/**
 * ============================================================
 * 📁 File: routes/buzzpost/buzz.likes.js
 * 💬 Purpose: Handles post likes and emoji reactions
 *             within the LetsBuzz system (MongoDB version).
 *
 * Description:
 *   - Toggle ❤️ like / unlike on any post.
 *   - React / unreact using any emoji (🔥😂👍 etc.).
 *   - Emits notifications to post owners when others react.
 *
 * Endpoints:
 *   POST   /api/posts/:postId/like        → Like / Unlike a post
 *   GET    /api/posts/:postId/likes       → Fetch like list or count
 *   POST   /api/buzz/posts/:postId/react  → Add / update emoji reaction
 *   DELETE /api/buzz/posts/:postId/react  → Remove emoji reaction
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
const { getSignedMediaUrl, isR2Key } = require("../../utils/r2Media");

async function signR2Value(value, expiresInSeconds = 21600) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (!isR2Key(raw)) return raw;

  return getSignedMediaUrl(raw, expiresInSeconds);
}

async function signLikeForResponse(like = {}) {
  return {
    ...(like || {}),
    avatar: await signR2Value(like?.avatar, 21600),
  };
}

// =======================================================
// ✅ Like / Unlike a post (MongoDB)
// =======================================================
router.post("/posts/:postId/like", authMiddleware, async (req, res) => {
  try {
    const { postId } = req.params;
    const myId = req.user.id;

    const post = await PostModel.findOne({ id: postId });
    if (!post) return res.status(404).json({ error: "Post not found" });

    post.likes = post.likes || [];
    const already = post.likes.find((l) => l.userId === myId);

    if (already) {
      // 💔 Unlike
      post.likes = post.likes.filter((l) => l.userId !== myId);
    } else {
      // ❤️ Like
      const meUser = await User.findOne({ id: myId }).lean();
      post.likes.push({
        userId: myId,
        name: `${meUser?.firstName || ""} ${meUser?.lastName || ""}`.trim(),
        avatar: meUser?.avatar || "",
        createdAt: new Date(),
      });

      // 🔔 Notify post owner (not self)
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
    console.error("❌ Mongo POST /posts/:postId/like error:", err);
    res.status(500).json({ error: "Failed to toggle like" });
  }
});

// =======================================================
// ✅ Get Likes List (owner-only full list)
// =======================================================
router.get("/posts/:postId/likes", authMiddleware, async (req, res) => {
  try {
    const { postId } = req.params;
    const myId = req.user.id;

      const post = await PostModel.findOne({ id: postId }).lean();
    if (!post) return res.status(404).json({ error: "Post not found" });

    const isOwner = post.userId === myId;
    const signedLikes = isOwner
      ? await Promise.all((post.likes || []).map((like) => signLikeForResponse(like)))
      : [];

    res.json({
      likes: signedLikes,
      likesCount: post.likes?.length || 0,
      isOwner,
    });
  } catch (err) {
    console.error("❌ Mongo GET /posts/:postId/likes error:", err);
  }
});

// =======================================================
// ✅ Emoji Reactions (MongoDB)
// =======================================================
router.post("/buzz/posts/:postId/react", authMiddleware, async (req, res) => {
  try {
    const { postId } = req.params;
    const { emoji } = req.body || {};
    const myId = req.user.id;
    if (!emoji) return res.status(400).json({ error: "Emoji required" });

    const post = await PostModel.findOne({ id: postId });
    if (!post) return res.status(404).json({ error: "Post not found" });

    post.reactions = post.reactions || {};
    const prevReaction = post.reactions.get(myId);

    // Toggle or update reaction
    if (prevReaction === emoji) {
      post.reactions.delete(myId); // remove if same emoji clicked again
    } else {
      post.reactions.set(myId, emoji);
    }
    await post.save();

    // 🔔 Notify owner if new reaction
    if (post.userId !== myId && prevReaction !== emoji) {
      const meUser = await User.findOne({ id: myId }).lean();
      await sendNotification(post.userId, {
        fromId: myId,
        type: "reaction",
        message: `${meUser?.firstName || "Someone"} reacted ${emoji} to your post`,
        href: `/buzz/post/${postId}`,
        entity: "post",
        entityId: postId,
        postId,
        postOwnerId: post.userId,
      });
    }

    // Compute counts
    const counts = {};
    for (const e of post.reactions.values()) {
      counts[e] = (counts[e] || 0) + 1;
    }

    res.json({
      success: true,
      myReaction: post.reactions.get(myId) || null,
      reactionCounts: counts,
      totalReactions: post.reactions.size,
    });
  } catch (err) {
    console.error("❌ Mongo POST /buzz/posts/:postId/react error:", err);
    res.status(500).json({ error: "Failed to react" });
  }
});

// =======================================================
// ✅ Remove Emoji Reaction
// =======================================================
router.delete("/buzz/posts/:postId/react", authMiddleware, async (req, res) => {
  try {
    const { postId } = req.params;
    const myId = req.user.id;

    const post = await PostModel.findOne({ id: postId });
    if (!post) return res.status(404).json({ error: "Post not found" });

    if (post.reactions && post.reactions.has(myId)) {
      post.reactions.delete(myId);
      await post.save();
    }

    // Re-count reactions
    const counts = {};
    for (const e of post.reactions.values()) {
      counts[e] = (counts[e] || 0) + 1;
    }

    res.json({
      success: true,
      myReaction: null,
      reactionCounts: counts,
      totalReactions: post.reactions.size,
    });
  } catch (err) {
    console.error("❌ Mongo DELETE /buzz/posts/:postId/react error:", err);
    res.status(500).json({ error: "Failed to remove reaction" });
  }
});

module.exports = router;
