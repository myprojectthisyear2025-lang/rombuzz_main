/**
 * Path: server/services/messageExpiry.js
 * Purpose: One Mongo-backed expiry job per server, independent of socket churn.
 */
const Message = require("../models/Message");
const ChatRoom = require("../models/ChatRoom");

async function expireMessages(io, now = new Date()) {
  const expired = await Message.find({ expireAt: { $lte: now } }).select("id from to").lean();
  for (const message of expired) {
    const result = await Message.deleteOne({ id: message.id, expireAt: { $lte: now } });
    if (result.deletedCount) io?.to(message.from).to(message.to)
      .emit("message:removed", { id: message.id });
  }
  const rooms = ChatRoom.find({ "messages.expireAt": { $lte: now } })
    .select("roomId participants messages.id messages.expireAt").lean().cursor();
  for await (const room of rooms) {
    const ids = room.messages.filter((m) => m.expireAt && new Date(m.expireAt) <= now).map((m) => m.id);
    await ChatRoom.updateOne({ roomId: room.roomId }, { $pull: { messages: { expireAt: { $lte: now } } }, $inc: { __v: 1 } });
    for (const id of ids) {
      const target = io?.to(room.roomId).to(room.participants);
      target?.emit("message:removed", { id });
      target?.emit("chat:ephemeral:expired", { roomId: room.roomId, msgId: id });
    }
  }
}

function startMessageExpiryJob(io) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { await expireMessages(io); }
    catch { console.error("Message expiry failed; will retry on the next run."); }
    finally { running = false; }
  };
  void run();
  const timer = setInterval(run, 60 * 60 * 1000);
  timer.unref();
  return () => clearInterval(timer);
}

module.exports = { expireMessages, startMessageExpiryJob };
