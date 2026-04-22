/**
 * ============================================================
 * 📁 File: routes/likesMatches.js
 * 🧩 Purpose: Handle Likes, Matches, Buzz, MatchStreak, and Social Stats.
 *
 * Endpoints:
 *   POST /api/likes                     → Like / Buzz request
 *   POST /api/buzz                      → Buzz between matched users
 *   GET  /api/likes/status/:id          → Get like/match status with user
 *   GET  /api/matches                   → Get all matches
 *   GET  /api/matchstreak/:id           → Get directed MatchStreak info
 *   POST /api/unmatch/:id               → Unmatch user
 *   GET  /api/social-stats              → Social counts (likes, matches)
 *   GET  /api/social/:type              → Lists (liked / likedYou / matches)
 *
 * Dependencies:
 *   - models/User.js        → Mongoose schema for users
 *   - models/Like.js        → Mongoose schema for likes
 *   - models/Match.js       → Mongoose schema for matches
 *   - models/MatchStreak.js → Optional streak tracking
 *   - authMiddleware.js     → JWT validation
 *   - utils/helpers.js      → isBlocked, baseSanitizeUser, incMatchStreakOut
 *   - io, onlineUsers       → from socket.js
 *   - sendNotification()    → notify matched or buzzed users
 *
 * Notes:
 *   - Core of matchmaking logic (Buzz + Match + Streaks)
 *   - Used by Discover, ViewProfile, Chat, and Notifications modules
 * ============================================================
 */


const express = require("express");
const router = express.Router();
const authMiddleware = require("../routes/auth-middleware");
const shortid = require("shortid");

const User = require("../models/User");
const Relationship = require("../models/Relationship");
const Match = require("../models/Match");
const MatchStreak = require("../models/MatchStreak");
const ChatRoom = require("../models/ChatRoom");
const mongoose = require("mongoose");
const {
  baseSanitizeUser,
  sendNotification,
  isBlocked,
  incMatchStreakOut,
} = require("../utils/helpers");

// Socket helpers – defer lookup so we don't capture undefined at require-time
function getIO() {
  return global.io || null;
}

function getOnlineUsers() {
  if (!global.onlineUsers) {
    global.onlineUsers = {};
  }
  return global.onlineUsers;
}

async function findUserByAnyId(userId) {
  const raw = String(userId || "").trim();
  if (!raw) return null;

  let user = await User.findOne({ id: raw }).lean();
  if (user) return user;

  if (mongoose.Types.ObjectId.isValid(raw)) {
    user = await User.findById(raw).lean();
    if (user) return user;
  }

  return null;
}

const ENABLE_LIKES_MATCHES = true;
const buzzLocks = new Set();

/* ======================
   ❤️ LIKE / MATCH
====================== */
router.post("/likes", authMiddleware, async (req, res) => {
  if (!ENABLE_LIKES_MATCHES)
    return res.status(403).json({ error: "likes disabled" });

  try {
    const { to } = req.body;
    if (!to) return res.status(400).json({ error: "to required" });
    const from = req.user.id;

    // ⭐ FIXED: make async
    if (await isBlocked(from, to))
      return res.status(403).json({ error: "blocked" });

    // 💞 Already liked?
    const existing = await Relationship.findOne({ from, to, type: "like" });
    if (existing)
      return res.status(400).json({ error: "already liked" });

       // 💞 Create like
    await Relationship.create({
      id: shortid.generate(),
      from,
      to,
      type: "like",
      createdAt: new Date(),
    });

    // 💞 Check mutual like → MATCH
    const mutual = await Relationship.findOne({ from: to, to: from, type: "like" });
    const [self, other] = await Promise.all([
      findUserByAnyId(from),
      findUserByAnyId(to),
    ]);

  if (mutual) {
  const existsMatch = await Match.findOne({ users: { $all: [from, to] } });
  if (!existsMatch) {
    await Match.create({
      id: shortid.generate(),
      users: [from, to],
      createdAt: new Date(),
    });
  }

  // 🧹 Cleanup
  await Relationship.deleteMany({
    $or: [
      { from, to, type: "like" },
      { from: to, to: from, type: "like" },
    ],
  });

    // ===============================
  // 🔥 NEW: Unified Discover Match Logic
  // ===============================

  const fromName =
    String(self?.firstName || self?.name || "").trim() || "Someone";
  const toName =
    String(other?.firstName || other?.name || "").trim() || "Someone";

  // Shared chat room id (consistent with MicroBuzz)
  const roomId = [from, to].sort().join("_");

   // ===========================
  // SAFE SOCKET LOOKUP
  // ===========================
  const io = getIO();
  const onlineUsers = getOnlineUsers();

  // SOCKET MATCH EVENT FOR BOTH USERS (safe guarded)
  if (io && onlineUsers[from]) {
    io.to(String(onlineUsers[from])).emit("match", {
      otherUserId: to,
      otherName: toName,
      roomId,
      via: "discover",
    });
  }

  if (io && onlineUsers[to]) {
    io.to(String(onlineUsers[to])).emit("match", {
      otherUserId: from,
      otherName: fromName,
      roomId,
      via: "discover",
    });
  }


  // MATCH NOTIFICATIONS FOR BOTH USERS (Symmetrical)
  await Promise.all([
    // To USER B (to)
    sendNotification(to, {
      fromId: from,
      type: "match",
      message: `You and ${fromName} matched with each other 💞`,
      href: `/viewProfile/${from}`,
      entity: "chat",
      entityId: roomId,
    }),

    // To USER A (from)
    sendNotification(from, {
      fromId: to,
      type: "match",
      message: `You and ${toName} matched with each other 💞`,
      href: `/viewProfile/${to}`,
      entity: "chat",
      entityId: roomId,
    }),
  ]);

  return res.json({ success: true, matched: true });
}

    else {
  // 💌 Discover Like → Match Request
  const io = getIO();
  const onlineUsers = getOnlineUsers();

  const targetSocket = onlineUsers[to];
  if (io && targetSocket) {
    const fromUser = baseSanitizeUser(self);

    // 🔔 Real-time Discover Like (navbar unread)
    io.to(String(targetSocket)).emit("notification", {
      id: shortid.generate(),
      fromId: from,
      type: "buzz",
      via: "discover_like",
      message: `${fromUser.firstName || "Someone nearby"} wants to match with you! 💖`,
      createdAt: new Date().toISOString(),
      read: false
    });

    // 🔔 Also show Discover popup
    io.to(String(targetSocket)).emit("buzz_request", {
      fromId: from,
      name: fromUser.firstName || "Someone nearby",
      selfieUrl: fromUser.avatar || "",
    });
  }

  const fromName = self?.firstName || "Someone nearby";
  await sendNotification(to, {
    fromId: from,
    type: "buzz",
    via: "discover_like", // 🔹 identify as Discover match request
    message: `${fromName} wants to match with you! 💖`,
  });
}



    res.json({ success: true, matched: !!mutual });
  } catch (err) {
    console.error("❌ LIKE error:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

/* ======================
   ✅ RESPOND TO LIKE (ACCEPT / REJECT)
====================== */
router.post("/likes/respond", authMiddleware, async (req, res) => {
  try {
    const toId = req.user.id; // current user (e.g. Katy)
    const { fromId, action } = req.body || {};

    if (!fromId || !action) {
      return res.status(400).json({ error: "fromId and action required" });
    }

    // Must be a pending like from John → Katy
    const likeDoc = await Relationship.findOne({
      from: fromId,
      to: toId,
      type: "like",
    });

    if (!likeDoc) {
      return res.status(404).json({ error: "request_not_found" });
    }

    // ❌ REJECT – just clean up the like(s)
    if (action === "reject") {
      await Relationship.deleteMany({
        $or: [
          { from: fromId, to: toId, type: "like" },
          { from: toId, to: fromId, type: "like" },
        ],
      });
      return res.json({ success: true, matched: false });
    }

    if (action !== "accept") {
      return res.status(400).json({ error: "invalid_action" });
    }

    // ✅ ACCEPT → create match, clean likes, notify both
    const existsMatch = await Match.findOne({ users: { $all: [fromId, toId] } });
    if (!existsMatch) {
      await Match.create({
        id: shortid.generate(),
        users: [fromId, toId],
        createdAt: new Date(),
      });
    }

      // Clean up likes in both directions
    await Relationship.deleteMany({
      $or: [
        { from: fromId, to: toId, type: "like" },
        { from: toId, to: fromId, type: "like" },
      ],
    });

    // Load names for pretty messages
    const [fromUser, toUser] = await Promise.all([
      findUserByAnyId(fromId),
      findUserByAnyId(toId),
    ]);

    const fromName =
      String(fromUser?.firstName || fromUser?.name || "").trim() || "Someone";
    const toName =
      String(toUser?.firstName || toUser?.name || "").trim() || "Someone";

    // Shared chat room id (same style as MicroBuzz)
    const roomId = [fromId, toId].sort().join("_");

    // 🎉 Socket "match" event for both users (Discover)
     const io = getIO();
    const onlineUsers = getOnlineUsers();

    if (io && onlineUsers[fromId]) {
      io.to(String(onlineUsers[fromId])).emit("match", {
        otherUserId: toId,
        otherName: toName,
        roomId,
        via: "discover",
      });
    }

    if (io && onlineUsers[toId]) {
      io.to(String(onlineUsers[toId])).emit("match", {
        otherUserId: fromId,
        otherName: fromName,
        roomId,
        via: "discover",
      });
    }


      // 🔔 Match notifications for BOTH (same shape as MicroBuzz)
    await Promise.all([
      // For Katy (who accepted)
      sendNotification(toId, {
        fromId,
        type: "match",
        message: `You and ${fromName} matched with each other 💞`,
        href: `/viewProfile/${fromId}`,
        entity: "chat",
        entityId: roomId,
      }),
      // For John
      sendNotification(fromId, {
        fromId: toId,
        type: "match",
        message: `You and ${toName} matched with each other 💞`,
        href: `/viewProfile/${toId}`,
        entity: "chat",
        entityId: roomId,
      }),
    ]);

    // ✅ Return rich payload for frontend celebrations
    return res.json({
      success: true,
      matched: true,
      roomId,
      via: "discover",
      otherUserId: fromId, // fromId = the person Katy accepted
    });

  } catch (err) {
    console.error("❌ LIKE respond error:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

/* ======================
   💖 BUZZ BETWEEN MATCHED USERS
====================== */
router.post("/buzz", authMiddleware, async (req, res) => {
  const fromId = req.user.id;
  const { to } = req.body || {};
  if (!to) return res.status(400).json({ error: "to required" });

  const pairKey = [String(fromId), String(to)].sort().join("_");
  if (buzzLocks.has(pairKey))
    return res.status(429).json({ error: "busy" });
  buzzLocks.add(pairKey);

  try {
    // Ensure match
    const matched = await Match.findOne({ users: { $all: [fromId, to] } });
    if (!matched) return res.status(409).json({ error: "not_matched" });

    // ⭐ FIXED: make async
    if (await isBlocked(fromId, to))
      return res.status(403).json({ error: "blocked" });

    // Cooldown
    const now = Date.now();
    const COOLDOWN_MS = 3 * 1000;
    global._buzzCooldown ||= {};
    const last = global._buzzCooldown[pairKey] || 0;
    if (now - last < COOLDOWN_MS) {
      return res.status(429).json({
        error: "cooldown",
        retryInMs: COOLDOWN_MS - (now - last),
      });
    }
    global._buzzCooldown[pairKey] = now;

    // Streak update
    const streakObj = await incMatchStreakOut(fromId, to);
    const currentStreak = Number(streakObj?.count || 0);

    const sender = await User.findOne({ id: fromId }).lean();
    const fromName = sender?.firstName || "Someone";
    let message = `${fromName} buzzed you! Buzz them back! 💖`;
    if (currentStreak > 1)
      message += `\n🔥 MatchStreak: ${currentStreak}`;
    else if (currentStreak === 1)
      message += `\n🎉 Start a MatchStreak!`;

    await sendNotification(to, {
      fromId,
      type: "buzz",
      message,
      href: `/viewProfile/${fromId}`,
      streak: currentStreak,
    });

    console.log(`✅ Buzz OK. Streak now ${currentStreak}`);
    return res.json({ success: true, streak: currentStreak });
  } catch (e) {
    console.error("❌ Buzz endpoint error:", e);
    return res.status(500).json({ error: "internal_error" });
  } finally {
    buzzLocks.delete(pairKey);
  }
});

/* ======================
   ❤️ STATUS & MATCH LISTS
====================== */
router.get("/likes/status/:targetUserId", authMiddleware, async (req, res) => {
  try {
    const targetId = req.params.targetUserId;
    const selfId = req.user.id;

    const likedByMe = await Relationship.exists({ from: selfId, to: targetId, type: "like" });
    const likedMe = await Relationship.exists({ from: targetId, to: selfId, type: "like" });
    const matched = await Match.exists({ users: { $all: [selfId, targetId] } });

    res.json({ likedByMe: !!likedByMe, likedMe: !!likedMe, matched: !!matched });
  } catch (e) {
    console.error("Status error:", e);
    res.status(500).json({ error: "internal_error" });
  }
});

router.get("/matches", authMiddleware, async (req, res) => {
  try {
    const selfId = String(req.user.id);

    const matchDocs = await Match.find({ users: selfId }).lean();
    const ids = matchDocs
      .map((m) => m.users.find((id) => String(id) !== selfId))
      .filter(Boolean)
      .map(String);

    const users = await User.find({ id: { $in: ids } }).lean();

    const result = await Promise.all(
      users.map(async (u) => {
        const otherId = String(u.id);
        const roomId = [selfId, otherId].sort().join("_");

        const room = await ChatRoom.findOne({ roomId }).lean();

        const visibleMessages = Array.isArray(room?.messages)
          ? room.messages.filter((msg) => {
              if (!msg) return false;
              if (Array.isArray(msg.hiddenFor) && msg.hiddenFor.includes(selfId)) return false;
              return true;
            })
          : [];

        const lastVisible = visibleMessages.length
          ? visibleMessages[visibleMessages.length - 1]
          : null;

        return {
          id: u.id,
          firstName: u.firstName,
          lastName: u.lastName,
          avatar: u.avatar || "https://via.placeholder.com/150x150?text=No+Photo",
          bio: u.bio || "",
          gender: u.gender || "",
          verified: !!u.verified,

          // ✅ send true latest visible message, regardless of read/unread
          lastMessage: lastVisible
            ? {
                id: lastVisible.id,
                from: lastVisible.from,
                to: lastVisible.to,
                text: lastVisible.text || "",
                type: lastVisible.type || "text",
                url: lastVisible.url || null,
                mediaType: lastVisible.mediaType || null,
                overlayText: lastVisible.overlayText || "",
                deleted: !!lastVisible.deleted,
                time: lastVisible.time || null,
              }
            : null,

          lastMessageTime: lastVisible?.time || room?.updatedAt || null,
        };
      })
    );

    result.sort((a, b) => {
      const at = new Date(a?.lastMessageTime || 0).getTime() || 0;
      const bt = new Date(b?.lastMessageTime || 0).getTime() || 0;
      return bt - at;
    });

    res.json(result);
  } catch (e) {
    console.error("Matches fetch error:", e);
    res.status(500).json({ error: "internal_error" });
  }
});

/* ======================
   🔥 MATCHSTREAK
====================== */
router.get("/matchstreak/:otherUserId", authMiddleware, async (req, res) => {
  try {
    const myId = String(req.user.id);
    const otherId = String(req.params.otherUserId);

    const streak = await MatchStreak.findOne({ from: myId, to: otherId }).lean();
    const payload = streak
      ? {
          from: streak.from,
          to: streak.to,
          count: Number(streak.count || 0),
          lastBuzz: streak.lastBuzz || null,
          createdAt: streak.createdAt || null,
        }
      : { from: myId, to: otherId, count: 0, lastBuzz: null, createdAt: null };

    res.json({ streak: payload });
  } catch (e) {
    console.error("MatchStreak error:", e);
    res.status(500).json({ error: "internal_error" });
  }
});

/* ======================
   💔 UNMATCH
====================== */
router.post("/unmatch/:id", authMiddleware, async (req, res) => {
  try {
    const me = req.user.id;
    const them = req.params.id;

    const before = await Match.countDocuments({});
    await Match.deleteMany({ users: { $all: [me, them] } });
    await Relationship.deleteMany({
      $or: [
        { from: me, to: them, type: "like" },
        { from: them, to: me, type: "like" },
      ],
    });

    const after = await Match.countDocuments({});
    const removed = before !== after;
    res.json({ ok: true, unmatched: removed });
  } catch (e) {
    console.error("Unmatch error:", e);
    res.status(500).json({ error: "Could not unmatch" });
  }
});

/* ======================
   📊 SOCIAL STATS & LISTS
====================== */
router.get("/social-stats", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const likes = await Relationship.find({ type: "like" }).lean();
    const matches = await Match.find({}).lean();

    const liked = likes.filter((l) => l.from === userId).map((l) => l.to);
    const likedYou = likes.filter((l) => l.to === userId).map((l) => l.from);
    const matched = matches.filter((m) => m.users.includes(userId));

    res.json({
      likedCount: liked.length,
      likedYouCount: likedYou.length,
      matchCount: matched.length,
    });
  } catch (e) {
    console.error("Social stats error:", e);
    res.status(500).json({ error: "internal_error" });
  }
});

router.get("/social/:type", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const type = req.params.type;

    const likes = await Relationship.find({ type: "like" }).lean();
    const matches = await Match.find({}).lean();
    const users = await User.find({}).lean();

    let targetIds = [];
    if (type === "liked") {
      targetIds = likes.filter((l) => l.from === userId).map((l) => l.to);
    } else if (type === "likedYou") {
      targetIds = likes.filter((l) => l.to === userId).map((l) => l.from);
    } else if (type === "matches") {
      targetIds = matches
        .filter((m) => m.users.includes(userId))
        .map((m) => m.users.find((id) => id !== userId));
    } else return res.status(400).json({ error: "Invalid type" });

    const idSet = new Set(targetIds);
    const result = users
      .filter((u) => idSet.has(u.id))
      .map((u) => ({
        id: u.id,
        firstName: u.firstName || "",
        lastName: u.lastName || "",
        avatar: u.avatar || "https://via.placeholder.com/150x150?text=No+Photo",
        bio: u.bio || "",
        gender: u.gender || "",
        verified: !!u.verified,
      }));

    res.json(result);
  } catch (e) {
    console.error("Social list error:", e);
    res.status(500).json({ error: "internal_error" });
  }
});

module.exports = router;
