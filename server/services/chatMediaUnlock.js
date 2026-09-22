/**
 * Paid chat media: the unlock, wallets, ledger and receipt commit together.
 * Callers perform the existing chat/gift authorization before entering here.
 */
const { createHash } = require("node:crypto");
const ChatRoom = require("../models/ChatRoom");
const MediaGift = require("../models/MediaGift");
const BuzzCoinLedger = require("../models/BuzzCoinLedger");
const { debitBuzzCoins, creditBuzzCoins, getWalletSnapshot } = require("./buzzCoinService");
const { normalizeGiftUnlockPrice } = require("./chatMessageBuilder");

function fail(statusCode, code, message = code) {
  throw Object.assign(new Error(message), { statusCode, code });
}

async function unlockChatMedia({ roomId, msgId, buyerId }) {
  roomId = String(roomId);
  msgId = String(msgId);
  buyerId = String(buyerId);
  const purchaseId = "chat_media_unlock_" + createHash("sha256")
    .update(JSON.stringify([roomId, msgId, buyerId])).digest("hex");

  // Each retry reads a fresh snapshot. Never carry a hydrated room across attempts.
  // No network signing or Socket.IO emits belong inside this retriable callback.
  return ChatRoom.db.transaction(async (session) => {
    const room = await ChatRoom.findOne({ roomId })
      .select({ participants: 1, messages: { $elemMatch: { id: msgId } } })
      .session(session).lean();
    if (!room) fail(404, "not_found");
    if (!(room.participants || []).map(String).includes(buyerId)) fail(403, "forbidden");
    let message = room.messages?.[0];
    if (!message) fail(404, "not_found");
    if (String(message.to) !== buyerId) fail(403, "only_receiver_can_unlock");

    const ownerId = String(message.from || "");
    const previouslyUnlocked = !message.gift?.locked ||
      (message.gift?.unlockedBy || []).map(String).includes(buyerId);
    let priceBC = normalizeGiftUnlockPrice(message.gift?.priceBC ?? message.gift?.amount ?? 0);
    let transactionId = String(message.gift?.unlockTransactionId || "");
    let alreadyUnlocked = previouslyUnlocked;
    let wallet;

    if (message.gift?.locked) {
      const changes = { "messages.$[media].gift.locked": false };
      const update = { $set: changes, $inc: { __v: 1 } };
      let receipt;
      if (!previouslyUnlocked) {
        // A completed receipt from the old non-transactional route is also proof
        // of payment. Repair its message marker without charging a second time.
        receipt = await MediaGift.findOne({ roomId, msgId, buyerId, sellerId: ownerId,
          giftId: "chat_media_unlock", placement: "chat", targetType: "chat_media",
          status: "completed" }).session(session).lean();
        if (receipt) {
          priceBC = Number(receipt.priceBC);
          transactionId = String(receipt.transactionId || "");
          if (!Number.isSafeInteger(priceBC) || priceBC <= 0 || !transactionId) {
            fail(409, "UNLOCK_RECONCILIATION_REQUIRED", "Existing payment needs reconciliation; no new charge was made.");
          }
          alreadyUnlocked = true;
        } else {
          // Old wallet operations were not atomic. An orphan ledger cannot safely
          // be interpreted as an unpaid request or automatically charged again.
          const priorLedger = await BuzzCoinLedger.exists({ source: "chat_media_unlock",
            "metadata.roomId": roomId, "metadata.msgId": msgId,
            userId: { $in: [buyerId, ownerId] }, type: { $in: ["gift_send", "gift_receive"] },
          }).session(session);
          if (priorLedger) {
            fail(409, "UNLOCK_RECONCILIATION_REQUIRED", "Existing payment needs reconciliation; no new charge was made.");
          }
          if (priceBC <= 0) fail(400, "invalid_unlock_price", "This gifted media does not have a valid BuzzCoin unlock price.");
          transactionId = purchaseId;
        }
        Object.assign(changes, {
          "messages.$[media].gift.amount": priceBC,
          "messages.$[media].gift.priceBC": priceBC,
          "messages.$[media].gift.currency": "BC",
          "messages.$[media].gift.unlockedAt": receipt ? new Date(receipt.createdAt) : new Date(),
          "messages.$[media].gift.unlockTransactionId": transactionId,
        });
        update.$addToSet = { "messages.$[media].gift.unlockedBy": buyerId };
      }

      // This conditional write serializes competing unlocks and preserves all
      // other messages. Incoming appends cause transaction retries, not stale saves.
      const claimed = await ChatRoom.updateOne({ roomId, participants: buyerId,
        messages: { $elemMatch: { id: msgId, to: buyerId, from: ownerId, "gift.locked": true } },
      }, update, { session, runValidators: true,
        arrayFilters: [{ "media.id": msgId, "media.to": buyerId, "media.from": ownerId, "media.gift.locked": true }],
      });
      if (claimed.modifiedCount !== 1) fail(409, "unlock_conflict", "Media changed; retry the unlock.");

      if (!alreadyUnlocked) {
        wallet = await debitBuzzCoins({ userId: buyerId, amountBC: priceBC, type: "gift_send",
          source: "chat_media_unlock", referenceId: transactionId, reason: "Unlocked gifted chat media",
          metadata: { roomId, msgId, mediaType: String(message.mediaType || ""), senderId: ownerId, receiverId: buyerId },
          session,
        });
        await creditBuzzCoins({ userId: ownerId, amountBC: priceBC, type: "gift_receive",
          source: "chat_media_unlock", referenceId: transactionId, walletBucket: "earned",
          reason: "Earned BuzzCoin from unlocked gifted chat media",
          metadata: { roomId, msgId, mediaType: String(message.mediaType || ""), senderId: ownerId, buyerId },
          session,
        });
        await MediaGift.create([{
          id: purchaseId, mediaId: msgId, ownerId, fromId: buyerId,
          giftId: "chat_media_unlock", priceBC, placement: "chat", targetType: "chat_media",
          targetId: msgId, transactionId, status: "completed", roomId, msgId,
          mediaType: String(message.mediaType || ""), buyerId, sellerId: ownerId,
          stickerId: String(message.gift?.stickerId || "sticker_basic"), amount: priceBC, createdAt: Date.now(),
        }], { session });
      }
      const updated = await ChatRoom.findOne({ roomId })
        .select({ messages: { $elemMatch: { id: msgId } } }).session(session).lean();
      message = updated?.messages?.[0];
      if (!message || message.gift?.locked || !(message.gift?.unlockedBy || []).map(String).includes(buyerId)) {
        fail(500, "UNLOCK_STATE_INVALID", "The message was not unlocked; payment was rolled back.");
      }
    }

    if (transactionId && !wallet) wallet = await getWalletSnapshot(buyerId, { session });
    return { ok: true, locked: false, alreadyUnlocked, ownerId, priceBC, transactionId,
      ...(wallet ? { wallet } : {}), message };
  }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary" });
}

module.exports = { unlockChatMedia };
