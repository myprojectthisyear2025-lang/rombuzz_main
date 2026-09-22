const { test } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const ChatRoom = require("../models/ChatRoom");
const MediaGift = require("../models/MediaGift");
const Wallet = require("../models/BuzzCoinWallet");
const Ledger = require("../models/BuzzCoinLedger");
const { unlockChatMedia } = require("../services/chatMediaUnlock");
const { appendMessage } = require("../services/chatPersistence");
const { debitBuzzCoins, creditBuzzCoins } = require("../services/buzzCoinService");

const purchase = { roomId: "seller_buyer", msgId: "paid", buyerId: "buyer" };
const paidMessage = () => ({ id: "paid", from: "seller", to: "buyer", type: "media",
  mediaType: "image", url: "https://example.test/paid.jpg", text: "paid media", time: new Date(),
  gift: { locked: true, priceBC: 10, amount: 10, unlockedBy: [] } });

test("chat media unlock is atomic and retryable against a real Mongo replica set", { timeout: 600000 }, async (t) => {
  const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 }, instanceOpts: [{ ip: "127.0.0.1" }] });
  t.after(async () => { await mongoose.disconnect(); await mongo.stop(); });
  await mongoose.connect(mongo.getUri(`rombuzz_unlock_test_${process.pid}`));
  for (const Model of [ChatRoom, MediaGift, Wallet, Ledger]) await Model.init();

  async function reset() {
    for (const Model of [ChatRoom, MediaGift, Wallet, Ledger]) await Model.deleteMany({});
    await ChatRoom.create({ roomId: purchase.roomId, participants: ["seller", "buyer"], messages: [paidMessage()] });
    await Wallet.create([{ userId: "buyer", balanceBC: 100 }, { userId: "seller" }]);
  }
  async function state() {
    const room = await ChatRoom.findOne({ roomId: purchase.roomId }).lean();
    return {
      room, message: room.messages.find((m) => m.id === "paid"),
      buyer: await Wallet.findOne({ userId: "buyer" }).lean(),
      seller: await Wallet.findOne({ userId: "seller" }).lean(),
      receipts: await MediaGift.find().lean(), ledger: await Ledger.find().lean(),
    };
  }
  async function assertPaidOnce() {
    const result = await state();
    assert.equal(result.buyer.balanceBC, 90);
    assert.equal(result.seller.earnedBC, 10);
    assert.equal(result.seller.balanceBC, 0);
    assert.equal(result.receipts.length, 1);
    assert.equal(result.ledger.length, 2);
    assert.equal(result.ledger.filter((l) => l.type === "gift_send" && l.amountBC === -10).length, 1);
    assert.equal(result.ledger.filter((l) => l.type === "gift_receive" && l.amountBC === 10).length, 1);
    assert.equal(result.message.gift.locked, false);
    assert.deepEqual(result.message.gift.unlockedBy, ["buyer"]);
    assert.equal(result.message.gift.unlockTransactionId, result.receipts[0].transactionId);
    assert.ok(result.ledger.every((l) => l.referenceId === result.receipts[0].transactionId));
    return result;
  }

  await t.test("simultaneous duplicate unlocks and incoming messages charge exactly once", async () => {
    await reset();
    const operations = Array.from({ length: 8 }, () => unlockChatMedia(purchase));
    const incoming = Array.from({ length: 5 }, (_, i) => appendMessage(purchase.roomId, ["seller", "buyer"],
      { id: `incoming-${i}`, from: "seller", to: "buyer", text: `message ${i}`, time: new Date() }));
    const results = (await Promise.all([...operations, ...incoming])).slice(0, operations.length);
    assert.equal(results.filter((r) => !r.alreadyUnlocked).length, 1);
    assert.equal(new Set(results.map((r) => r.transactionId)).size, 1);
    const final = await assertPaidOnce();
    assert.equal(final.room.messages.length, 6);
  });

  await t.test("a message arriving after the snapshot causes a safe transaction retry", async (ctx) => {
    await reset();
    const original = ChatRoom.updateOne;
    let attempts = 0;
    const mocked = ctx.mock.method(ChatRoom, "updateOne", async function (filter, update, options) {
      if (options?.session && update.$set?.["messages.$[media].gift.locked"] === false) {
        attempts++;
        if (attempts === 1) await appendMessage(purchase.roomId, ["seller", "buyer"],
          { id: "between-read-and-write", from: "seller", to: "buyer", text: "keep me", time: new Date() });
      }
      return original.call(this, filter, update, options);
    });
    try { await unlockChatMedia(purchase); } finally { mocked.mock.restore(); }
    assert.ok(attempts >= 2, `Expected transaction retry, got ${attempts} attempt(s)`);
    const result = await assertPaidOnce();
    assert.ok(result.room.messages.some((m) => m.id === "between-read-and-write"));
  });

  for (const stage of ["debit-ledger", "credit-ledger", "receipt"]) {
    await t.test(`failure after ${stage} rolls back every write; retry pays once`, async (ctx) => {
      await reset();
      const Model = stage === "receipt" ? MediaGift : Ledger;
      const original = Model.create;
      const mocked = ctx.mock.method(Model, "create", async function (...args) {
        const saved = await original.apply(this, args);
        const entry = args[0][0];
        if (stage === "receipt" || (stage === "debit-ledger" && entry.type === "gift_send") ||
          (stage === "credit-ledger" && entry.type === "gift_receive")) throw new Error(`injected-${stage}`);
        return saved;
      });
      try { await assert.rejects(unlockChatMedia(purchase), new RegExp(`injected-${stage}`)); }
      finally { mocked.mock.restore(); }
      const aborted = await state();
      assert.equal(aborted.buyer.balanceBC, 100);
      assert.equal(aborted.seller.earnedBC, 0);
      assert.equal(aborted.receipts.length, 0);
      assert.equal(aborted.ledger.length, 0);
      assert.equal(aborted.message.gift.locked, true);
      assert.deepEqual(aborted.message.gift.unlockedBy, []);
      assert.equal(aborted.room.__v, 0);
      await unlockChatMedia(purchase);
      assert.equal((await unlockChatMedia(purchase)).alreadyUnlocked, true);
      await assertPaidOnce();
    });
  }

  await t.test("lost response and unknown commit result do not repeat payment", async (ctx) => {
    await reset();
    const originalStart = ChatRoom.db.startSession;
    let commitAttempts = 0;
    const mocked = ctx.mock.method(ChatRoom.db, "startSession", async function (...args) {
      const session = await originalStart.apply(this, args);
      const originalCommit = session.commitTransaction.bind(session);
      session.commitTransaction = async () => {
        const result = await originalCommit();
        commitAttempts++;
        if (commitAttempts === 1) {
          const error = new mongoose.mongo.MongoServerError({ message: "Lost commit acknowledgment" });
          error.addErrorLabel("UnknownTransactionCommitResult");
          throw error;
        }
        return result;
      };
      return session;
    });
    try { await unlockChatMedia(purchase); } finally { mocked.mock.restore(); }
    assert.ok(commitAttempts >= 2);
    // The first HTTP result could be lost after commit; replay from another request.
    const replay = await unlockChatMedia(purchase);
    assert.equal(replay.alreadyUnlocked, true);
    assert.equal(replay.wallet.balanceBC, 90);
    const result = await assertPaidOnce();
    assert.equal(replay.transactionId, result.receipts[0].transactionId);
  });

  await t.test("insufficient funds and locked seller roll back the unlock and debit", async () => {
    await reset();
    await Wallet.updateOne({ userId: "buyer" }, { $set: { balanceBC: 5 } });
    await assert.rejects(unlockChatMedia(purchase), { code: "INSUFFICIENT_BUZZCOIN", statusCode: 402 });
    assert.equal((await state()).message.gift.locked, true);
    await Wallet.updateOne({ userId: "buyer" }, { $set: { balanceBC: 100 } });
    await Wallet.updateOne({ userId: "seller" }, { $set: { locked: true } });
    await assert.rejects(unlockChatMedia(purchase), { code: "WALLET_LOCKED", statusCode: 403 });
    const result = await state();
    assert.equal(result.buyer.balanceBC, 100);
    assert.equal(result.message.gift.locked, true);
    assert.equal(result.receipts.length, 0);
    assert.equal(result.ledger.length, 0);
    await Wallet.updateOne({ userId: "seller" }, { $set: { locked: false } });
    await unlockChatMedia(purchase);
    await assertPaidOnce();
  });

  await t.test("transaction-created seller wallet is rolled back on failure", async (ctx) => {
    await reset();
    await Wallet.deleteOne({ userId: "seller" });
    const original = MediaGift.create;
    const mocked = ctx.mock.method(MediaGift, "create", async function (...args) {
      await original.apply(this, args);
      throw new Error("after-new-wallet");
    });
    try { await assert.rejects(unlockChatMedia(purchase), /after-new-wallet/); }
    finally { mocked.mock.restore(); }
    assert.equal(await Wallet.countDocuments({ userId: "seller" }), 0);
    assert.equal((await state()).buyer.balanceBC, 100);
    await unlockChatMedia(purchase);
    await assertPaidOnce();
  });

  await t.test("a stale room save cannot overwrite a committed unlock", async () => {
    await reset();
    const stale = await ChatRoom.findOne({ roomId: purchase.roomId });
    await unlockChatMedia(purchase);
    stale.messages[0].gift.priceBC = 99;
    await assert.rejects(stale.save(), { name: "VersionError" });
    await assertPaidOnce();
  });

  await t.test("legacy completed receipt repairs a locked message without another payment", async () => {
    await reset();
    const metadata = { roomId: purchase.roomId, msgId: purchase.msgId };
    await debitBuzzCoins({ userId: "buyer", amountBC: 10, type: "gift_send", source: "chat_media_unlock",
      referenceId: "legacy-payment", metadata });
    await creditBuzzCoins({ userId: "seller", amountBC: 10, type: "gift_receive", source: "chat_media_unlock",
      referenceId: "legacy-payment", walletBucket: "earned", metadata });
    await MediaGift.create({ id: "legacy-receipt", mediaId: "paid", ownerId: "seller", fromId: "buyer",
      giftId: "chat_media_unlock", priceBC: 10, placement: "chat", targetType: "chat_media",
      targetId: "paid", transactionId: "legacy-payment", status: "completed", roomId: purchase.roomId,
      msgId: "paid", mediaType: "image", buyerId: "buyer", sellerId: "seller", amount: 10 });
    const result = await unlockChatMedia(purchase);
    assert.equal(result.transactionId, "legacy-payment");
    assert.equal(result.alreadyUnlocked, true);
    await assertPaidOnce();
  });

  await t.test("an orphan legacy ledger fails closed instead of charging again", async () => {
    await reset();
    await debitBuzzCoins({ userId: "buyer", amountBC: 10, type: "gift_send", source: "chat_media_unlock",
      referenceId: "incomplete-legacy", metadata: { roomId: purchase.roomId, msgId: "paid" } });
    for (let i = 0; i < 2; i++) await assert.rejects(unlockChatMedia(purchase), { code: "UNLOCK_RECONCILIATION_REQUIRED" });
    const result = await state();
    assert.equal(result.buyer.balanceBC, 90);
    assert.equal(result.seller.earnedBC, 0);
    assert.equal(result.ledger.length, 1);
    assert.equal(result.receipts.length, 0);
    assert.equal(result.message.gift.locked, true);
  });

  await t.test("existing unlockedBy marker repairs without payment; only receiver may unlock", async () => {
    await reset();
    await assert.rejects(unlockChatMedia({ ...purchase, buyerId: "seller" }), { code: "only_receiver_can_unlock" });
    await assert.rejects(unlockChatMedia({ ...purchase, buyerId: "stranger" }), { code: "forbidden" });
    await ChatRoom.updateOne({ roomId: purchase.roomId }, { $set: { "messages.0.gift.unlockedBy": ["buyer"] } });
    assert.equal((await unlockChatMedia(purchase)).alreadyUnlocked, true);
    const result = await state();
    assert.equal(result.buyer.balanceBC, 100);
    assert.equal(result.seller.earnedBC, 0);
    assert.equal(result.receipts.length, 0);
    assert.equal(result.ledger.length, 0);
    assert.equal(result.message.gift.locked, false);
  });
});
