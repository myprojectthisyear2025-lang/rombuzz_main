/**
 * ============================================================
 * 📁 File: routes/buzz.create.js
 * 💬 Purpose: Handles creation of new posts in the LetsBuzz system.
 *
 * Description:
 *   - Creates text, photo, video, or story posts for the current user.
 *   - Automatically determines the post type (text / image / video).
 *   - Saves post to MongoDB (`PostModel`).
 *   - Sends notifications to matched users using MongoDB (`Match`).
 *
 * Endpoint:
 *   POST /api/buzz/posts → Create new post
 *
 * Dependencies:
 *   - authMiddleware.js
 *   - models/PostModel.js
 *   - models/User.js
 *   - models/Match.js
 *   - utils/helpers.js → sendNotification()
 * ============================================================
 */

const express = require("express");
const router = express.Router();
const shortid = require("shortid");

const authMiddleware = require("../auth-middleware");
const { sendNotification } = require("../../utils/helpers");

const PostModel = require("../../models/PostModel");
const User = require("../../models/User");
const Match = require("../../models/Match");   // ✅ Now using only one Match model

// =======================================================
// ✅ Create a new post (MongoDB only, no LowDB)
// =======================================================
router.post("/buzz/posts", authMiddleware, async (req, res) => {
  try {
    const {
      text,
      mediaUrl,
      type = "text",           // text, photo, reel, story
      privacy = "matches",     // matches | public | specific
      expiresAt,               // for stories
      sharedWith = [],         // specific user IDs
      tags = []                // optional tag list
    } = req.body || {};

    // 🧾 Verify user in MongoDB
    const user = await User.findOne({ id: req.user.id }).lean();
    if (!user) return res.status(404).json({ error: "User not found" });

    // 🪶 Auto-detect post type
    const detectType = () => {
      if (type) return type;
      if (!mediaUrl) return "text";
      const ext = mediaUrl.toLowerCase();
      if (/\.(mp4|mov|webm|ogg)$/.test(ext) || ext.includes("/video/upload/"))
        return "video";
      return "image";
    };

    // 🧩 Build post document
    const newPost = {
      id: shortid.generate(),
      userId: req.user.id,
      text: (text || "").trim(),
      mediaUrl: mediaUrl || "",
      type: detectType(),
      privacy,
      sharedWith,
      tags,
      expiresAt:
        detectType() === "story"
          ? expiresAt || Date.now() + 24 * 60 * 60 * 1000
          : null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      reactions: {},
      comments: [],
      shares: [],
      bookmarks: [],
      viewCount: 0,
      isActive: true
    };

    // 🗄️ Save post to MongoDB
    const created = await PostModel.create(newPost);
    console.log(`🪶 New post created by ${req.user.id}: ${created.id}`);

    // =======================================================
    // 🔔 Notify matched users (MongoDB version)
    // =======================================================

    // Find all matches where current user is one of the pair
    const mongoMatches = await Match.find({
      users: req.user.id,
      status: "matched"
    }).lean();

    // Extract the *other* user from each match
    const matchedUserIds = mongoMatches
      .map(m => m.users.find(u => u !== req.user.id))
      .filter(Boolean);

    // Notify matched users depending on privacy settings
    for (const matchId of matchedUserIds) {
      if (
        privacy === "matches" ||
        (privacy === "specific" && sharedWith.includes(matchId))
      ) {
        await sendNotification(matchId, {
          fromId: req.user.id,
          type: "new_post",
          message: `${user.firstName} posted something new! 📝`,
          href: `/buzz/post/${created.id}`,
          entity: "post",
          entityId: created.id,
          postId: created.id,
          postOwnerId: req.user.id
        });
      }
    }

    // Response
    res.json({ success: true, post: created });
  } catch (err) {
    console.error("❌ Mongo create /buzz/posts error:", err);
    res.status(500).json({ error: "Failed to create post" });
  }
});

module.exports = router;
