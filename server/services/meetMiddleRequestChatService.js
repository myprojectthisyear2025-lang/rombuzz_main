/**
 * ============================================================
 * 📁 File: services/meetMiddleRequestChatService.js
 * 💬 Purpose: Creates and updates chat bubbles for RomBuzz
 *             Meet in the Middle request flow.
 *
 * Handles chat bubble states:
 *   - pending
 *   - accepted
 *   - rejected
 *   - cancelled
 *   - expired
 *
 * Important:
 *   - MongoDB only.
 *   - No LowDB.
 *   - No Geoapify.
 *   - No old meet:* events.
 *   - This is separate from meetMiddleChatService.js, which is
 *     only for final confirmed meetup place messages.
 * ============================================================
 */

const shortid = require("shortid");
const ChatRoom = require("../models/ChatRoom");

const MEET_REQUEST_BUBBLE_TYPE = "meet_middle_request";

function makeRoomId(a, b) {
  const userA = String(a || "").trim();
  const userB = String(b || "").trim();

  if (!userA || !userB) {
    const err = new Error("Both user ids are required to create meet request chat bubble");
    err.code = "ROOM_USERS_REQUIRED";
    err.statusCode = 400;
    throw err;
  }

  return [userA, userB].sort().join("_");
}

function safeText(value, fallback = "") {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text || fallback;
}

function getDisplayName(user = {}, fallback = "Someone") {
  const first = safeText(user.firstName || "");
  const last = safeText(user.lastName || "");
  const full = [first, last].filter(Boolean).join(" ").trim();

  return (
    full ||
    safeText(user.name || "") ||
    fallback
  );
}

function getAvatar(user = {}) {
  return (
    safeText(user.avatar || "") ||
    (Array.isArray(user.photos) && user.photos.length ? safeText(user.photos[0]) : "")
  );
}

function getBubbleText(status, fromName, toName) {
  if (status === "accepted") {
    return `${toName} accepted the Meet in the Middle request.`;
  }

  if (status === "rejected") {
    return `${toName} rejected the Meet in the Middle request.`;
  }

  if (status === "cancelled") {
    return `${fromName} cancelled the Meet in the Middle request.`;
  }

  if (status === "expired") {
    return `Meet in the Middle request expired.`;
  }

  return `${fromName} wants to meet halfway with ${toName}.`;
}

function buildMeetRequestPayload({
  fromId,
  toId,
  fromUser,
  toUser,
  session,
  status = "pending",
}) {
  const fromName = getDisplayName(fromUser, "Someone");
  const toName = getDisplayName(toUser, "your match");

  const expiresAt =
    session?.expiresAt
      ? new Date(session.expiresAt).toISOString()
      : new Date(Date.now() + 60 * 1000).toISOString();

  return {
    id: shortid.generate(),
    roomId: makeRoomId(fromId, toId),
    from: String(fromId),
    to: String(toId),
    text: getBubbleText(status, fromName, toName),
    type: MEET_REQUEST_BUBBLE_TYPE,
    time: new Date(),
    edited: false,
    deleted: false,
    reactions: {},
    hiddenFor: [],
    ephemeral: { mode: "none" },
    meetMiddleRequest: {
      type: MEET_REQUEST_BUBBLE_TYPE,
      sessionId: String(session?.sessionId || ""),
      status,
      fromUserId: String(fromId),
      toUserId: String(toId),
      fromName,
      toName,
      fromAvatar: getAvatar(fromUser),
      toAvatar: getAvatar(toUser),
      createdAt: new Date().toISOString(),
      expiresAt,
    },
  };
}

async function findOrCreateRoom(roomId, fromId, toId) {
  let room = await ChatRoom.findOne({ roomId });

  if (!room) {
    room = await ChatRoom.create({
      roomId,
      participants: [String(fromId), String(toId)],
      messages: [],
    });
  }

  if (!Array.isArray(room.messages)) {
    room.messages = [];
  }

  return room;
}

async function createMeetRequestChatBubble({
  fromId,
  toId,
  fromUser,
  toUser,
  session,
}) {
  const roomId = makeRoomId(fromId, toId);
  const room = await findOrCreateRoom(roomId, fromId, toId);

  const existingIndex = room.messages.findIndex((message) => {
    return (
      String(message?.type || "") === MEET_REQUEST_BUBBLE_TYPE &&
      String(message?.meetMiddleRequest?.sessionId || "") === String(session?.sessionId || "")
    );
  });

  if (existingIndex !== -1) {
    const existing = room.messages[existingIndex];

    existing.text = getBubbleText(
      "pending",
      getDisplayName(fromUser, "Someone"),
      getDisplayName(toUser, "your match")
    );
    existing.meetMiddleRequest = {
      ...(existing.meetMiddleRequest || {}),
      type: MEET_REQUEST_BUBBLE_TYPE,
      sessionId: String(session?.sessionId || ""),
      status: "pending",
      fromUserId: String(fromId),
      toUserId: String(toId),
      fromName: getDisplayName(fromUser, "Someone"),
      toName: getDisplayName(toUser, "your match"),
      fromAvatar: getAvatar(fromUser),
      toAvatar: getAvatar(toUser),
      createdAt: existing?.meetMiddleRequest?.createdAt || new Date().toISOString(),
      expiresAt: session?.expiresAt
        ? new Date(session.expiresAt).toISOString()
        : new Date(Date.now() + 60 * 1000).toISOString(),
    };

    room.updatedAt = new Date();
    await room.save();

    return {
      roomId,
      message: existing,
      reused: true,
    };
  }

  const message = buildMeetRequestPayload({
    fromId,
    toId,
    fromUser,
    toUser,
    session,
    status: "pending",
  });

  room.messages.push(message);
  room.updatedAt = new Date();

  await room.save();

  return {
    roomId,
    message,
    reused: false,
  };
}

async function updateMeetRequestChatBubble({
  sessionId,
  status,
  actorId = "",
}) {
  const cleanSessionId = String(sessionId || "").trim();

  if (!cleanSessionId) {
    const err = new Error("Meet session id is required to update request chat bubble");
    err.code = "SESSION_ID_REQUIRED";
    err.statusCode = 400;
    throw err;
  }

  const room = await ChatRoom.findOne({
    "messages.type": MEET_REQUEST_BUBBLE_TYPE,
    "messages.meetMiddleRequest.sessionId": cleanSessionId,
  });

  if (!room || !Array.isArray(room.messages)) {
    return {
      roomId: null,
      message: null,
      updated: false,
    };
  }

  const index = room.messages.findIndex((message) => {
    return (
      String(message?.type || "") === MEET_REQUEST_BUBBLE_TYPE &&
      String(message?.meetMiddleRequest?.sessionId || "") === cleanSessionId
    );
  });

  if (index === -1) {
    return {
      roomId: room.roomId,
      message: null,
      updated: false,
    };
  }

  const message = room.messages[index];
  const request = message.meetMiddleRequest || {};

  const fromName = safeText(request.fromName, "Someone");
  const toName = safeText(request.toName, "your match");

  message.text = getBubbleText(status, fromName, toName);
  message.meetMiddleRequest = {
    ...request,
    status,
    updatedAt: new Date().toISOString(),
    updatedBy: String(actorId || ""),
  };

  room.updatedAt = new Date();
  await room.save();

  return {
    roomId: room.roomId,
    message,
    updated: true,
  };
}

module.exports = {
  MEET_REQUEST_BUBBLE_TYPE,
  createMeetRequestChatBubble,
  updateMeetRequestChatBubble,
};