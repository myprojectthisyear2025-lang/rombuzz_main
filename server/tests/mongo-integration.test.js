/**
 * Path: server/tests/mongo-integration.test.js
 * Purpose: Real Mongo, HTTP, Socket.IO, importer rerun, and backend restart regression checks.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const { planMigration, applyPlan } = require("../scripts/lowdb/planner");
const { models } = require("../scripts/lowdb/mappings");
const { expireMessages } = require("../services/messageExpiry");
const { appendMessage } = require("../services/chatPersistence");
const { legacyFixture } = require("./fixtures");
const { startBackend, stopBackend, request, connectClient, emit, event } = require("./integrationHelpers");

test("Mongo migration and application persistence", { timeout: 600000 }, async (t) => {
  const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 }, instanceOpts: [{ ip: "127.0.0.1" }] });
  const uri = mongo.getUri(`rombuzz_migration_test_${process.pid}`);
  let backend;
  const clients = [];
  t.after(async () => {
    clients.forEach((s) => s.disconnect());
    if (backend) await stopBackend(backend);
    await mongoose.disconnect();
    await mongo.stop();
  });
  await mongoose.connect(uri, { autoIndex: false, autoCreate: false });
  const fixture = legacyFixture();
  await models.users.create({ ...fixture.users[0], bio: "Mongo-only profile detail" });
  await t.test("dry-run is read-only; import preserves ids; repeat import is a no-op", async () => {
    const collectionsBefore = (await mongoose.connection.db.listCollections().toArray()).map((c) => c.name).sort();
    const plan = await planMigration(fixture, { connected: true });
    assert.deepEqual((await mongoose.connection.db.listCollections().toArray()).map((c) => c.name).sort(), collectionsBefore);
    assert.equal(plan.report.valid, true, JSON.stringify(plan.report.issues));
    assert.equal(await models.users.countDocuments(), 1);
    assert.equal(plan.report.collections.users.duplicates, 1);
    await applyPlan(plan);
    assert.equal(plan.report.totals.migrated, 13);
    assert.equal((await models.users.findOne({ id: "alice" }).lean()).bio, "Mongo-only profile detail");
    const room = await models.roomMessages.findOne({ roomId: "alice_bob" }).lean();
    assert.equal(room.messages[0].reactions.bob, "heart");
    assert.equal(room.messages[0].seen, true);
    const second = await planMigration(fixture, { connected: true });
    assert.equal(second.report.valid, true, JSON.stringify(second.report.issues));
    assert.equal(second.report.totals.planned, 0);
    assert.equal(second.report.totals.skipped, 13);
    await applyPlan(second);
    assert.equal(await models.matches.countDocuments(), 1);
  });
  await t.test("conflicting Mongo values fail before any write; receipts prevent resurrection", async () => {
    const conflict = legacyFixture(); conflict.users[0].firstName = "different";
    const plan = await planMigration(conflict, { connected: true });
    assert.equal(plan.report.valid, false);
    await assert.rejects(applyPlan(plan), /Preflight/);
    await models.reports.deleteOne({ id: "report-old" });
    const repeat = await planMigration(fixture, { connected: true });
    await applyPlan(repeat);
    assert.equal(await models.reports.countDocuments(), 0);
  });
  // Build existing indexes after import as deployment does; do not build indexes during dry-run.
  for (const name of ["users", "matches", "messages", "roomMessages", "posts", "stories", "relationships"]) {
    await models[name].createIndexes();
  }
  backend = await startBackend(uri);
  const alice = await connectClient(backend, "alice"); clients.push(alice);
  let bob = await connectClient(backend, "bob"); clients.push(bob);
  const roomId = "alice_bob";
  await t.test("socket authorization rejects identity spoofing and unrelated room access", async () => {
    const carol = await connectClient(backend, "carol"); clients.push(carol);
    assert.equal((await emit(carol, "joinRoom", roomId)).ok, false);
    assert.equal((await emit(alice, "sendMessage", { roomId, id: "forged", from: "carol", text: "forged" })).ok, false);
    assert.equal((await emit(alice, "message:seen", { roomId, msgId: "room-old" })).ok, false);
    assert.equal(await models.roomMessages.countDocuments({ "messages.id": "forged" }), 0);
  });
  await t.test("socket send/receive and HTTP retries share one durable message", async () => {
    assert.equal((await emit(alice, "joinRoom", roomId)).ok, true);
    assert.equal((await emit(bob, "joinRoom", roomId)).ok, true);
    const received = event(bob, "chat:message", (m) => m.id === "socket-one");
    const packet = { roomId, from: "alice", to: "bob", id: "socket-one", text: "persist me" };
    const sent = await emit(alice, "sendMessage", packet);
    assert.equal(sent.ok, true, JSON.stringify(sent));
    assert.equal((await received).text, "persist me");
    await Promise.all([emit(alice, "sendMessage", packet), request(backend, "alice", `/chat/rooms/${roomId}`, { method: "POST", body: { id: packet.id, text: packet.text } })]);
    const room = await models.roomMessages.findOne({ roomId }).lean();
    assert.equal(room.messages.filter((m) => m.id === packet.id).length, 1);
    assert.equal((await request(backend, "bob", "/chat/unread-summary")).total, 1);
  });
  await t.test("typing and seen preserve payloads and update Mongo unread state", async () => {
    const typed = event(alice, "typing");
    assert.equal((await emit(bob, "typing", { roomId, from: "bob", to: "alice", typing: true })).ok, true);
    assert.equal((await typed).fromId, "bob");
    const receipt = event(alice, "message:seen");
    assert.equal((await emit(bob, "message:seen", { roomId, msgId: "socket-one", from: "bob", to: "alice" })).ok, true);
    assert.equal(await receipt, "socket-one");
    assert.equal((await request(backend, "bob", "/chat/unread-summary")).total, 0);
    const room = await models.roomMessages.findOne({ roomId }).lean();
    assert.equal(room.messages.find((m) => m.id === "socket-one").seen, true);
    await request(backend, "bob", `/chat/rooms/${roomId}/prefs`, { method: "PATCH", body: { forceUnread: true } });
    assert.equal((await request(backend, "bob", "/chat/unread-summary")).total, 1);
    await request(backend, "bob", "/chat/mark-read", { method: "POST", body: { peerId: "alice" } });
    assert.equal((await request(backend, "bob", "/chat/unread-summary")).total, 0);
    await request(backend, "bob", `/chat/rooms/${roomId}/prefs`, { method: "PATCH", body: { forceUnread: true } });
    assert.equal((await request(backend, "bob", "/chat/unread-summary")).total, 1);
    await request(backend, "bob", "/chat/mark-all-read", { method: "POST", body: {} });
    assert.equal((await request(backend, "bob", "/chat/unread-summary")).total, 0);
  });
  await t.test("HTTP message edit, react, pagination, and delete remain Mongo-backed", async () => {
    await request(backend, "alice", `/chat/rooms/${roomId}/socket-one`, { method: "PATCH", body: { text: "edited" } });
    await request(backend, "bob", `/chat/rooms/${roomId}/socket-one/react`, { method: "POST", body: { emoji: "heart" } });
    const page = await request(backend, "bob", `/chat/rooms/${roomId}?limit=1`);
    assert.equal(page.paginated, true);
    assert.equal(page.messages.at(-1).text, "edited");
    assert.equal(page.messages.at(-1).reactions.bob, "heart");
    assert.ok(Array.isArray(await request(backend, "alice", `/chat/rooms/${roomId}`)));
    await request(backend, "alice", `/chat/rooms/${roomId}`, { method: "POST", body: { id: "delete-me", text: "delete" } });
    await request(backend, "alice", `/chat/rooms/${roomId}/delete-me?scope=all`, { method: "DELETE" });
    assert.equal(await models.roomMessages.countDocuments({ "messages.id": "delete-me" }), 0);
  });
  await t.test("posts, comments, reactions, bookmarks and matched stories retain their contracts", async () => {
    const post = await request(backend, "alice", "/posts", { method: "POST", body: { text: "new post", type: "image" } });
    assert.ok((await request(backend, "bob", "/posts/matches")).posts.some((p) => p.id === post.post.id));
    await request(backend, "bob", `/posts/${post.post.id}/react`, { method: "POST", body: {} });
    assert.equal((await models.posts.findOne({ id: post.post.id }).lean()).reactions.bob, true);
    const reaction = await request(backend, "bob", `/buzz/posts/${post.post.id}/react`, { method: "POST", body: { emoji: "smile" } });
    assert.equal(reaction.reactionCounts.smile, 1);
    assert.equal((await models.posts.findOne({ id: post.post.id }).lean()).reactions.bob, "smile");
    await request(backend, "bob", `/buzz/posts/${post.post.id}/react`, { method: "DELETE" });
    assert.equal((await models.posts.findOne({ id: post.post.id }).lean()).reactions.bob, undefined);
    const toggled = await request(backend, "bob", `/buzz/posts/${post.post.id}/react-emoji`, { method: "POST", body: { emoji: "heart" } });
    assert.equal(toggled.reactions.bob, "heart");
    await request(backend, "bob", `/buzz/posts/${post.post.id}/bookmark`, { method: "POST", body: {} });
    assert.ok((await request(backend, "bob", "/buzz/bookmarks")).posts.some((p) => p.id === post.post.id));
    await request(backend, "bob", `/buzz/posts/${post.post.id}/bookmark`, { method: "DELETE" });
    await request(backend, "bob", "/posts/post-old/comments/comment-old", { method: "PATCH", body: { text: "comment edited" } });
    await request(backend, "alice", "/posts/post-old/comments/comment-old/react-emoji", { method: "POST", body: { emoji: "smile" } });
    assert.equal((await models.posts.findOne({ id: "post-old" }).lean()).comments[0].reactions.alice, "smile");
    const story = await request(backend, "alice", "/stories", { method: "POST", body: { text: "new story" } });
    assert.equal((await request(backend, "bob", "/stories/feed")).users[0].user.id, "alice");
    await request(backend, "bob", `/stories/${story.story.id}/view`, { method: "POST", body: {} });
    assert.ok((await models.stories.findOne({ id: story.story.id }).lean()).views.includes("bob"));
    await request(backend, "alice", `/posts/${post.post.id}`, { method: "DELETE" });
  });
  await t.test("view-once and expired direct messages are deleted from Mongo", async () => {
    const removed = event(alice, "message:removed", (p) => p.id === "direct-old");
    assert.equal((await emit(bob, "message:seen", { roomId, msgId: "direct-old" })).ok, true);
    await removed;
    assert.equal(await models.messages.countDocuments({ id: "direct-old" }), 0);
    await models.messages.create({ id: "expired", from: "alice", to: "bob", expireAt: new Date(1) });
    await expireMessages(null);
    assert.equal(await models.messages.countDocuments({ id: "expired" }), 0);
  });
  await t.test("room view-once media persists until opened and retains its gift/reply metadata", async () => {
    const text = `::RBZ::${JSON.stringify({ type: "media", mediaType: "image", url: "https://example.test/media.jpg", ephemeral: "once" })}`;
    const result = await emit(alice, "sendMessage", { roomId, id: "once-room", text, replyTo: { id: "socket-one", from: "alice", text: "edited" } });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.message.replyTo.id, "socket-one");
    await emit(bob, "message:seen", { roomId, msgId: "once-room" });
    assert.equal(await models.roomMessages.countDocuments({ "messages.id": "once-room" }), 1);
    await request(backend, "bob", `/chat/rooms/${roomId}/once-room/viewed`, { method: "POST", body: {} });
    assert.equal(await models.roomMessages.countDocuments({ "messages.id": "once-room" }), 0);
  });
  await t.test("underscore-containing account ids work through socket and HTTP history", async () => {
    await models.users.create({ id: "under_score", email: "underscore@example.test" });
    await models.matches.create({ id: "underscore-match", users: ["alice", "under_score"] });
    const peer = await connectClient(backend, "under_score"); clients.push(peer);
    const rid = "alice_under_score";
    assert.equal((await emit(peer, "sendMessage", { roomId: rid, id: "underscore-msg", text: "id preserved" })).ok, true);
    assert.equal((await request(backend, "alice", `/chat/rooms/${rid}`))[0].id, "underscore-msg");
  });
  await t.test("paid media HTTP retries preserve wallets, receipt, socket event and concurrent messages", async () => {
    const Wallet = require("../models/BuzzCoinWallet");
    const Ledger = require("../models/BuzzCoinLedger");
    const MediaGift = require("../models/MediaGift");
    await Wallet.updateOne({ userId: "bob" }, { $set: { balanceBC: 100 } }, { upsert: true });
    await Wallet.updateOne({ userId: "alice" }, { $set: { earnedBC: 0 } }, { upsert: true });
    const text = `::RBZ::${JSON.stringify({ type: "media", mediaType: "image", url: "https://example.test/paid.jpg",
      gift: { locked: true, priceBC: 10 } })}`;
    await request(backend, "alice", `/chat/rooms/${roomId}`, { method: "POST", body: { id: "paid-http", text } });
    const unlocked = event(alice, "chat:gift:unlocked", (payload) => payload.msgId === "paid-http");
    const options = { method: "POST", body: { priceBC: 1 } }; // Client price must remain ignored.
    const [first, duplicate, incoming] = await Promise.all([
      request(backend, "bob", `/chat/rooms/${roomId}/paid-http/unlock`, options),
      request(backend, "bob", `/chat/rooms/${roomId}/paid-http/unlock`, options),
      emit(bob, "sendMessage", { roomId, id: "during-unlock", text: "preserved" }),
    ]);
    assert.equal(incoming.ok, true);
    assert.equal(first.transactionId, duplicate.transactionId);
    assert.equal(first.priceBC, 10);
    assert.equal(first.wallet.balanceBC, 90);
    assert.equal(duplicate.wallet.balanceBC, 90);
    const notification = await unlocked;
    assert.equal(notification.transactionId, first.transactionId);
    assert.equal(notification.unlockedBy, "bob");
    assert.equal(notification.message.gift.locked, false);
    assert.equal((await request(backend, "bob", `/chat/rooms/${roomId}/paid-http/unlock`, options)).alreadyUnlocked, true);
    assert.equal(await MediaGift.countDocuments({ roomId, msgId: "paid-http", buyerId: "bob" }), 1);
    assert.equal(await Ledger.countDocuments({ referenceId: first.transactionId }), 2);
    assert.equal((await Wallet.findOne({ userId: "alice" }).lean()).earnedBC, 10);
    const history = await request(backend, "bob", `/chat/rooms/${roomId}`);
    assert.ok(history.some((message) => message.id === "during-unlock"));
    assert.equal(history.find((message) => message.id === "paid-http").gift.locked, false);
    await request(backend, "bob", "/chat/mark-read", { method: "POST", body: { peerId: "alice" } });
  });
  await t.test("a stale room save cannot discard a concurrent atomic message append", async () => {
    const stale = await models.roomMessages.findOne({ roomId });
    await appendMessage(roomId, ["alice", "bob"], { id: "concurrent", from: "bob", to: "alice", text: "kept", time: new Date() });
    stale.messages.splice(0, 1);
    await assert.rejects(stale.save(), { name: "VersionError" });
    assert.equal(await models.roomMessages.countDocuments({ "messages.id": "concurrent" }), 1);
  });
  await t.test("reconnect and backend process restart preserve history, edits, read state and deletions", async () => {
    bob.disconnect();
    bob = await connectClient(backend, "bob"); clients.push(bob);
    assert.equal((await emit(bob, "joinRoom", roomId)).ok, true);
    clients.forEach((s) => s.disconnect());
    await stopBackend(backend);
    backend = await startBackend(uri);
    bob = await connectClient(backend, "bob"); clients.push(bob);
    assert.equal((await emit(bob, "joinRoom", roomId)).ok, true);
    const history = await request(backend, "bob", `/chat/rooms/${roomId}`);
    assert.equal(history.find((m) => m.id === "socket-one").text, "edited");
    assert.equal(history.find((m) => m.id === "socket-one").seen, true);
    assert.equal(history.some((m) => m.id === "delete-me"), false);
    assert.equal((await request(backend, "bob", "/chat/unread-summary")).total, 0);
    assert.ok((await models.users.findOne({ id: "bob" }).lean()).lastOnline);
  });
  await t.test("block and unmatch stop socket writes, and matches can be recreated through HTTP", async () => {
    await request(backend, "alice", "/block", { method: "POST", body: { userId: "bob", targetId: "bob" } });
    assert.equal((await emit(bob, "sendMessage", { roomId, id: "blocked-send", text: "blocked" })).ok, false);
    await request(backend, "alice", "/unblock", { method: "POST", body: { userId: "bob", targetId: "bob" } });
    await request(backend, "alice", "/unmatch/bob", { method: "POST", body: {} });
    assert.equal((await emit(bob, "sendMessage", { roomId, id: "unmatched-send", text: "unmatched" })).ok, false);
    assert.deepEqual((await request(backend, "bob", "/posts/matches")).posts, []);
    assert.deepEqual((await request(backend, "bob", "/stories/feed")).users, []);
    await request(backend, "alice", "/likes", { method: "POST", body: { to: "bob" } });
    await request(backend, "bob", "/likes", { method: "POST", body: { to: "alice" } });
    assert.equal(await models.matches.countDocuments({ users: { $all: ["alice", "bob"] } }), 1);
    assert.equal((await emit(bob, "sendMessage", { roomId, id: "rematched", text: "works" })).ok, true);
  });
});
