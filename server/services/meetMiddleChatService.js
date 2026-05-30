/**
 * ============================================================
 * 📁 File: services/meetMiddleChatService.js
 * 💬 Purpose: Creates durable chat milestone messages for
 *             RomBuzz Meet in the Middle.
 *
 * Used by:
 *   - routes/meetMiddle.js
 *   - sockets/meetMiddleSocket.js if needed later
 *
 * Chat milestones handled here:
 *   - place_proposed
 *   - place_rejected
 *   - confirmed
 *
 * Important:
 *   - MongoDB only.
 *   - No LowDB.
 *   - No Geoapify calls here.
 *   - No Socket.IO emit logic here.
 *   - Keeps Meet chat persistence out of route/socket files.
 * ============================================================
 */

const shortid = require("shortid");
const ChatRoom = require("../models/ChatRoom");

const MEET_MIDDLE_MESSAGE_TYPE = "meetup";
const MEET_REQUEST_BUBBLE_TYPE = "meet_middle_request";

const MEET_MIDDLE_STATUSES = {
  PLACE_PROPOSED: "place_proposed",
  PLACE_REJECTED: "place_rejected",
  CONFIRMED: "confirmed",
  COMPLETED: "completed",
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

function getPlaceCoords(place = {}) {
  const lat = Number(place?.coords?.lat);
  const lng = Number(place?.coords?.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return { lat, lng };
}

function normalizeMeetPlace(place = {}) {
  const coords = getPlaceCoords(place);

  return {
    id: String(place?.id || ""),
    name: safeText(place?.name, "Selected place"),
    category: safeText(place?.category, "Place"),
    address: place?.address ? safeText(place.address) : null,
    coords,
    provider: safeText(place?.provider, "geoapify"),
    isMidpoint:
      place?.isMidpoint === true ||
      place?.provider === "rombuzz_midpoint" ||
      String(place?.id || "").startsWith("midpoint:"),
  };
}

function buildDirectionsUrl(place = {}) {
  const coords = getPlaceCoords(place);

  if (coords) {
    return `https://www.google.com/maps/dir/?api=1&destination=${coords.lat},${coords.lng}`;
  }

  const query = encodeURIComponent(
    [
      place?.name,
      place?.address,
      place?.category,
    ]
      .filter(Boolean)
      .join(" ")
      .trim() || "meetup spot"
  );

  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

function buildMeetupMessageText(place = {}) {
  const safePlace = normalizeMeetPlace(place);
  return `Meetup confirmed at ${safePlace.name}.`;
}

function buildMeetMiddleMilestoneText({ status, session }) {
  const place = normalizeMeetPlace(session?.selectedPlace || {});
  if (status === MEET_MIDDLE_STATUSES.PLACE_PROPOSED) {
    return `${place.name} was picked as a meetup spot. Waiting for confirmation.`;
  }

  if (status === MEET_MIDDLE_STATUSES.PLACE_REJECTED) {
    return `Meetup spot was not confirmed. Pick another spot.`;
  }

  if (status === MEET_MIDDLE_STATUSES.COMPLETED) {
    return `Meetup marked as completed.`;
  }

  if (status === MEET_MIDDLE_STATUSES.CONFIRMED) {
    return buildMeetupMessageText(place);
  }

  return `Meet in the Middle was updated.`;
}

function buildMeetMiddlePayload({
  fromId,
  toId,
  session,
  status,
  actorId = "",
}) {
  const now = new Date();
  const place = normalizeMeetPlace(session?.selectedPlace || {});
  const roomId = makeRoomId(fromId, toId);

  return {
    id: shortid.generate(),
    roomId,
    from: String(fromId),
    to: String(toId),
    text: buildMeetMiddleMilestoneText({
      status,
      session,
      actorId,
    }),
    type: MEET_MIDDLE_MESSAGE_TYPE,
    time: now,
    createdAt: now,
    edited: false,
    deleted: false,
    system: true,
    reactions: {},
    hiddenFor: [],
    ephemeral: { mode: "none", viewsLeft: 0 },
    meetMiddle: {
      type: "meet_middle_milestone",
      sessionId: String(session?.sessionId || ""),
      status: String(status || ""),
      selectedBy: String(session?.selectedBy || ""),
      acceptedBy:
        status === MEET_MIDDLE_STATUSES.CONFIRMED
          ? String(session?.confirmedBy || actorId || "")
          : "",
      rejectedBy:
        status === MEET_MIDDLE_STATUSES.PLACE_REJECTED
          ? String(actorId || "")
          : "",
      place,
      createdAt: now,
      updatedAt: now,
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

function findExistingMeetMiddleMessageIndex(room, sessionId, status) {
  const safeSessionId = String(sessionId || "");

  if (!safeSessionId) return -1;

  const requestIndex = (room.messages || []).findIndex((message) => {
    return (
      String(message?.meetMiddleRequest?.sessionId || "") === safeSessionId ||
      (
        String(message?.type || "") === MEET_REQUEST_BUBBLE_TYPE &&
        String(message?.meetMiddleRequest?.sessionId || "") === safeSessionId
      )
    );
  });

  if (requestIndex !== -1) return requestIndex;

  return (room.messages || []).findIndex((message) => {
    return (
      String(message?.type || "") === MEET_MIDDLE_MESSAGE_TYPE &&
      String(message?.meetMiddle?.sessionId || "") === safeSessionId
    );
  });
}

function shouldUpdateExistingStatus(status) {
  return (
    status === MEET_MIDDLE_STATUSES.PLACE_PROPOSED ||
    status === MEET_MIDDLE_STATUSES.PLACE_REJECTED
  );
}

async function createOrUpdateMeetMiddleMilestoneMessage({
  fromId,
  toId,
  session,
  status,
  actorId = "",
}) {
  const roomId = makeRoomId(fromId, toId);

  if (status === MEET_MIDDLE_STATUSES.CONFIRMED) {
    return {
      roomId,
      message: null,
      action: "skipped_confirmed_meetup_chat_message",
    };
  }

  const room = await findOrCreateRoom(roomId, fromId, toId);
  const now = new Date();

  const nextMessage = buildMeetMiddlePayload({
    fromId,
    toId,
    session,
    status,
    actorId,
  });

  const existingIndex = shouldUpdateExistingStatus(status)
    ? findExistingMeetMiddleMessageIndex(room, session?.sessionId, status)
    : -1;

  if (existingIndex !== -1) {
    const existing = room.messages[existingIndex];

    existing.text = nextMessage.text;
    existing.from = nextMessage.from;
    existing.to = nextMessage.to;
    existing.type = nextMessage.type;
    existing.system = true;
    existing.time = now;
    existing.edited = false;
    existing.deleted = false;
    existing.meetMiddle = {
      ...(existing.meetMiddle?.toObject
        ? existing.meetMiddle.toObject()
        : existing.meetMiddle || {}),
      ...nextMessage.meetMiddle,
      createdAt: existing.meetMiddle?.createdAt || nextMessage.meetMiddle.createdAt,
      updatedAt: now,
    };

    room.updatedAt = now;
    await room.save();

    const updatedMessage = existing.toObject ? existing.toObject() : existing;

    return {
      roomId,
      message: updatedMessage,
      action: "updated",
    };
  }

  room.messages.push(nextMessage);
  room.updatedAt = now;

  await room.save();

  return {
    roomId,
    message: nextMessage,
    action: "created",
  };
}

async function createMeetMiddleSystemMessage({ fromId, toId, session }) {
  const roomId = makeRoomId(fromId, toId);

  return {
    roomId,
    message: null,
    action: "skipped_confirmed_meetup_chat_message",
    sessionId: String(session?.sessionId || ""),
  };
}

module.exports = {
  MEET_MIDDLE_MESSAGE_TYPE,
  MEET_MIDDLE_STATUSES,
  makeRoomId,
  buildDirectionsUrl,
  buildMeetupMessageText,
  buildMeetMiddleMilestoneText,
  buildMeetMiddlePayload,
  createOrUpdateMeetMiddleMilestoneMessage,
  createMeetMiddleSystemMessage,
};