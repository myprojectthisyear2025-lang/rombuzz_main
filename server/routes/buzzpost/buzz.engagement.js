/**
 * ============================================================
 * 📁 File: routes/buzzpost/buzz.engagement.js
 * 💖 Purpose: Handle all engagement interactions on posts —
 *             likes (❤️), reactions (😍🔥😂), and unreact/unlike.
 *
 * Endpoints:
 *   POST   /api/posts/:postId/like             → Toggle like/unlike (Mongo)
 *   GET    /api/posts/:postId/likes            → Get likes list (Mongo)
 *   POST   /api/buzz/posts/:postId/react       → React with emoji (Mongo)
 *   DELETE /api/buzz/posts/:postId/react       → Remove emoji reaction (Mongo)
 *   POST   /api/buzz/posts/:postId/react-emoji → Multi-emoji toggle (Mongo)
 *
 * Dependencies:
 *   - auth-middleware.js
 *   - models/PostModel.js
 *   - models/User.js
 *   - utils/helpers.js → sendNotification()
 * ============================================================
 */

const express = require("express");
const router = express.Router();
const authMiddleware = require("../auth-middleware");

const PostModel = require("../../models/PostModel");
const User = require("../../models/User");
const { sendNotification } = require("../../utils/helpers");

// ============================================================
// ❤️ LIKE / UNLIKE a post (MongoDB)
// ============================================================
router.post("/posts/:postId/like", authMiddleware, async (req, res) => {
  try {
    const { postId } = req.params;
    const myId = req.user.id;

    const post = await PostModel.findOne({ id: postId });
    if (!post) return res.status(404).json({ error: "Post not found" });

    post.likes = post.likes || [];
    const already = post.likes.find((l) => l.userId === myId);

    if (already) {
      // Unlike
      post.likes = post.likes.filter((l) => l.userId !== myId);
    } else {
      const meUser = await User.findOne({ id: myId }).lean();
      post.likes.push({
        userId: myId,
        name: `${meUser?.firstName || ""} ${meUser?.lastName || ""}`.trim(),
        avatar: meUser?.avatar || "",
        createdAt: new Date(),
      });

      // Notify owner if not liking own post
      if (post.userId !== myId) {
        await sendNotification(post.userId, {
          fromId: myId,
          type: "like",
          message: `${meUser?.firstName || "Someone"} liked your post ❤️`,
          href: `/buzz/post/${postId}`,
          entity: "post",
          entityId: postId,
          postId,
          postOwnerId: post.userId,
        });
      }
    }

    await post.save();
    res.json({ success: true, likesCount: post.likes.length });
  } catch (err) {
    console.error("❌ Mongo /posts/:postId/like error:", err);
    res.status(500).json({ error: "Failed to toggle like" });
  }
});

// --- Get likes list (MongoDB) ---
router.get("/posts/:postId/likes", authMiddleware, async (req, res) => {
  try {
    const { postId } = req.params;
    const myId = req.user.id;

    const post = await PostModel.findOne({ id: postId }).lean();
    if (!post) return res.status(404).json({ error: "Post not found" });

    const isOwner = post.userId === myId;

    res.json({
      likes: isOwner ? post.likes || [] : [],
      likesCount: (post.likes || []).length,
      isOwner,
    });
  } catch (err) {
    console.error("❌ Mongo GET /posts/:postId/likes error:", err);
    res.status(500).json({ error: "Failed to get likes" });
  }
});

// ============================================================
// 😍 EMOJI REACTIONS — FULL MONGODB MIGRATION
// ============================================================

// Add or update reaction
router.post("/buzz/posts/:postId/react", authMiddleware, async (req, res) => {
  try {
    const { emoji } = req.body;
    const { postId } = req.params;
    const myId = req.user.id;

    if (!emoji) return res.status(400).json({ error: "Emoji required" });

    const post = await PostModel.findOne({ id: postId });
    if (!post) return res.status(404).json({ error: "Post not found" });

    post.reactions = post.reactions || {};
    const hadReaction = post.reactions[myId];

    // update reaction
    post.reactions[myId] = emoji;
    post.updatedAt = Date.now();

    await post.save();

    // Notify only if NEW reaction and not owner's self-react
    if (post.userId !== myId && !hadReaction) {
      const reactor = await User.findOne({ id: myId }).lean();
      const name = reactor?.firstName || "Someone";

      await sendNotification(post.userId, {
        fromId: myId,
        type: "reaction",
        message: `${name} reacted with ${emoji} to your post`,
        href: `/buzz/post/${postId}`,
        entity: "post",
        entityId: postId,
      });
    }

    // build reaction counts
    const reactionCounts = {};
    Object.values(post.reactions).forEach(
      (em) => (reactionCounts[em] = (reactionCounts[em] || 0) + 1)
    );

    res.json({
      success: true,
      myReaction: emoji,
      reactionCounts,
      totalReactions: Object.keys(post.reactions).length,
    });
  } catch (err) {
    console.error("❌ Mongo react error:", err);
    res.status(500).json({ error: "Failed to react" });
  }
});

// Remove reaction
router.delete("/buzz/posts/:postId/react", authMiddleware, async (req, res) => {
  try {
    const { postId } = req.params;
    const myId = req.user.id;

    const post = await PostModel.findOne({ id: postId });
    if (!post) return res.status(404).json({ error: "Post not found" });

    if (post.reactions && post.reactions[myId]) {
      delete post.reactions[myId];
      post.updatedAt = Date.now();
      await post.save();
    }

    res.json({ success: true });
  } catch (err) {
    console.error("❌ Mongo remove reaction error:", err);
    res.status(500).json({ error: "Failed to remove reaction" });
  }
});

// Multi-emoji toggle (legacy UX, now MongoDB)
router.post(
  "/buzz/posts/:postId/react-emoji",
  authMiddleware,
  async (req, res) => {
    try {
      const { emoji } = req.body;
      const { postId } = req.params;
      const myId = req.user.id;

      if (!emoji) return res.status(400).json({ error: "emoji required" });

      const post = await PostModel.findOne({ id: postId });
      if (!post) return res.status(404).json({ error: "Post not found" });

      post.reactions = post.reactions || {};

      // toggle logic
      if (!post.reactions[myId]) {
        post.reactions[myId] = emoji; // add
      } else if (post.reactions[myId] === emoji) {
        delete post.reactions[myId]; // remove same reaction
      } else {
        post.reactions[myId] = emoji; // change emoji
      }

      await post.save();

      // count reactions
      const counts = {};
      for (const e of Object.values(post.reactions)) {
        counts[e] = (counts[e] || 0) + 1;
      }

      res.json({ success: true, counts, reactions: post.reactions });
    } catch (err) {
      console.error("❌ Mongo react-emoji failed:", err);
      res.status(500).json({ error: "Reaction failed" });
    }
  }
);

module.exports = router;
