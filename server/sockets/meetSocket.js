/**
 * ============================================================
 * 📁 File: sockets/meetSocket.js
 * ⚡ Purpose: Manage realtime Meet-in-Middle & presence events
 *             through Socket.IO (location sharing, buzz popups,
 *             meet requests, and live status updates).
 *
 * Events:
 *   user:register / register         → Track active socket users
 *   meet:request / accept / decline  → Coordinate meet flow
 *   meet:chosen                      → Notify both users of selected venue
 *   buzz_request                     → Handle MicroBuzz live pop-ups
 *
 * Dependencies (Mongo version):
 *   - models/User.js        → User data + location
 *   - global.onlineUsers    → Socket ID map
 *   - node-fetch / fetch    → For calling /api/meet-suggest
 * ============================================================
 */

const fetch = require("node-fetch");
const User = require("../models/User"); // MongoDB User model

function registerMeetSockets(io) {
  io.on("connection", (socket) => {
    console.log("⚡ meet-user connected:", socket.id);

    // Ensure map exists
    global.onlineUsers = global.onlineUsers || {};

    /* ============================================================
       👤 USER REGISTRATION & PRESENCE
    ============================================================ */

    socket.on("user:register", (userId) => {
      if (!userId) return;

      onlineUsers[userId] = socket.id;
      socket.userId = String(userId);
      socket.join(String(userId));

      console.log("✅ Registered user:", userId, "→", socket.id);
    });

    socket.on("register", (userId) => {
      if (!userId) return;

      onlineUsers[userId] = socket.id;
      socket.userId = String(userId);
      socket.join(String(userId));

      console.log("✅ Legacy register:", userId, "→", socket.id);
      io.emit("presence:online", { userId });
    });

    socket.on("disconnect", () => {
      const userId = socket.userId;
      if (userId && onlineUsers[userId]) {
        delete onlineUsers[userId];
        io.emit("presence:offline", { userId });
        console.log("❌ Disconnected:", userId);
      }
    });

    /* ============================================================
       💌 MICROBUZZ — Real-time Nearby Buzz Request
    ============================================================ */
    socket.on("buzz_request", ({ toId, fromId, selfieUrl, name, message }) => {
      if (!toId || !fromId) return;

      if (onlineUsers[toId]) {
        io.to(String(toId)).emit("buzz_request", {
          fromId,
          selfieUrl,
          name,
          message: message || "Someone nearby buzzed you!",
          type: "microbuzz",
        });

        console.log(`📡 buzz_request ${fromId} → ${toId}`);
      }
    });

    /* ============================================================
       💞 MEET-IN-MIDDLE — Realtime Coordination (Mongo version)
    ============================================================ */

    // 🔔 Step 1: Send Meet Request
    socket.on("meet:request", async ({ from, to }) => {
      try {
        if (!from || !to) return;

        // Fetch sender from Mongo
        const sender =
          (await User.findOne({ id: from }, { id: 1, firstName: 1, lastName: 1 }).lean()) ||
          { id: from };

        const sid = onlineUsers[to];
        if (sid) {
          io.to(sid).emit("meet:request", { from: sender });
          console.log(`📨 meet:request ${from} → ${to}`);
        }
      } catch (e) {
        console.error("meet:request error", e);
      }
    });

    // 📍 Step 2: Accept Meet & Share Location
    socket.on("meet:accept", async ({ from, to, coords }) => {
      try {
        if (!from || !to || !coords) return;

        // 1️⃣ Update "from" user's location in Mongo
        const me = await User.findOneAndUpdate(
          { id: from },
          {
            $set: {
              location: {
                lat: Number(coords.lat),
                lng: Number(coords.lng),
                updatedAt: new Date(),
              },
            },
          },
          { new: true }
        ).lean();

        // 2️⃣ Fetch "to" user
        const you = await User.findOne({ id: to }).lean();
        if (!me || !you) return;

        // If "to" user hasn't shared location yet → send mine and wait
        if (!you.location?.lat || !you.location?.lng) {
          const sid = onlineUsers[to];
          if (sid)
            io.to(sid).emit("meet:accept", {
              from,
              coords: me.location,
            });
          return;
        }

        // 3️⃣ Both shared → Fetch midpoint & venues
        let data = {};
        try {
          const resp = await fetch(`${process.env.API_BASE}/api/meet-suggest?otherId=${to}`);
          data = await resp.json();
        } catch (err) {
          console.warn("⚠️ meet-suggest fetch failed:", err);
        }

        const places = Array.isArray(data.places) ? data.places : [];

        // Final calculated midpoint (fallback)
        const midpoint = {
          lat: (me.location.lat + you.location.lat) / 2,
          lng: (me.location.lng + you.location.lng) / 2,
        };

        // Final payload
        const payload = {
          from: {
            id: me.id,
            firstName: me.firstName,
            lastName: me.lastName,
          },
          midpoint,
          places,
        };

        // Send to both users
        [me.id, you.id].forEach((id) => {
          const sid = onlineUsers[id];
          if (sid) io.to(sid).emit("meet:suggest", payload);
        });

        console.log(`📍 meet:suggest → ${me.id}, ${you.id}`);
      } catch (e) {
        console.error("meet:accept error", e);
      }
    });

    // 🚫 Step 3: Decline Meet Request
    socket.on("meet:decline", ({ from, to }) => {
      const sid = onlineUsers[to];
      if (sid) io.to(sid).emit("meet:decline", { from: { id: from } });
      console.log(`❌ meet:decline ${from} → ${to}`);
    });

    // 🏠 Step 4: Confirm Chosen Place
    socket.on("meet:chosen", ({ from, to, place }) => {
      const sid = onlineUsers[to];
      if (sid)
        io.to(sid).emit("meet:place:selected", {
          from: { id: from },
          place,
        });

      console.log(`🏠 meet:chosen ${from} → ${to} (${place?.name || "?"})`);
    });
  });
}

module.exports = { registerMeetSockets };
