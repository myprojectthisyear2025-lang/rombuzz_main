/**
 * ============================================================
 * 📁 File: services/meetMiddleChatService.js
 * 💬 Purpose: Creates clean system chat messages for confirmed
 *             Meet in the Middle sessions.
 *
 * Used by:
 *   - sockets/meetMiddleSocket.js
 *
 * Important:
 *   - MongoDB only.
 *   - No LowDB.
 *   - No old meet:* socket events.
 *   - Keeps chat-message creation out of the socket file.
 * ============================================================
 */

const shortid = require("shortid");
const ChatRoom = require("../models/ChatRoom");

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

function buildMeetupMessageText(place = {}) {
  const name = safeText(place.name, "the selected place");
  const category = safeText(place.category, "Meetup spot");
  const address = safeText(place.address, "");
  const coords = getPlaceCoords(place);

  const lines = [
    `🎉 Meetup Confirmed`,
    `You both agreed to meet at ${name}.`,
    `Type: ${category}`,
  ];

  if (address) {
    lines.push(`Address: ${address}`);
  }

  if (coords) {
    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${coords.lat},${coords.lng}`;
    lines.push(`Directions: ${mapsUrl}`);
  }

  return lines.join("\n");
}

function buildMeetupMessagePayload({ fromId, toId, session }) {
  const place = session?.selectedPlace || {};
  const roomId = makeRoomId(fromId, toId);

  return {
    id: shortid.generate(),
    roomId,
    from: String(fromId),
    to: String(toId),
    text: buildMeetupMessageText(place),
    type: "meetup",
    time: new Date(),
    edited: false,
    deleted: false,
    reactions: {},
    hiddenFor: [],
    ephemeral: { mode: "none" },
    meetMiddle: {
      sessionId: String(session?.sessionId || ""),
      place: {
        id: String(place?.id || ""),
        name: safeText(place?.name, "Selected place"),
        category: safeText(place?.category, "Place"),
        address: place?.address || null,
        coords: place?.coords || null,
        provider: place?.provider || "geoapify",
      },
    },
  };
}

async function createMeetMiddleSystemMessage({ fromId, toId, session }) {
  const roomId = makeRoomId(fromId, toId);

  let room = await ChatRoom.findOne({ roomId });

  if (!room) {
    room = await ChatRoom.create({
      roomId,
      participants: [String(fromId), String(toId)],
      messages: [],
    });
  }

  const message = buildMeetupMessagePayload({
    fromId,
    toId,
    session,
  });

  if (!Array.isArray(room.messages)) {
    room.messages = [];
  }

  room.messages.push(message);
  room.updatedAt = new Date();

  await room.save();

  return {
    roomId,
    message,
  };
}

module.exports = {
  makeRoomId,
  buildMeetupMessageText,
  buildMeetupMessagePayload,
  createMeetMiddleSystemMessage,
};