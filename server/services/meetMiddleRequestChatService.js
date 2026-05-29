/**
 * ============================================================
 * 📁 File: services/meetMiddleRequestChatService.js
 * 💬 Purpose: Creates and updates the single clean chat card for
 *             RomBuzz Meet in the Middle request state.
 *
 * Used by:
 *   - routes/meetMiddle.js
 *
 * Important:
 *   - MongoDB only.
 *   - No LowDB.
 *   - No Geoapify calls here.
 *   - No Socket.IO emit logic here.
 *   - This service only persists the request bubble/card.
 *   - Final place/proposal metadata is handled by meetMiddleChatService.js
 *     and can update this same message later.
 * ============================================================
 */

const shortid = require("shortid");
const ChatRoom = require("../models/ChatRoom");

const MEET_REQUEST_BUBBLE_TYPE = "meet_middle_request";

const REQUEST_STATUSES = {
  PENDING: "pending",
  ACCEPTED: "accepted",
  REJECTED: "rejected",
  DECLINED: "declined",
  CANCELLED: "cancelled",
  CANCELED: "canceled",
  EXPIRED: "expired",
};

function makeRoomId(a, b) {
  const userA = String(a || "").trim();
  const userB = String(b || "").trim();

  if (!userA || !userB) {
    const err = new Error("Both user ids are required to create chat room id");
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

function normalizeStatus(status) {
  const raw = String(status || "").trim().toLowerCase();

  if (raw === REQUEST_STATUSES.ACCEPTED) return REQUEST_STATUSES.ACCEPTED;
  if (raw === REQUEST_STATUSES.REJECTED) return REQUEST_STATUSES.REJECTED;
  if (raw === REQUEST_STATUSES.DECLINED) return REQUEST_STATUSES.REJECTED;
  if (raw === REQUEST_STATUSES.CANCELLED) return REQUEST_STATUSES.CANCELLED;
  if (raw === REQUEST_STATUSES.CANCELED) return REQUEST_STATUSES.CANCELLED;
  if (raw === REQUEST_STATUSES.EXPIRED) return REQUEST_STATUSES.EXPIRED;

  return REQUEST_STATUSES.PENDING;
}

function getUserDisplayName(user = {}, fallback = "Someone") {
  const fullName = safeText(user.name);
  if (fullName) return fullName;

  const firstName = safeText(user.firstName);
  const lastName = safeText(user.lastName);
  const joined = safeText(`${firstName} ${lastName}`);

  return joined || fallback;
}

function getUserAvatar(user = {}) {
  return (
    safeText(user.avatar) ||
    (Array.isArray(user.photos) && user.photos.length
      ? safeText(user.photos[0])
      : "")
  );
}

function buildRequestBubbleText({ status, fromName, toName }) {
  const safeFromName = safeText(fromName, "Someone");
  const safeToName = safeText(toName, "your match");

  if (status === REQUEST_STATUSES.ACCEPTED) {
    return `${safeToName} accepted the Meet in the Middle request.`;
  }

  if (status === REQUEST_STATUSES.REJECTED) {
    return `${safeToName} declined the Meet in the Middle request.`;
  }

  if (status === REQUEST_STATUSES.CANCELLED) {
    return `${safeFromName} cancelled the Meet in the Middle request.`;
  }

  if (status === REQUEST_STATUSES.EXPIRED) {
    return "This Meet in the Middle request expired.";
  }

  return `${safeFromName} wants to find a halfway spot.`;
}

function buildMeetRequestMessage({
  fromId,
  toId,
  fromUser = {},
  toUser = {},
  session = {},
}) {
  const now = new Date();
  const roomId = makeRoomId(fromId, toId);

  const fromName = getUserDisplayName(fromUser, "Someone");
  const toName = getUserDisplayName(toUser, "your match");

  return {
    id: shortid.generate(),
    roomId,
    from: String(fromId),
    to: String(toId),
    text: buildRequestBubbleText({
      status: REQUEST_STATUSES.PENDING,
      fromName,
      toName,
    }),
    type: MEET_REQUEST_BUBBLE_TYPE,
    time: now,
    createdAt: now,
    edited: false,
    deleted: false,
    system: true,
    reactions: {},
    hiddenFor: [],
    ephemeral: { mode: "none", viewsLeft: 0 },
    meetMiddleRequest: {
      type: MEET_REQUEST_BUBBLE_TYPE,
      sessionId: String(session?.sessionId || ""),
      status: REQUEST_STATUSES.PENDING,
      fromUserId: String(fromId),
      toUserId: String(toId),
      fromName,
      toName,
      fromAvatar: getUserAvatar(fromUser),
      toAvatar: getUserAvatar(toUser),
      createdAt: session?.createdAt || now,
      expiresAt: session?.expiresAt || null,
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

function findRequestMessageIndex(room, sessionId) {
  const safeSessionId = String(sessionId || "").trim();

  if (!safeSessionId) return -1;

  return (room.messages || []).findIndex((message) => {
    return (
      String(message?.meetMiddleRequest?.sessionId || "") === safeSessionId ||
      (
        String(message?.type || "") === MEET_REQUEST_BUBBLE_TYPE &&
        String(message?.meetMiddleRequest?.sessionId || "") === safeSessionId
      ) ||
      String(message?.meetMiddle?.sessionId || "") === safeSessionId
    );
  });
}

async function createMeetRequestChatBubble({
  fromId,
  toId,
  fromUser = {},
  toUser = {},
  session = {},
}) {
  const roomId = makeRoomId(fromId, toId);
  const room = await findOrCreateRoom(roomId, fromId, toId);
  const sessionId = String(session?.sessionId || "").trim();

  if (!sessionId) {
    const err = new Error("Meet request session id is required.");
    err.code = "SESSION_ID_REQUIRED";
    err.statusCode = 400;
    throw err;
  }

  const existingIndex = findRequestMessageIndex(room, sessionId);
  const nextMessage = buildMeetRequestMessage({
    fromId,
    toId,
    fromUser,
    toUser,
    session,
  });

  if (existingIndex !== -1) {
    const existing = room.messages[existingIndex];

    existing.from = nextMessage.from;
    existing.to = nextMessage.to;
    existing.text = nextMessage.text;
    existing.type = MEET_REQUEST_BUBBLE_TYPE;
    existing.system = true;
    existing.time = new Date();
    existing.edited = false;
    existing.deleted = false;
    existing.meetMiddleRequest = {
      ...(existing.meetMiddleRequest?.toObject
        ? existing.meetMiddleRequest.toObject()
        : existing.meetMiddleRequest || {}),
      ...nextMessage.meetMiddleRequest,
    };

    // Fresh pending request should visually be a request.
    // If this existing message somehow belongs to another session's milestone,
    // clear it. Same-session milestone data can stay for later one-card updates.
    if (
      existing.meetMiddle &&
      String(existing.meetMiddle?.sessionId || "") !== sessionId
    ) {
      existing.meetMiddle = undefined;
    }

    room.updatedAt = new Date();
    await room.save();

    const message = existing.toObject ? existing.toObject() : existing;

    return {
      roomId,
      message,
      action: "updated",
    };
  }

  room.messages.push(nextMessage);
  room.updatedAt = new Date();

  await room.save();

  return {
    roomId,
    message: nextMessage,
    action: "created",
  };
}

async function updateMeetRequestChatBubble({
  sessionId,
  status,
  actorId = "",
}) {
  const safeSessionId = String(sessionId || "").trim();

  if (!safeSessionId) {
    const err = new Error("Meet request session id is required.");
    err.code = "SESSION_ID_REQUIRED";
    err.statusCode = 400;
    throw err;
  }

  const room = await ChatRoom.findOne({
    $or: [
      { "messages.meetMiddleRequest.sessionId": safeSessionId },
      { "messages.meetMiddle.sessionId": safeSessionId },
    ],
  });

  if (!room) {
    const err = new Error("Meet request chat bubble was not found.");
    err.code = "MEET_REQUEST_CHAT_BUBBLE_NOT_FOUND";
    err.statusCode = 404;
    throw err;
  }

  const index = findRequestMessageIndex(room, safeSessionId);

  if (index === -1) {
    const err = new Error("Meet request chat bubble was not found.");
    err.code = "MEET_REQUEST_CHAT_BUBBLE_NOT_FOUND";
    err.statusCode = 404;
    throw err;
  }

  const message = room.messages[index];
  const nextStatus = normalizeStatus(status);
  const currentRequest =
    message.meetMiddleRequest?.toObject
      ? message.meetMiddleRequest.toObject()
      : message.meetMiddleRequest || {};

  const fromName = safeText(currentRequest.fromName, "Someone");
  const toName = safeText(currentRequest.toName, "your match");

  message.text = buildRequestBubbleText({
    status: nextStatus,
    fromName,
    toName,
  });
  message.type = MEET_REQUEST_BUBBLE_TYPE;
  message.system = true;
  message.time = new Date();
  message.edited = false;
  message.deleted = false;
  message.meetMiddleRequest = {
    ...currentRequest,
    type: MEET_REQUEST_BUBBLE_TYPE,
    sessionId: safeSessionId,
    status: nextStatus,
    createdAt: currentRequest.createdAt || message.createdAt || new Date(),
  };

  // Do not delete existing meetMiddle final/proposal metadata here.
  // If the final card already exists, frontend can prefer meetMiddle data.
  if (message.meetMiddle?.updatedAt) {
    message.meetMiddle.updatedAt = new Date();
  }

  room.updatedAt = new Date();
  await room.save();

  const updatedMessage = message.toObject ? message.toObject() : message;

  return {
    roomId: room.roomId,
    message: updatedMessage,
    action: "updated",
    actorId: String(actorId || ""),
  };
}

module.exports = {
  MEET_REQUEST_BUBBLE_TYPE,
  REQUEST_STATUSES,
  makeRoomId,
  buildRequestBubbleText,
  buildMeetRequestMessage,
  createMeetRequestChatBubble,
  updateMeetRequestChatBubble,
};