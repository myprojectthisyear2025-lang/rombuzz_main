const { test } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const ChatRoom = require("../models/ChatRoom");
const User = require("../models/User");
const Match = require("../models/Match");
const { computeUnreadSummaryForUser, countUnreadForRoom } = require("../services/chatUnread");
const { unreadRoomsPipeline } = require("../services/chatUnreadQuery");

test("unread aggregation preserves counts, peer eligibility and bounded result payload", { timeout: 180000 }, async (t) => {
  const mongo = await MongoMemoryServer.create({ instance: { ip: "127.0.0.1" } });
  t.after(async () => { await mongoose.disconnect(); await mongo.stop(); });
  await mongoose.connect(mongo.getUri(`unread_test_${process.pid}`), { autoIndex: false });
  const me = "reader", past = new Date("2020-01-01"), time = new Date("2021-01-01"), future = new Date("2099-01-01");
  const message = (id, patch = {}) => ({ id, from: "peer", to: me, time, ...patch });
  const fixtures = [
    { roomId: "reader_peer", participants: [me, "peer"], lastReadAtByUser: { [me]: past }, messages: [
      message("new"), message("outgoing", { from: me, to: "peer" }),
      message("seen", { seen: true }), message("deleted", { deleted: true }),
      message("hidden", { hiddenFor: [me] }), message("visible", { hiddenFor: ["someone"] }),
      message("expired", { expireAt: past }), message("future", { expireAt: future }),
      message("old", { time: new Date("2019-01-01") }), message("boundary", { time: past }),
      message("missing-time", { time: undefined }), message("null-time", { time: null }),
    ] },
    { roomId: "manual", participants: [me, "manual"], messages: [], chatPrefsByUser: { [me]: { forceUnread: true } } },
    { roomId: "manual-real", participants: [me, "manual-real"], messages: [message("one"), message("two")], chatPrefsByUser: { [me]: { forceUnread: true, muted: true, deletedForMe: true } } },
    { roomId: "empty", participants: [me, "empty"] },
    { roomId: "pending", participants: [me, "pending"], messages: [message("pending")] },
    { roomId: "deleting", participants: [me, "deleting"], messages: [message("deleting")] },
    { roomId: "unmatched", participants: [me, "unmatched"], messages: [message("unmatched")] },
    { roomId: "missing-user", participants: [me, "missing-user"], messages: [message("missing-user")] },
    { roomId: "legacy", participants: [me, "legacy"], messages: [message("legacy")] },
    { roomId: "legacy-reverse", participants: [me, "legacy-reverse"], messages: [message("legacy-reverse")] },
  ];
  // Store through Mongoose like application writes, then remove a legacy time
  // field directly to verify parity with the old hydration default.
  await ChatRoom.insertMany(fixtures);
  await ChatRoom.collection.updateOne({ roomId: "reader_peer" }, { $unset: { "messages.10.time": "" } });
  const peers = fixtures.map(r => r.participants[1]);
  await User.collection.insertMany(peers.filter(id => id !== "missing-user").map(id => ({ id,
    ...(id === "pending" ? { visibility: "pending_delete" } : {}),
    ...(id === "deleting" ? { deleteStatus: "pending_delete" } : {}),
  })));
  await Match.collection.insertMany(peers.filter(id => id !== "unmatched").map(id => ({ id: `match-${id}`,
    ...(id === "legacy" ? { status: "matched", user1: me, user2: id }
      : id === "legacy-reverse" ? { status: "matched", user1: id, user2: me } : { users: [me, id] }),
  })));
  await t.test("each room agrees with the original hydrated counter", async () => {
    const rooms = await ChatRoom.find({ participants: me });
    const results = await ChatRoom.aggregate(unreadRoomsPipeline(me));
    for (const room of rooms) {
      const result = results.find(r => r.participants[1] === room.participants[1]);
      assert.equal(result.unreadCount, countUnreadForRoom(room, me), room.roomId);
      assert.deepEqual(Object.keys(result).sort(), ["participants", "unreadCount"]);
    }
    assert.equal(results.find(r => r.participants[1] === "peer").unreadCount, 4);
  });
  await t.test("modern/legacy matches and pending-delete exclusions retain the API contract", async () => {
    assert.deepEqual(await computeUnreadSummaryForUser(me), {
      total: 9, byPeer: { peer: 4, manual: 1, "manual-real": 2, legacy: 1, "legacy-reverse": 1 },
    });
    assert.deepEqual(await computeUnreadSummaryForUser("no-rooms"), { total: 0, byPeer: {} });
  });
  await t.test("history/media stay inside Mongo and the existing participants index is usable", async () => {
    await ChatRoom.collection.insertMany(Array.from({ length: 120 }, (_, i) => ({ roomId: `unrelated-${i}`, participants: [`x-${i}`, `y-${i}`], messages: [] })));
    const history = Array.from({ length: 1000 }, (_, i) => message(`history-${i}`, {
      seen: true, text: "x".repeat(1000), url: "https://example.invalid/large-media-key", replyTo: { text: "y".repeat(1000) },
    }));
    await ChatRoom.collection.updateOne({ roomId: "reader_peer" }, { $push: { messages: { $each: history } } });
    await ChatRoom.collection.createIndex({ participants: 1, updatedAt: -1 });
    const pipeline = unreadRoomsPipeline(me);
    const result = await ChatRoom.aggregate(pipeline);
    const before = await ChatRoom.find({ participants: me }).lean();
    const beforeBytes = Buffer.byteLength(JSON.stringify(before)), afterBytes = Buffer.byteLength(JSON.stringify(result));
    assert.ok(afterBytes < beforeBytes / 100, `${beforeBytes} -> ${afterBytes}`);
    assert.equal(result.find(r => r.participants[1] === "peer").unreadCount, 4);
    const plan = await ChatRoom.aggregate(pipeline).explain("executionStats");
    const cursor = plan.stages?.find(stage => stage.$cursor)?.$cursor || plan;
    assert.match(JSON.stringify(cursor.queryPlanner.winningPlan), /IXSCAN/);
    assert.equal(cursor.executionStats.totalDocsExamined, fixtures.length);
    t.diagnostic(`Synthetic Mongo result: ${beforeBytes} -> ${afterBytes} bytes; examined ${cursor.executionStats.totalDocsExamined} eligible room documents using the existing index.`);
  });
});
