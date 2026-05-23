/**
 * ============================================================
 * 📁 File: services/meetMiddleService.js
 * 🧠 Purpose: Core MongoDB-only business logic for RomBuzz
 *             Meet in the Middle.
 *
 * Used by:
 *   - routes/meetMiddle.js
 *   - sockets/meetMiddleSocket.js
 *
 * What this service does:
 *   - Validates matched users
 *   - Creates temporary meetup sessions
 *   - Stores shared coordinates in MeetMiddleSession only
 *   - Calculates midpoint
 *   - Fetches normalized places from Geoapify
 *   - Handles place selection / acceptance / rejection
 *   - Keeps old LowDB meet logic completely out
 *
 * Important:
 *   - Do NOT save live meet coordinates into User.location.
 *   - Do NOT call Geoapify directly from mobile.
 *   - Do NOT use LowDB in this feature.
 * ============================================================
 */

const shortid = require("shortid");

const User = require("../models/User");
const Match = require("../models/Match");
const MeetMiddleSession = require("../models/MeetMiddleSession");

const {
  assertValidCoords,
  calculateMidpoint,
} = require("../utils/geo");

const {
  searchMeetPlacesWithRadiusExpansion,
} = require("./geoapifyService");

const DEFAULT_SESSION_TTL_MINUTES = 45;

function makePairKey(a, b) {
  const userA = String(a || "").trim();
  const userB = String(b || "").trim();

  if (!userA || !userB) {
    const err = new Error("Both user ids are required");
    err.code = "USER_IDS_REQUIRED";
    err.statusCode = 400;
    throw err;
  }

  if (userA === userB) {
    const err = new Error("Cannot create a meet session with yourself");
    err.code = "SELF_MEET_NOT_ALLOWED";
    err.statusCode = 400;
    throw err;
  }

  return [userA, userB].sort().join("_");
}

function getSessionExpiryDate() {
  const ttlMinutes = Number(process.env.MEET_MIDDLE_SESSION_TTL_MINUTES || DEFAULT_SESSION_TTL_MINUTES);
  const safeTtl = Number.isFinite(ttlMinutes) && ttlMinutes > 0 ? ttlMinutes : DEFAULT_SESSION_TTL_MINUTES;

  return new Date(Date.now() + safeTtl * 60 * 1000);
}

function serializePlace(place = {}) {
  if (!place || typeof place !== "object") return null;

  const coords = assertValidCoords(place.coords || {}, "place.coords");

  return {
    id: String(place.id || `${coords.lat},${coords.lng}`),
    name: String(place.name || "Unnamed Place").trim() || "Unnamed Place",
    category: String(place.category || "Place").trim() || "Place",
    address: place.address ? String(place.address).trim() : null,
    coords,
    rating:
      place.rating === null || place.rating === undefined
        ? null
        : Number(place.rating),
    image: place.image ? String(place.image) : null,
    distance:
      place.distance === null || place.distance === undefined
        ? null
        : Number(place.distance),
    provider: String(place.provider || "geoapify"),
  };
}

function serializeSession(sessionDoc) {
  if (!sessionDoc) return null;

  const session = typeof sessionDoc.toObject === "function"
    ? sessionDoc.toObject()
    : sessionDoc;

  const coordsByUser = {};
  const rawCoords = session.coordsByUser;

  if (rawCoords instanceof Map) {
    for (const [key, value] of rawCoords.entries()) {
      coordsByUser[key] = value;
    }
  } else if (rawCoords && typeof rawCoords === "object") {
    Object.assign(coordsByUser, rawCoords);
  }

  return {
    sessionId: session.sessionId,
    pairKey: session.pairKey,
    users: Array.isArray(session.users) ? session.users.map(String) : [],
    requestedBy: session.requestedBy,
    peerId: session.peerId,
    status: session.status,
    coordsByUser,
    midpoint: session.midpoint || null,
    smartMidpoint: session.smartMidpoint || null,
    radiusUsedMeters: session.radiusUsedMeters || null,
    places: Array.isArray(session.places) ? session.places : [],
    selectedPlace: session.selectedPlace || null,
    selectedBy: session.selectedBy || null,
    selectedAt: session.selectedAt || null,
    confirmedBy: session.confirmedBy || null,
    confirmedAt: session.confirmedAt || null,
    cancelledBy: session.cancelledBy || null,
    cancelledAt: session.cancelledAt || null,
    completedBy: session.completedBy || null,
    completedAt: session.completedAt || null,
    declineReason: session.declineReason || "",
    lastActivityAt: session.lastActivityAt || null,
    expiresAt: session.expiresAt || null,
    createdAt: session.createdAt || null,
    updatedAt: session.updatedAt || null,
  };
}

async function findUserOrThrow(userId, label = "user") {
  const id = String(userId || "").trim();

  if (!id) {
    const err = new Error(`${label} id is required`);
    err.code = "USER_ID_REQUIRED";
    err.statusCode = 400;
    throw err;
  }

  const user = await User.findOne({ id }).lean();

  if (!user) {
    const err = new Error(`${label} not found`);
    err.code = "USER_NOT_FOUND";
    err.statusCode = 404;
    throw err;
  }

  return user;
}

async function assertUsersAreMatched(userId, peerId) {
  const me = String(userId || "").trim();
  const peer = String(peerId || "").trim();

  makePairKey(me, peer);

  const match = await Match.findOne({
    users: { $all: [me, peer] },
    status: "matched",
  }).lean();

  if (!match) {
    const err = new Error("Users are not matched");
    err.code = "NOT_MATCHED";
    err.statusCode = 409;
    throw err;
  }

  return match;
}

async function assertSessionParticipant(session, userId) {
  const id = String(userId || "").trim();

  if (!session || !Array.isArray(session.users) || !session.users.map(String).includes(id)) {
    const err = new Error("User is not part of this meet session");
    err.code = "NOT_SESSION_PARTICIPANT";
    err.statusCode = 403;
    throw err;
  }

  return true;
}

async function getActiveSessionForPair(userId, peerId) {
  const pairKey = makePairKey(userId, peerId);

  const session = await MeetMiddleSession.findOne({
    pairKey,
    status: {
      $in: [
        "requested",
        "accepted",
        "locating",
        "suggested",
        "place_pending",
        "place_rejected",
        "confirmed",
      ],
    },
    expiresAt: { $gt: new Date() },
  }).sort({ lastActivityAt: -1 });

  return session;
}

async function createMeetRequest({ fromId, toId }) {
  const requesterId = String(fromId || "").trim();
  const peerId = String(toId || "").trim();
  const pairKey = makePairKey(requesterId, peerId);

  await Promise.all([
    findUserOrThrow(requesterId, "requester"),
    findUserOrThrow(peerId, "peer"),
    assertUsersAreMatched(requesterId, peerId),
  ]);

  let session = await getActiveSessionForPair(requesterId, peerId);

  if (session) {
    session.requestedBy = requesterId;
    session.peerId = peerId;
    session.status = "requested";
    session.lastActivityAt = new Date();
    session.expiresAt = getSessionExpiryDate();
    await session.save();

    return {
      reused: true,
      session: serializeSession(session),
    };
  }

  session = await MeetMiddleSession.create({
    sessionId: shortid.generate(),
    pairKey,
    users: [requesterId, peerId],
    requestedBy: requesterId,
    peerId,
    status: "requested",
    coordsByUser: {},
    places: [],
    expiresAt: getSessionExpiryDate(),
    lastActivityAt: new Date(),
  });

  return {
    reused: false,
    session: serializeSession(session),
  };
}

async function declineMeetRequest({ sessionId, userId, reason = "" }) {
  const session = await MeetMiddleSession.findOne({ sessionId });

  if (!session) {
    const err = new Error("Meet session not found");
    err.code = "SESSION_NOT_FOUND";
    err.statusCode = 404;
    throw err;
  }

  await assertSessionParticipant(session, userId);

  session.status = "declined";
  session.declineReason = String(reason || "").slice(0, 200);
  session.lastActivityAt = new Date();
  await session.save();

  return serializeSession(session);
}

async function shareLocationAndBuildSuggestions({ sessionId, userId, coords }) {
  const safeCoords = assertValidCoords(coords, "coords");

  const session = await MeetMiddleSession.findOne({ sessionId });

  if (!session) {
    const err = new Error("Meet session not found");
    err.code = "SESSION_NOT_FOUND";
    err.statusCode = 404;
    throw err;
  }

  await assertSessionParticipant(session, userId);

  if (["declined", "cancelled", "completed", "expired"].includes(session.status)) {
    const err = new Error(`Cannot update location for ${session.status} session`);
    err.code = "SESSION_CLOSED";
    err.statusCode = 409;
    throw err;
  }

  session.coordsByUser.set(String(userId), {
    ...safeCoords,
    sharedAt: new Date(),
  });

  session.status = "locating";
  session.lastActivityAt = new Date();
  session.expiresAt = getSessionExpiryDate();

  const userIds = session.users.map(String);
  const firstCoords = session.coordsByUser.get(userIds[0]);
  const secondCoords = session.coordsByUser.get(userIds[1]);

  if (!firstCoords || !secondCoords) {
    await session.save();

    return {
      ready: false,
      session: serializeSession(session),
      midpoint: null,
      smartMidpoint: null,
      radiusUsedMeters: null,
      places: [],
    };
  }

  const midpoint = calculateMidpoint(firstCoords, secondCoords);

  const suggestions = await searchMeetPlacesWithRadiusExpansion({
    midpoint,
  });

  session.midpoint = midpoint;
  session.smartMidpoint = midpoint;
  session.radiusUsedMeters = suggestions.radiusUsedMeters;
  session.places = suggestions.places;
  session.status = "suggested";
  session.lastActivityAt = new Date();

  await session.save();

  return {
    ready: true,
    session: serializeSession(session),
    midpoint,
    smartMidpoint: midpoint,
    radiusUsedMeters: suggestions.radiusUsedMeters,
    places: suggestions.places,
  };
}

async function selectPlace({ sessionId, userId, place }) {
  const safePlace = serializePlace(place);

  const session = await MeetMiddleSession.findOne({ sessionId });

  if (!session) {
    const err = new Error("Meet session not found");
    err.code = "SESSION_NOT_FOUND";
    err.statusCode = 404;
    throw err;
  }

  await assertSessionParticipant(session, userId);

  if (!["suggested", "place_rejected", "place_pending"].includes(session.status)) {
    const err = new Error("Place can only be selected after suggestions are ready");
    err.code = "SUGGESTIONS_NOT_READY";
    err.statusCode = 409;
    throw err;
  }

  session.selectedPlace = safePlace;
  session.selectedBy = String(userId);
  session.selectedAt = new Date();
  session.status = "place_pending";
  session.lastActivityAt = new Date();
  session.expiresAt = getSessionExpiryDate();

  await session.save();

  return serializeSession(session);
}

async function acceptSelectedPlace({ sessionId, userId }) {
  const session = await MeetMiddleSession.findOne({ sessionId });

  if (!session) {
    const err = new Error("Meet session not found");
    err.code = "SESSION_NOT_FOUND";
    err.statusCode = 404;
    throw err;
  }

  await assertSessionParticipant(session, userId);

  if (session.status !== "place_pending" || !session.selectedPlace) {
    const err = new Error("No selected place is waiting for confirmation");
    err.code = "NO_PLACE_PENDING";
    err.statusCode = 409;
    throw err;
  }

  if (String(session.selectedBy) === String(userId)) {
    const err = new Error("The other user must accept the selected place");
    err.code = "SELECTOR_CANNOT_SELF_ACCEPT";
    err.statusCode = 409;
    throw err;
  }

  session.status = "confirmed";
  session.confirmedBy = String(userId);
  session.confirmedAt = new Date();
  session.lastActivityAt = new Date();
  session.expiresAt = getSessionExpiryDate();

  await session.save();

  return serializeSession(session);
}

async function rejectSelectedPlace({ sessionId, userId }) {
  const session = await MeetMiddleSession.findOne({ sessionId });

  if (!session) {
    const err = new Error("Meet session not found");
    err.code = "SESSION_NOT_FOUND";
    err.statusCode = 404;
    throw err;
  }

  await assertSessionParticipant(session, userId);

  if (session.status !== "place_pending") {
    const err = new Error("No selected place is waiting for rejection");
    err.code = "NO_PLACE_PENDING";
    err.statusCode = 409;
    throw err;
  }

  session.selectedPlace = null;
  session.selectedBy = null;
  session.selectedAt = null;
  session.status = "place_rejected";
  session.lastActivityAt = new Date();
  session.expiresAt = getSessionExpiryDate();

  await session.save();

  return serializeSession(session);
}

async function cancelSession({ sessionId, userId }) {
  const session = await MeetMiddleSession.findOne({ sessionId });

  if (!session) {
    const err = new Error("Meet session not found");
    err.code = "SESSION_NOT_FOUND";
    err.statusCode = 404;
    throw err;
  }

  await assertSessionParticipant(session, userId);

  session.status = "cancelled";
  session.cancelledBy = String(userId);
  session.cancelledAt = new Date();
  session.lastActivityAt = new Date();

  await session.save();

  return serializeSession(session);
}

async function completeSession({ sessionId, userId }) {
  const session = await MeetMiddleSession.findOne({ sessionId });

  if (!session) {
    const err = new Error("Meet session not found");
    err.code = "SESSION_NOT_FOUND";
    err.statusCode = 404;
    throw err;
  }

  await assertSessionParticipant(session, userId);

  if (session.status !== "confirmed") {
    const err = new Error("Only confirmed meetups can be completed");
    err.code = "SESSION_NOT_CONFIRMED";
    err.statusCode = 409;
    throw err;
  }

  session.status = "completed";
  session.completedBy = String(userId);
  session.completedAt = new Date();
  session.lastActivityAt = new Date();

  await session.save();

  return serializeSession(session);
}

module.exports = {
  makePairKey,
  serializeSession,
  assertUsersAreMatched,
  getActiveSessionForPair,
  createMeetRequest,
  declineMeetRequest,
  shareLocationAndBuildSuggestions,
  selectPlace,
  acceptSelectedPlace,
  rejectSelectedPlace,
  cancelSession,
  completeSession,
};