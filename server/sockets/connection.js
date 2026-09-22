/**
 * Path: server/sockets/connection.js
 * Purpose: Authenticate realtime clients and use MongoDB for every persistent socket operation.
 */
const authMiddleware = require("../routes/auth-middleware");
const User = require("../models/User");
const { onlineUsers } = require("../models/state");
const { registerChatEvents } = require("./chatEvents");
const { authorizeRoom, authorizePair } = require("../services/chatPersistence");
const fetch = (...args) => global.fetch(...args);

function registerConnection(io) {
  io.use(async (socket, next) => {
    const req = { headers: { authorization: "Bearer " + (socket.handshake?.auth?.token || "") } };
    const res = { status() { return this; }, json() { next(new Error("Authentication required")); } };
    await authMiddleware(req, res, async () => {
      try {
        socket.userId = String(req.user.id);
        await User.updateOne({ id: socket.userId }, { $set: { lastOnline: new Date() } });
        next();
      } catch { next(new Error("Presence persistence unavailable")); }
    });
  });
  io.on("connection", (socket) => {
    const currentUserId = socket.userId;
    let registered = false;
    const register = (userId) => {
      if (String(userId) !== currentUserId || registered) return;
      registered = true;
      onlineUsers[currentUserId] = socket.id;
      socket.join(currentUserId);
      io.emit("presence:online", { userId: currentUserId });
    };
    register(currentUserId);
    socket.emit("connected", { userId: currentUserId });
    socket.on("user:register", register);
    socket.on("register", register);
    registerChatEvents(io, socket);
    socket.on("match", async (data = {}) => {
      try {
        await authorizePair(currentUserId, String(data.otherUserId));
        io.to(String(data.otherUserId)).emit("match", { fromId: currentUserId, type: data.type });
      } catch {}
    });
    socket.on("buzz_match_open_profile", async (data = {}) => {
      try {
        const peerId = String(data.otherUserId);
        await authorizePair(currentUserId, peerId);
        io.to(currentUserId).emit("buzz_match_open_profile", { otherUserId: peerId, selfieUrl: data.selfieUrl });
        io.to(peerId).emit("buzz_match_open_profile", { otherUserId: currentUserId, selfieUrl: data.selfieUrl });
      } catch {}
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
        if (String(from) !== socket.userId) return;
        await authorizePair(String(from), String(to));
        const fromUser = await User.findOne({ id: String(from) }).select("id firstName lastName avatar").lean();
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
        if (!coords || !Number.isFinite(coords.lat) || !Number.isFinite(coords.lng) || Math.abs(coords.lat) > 90 || Math.abs(coords.lng) > 180) return;

        if (String(from) !== socket.userId) return;
        await authorizePair(String(from), String(to));
        const me = await User.findOne({ id: String(from) }).select("id firstName lastName location").lean();
        const you = await User.findOne({ id: String(to) }).select("id location").lean();
        if (!me || !you) return;

        me.location = { lat: Number(coords.lat), lng: Number(coords.lng) };
        await User.updateOne({ id: me.id }, { $set: { location: me.location } });

        if (!Number.isFinite(you.location?.lat) || !Number.isFinite(you.location?.lng)) {
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

    socket.on("game:join", async ({ roomId, game }) => {
      try {
        if (!roomId) return;
        const rid = String(roomId);
        await authorizeRoom(rid, socket.userId);
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

    socket.on("game:leave", async ({ roomId, game }) => {
      try {
        if (!roomId) return;
        const rid = String(roomId);
        await authorizeRoom(rid, socket.userId);
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

    socket.on("game:action", async (packet = {}) => {
      try {
        const { roomId, game, type, payload } = packet;
        if (!roomId || !game) return;
        const rid = String(roomId);
        await authorizeRoom(rid, socket.userId);
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

    socket.on("disconnect", async () => {
      try {
        const remaining = await io.in(currentUserId).fetchSockets();
        if (remaining.length) { onlineUsers[currentUserId] = remaining[0].id; return; }
        delete onlineUsers[currentUserId];
        await User.updateOne({ id: currentUserId }, { $set: { lastOnline: new Date() } });
        io.emit("presence:offline", { userId: currentUserId });
      } catch { console.error("Could not persist disconnect timestamp."); }
    });
  });
}
module.exports = { registerConnection };
