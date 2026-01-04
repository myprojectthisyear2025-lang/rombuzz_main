/**
 * ============================================================
 * 📁 File: routes/stories.js
 * 🧩 Purpose: Matches-only 24h Stories (create + my story + feed)
 *
 * Mount at:
 *   app.use("/api/stories", require("./routes/stories"));
 *
 * Endpoints:
 *   POST /api/stories           → create story (text or media)
 *   GET  /api/stories/me        → my active stories
 *   GET  /api/stories/feed      → matched users’ active stories
 *   POST /api/stories/:id/view  → mark story viewed
 * ============================================================
 */

const express = require("express");
const router = express.Router();
const shortid = require("shortid");

const authMiddleware = require("./auth-middleware");
const { baseSanitizeUser } = require("../utils/helpers");

const { db } = require("../models/db.lowdb"); // matches are still in LowDB in your project
const User = require("../models/User");
const StoryModel = require("../models/StoryModel");

// ---------- helpers
function isVideoUrl(url = "") {
  const u = (url || "").toLowerCase();
  return /\.(mp4|mov|webm|ogg)$/.test(u) || u.includes("/video/upload/");
}

function nowPlus24h() {
  return new Date(Date.now() + 24 * 60 * 60 * 1000);
}

function onlyActiveQuery(extra = {}) {
  return {
    isActive: true,
    expiresAt: { $gt: new Date() },
    ...extra,
  };
}

// ============================================================
// POST /api/stories
// Create: text-only OR media story
// ============================================================
router.post("/", authMiddleware, async (req, res) => {
  try {
    const { text = "", mediaUrl = "" } = req.body || {};
    const cleanText = String(text || "").trim();
    const cleanMedia = String(mediaUrl || "").trim();

    // ✅ allow text-only status stories
    if (!cleanText && !cleanMedia) {
      return res.status(400).json({ error: "Story must have text or media." });
    }

    const type = cleanMedia
      ? isVideoUrl(cleanMedia)
        ? "video"
        : "image"
      : "text";

    const story = await StoryModel.create({
      id: shortid.generate(),
      userId: req.user.id,
      mediaUrl: cleanMedia || "",
      text: cleanText || "",
      type,
      createdAt: new Date(),
      expiresAt: nowPlus24h(),
      isActive: true,
      views: [],
    });

    return res.json({ story });
  } catch (err) {
    console.error("❌ POST /api/stories error:", err);
    return res.status(500).json({ error: "Failed to post story" });
  }
});

// ============================================================
// GET /api/stories/me
// My active stories (latest first)
// ============================================================
router.get("/me", authMiddleware, async (req, res) => {
  try {
    const stories = await StoryModel.find(onlyActiveQuery({ userId: req.user.id }))
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ stories: stories || [] });
  } catch (err) {
    console.error("❌ GET /api/stories/me error:", err);
    return res.status(500).json({ error: "Failed to load my stories" });
  }
});

// ============================================================
// GET /api/stories/feed
// Matched users’ active stories (grouped by user)
// ============================================================
router.get("/feed", authMiddleware, async (req, res) => {
  try {
    const myId = req.user.id;

    // Matches still coming from LowDB (same approach as posts.js does) :contentReference[oaicite:1]{index=1}
    await db.read();
    const myMatches = (db.data.matches || [])
      .filter((m) => Array.isArray(m.users) && m.users.includes(myId))
      .map((m) => m.users.find((id) => id !== myId))
      .filter(Boolean);

    if (!myMatches.length) return res.json({ users: [] });

    // fetch active stories from mongo
    const stories = await StoryModel.find(
      onlyActiveQuery({ userId: { $in: myMatches } })
    )
      .sort({ createdAt: 1 })
      .lean();

    if (!stories.length) return res.json({ users: [] });

    // fetch owners for user cards
    const owners = await User.find({ id: { $in: myMatches } }).lean();
    const ownersMap = new Map(owners.map((u) => [u.id, baseSanitizeUser(u)]));

    // group by userId
    const grouped = new Map();
    for (const s of stories) {
      if (!grouped.has(s.userId)) grouped.set(s.userId, []);
      grouped.get(s.userId).push(s);
    }

    // build response list
    const users = Array.from(grouped.entries()).map(([userId, list]) => ({
      user: ownersMap.get(userId) || { id: userId, firstName: "", lastName: "", avatar: "" },
      stories: list,
      latestCreatedAt: list[list.length - 1]?.createdAt || 0,
    }));

    // show newest story owners first (like IG)
    users.sort((a, b) => new Date(b.latestCreatedAt).getTime() - new Date(a.latestCreatedAt).getTime());

    return res.json({ users });
  } catch (err) {
    console.error("❌ GET /api/stories/feed error:", err);
    return res.status(500).json({ error: "Failed to load story feed" });
  }
});

// ============================================================
// POST /api/stories/:id/view
// Mark story as viewed by current user
// ============================================================
router.post("/:id/view", authMiddleware, async (req, res) => {
  try {
    const storyId = req.params.id;
    const myId = req.user.id;

    const story = await StoryModel.findOne(onlyActiveQuery({ id: storyId }));
    if (!story) return res.status(404).json({ error: "Story not found" });

    if (!Array.isArray(story.views)) story.views = [];
    if (!story.views.includes(myId)) {
      story.views.push(myId);
      await story.save();
    }

    return res.json({ success: true, views: story.views.length });
  } catch (err) {
    console.error("❌ POST /api/stories/:id/view error:", err);
    return res.status(500).json({ error: "Failed to mark viewed" });
  }
});

module.exports = router;
