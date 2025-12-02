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
const ChatRoom = require("../models/ChatRoom");
const shortid = require("shortid");

function registerMeetSockets(io) {
  io.on("connection", (socket) => {
    console.log("⚡ meet-user connected:", socket.id);

    // Ensure map exists
    global.onlineUsers = global.onlineUsers || {};
    // Helper: build roomId in the same way as frontend (sorted "a_b")
    const makeRoomId = (a, b) => {
      const A = String(a);
      const B = String(b);
      return A < B ? `${A}_${B}` : `${B}_${A}`;
    };

    // Helper: create a system meetup message in the chat and emit it
    async function createMeetSystemMessage(fromId, toId, place) {
      try {
        const roomId = makeRoomId(fromId, toId);
        let room = await ChatRoom.findOne({ roomId });

        if (!room) {
          room = await ChatRoom.create({
            roomId,
            participants: [String(fromId), String(toId)],
            messages: [],
          });
        }

        const lat =
          (place && place.coords && place.coords.lat) ||
          place?.lat ||
          null;
        const lng =
          (place && place.coords && place.coords.lng) ||
          place?.lng ||
          null;

        let text = `🎉 Meetup Confirmed:\nYou both agreed to meet at ${place?.name || "this place"}`;

        if (typeof lat === "number" && typeof lng === "number") {
          const osmUrl = `https://www.openstreetmap.org/#map=18/${lat}/${lng}`;
          text += `\n🌍 ${osmUrl}`;
        }

        const msg = {
          id: shortid.generate(),
          from: String(fromId),
          to: String(toId),
          text,
          type: "meetup",
          time: new Date(),
          edited: false,
          deleted: false,
          reactions: {},
          hiddenFor: [],
          ephemeral: { mode: "none" },
        };

        room.messages.push(msg);
        await room.save();

        // Emit to the room so both users see it in chat
        io.to(roomId).emit("chat:message", msg);

        // Also update peer via direct channel if online (for unread bubble)
        const sid = global.onlineUsers?.[toId];
        if (sid) {
          io.to(sid).emit("chat:message", msg);
          io.to(sid).emit("direct:message", {
            id: msg.id,
            roomId,
            from: fromId,
            to: toId,
            time: msg.time,
            preview: (msg.text || "").slice(0, 80),
            type: msg.type || "text",
          });
        }
      } catch (err) {
        console.error("createMeetSystemMessage error:", err);
      }
    }

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

        // 3️⃣ Both shared → Fetch midpoint & venues from backend
        let data = {};
        try {
          const resp = await fetch(
            `${process.env.API_BASE}/api/meet-suggest?otherId=${to}`
          );
          data = await resp.json();
        } catch (err) {
          console.warn("⚠️ meet-suggest fetch failed:", err);
        }

        const places = Array.isArray(data.places) ? data.places : [];

        // Midpoint from API if available, otherwise fallback to pure average
        const midpoint =
          data.midpoint && typeof data.midpoint.lat === "number" && typeof data.midpoint.lng === "number"
            ? data.midpoint
            : {
                lat: (me.location.lat + you.location.lat) / 2,
                lng: (me.location.lng + you.location.lng) / 2,
              };

        // Smart midpoint (for UI - exact vs "smart" center)
        const smartMidpoint =
          data.smartMidpoint &&
          typeof data.smartMidpoint.lat === "number" &&
          typeof data.smartMidpoint.lng === "number"
            ? data.smartMidpoint
            : midpoint;

        const canExpand = Boolean(data.canExpand);

        // Final payload for both users
        const payload = {
          from: {
            id: me.id,
            firstName: me.firstName,
            lastName: me.lastName,
          },
          midpoint,
          smartMidpoint,
          places,
          canExpand,
        };

        // Send to both users
        [me.id, you.id].forEach((id) => {
          const sid = onlineUsers[id];
          if (sid) io.to(sid).emit("meet:suggest", payload);
        });

        console.log(
          `📍 meet:suggest → ${me.id}, ${you.id} (places: ${places.length}, canExpand=${canExpand})`
        );
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

    // ✅ NEW: User ACCEPTS the suggested place
    socket.on("meet:place:accepted", async ({ from, to, place }) => {
      try {
        if (!from || !to || !place) return;

        // Notify the other user that the place is finalized
        const sid = onlineUsers[to];
        if (sid) {
          io.to(sid).emit("meet:finalized", {
            from,
            place,
            accepted: true,
          });
        }

        // Create system chat message in their room
        await createMeetSystemMessage(from, to, place);

        console.log(`✅ meet:place:accepted ${from} ↔ ${to} (${place?.name || "?"})`);
      } catch (err) {
        console.error("meet:place:accepted error", err);
      }
    });

    // ✅ NEW: User REJECTS the suggested place
    socket.on("meet:place:rejected", ({ from, to, place }) => {
      try {
        if (!from || !to || !place) return;

        const sid = onlineUsers[to];
        if (sid) {
          io.to(sid).emit("meet:place:rejected", {
            from,
            place,
            rejected: true,
          });
        }

        console.log(`❌ meet:place:rejected ${from} → ${to} (${place?.name || "?"})`);
      } catch (err) {
        console.error("meet:place:rejected error", err);
      }
    });
  });
}

module.exports = { registerMeetSockets };

