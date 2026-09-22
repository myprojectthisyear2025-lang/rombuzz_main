/**
 * Path: server/services/chatPersistence.js
 * Purpose: Shared Mongo room creation, idempotent sends, and durable read receipts.
 */
const ChatRoom = require("../models/ChatRoom");
const Match = require("../models/Match");
const Relationship = require("../models/Relationship");
const User = require("../models/User");

function validKey(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 200 &&
    !/[.$\x00]/.test(value) && !["__proto__", "constructor", "prototype"].includes(value);
}

async function roomParticipants(roomId, actorId) {
  if (!validKey(roomId) || !validKey(actorId)) throw new Error("forbidden");
  const existing = await ChatRoom.findOne({ roomId }).select("participants").lean();
  if (existing?.participants?.length === 2) {
    if (!existing.participants.includes(actorId)) throw new Error("forbidden");
    return existing.participants;
  }
  // Match ids may themselves contain underscores; never split arbitrary ids.
  const matches = await Match.find({ $or: [{ users: actorId }, { user1: actorId, status: "matched" }, { user2: actorId, status: "matched" }] }).select("users user1 user2").lean();
  const pair = matches.map((m) => m.users?.length ? m.users : [m.user1, m.user2]).find((users) => {
    if (users.length !== 2) return false;
    return [users, [...users].reverse()].some((p) =>
      p.join("_") === roomId || p.join("__") === roomId);
  });
  if (!pair) throw new Error("not_matched");
  return pair;
}

async function authorizePair(from, to) {
  if (!validKey(from) || !validKey(to) || from === to) throw new Error("forbidden");
  const [users, match, block] = await Promise.all([
    User.countDocuments({ id: { $in: [from, to] }, deleteStatus: { $ne: "pending_delete" },
      visibility: { $nin: ["pending_delete", "deactivated", "banned", "suspended"] } }),
    isChatMatchActive(from, to),
    Relationship.exists({ type: "block", $or: [{ from, to }, { from: to, to: from }] }),
  ]);
  if (users !== 2) throw new Error("user_not_found");
  if (block) throw new Error("blocked");
  if (!match) throw new Error("not_matched");
}

function findActiveChatUser(id) {
  return User.findOne({ id: String(id), visibility: { $ne: "pending_delete" }, deleteStatus: { $ne: "pending_delete" } }).select("id").lean();
}

function isChatMatchActive(from, to) {
  return Match.exists({ $or: [{ users: { $all: [from, to] } }, { user1: from, user2: to, status: "matched" }, { user1: to, user2: from, status: "matched" }] });
}

async function authorizeRoom(roomId, actorId) {
  const participants = await roomParticipants(roomId, actorId);
  const peerId = participants.find((id) => id !== actorId);
  await authorizePair(actorId, peerId);
  return { participants, peerId };
}

async function ensureRoom(roomId, participants) {
  const epoch = new Date(0);
  try {
    await ChatRoom.updateOne({ roomId }, { $setOnInsert: {
      roomId, participants, messages: [],
      lastReadAtByUser: Object.fromEntries(participants.map((id) => [id, epoch])),
    } }, { upsert: true, runValidators: true });
  } catch (err) {
    if (err.code !== 11000) throw err; // Another sender created this room.
  }
}

async function appendMessage(roomId, participants, message) {
  if (!validKey(message.id)) throw new Error("invalid_message_id");
  await ensureRoom(roomId, participants);
  const result = await ChatRoom.updateOne(
    { roomId, participants: { $all: participants }, "messages.id": { $ne: message.id } },
    { $push: { messages: message }, $inc: { __v: 1 } }, { runValidators: true }
  );
  const room = await ChatRoom.findOne({ roomId, "messages.id": message.id })
    .select({ messages: { $elemMatch: { id: message.id } } }).lean();
  const saved = room?.messages?.[0];
  if (!saved || saved.from !== message.from || saved.to !== message.to || saved.text !== message.text) {
    throw new Error("message_id_conflict");
  }
  return { message: saved, inserted: result.modifiedCount === 1 };
}

async function markRoomSeen(roomId, viewerId, msgId) {
  const room = await ChatRoom.findOne({ roomId, participants: viewerId, messages: {
    $elemMatch: { id: msgId, to: viewerId, hiddenFor: { $ne: viewerId }, deleted: { $ne: true } },
  } }).select({ messages: { $elemMatch: { id: msgId } } }).lean();
  const message = room?.messages?.[0];
  if (!message) return null;
  const seenAt = new Date(message.time || message.createdAt);
  // Out-of-order receipts must not move the read cursor backwards.
  await ChatRoom.updateOne({ roomId, participants: viewerId }, {
    $max: { [`lastReadAtByUser.${viewerId}`]: seenAt },
    $inc: { __v: 1 },
    $set: { [`chatPrefsByUser.${viewerId}.forceUnread`]: false, "messages.$[read].seen": true },
  }, { arrayFilters: [{ "read.to": viewerId, "read.time": { $lte: seenAt } }] });
  return message;
}

async function markRoomsRead(viewerId, roomId) {
  if (!validKey(viewerId)) throw new Error("forbidden");
  const filter = { participants: viewerId };
  if (roomId !== undefined) filter.roomId = roomId;
  // Keep concurrent messages intact and never move a newer receipt backwards.
  return ChatRoom.updateMany(filter, {
    $max: { [`lastReadAtByUser.${viewerId}`]: new Date() },
    $set: { [`chatPrefsByUser.${viewerId}.forceUnread`]: false },
    $inc: { __v: 1 },
  });
}

module.exports = { validKey, authorizePair, authorizeRoom, ensureRoom, appendMessage, markRoomSeen, markRoomsRead, findActiveChatUser, isChatMatchActive };
