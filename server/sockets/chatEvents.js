/**
 * Path: server/sockets/chatEvents.js
 * Purpose: Persist socket chat in MongoDB before publishing existing realtime events.
 */
const Message = require("../models/Message");
const { authorizeRoom, appendMessage, markRoomSeen, validKey } = require("../services/chatPersistence");
const { buildChatMessage } = require("../services/chatMessageBuilder");
const { signChatMessageMedia } = require("../services/chatMessageMedia");
const { computeUnreadSummaryForUser } = require("../services/chatUnread");
const { ensureFeatureAllowed } = require("../utils/moderation");

function registerChatEvents(io, socket) {
  const me = socket.userId;
  const handle = (event, fn) => socket.on(event, async (packet = {}, ack) => {
    try {
      const result = await fn(packet);
      if (typeof ack === "function") ack({ ok: true, ...result });
    } catch (err) {
      const known = ["blocked", "forbidden", "not_matched", "user_not_found", "invalid_message_id", "message_id_conflict"];
      const reason = known.includes(err.message) ? err.message : "operation_failed";
      socket.emit("warn", { roomId: packet?.roomId, reason, message: "Chat operation could not be completed." });
      if (typeof ack === "function") ack({ ok: false, error: reason });
    }
  });
  handle("joinRoom", async (roomId) => {
    await authorizeRoom(roomId, me);
    await socket.join(roomId);
  });
  socket.on("leaveRoom", (roomId) => {
    if (validKey(roomId) && roomId !== me) socket.leave(roomId);
  });
  handle("typing", async (packet) => {
    const { peerId } = await authorizeRoom(packet.roomId, me);
    socket.to(packet.roomId).to(peerId).emit("typing", {
      roomId: packet.roomId, from: me, fromId: me, to: peerId,
      typing: packet.typing === undefined ? true : !!packet.typing,
    });
  });
  handle("sendMessage", async (packet) => {
    await ensureFeatureAllowed(me, "chat");
    const { participants, peerId } = await authorizeRoom(packet.roomId, me);
    if ((packet.from && packet.from !== me) || (packet.to && packet.to !== peerId)) throw new Error("forbidden");
    let text = packet.text;
    if (!text && typeof packet.url === "string") {
      text = `::RBZ::${JSON.stringify({ type: "media", mediaType: packet.type === "video" ? "video" : "image", url: packet.url })}`;
    }
    if (typeof text !== "string" || !text || text.length > 100000) throw new Error("forbidden");
    const message = buildChatMessage({ text, replyTo: packet.replyTo, id: packet.id, fromId: me, toId: peerId });
    const saved = await appendMessage(packet.roomId, participants, message);
    const signed = await signChatMessageMedia(saved.message);
    const payload = { ...signed, roomId: packet.roomId };
    const target = io.to(packet.roomId).to(me).to(peerId);
    target.emit("chat:message", payload);
    target.emit("message", payload);
    if (saved.inserted) io.to(peerId).emit("direct:message", {
      id: signed.id, roomId: packet.roomId, from: me, to: peerId,
      time: signed.time, type: signed.type, preview: signed.text.slice(0, 80),
    });
    io.to(peerId).emit("chat:unread:update", await computeUnreadSummaryForUser(peerId));
    return { message: payload };
  });
  handle("message:seen", async (packet) => {
    if (!validKey(packet.msgId)) throw new Error("forbidden");
    const { peerId } = await authorizeRoom(packet.roomId, me);
    const roomMessage = await markRoomSeen(packet.roomId, me, packet.msgId);
    if (!roomMessage) {
      const directMessage = await Message.findOneAndUpdate(
        { id: packet.msgId, from: peerId, to: me },
        { $set: { seen: true, seenAt: new Date() } }, { new: true }
      ).lean();
      if (!directMessage) throw new Error("forbidden");
      if (directMessage.ephemeral === "once") {
        await Message.deleteOne({ id: packet.msgId, to: me, ephemeral: "once" });
        io.to(me).to(peerId).to(packet.roomId).emit("message:removed", { id: packet.msgId });
      }
    }
    // Room media is consumed by /viewed, never by opening the chat thread.
    const target = socket.to(packet.roomId).to(peerId);
    target.emit("message:seen", packet.msgId);
    target.emit("chat:seen", { roomId: packet.roomId, msgId: packet.msgId,
      lastSeenId: packet.msgId, from: me, to: peerId });
    io.to(me).emit("chat:unread:update", await computeUnreadSummaryForUser(me));
  });
}
module.exports = { registerChatEvents };
