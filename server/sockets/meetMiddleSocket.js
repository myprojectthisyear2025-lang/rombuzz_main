/**
 * ============================================================
 * 📁 File: sockets/meetMiddleSocket.js
 * ⚡ Purpose: Clean realtime Socket.IO layer for RomBuzz
 *             Meet in the Middle.
 *
 * Event namespace:
 *   meetMiddle:*
 *
 * Why this file uses meetMiddle:* instead of meet:*:
 *   - Old backend files already contain broken/legacy meet:* handlers.
 *   - This new file avoids all old event-name conflicts.
 *   - Mobile should use only meetMiddle:* for the new feature.
 *
 * Important:
 *   - MongoDB only.
 *   - No LowDB.
 *   - No User.location writes.
 *   - No direct Geoapify calls here.
 *   - No old /api/meet or /api/meet-suggest calls.
 * ============================================================
 */

const User = require("../models/User");

const {
  createMeetRequest,
  declineMeetRequest,
  shareLocationAndBuildSuggestions,
  selectPlace,
  acceptSelectedPlace,
  rejectSelectedPlace,
  cancelSession,
  completeSession,
} = require("../services/meetMiddleService");

function getOnlineUsers() {
  if (!global.onlineUsers) {
    global.onlineUsers = {};
  }

  return global.onlineUsers;
}

function emitToUser(io, userId, eventName, payload) {
  const safeUserId = String(userId || "").trim();
  if (!safeUserId || !io) return;

  const onlineUsers = getOnlineUsers();
  const socketId = onlineUsers[safeUserId];

  // Primary direct socket emit.
  if (socketId) {
    io.to(String(socketId)).emit(eventName, payload);
  }

  // Reliable fallback because your sockets also join private rooms by userId.
  io.to(safeUserId).emit(eventName, payload);
}

function getOtherUserId(session, userId) {
  const safeUserId = String(userId || "").trim();
  const users = Array.isArray(session?.users) ? session.users.map(String) : [];

  return users.find((id) => id !== safeUserId) || null;
}

function getPublicUser(user = {}) {
  return {
    id: String(user.id || ""),
    firstName: user.firstName || "",
    lastName: user.lastName || "",
    name:
      String(user.firstName || user.name || "").trim() ||
      "Someone",
    avatar:
      user.avatar ||
      (Array.isArray(user.photos) && user.photos.length ? user.photos[0] : "") ||
      "",
  };
}

async function getPublicUserById(userId) {
  const user = await User.findOne(
    { id: String(userId) },
    {
      id: 1,
      firstName: 1,
      lastName: 1,
      name: 1,
      avatar: 1,
      photos: 1,
    }
  ).lean();

  return getPublicUser(user || { id: userId });
}

function socketError(socket, eventName, err, extra = {}) {
  const statusCode = Number(err?.statusCode || 500);

  if (statusCode >= 500) {
    console.error(`❌ ${eventName} socket error:`, err);
  }

  socket.emit("meetMiddle:error", {
    event: eventName,
    success: false,
    error: err?.code || "MEET_MIDDLE_SOCKET_ERROR",
    message: err?.message || "Meet in the Middle socket action failed",
    ...extra,
  });
}

function registerMeetMiddleSockets(io) {
  if (!io) {
    console.warn("⚠️ registerMeetMiddleSockets skipped: io missing");
    return;
  }

  io.on("connection", (socket) => {
    console.log("📍 meetMiddle socket connected:", socket.id);

    /**
     * Client emits:
     * socket.emit("meetMiddle:request", { to: peerId })
     *
     * Server emits to receiver:
     * meetMiddle:request:received
     *
     * Server emits to requester:
     * meetMiddle:request:sent
     */
    socket.on("meetMiddle:request", async ({ to } = {}) => {
      const eventName = "meetMiddle:request";

      try {
        const fromId = String(socket.userId || "").trim();
        const toId = String(to || "").trim();

        if (!fromId) {
          const err = new Error("Socket user is not registered");
          err.code = "SOCKET_USER_NOT_REGISTERED";
          err.statusCode = 401;
          throw err;
        }

        if (!toId) {
          const err = new Error("Peer user id is required");
          err.code = "PEER_REQUIRED";
          err.statusCode = 400;
          throw err;
        }

        const result = await createMeetRequest({
          fromId,
          toId,
        });

        const sender = await getPublicUserById(fromId);

        const payload = {
          success: true,
          reused: !!result.reused,
          session: result.session,
          from: sender,
          to: toId,
          createdAt: new Date().toISOString(),
        };

        socket.emit("meetMiddle:request:sent", payload);

        emitToUser(io, toId, "meetMiddle:request:received", {
          success: true,
          session: result.session,
          from: sender,
          message: `${sender.name || "Someone"} wants to meet halfway 💞`,
          createdAt: payload.createdAt,
        });
      } catch (err) {
        socketError(socket, eventName, err);
      }
    });

    /**
     * Client emits:
     * socket.emit("meetMiddle:location:share", {
     *   sessionId,
     *   coords: { lat, lng }
     * })
     *
     * Server emits:
     * - meetMiddle:location:waiting when only one side shared
     * - meetMiddle:suggestions:ready when both shared and places are ready
     */
    socket.on("meetMiddle:location:share", async ({ sessionId, coords } = {}) => {
      const eventName = "meetMiddle:location:share";

      try {
        const userId = String(socket.userId || "").trim();

        if (!userId) {
          const err = new Error("Socket user is not registered");
          err.code = "SOCKET_USER_NOT_REGISTERED";
          err.statusCode = 401;
          throw err;
        }

        const result = await shareLocationAndBuildSuggestions({
          sessionId,
          userId,
          coords,
        });

        const session = result.session;
        const otherUserId = getOtherUserId(session, userId);

        if (!result.ready) {
          const waitingPayload = {
            success: true,
            ready: false,
            session,
            sharedBy: userId,
            createdAt: new Date().toISOString(),
          };

          socket.emit("meetMiddle:location:waiting", waitingPayload);

          if (otherUserId) {
            emitToUser(io, otherUserId, "meetMiddle:location:peer-shared", waitingPayload);
          }

          return;
        }

        const readyPayload = {
          success: true,
          ready: true,
          session,
          midpoint: result.midpoint,
          smartMidpoint: result.smartMidpoint,
          radiusUsedMeters: result.radiusUsedMeters,
          places: result.places,
          createdAt: new Date().toISOString(),
        };

        session.users.forEach((id) => {
          emitToUser(io, id, "meetMiddle:suggestions:ready", readyPayload);
        });
      } catch (err) {
        socketError(socket, eventName, err);
      }
    });

    /**
     * Client emits:
     * socket.emit("meetMiddle:decline", { sessionId, reason })
     */
    socket.on("meetMiddle:decline", async ({ sessionId, reason } = {}) => {
      const eventName = "meetMiddle:decline";

      try {
        const userId = String(socket.userId || "").trim();

        if (!userId) {
          const err = new Error("Socket user is not registered");
          err.code = "SOCKET_USER_NOT_REGISTERED";
          err.statusCode = 401;
          throw err;
        }

        const session = await declineMeetRequest({
          sessionId,
          userId,
          reason,
        });

        const otherUserId = getOtherUserId(session, userId);

        const payload = {
          success: true,
          session,
          declinedBy: userId,
          reason: session.declineReason || "",
          createdAt: new Date().toISOString(),
        };

        socket.emit("meetMiddle:declined", payload);

        if (otherUserId) {
          emitToUser(io, otherUserId, "meetMiddle:declined", payload);
        }
      } catch (err) {
        socketError(socket, eventName, err);
      }
    });

    /**
     * Client emits:
     * socket.emit("meetMiddle:place:select", { sessionId, place })
     */
    socket.on("meetMiddle:place:select", async ({ sessionId, place } = {}) => {
      const eventName = "meetMiddle:place:select";

      try {
        const userId = String(socket.userId || "").trim();

        if (!userId) {
          const err = new Error("Socket user is not registered");
          err.code = "SOCKET_USER_NOT_REGISTERED";
          err.statusCode = 401;
          throw err;
        }

        const session = await selectPlace({
          sessionId,
          userId,
          place,
        });

        const otherUserId = getOtherUserId(session, userId);
        const selector = await getPublicUserById(userId);

        const payload = {
          success: true,
          session,
          selectedBy: selector,
          place: session.selectedPlace,
          message: `${selector.name || "Someone"} wants to meet at ${session.selectedPlace?.name || "this place"} 💞`,
          createdAt: new Date().toISOString(),
        };

        socket.emit("meetMiddle:place:selected", payload);

        if (otherUserId) {
          emitToUser(io, otherUserId, "meetMiddle:place:confirmation-needed", payload);
        }
      } catch (err) {
        socketError(socket, eventName, err);
      }
    });

    /**
     * Client emits:
     * socket.emit("meetMiddle:place:accept", { sessionId })
     */
    socket.on("meetMiddle:place:accept", async ({ sessionId } = {}) => {
      const eventName = "meetMiddle:place:accept";

      try {
        const userId = String(socket.userId || "").trim();

        if (!userId) {
          const err = new Error("Socket user is not registered");
          err.code = "SOCKET_USER_NOT_REGISTERED";
          err.statusCode = 401;
          throw err;
        }

        const session = await acceptSelectedPlace({
          sessionId,
          userId,
        });

        const payload = {
          success: true,
          session,
          place: session.selectedPlace,
          acceptedBy: userId,
          createdAt: new Date().toISOString(),
        };

        session.users.forEach((id) => {
          emitToUser(io, id, "meetMiddle:final-confirmed", payload);
        });
      } catch (err) {
        socketError(socket, eventName, err);
      }
    });

    /**
     * Client emits:
     * socket.emit("meetMiddle:place:reject", { sessionId })
     */
    socket.on("meetMiddle:place:reject", async ({ sessionId } = {}) => {
      const eventName = "meetMiddle:place:reject";

      try {
        const userId = String(socket.userId || "").trim();

        if (!userId) {
          const err = new Error("Socket user is not registered");
          err.code = "SOCKET_USER_NOT_REGISTERED";
          err.statusCode = 401;
          throw err;
        }

        const session = await rejectSelectedPlace({
          sessionId,
          userId,
        });

        const payload = {
          success: true,
          session,
          rejectedBy: userId,
          createdAt: new Date().toISOString(),
        };

        session.users.forEach((id) => {
          emitToUser(io, id, "meetMiddle:place:rejected", payload);
        });
      } catch (err) {
        socketError(socket, eventName, err);
      }
    });

    /**
     * Client emits:
     * socket.emit("meetMiddle:cancel", { sessionId })
     */
    socket.on("meetMiddle:cancel", async ({ sessionId } = {}) => {
      const eventName = "meetMiddle:cancel";

      try {
        const userId = String(socket.userId || "").trim();

        if (!userId) {
          const err = new Error("Socket user is not registered");
          err.code = "SOCKET_USER_NOT_REGISTERED";
          err.statusCode = 401;
          throw err;
        }

        const session = await cancelSession({
          sessionId,
          userId,
        });

        const payload = {
          success: true,
          session,
          cancelledBy: userId,
          createdAt: new Date().toISOString(),
        };

        session.users.forEach((id) => {
          emitToUser(io, id, "meetMiddle:cancelled", payload);
        });
      } catch (err) {
        socketError(socket, eventName, err);
      }
    });

    /**
     * Client emits:
     * socket.emit("meetMiddle:complete", { sessionId })
     */
    socket.on("meetMiddle:complete", async ({ sessionId } = {}) => {
      const eventName = "meetMiddle:complete";

      try {
        const userId = String(socket.userId || "").trim();

        if (!userId) {
          const err = new Error("Socket user is not registered");
          err.code = "SOCKET_USER_NOT_REGISTERED";
          err.statusCode = 401;
          throw err;
        }

        const session = await completeSession({
          sessionId,
          userId,
        });

        const payload = {
          success: true,
          session,
          completedBy: userId,
          createdAt: new Date().toISOString(),
        };

        session.users.forEach((id) => {
          emitToUser(io, id, "meetMiddle:completed", payload);
        });
      } catch (err) {
        socketError(socket, eventName, err);
      }
    });
  });
}

module.exports = {
  registerMeetMiddleSockets,
};