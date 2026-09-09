/**
 * ============================================================
 * 📁 File: sockets/connection.js
 * ⚡ Purpose: Handles all Socket.IO real-time events for:
 *   - Chat messaging
 *   - Typing / message seen
 *   - MicroBuzz & BuzzMatch live interactions
 *   - Real-time voice/video call signaling
 *   - Meet-in-Middle live coordination
 * ============================================================
 */

const jwt = require("jsonwebtoken");
const shortid = require("shortid");
const db = require("../models/db.lowdb");
const { JWT_SECRET, ENABLE_REALTIME_CHAT = true } = require("../config/env");
const { isBlocked, getRoomDoc } = require("../utils/helpers");
const { onlineUsers } = require("../models/state");

// ESM-safe fetch wrapper (same pattern as index.js)
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

function registerConnection(io) {  io.on("connection", (socket) => {
    console.log(`⚡️ New client connected: ${socket.id}`);
    let currentUserId = null;

    // =========================
    // ❤️ MATCH + BUZZ MATCH OPEN PROFILE
    // =========================
    socket.on("match", (data) => {
      const { otherUserId, type } = data || {};
      if (onlineUsers[otherUserId]) {
        io.to(String(otherUserId)).emit("match", {
          fromId: socket.userId,
          type,
        });

        // 💫 When both should open each other's profile
        socket.on("buzz_match_open_profile", (data) => {
          const { otherUserId, selfieUrl } = data || {};
          console.log("💫 buzz_match_open_profile:", data);

          const myId = currentUserId;
          const peerId = otherUserId;
          if (!myId || !peerId) return;

          // Emit to both users' private rooms
          if (onlineUsers[myId]) {
            io.to(String(myId)).emit("buzz_match_open_profile", {
              otherUserId: peerId,
              selfieUrl,
            });
          }
          if (onlineUsers[peerId]) {
            io.to(String(peerId)).emit("buzz_match_open_profile", {
              otherUserId: myId,
              selfieUrl,
            });
          }

          console.log(`💫 buzz_match_open_profile relayed between ${myId} ↔ ${peerId}`);
        });

        console.log(`💥 Match emitted between ${socket.userId} ↔ ${otherUserId}`);
      }
    });

    // =========================
    // 🔌 USER REGISTRATION EVENTS
    // =========================
    socket.on("user:register", (userId) => {
      if (!userId) return;
      onlineUsers[userId] = socket.id;
      currentUserId = userId;
      socket.join(String(userId));
      io.emit("presence:online", { userId });
      console.log(`🔌 (user:register) ${userId} → ${socket.id} (joined private room)`);
    });

    socket.on("register", (userId) => {
      if (!userId) return;
      onlineUsers[userId] = socket.id;
      currentUserId = userId;
      socket.join(String(userId));
      io.emit("presence:online", { userId });
      console.log(`🔌 (legacy register) ${userId} → ${socket.id}`);
    });

    // =========================
    // 🔐 AUTHENTICATION VIA TOKEN
    // =========================
    if (!ENABLE_REALTIME_CHAT) {
      socket.emit("info", { message: "Realtime chat disabled by config" });
      return;
    }

    const token = socket.handshake?.auth?.token;
    if (token) {
      try {
        const data = jwt.verify(token, JWT_SECRET);
        const userId = data.id;
        onlineUsers[userId] = socket.id;
        currentUserId = userId;

        (async () => {
          await db.read();
          const u = db.data.users.find((x) => x.id === userId);
          if (u) {
            u.lastOnline = Date.now();
            await db.write();
          }
        })();

        socket.join(userId);
        socket.emit("connected", { userId });
        console.log(`✅ Authenticated user ${userId} joined their private room.`);
      } catch {
        socket.emit("error", { message: "Invalid auth token" });
      }
    }

    // =========================
    // 💬 ROOMS + UX SIGNALS
    // =========================
    socket.on("joinRoom", (roomId) => {
      if (!roomId) return;
      socket.join(roomId);
      console.log(`🟢 ${socket.id} joined room ${roomId}`);
    });

    socket.on("leaveRoom", (roomId) => {
      if (!roomId) return;
      socket.leave(roomId);
      console.log(`🔴 ${socket.id} left room ${roomId}`);
    });

    socket.on("typing", ({ roomId, fromId }) => {
      if (!roomId || !fromId) return;
      socket.to(roomId).emit("typing", { fromId });
    });

    socket.on("message:seen", ({ roomId, msgId }) => {
      if (!roomId || !msgId) return;
      socket.to(roomId).emit("message:seen", msgId);
    });

    // 🧨 Auto-delete “view once” messages when seen
    socket.on("message:seen", async ({ roomId, msgId }) => {
      await db.read();
      const msg = db.data.messages?.find((m) => m.id === msgId);
      if (msg && msg.ephemeral?.mode === "once") {
        db.data.messages = db.data.messages.filter((m) => m.id !== msgId);
        await db.write();
        io.to(roomId).emit("message:removed", { id: msgId });
      }
    });

    // 🕓 Auto-cleanup expired messages hourly
    setInterval(async () => {
      await db.read();
      const now = Date.now();
      db.data.messages = db.data.messages.filter((m) => {
        if (!m.expireAt) return true;
        return new Date(m.expireAt).getTime() > now;
      });
      await db.write();
    }, 60 * 60 * 1000);

    // =========================
    // 💌 SEND MESSAGE
    // =========================
    socket.on("sendMessage", async (msg) => {
      try {
        if (!msg || !msg.roomId) return;
        const { roomId, from, to, text } = msg;

        // Block check
        if (isBlocked(from, to)) {
          socket.emit("warn", {
            roomId,
            reason: "blocked",
            message: "This user is unavailable to chat.",
          });
          return;
        }

        const doc = await getRoomDoc(roomId);
        if (!doc.list.find((m) => m.id === msg.id)) {
          doc.list.push({
            id: msg.id || shortid.generate(),
            roomId,
            from,
            to,
            text: text || "",
            type:
              msg.type ||
              (String(text || "").startsWith("::RBZ::") ? "media" : "text"),
            time: msg.time || new Date().toISOString(),
            edited: false,
            deleted: false,
            reactions: {},
            hiddenFor: [],
          });
          await db.write();
        }

        // Emit message events
        io.to(roomId).emit("chat:message", {
          id: msg.id,
          roomId,
          from,
          to,
          text: msg.text || text || "",
          time: msg.time,
          type: msg.type || "text",
        });

        io.to(String(to)).emit("chat:message", {
          id: msg.id,
          roomId,
          from,
          to,
          text: msg.text || text || "",
          time: msg.time,
          type: msg.type || "text",
        });

        const sid = onlineUsers[to];
        if (sid) {
          io.to(sid).emit("chat:message", {
            id: msg.id,
            roomId,
            from,
            to,
            text: msg.text || text || "",
            time: msg.time,
            type: msg.type || "text",
          });
        }

        console.log(`💬 Message in ${roomId} from ${from} → ${to}`);
      } catch (e) {
        console.error("sendMessage error:", e);
      }
    });

    // =========================
    // 📞 REAL-TIME CALLS (OFFER / ANSWER / SIGNAL / END)
    // =========================
    socket.on("call:offer", (data) => {
      const { roomId, type, from } = data;
      if (!roomId || !type || !from) return;
      const [user1, user2] = roomId.split("_");
      const peerId = user1 === from ? user2 : user1;
      const sid = onlineUsers[peerId];
      if (sid) io.to(sid).emit("call:offer", { roomId, type, from });
      console.log(`📞 Offer (${type}) ${from} → ${peerId}`);
    });

    socket.on("call:answer", (data) => {
      const { roomId, accepted, from } = data;
      if (!roomId || !from) return;
      const [user1, user2] = roomId.split("_");
      const peerId = user1 === from ? user2 : user1;
      const sid = onlineUsers[peerId];
      if (sid) io.to(sid).emit("call:answer", { roomId, accepted, from });
      console.log(`📞 Answer ${accepted ? "accepted" : "declined"} ${from} → ${peerId}`);
    });

    socket.on("call:signal", (data) => {
      const { roomId, payload } = data;
      if (!roomId || !payload) return;
      const { from, data: signalData } = payload;
      const [user1, user2] = roomId.split("_");
      const peerId = user1 === from ? user2 : user1;
      const sid = onlineUsers[peerId];
      if (sid)
        io.to(sid).emit("call:signal", { roomId, payload: { from, data: signalData } });
      console.log(`📡 ICE signal ${from} → ${peerId}`);
    });

    socket.on("call:end", (data) => {
      const { roomId, reason, from } = data;
      if (!roomId || !from) return;
      const [user1, user2] = roomId.split("_");
      const peerId = user1 === from ? user2 : user1;
      const sid = onlineUsers[peerId];
      if (sid)
        io.to(sid).emit("call:end", { roomId, reason, from });
      console.log(`📞 Call ended ${from} → ${peerId}: ${reason}`);
    });

    // =========================
    // 📍 MEET-IN-MIDDLE EVENTS
    // =========================
    socket.on("meet:request", async ({ from, to }) => {
      try {
        if (!from || !to) return;
        await db.read();
        const fromUser = db.data.users.find((u) => String(u.id) === String(from)) || { id: from };
        const sid = onlineUsers[to];
        if (sid) {
          io.to(sid).emit("meet:request", { from: fromUser });
          console.log(`📨 meet:request ${from} → ${to}`);
        }
      } catch (e) {
        console.error("meet:request error", e);
      }
    });

    socket.on("meet:accept", async ({ to, from, coords }) => {
      try {
        console.log("📍 meet:accept from", from, "→", to, coords);
        if (!from || !to) return;
        if (!coords || typeof coords.lat !== "number" || typeof coords.lng !== "number") return;

        await db.read();
        const me = db.data.users.find((u) => String(u.id) === String(from));
        const you = db.data.users.find((u) => String(u.id) === String(to));
        if (!me || !you) return;

        me.location = { lat: Number(coords.lat), lng: Number(coords.lng) };
        await db.write();

        if (!you.location?.lat || !you.location?.lng) {
          const sid = onlineUsers[to];
          if (sid) io.to(sid).emit("meet:accept", { from, coords: me.location });
          return;
        }

        const res = await fetch("https://rombuzz-api.onrender.com/api/meet/suggest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ a: me.location, b: you.location }),
        });

        const data = await res.json().catch(() => ({}));
        const places = Array.isArray(data.places) ? data.places : [];

        const payload = {
          from: { id: me.id, firstName: me.firstName, lastName: me.lastName },
          midpoint: data.midpoint || {
            lat: (me.location.lat + you.location.lat) / 2,
            lng: (me.location.lng + you.location.lng) / 2,
          },
          places,
        };

        const sidMe = onlineUsers[me.id];
        const sidYou = onlineUsers[you.id];
        if (sidMe) io.to(sidMe).emit("meet:suggest", payload);
        if (sidYou) io.to(sidYou).emit("meet:suggest", payload);
        console.log(`📍 meet:suggest → ${me.id}, ${you.id} (${places.length} places)`);
      } catch (e) {
        console.error("meet:accept error", e);
      }
    });

    // ===============================
    // 🎮 REAL-TIME COUPLES GAMES HUB
    // ===============================
    //
    // Frontend emits:
    //   socket.emit("game:join",  { roomId, game });
    //   socket.emit("game:leave", { roomId, game });
    //   socket.emit("game:action",{ roomId, game, type:"SYNC", payload:{...} });
    //
    // We just broadcast to the *other* socket(s) in that chat room.

    socket.on("game:join", ({ roomId, game }) => {
      try {
        if (!roomId) return;
        const rid = String(roomId);
        socket.join(rid);
        const userId = currentUserId;

        // let the partner know someone opened a game
        socket.to(rid).emit("game:presence", {
          roomId: rid,
          game,
          type: "join",
          userId,
        });
      } catch (e) {
        console.error("game:join error", e);
      }
    });

    socket.on("game:leave", ({ roomId, game }) => {
      try {
        if (!roomId) return;
        const rid = String(roomId);
        socket.leave(rid);
        const userId = currentUserId;

        socket.to(rid).emit("game:presence", {
          roomId: rid,
          game,
          type: "leave",
          userId,
        });
      } catch (e) {
        console.error("game:leave error", e);
      }
    });

    socket.on("game:action", (packet = {}) => {
      try {
        const { roomId, game, type, payload } = packet;
        if (!roomId || !game) return;
        const rid = String(roomId);
        const userId = currentUserId;

        // Only send to the *other* side – sender already has the state.
        socket.to(rid).emit("game:update", {
          roomId: rid,
          game,
          type,
          payload,
          from: userId,
        });
      } catch (e) {
        console.error("game:action error", e);
      }
    });

    // Keep the shared onlineUsers map from pointing at a dead socket.
    socket.on("disconnect", () => {
      if (currentUserId && onlineUsers[currentUserId] === socket.id) {
        delete onlineUsers[currentUserId];
      }
    });

  });
}

// ============================================================
// ✅ EXPORT
// ============================================================
module.exports = { registerConnection };
