/**
 * ============================================================
 * 📁 File: routes/buzzComments.js
 * 💬 Purpose: Mongo-only private comments for LetsBuzz posts
 *
 * PRIVATE VISIBILITY RULE:
 *   - Only post owner + comment author can see a comment
 *
 * Endpoints:
 *   POST    /api/buzz/posts/:postId/comments
 *   GET     /api/buzz/posts/:postId/comments
 *   PATCH   /api/buzz/posts/:postId/comments/:commentId
 *   DELETE  /api/buzz/posts/:postId/comments/:commentId
 *   POST    /api/buzz/posts/:postId/comments/:commentId/react
 *   DELETE  /api/buzz/posts/:postId/comments/:commentId/react
 * ============================================================
 */

const express = require("express");
const router = express.Router();
const shortid = require("shortid");

const PostModel = require("../models/PostModel");
const User = require("../models/User");
const Notification = require("../models/Notification"); // fallback
const authMiddleware = require("../routes/auth-middleware");

const { sendNotification, baseSanitizeUser } = require("../utils/helpers");

// socket (your project sets globals)
const { io } = global;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

// ✅ Robust Mongo lookup: supports id OR _id
async function findPostDocAny(postId) {
  // Try by custom id
  let post = await PostModel.findOne({ id: postId });
  if (post) return post;

  // Try by _id (string will cast; if invalid it may throw)
  try {
    post = await PostModel.findById(postId);
    if (post) return post;
  } catch {}

  return null;
}

async function findPostLeanAny(postId) {
  // Lean version for reads
  let post = await PostModel.findOne({ id: postId }).lean();
  if (post) return post;

  try {
    post = await PostModel.findById(postId).lean();
    if (post) return post;
  } catch {}

  return null;
}

function isVisibleToViewer(comment, viewerId, postOwnerId) {
  const v = Array.isArray(comment?.visibleTo)
    ? comment.visibleTo.map(String)
    : [String(postOwnerId), String(comment?.userId)];

  return v.includes(String(viewerId));
}

function ensurePrivateVisibleTo(postOwnerId, commenterId, existing = []) {
  const base = Array.isArray(existing) ? existing : [];
  const set = new Set(base.map(String));
  set.add(String(postOwnerId));
  set.add(String(commenterId));
  return Array.from(set);
}

function buildReactionCounts(reactions = {}) {
  const counts = {};
  Object.values(reactions || {}).forEach((emoji) => {
    counts[emoji] = (counts[emoji] || 0) + 1;
  });
  return counts;
}

/* -------------------------------------------------------------------------- */
/* POST: Add comment or reply                                                 */
/* -------------------------------------------------------------------------- */

router.post("/buzz/posts/:postId/comments", authMiddleware, async (req, res) => {
  try {
    const { postId } = req.params;
    const { text, parentId = null } = req.body || {};
    const myId = req.user.id;

    if (!text?.trim()) {
      return res.status(400).json({ error: "Comment text required" });
    }

    const post = await findPostDocAny(postId);
    if (!post) return res.status(404).json({ error: "Post not found" });

    // ✅ Ensure post.comments exists
    if (!Array.isArray(post.comments)) post.comments = [];

    const comment = {
      id: shortid.generate(),
      userId: myId,
      text: text.trim(),
      parentId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      // 🔒 PRIVATE: only owner + commenter
      visibleTo: [String(post.userId), String(myId)],
      reactions: {},
    };

    post.comments.push(comment);
    post.updatedAt = Date.now();
    await post.save();

    // 🔔 Notify post owner (only if commenter != owner)
    if (String(post.userId) !== String(myId)) {
      const user = await User.findOne({ id: myId }).lean();
      const commenterName = user?.firstName || "Someone";

         const link = `/letsbuzz?post=${postId}`;

      const notif = {
        id: shortid.generate(),
        toId: post.userId,
        fromId: myId,
        type: "comment",
        message: `${commenterName} commented on your post: "${text.slice(0, 50)}${
          text.length > 50 ? "..." : ""
        }"`,
        href: link,
        postId,
        postOwnerId: post.userId,
        createdAt: Date.now(),
      };


      // If your sendNotification helper is reliable, use it; else fallback to model
      try {
        if (sendNotification) {
          await sendNotification(post.userId, notif);
        } else {
          await Notification.create(notif);
        }
      } catch {
        await Notification.create(notif);
      }

      // 🔥 Real-time navbar update
      if (io) io.to(String(post.userId)).emit("notification", notif);
    }

    // 📡 Real-time comment broadcast (ONLY owner + commenter)
    if (io) {
      io.to(String(myId)).emit("comment:new", { postId, comment });
      if (String(post.userId) !== String(myId)) {
        io.to(String(post.userId)).emit("comment:new", { postId, comment });
      }
    }

    return res.json({ success: true, comment });
  } catch (error) {
    console.error("❌ Add comment error:", error);
    return res.status(500).json({ error: "Failed to add comment" });
  }
});

/* -------------------------------------------------------------------------- */
/* GET: Fetch visible comments (private)                                      */
/* -------------------------------------------------------------------------- */

router.get("/buzz/posts/:postId/comments", authMiddleware, async (req, res) => {
  try {
    const { postId } = req.params;
    const myId = req.user.id;

    const post = await findPostLeanAny(postId);
    if (!post) return res.status(404).json({ error: "Post not found" });

    const postOwnerId = post.userId;

    // 🔒 Only comments visible to viewer (owner or author)
    const filtered = (post.comments || []).filter((c) =>
      isVisibleToViewer(c, myId, postOwnerId)
    );

    const authorIds = [...new Set(filtered.map((c) => c.userId))];
    const users = await User.find({ id: { $in: authorIds } }).lean();

    const comments = filtered.map((c) => {
      const author = users.find((u) => String(u.id) === String(c.userId));
      const reactionCounts = buildReactionCounts(c.reactions || {});

      return {
        ...c,
        author: author
          ? baseSanitizeUser(author)
          : { firstName: "Unknown", avatar: "" },

        // reactions summary
        myReaction: c.reactions?.[myId] || null,
        reactionCounts,
        totalReactions: Object.keys(c.reactions || {}).length,

        // ✅ permissions (for your 3-dot menu)
        canEdit: String(c.userId) === String(myId),
        canDelete:
          String(c.userId) === String(myId) ||
          String(postOwnerId) === String(myId),
        canReply:
          String(postOwnerId) === String(myId) ||
          String(c.userId) === String(myId),

        isPostOwner: String(postOwnerId) === String(myId),
      };
    });

    // ✅ commentCount ONLY for owner
    const commentCount =
      String(postOwnerId) === String(myId) ? (post.comments || []).length : 0;

    return res.json({ comments, commentCount, isOwner: String(postOwnerId) === String(myId) });
  } catch (err) {
    console.error("❌ Fetch comments error:", err);
    return res.status(500).json({ error: "Failed to fetch comments" });
  }
});

/* -------------------------------------------------------------------------- */
/* PATCH: Edit comment (author only)                                          */
/* -------------------------------------------------------------------------- */

router.patch("/buzz/posts/:postId/comments/:commentId", authMiddleware, async (req, res) => {
  try {
    const { postId, commentId } = req.params;
    const { text = "" } = req.body || {};
    const me = req.user.id;

    if (!text.trim()) return res.status(400).json({ error: "text required" });

    // Find post that contains comment
    const post = await PostModel.findOne({ $or: [{ id: postId }, { _id: postId }], "comments.id": commentId }).lean();
    if (!post) return res.status(404).json({ error: "Post or comment not found" });

    const existing = (post.comments || []).find((c) => c.id === commentId);
    if (!existing) return res.status(404).json({ error: "Comment not found" });

    // Author only
    if (String(existing.userId) !== String(me)) {
      return res.status(403).json({ error: "Not your comment" });
    }

    // Update text + keep private visibleTo enforced
    await PostModel.updateOne(
      { $or: [{ id: postId }, { _id: postId }], "comments.id": commentId },
      {
        $set: {
          "comments.$.text": text.trim(),
          "comments.$.updatedAt": Date.now(),
          "comments.$.visibleTo": ensurePrivateVisibleTo(post.userId, me, existing.visibleTo),
        },
      }
    );

    return res.json({ success: true });
  } catch (e) {
    console.error("Buzz comment edit error:", e);
    return res.status(500).json({ error: "Failed to edit comment" });
  }
});

/* -------------------------------------------------------------------------- */
/* DELETE: Delete comment (author OR post owner)                              */
/* -------------------------------------------------------------------------- */

router.delete("/buzz/posts/:postId/comments/:commentId", authMiddleware, async (req, res) => {
  try {
    const { postId, commentId } = req.params;
    const me = req.user.id;

    const post = await findPostDocAny(postId);
    if (!post) return res.status(404).json({ error: "Post not found" });

    const comment = (post.comments || []).find((c) => c.id === commentId);
    if (!comment) return res.status(404).json({ error: "Comment not found" });

    const isAuthor = String(comment.userId) === String(me);
    const isPostOwner = String(post.userId) === String(me);

    if (!isAuthor && !isPostOwner) {
      return res.status(403).json({ error: "Not allowed" });
    }

    const before = post.comments.length;
    post.comments = post.comments.filter((c) => c.id !== commentId);
    const removed = post.comments.length < before;

    await post.save();

    if (io && io.to) {
      io.to(String(me)).emit("comment:deleted", { postId, commentId });
      if (String(post.userId) !== String(me)) {
        io.to(String(post.userId)).emit("comment:deleted", { postId, commentId });
      }
    }

    return res.json({ success: true, removed });
  } catch (e) {
    console.error("Buzz comment delete error:", e);
    return res.status(500).json({ error: "Failed to delete comment" });
  }
});

/* -------------------------------------------------------------------------- */
/* POST: React to comment                                                     */
/* -------------------------------------------------------------------------- */

router.post("/buzz/posts/:postId/comments/:commentId/react", authMiddleware, async (req, res) => {
  try {
    const { postId, commentId } = req.params;
    const { emoji = "❤️" } = req.body || {};
    const myId = req.user.id;

    const post = await findPostDocAny(postId);
    if (!post) return res.status(404).json({ error: "Post not found" });

    const comment = (post.comments || []).find((c) => c.id === commentId);
    if (!comment) return res.status(404).json({ error: "Comment not found" });

    // 🔒 Ensure viewer is allowed to interact (private visibility)
    if (!isVisibleToViewer(comment, myId, post.userId)) {
      return res.status(403).json({ error: "Not allowed" });
    }

    const hadReaction = !!comment.reactions?.[myId];
    if (!comment.reactions) comment.reactions = {};

    comment.reactions[myId] = emoji;
    comment.updatedAt = Date.now();

    // keep private visibility intact
    comment.visibleTo = ensurePrivateVisibleTo(post.userId, comment.userId, comment.visibleTo);

    await post.save();

    // notify comment owner (not self, and only first time)
    if (String(comment.userId) !== String(myId) && !hadReaction) {
      try {
        await sendNotification(comment.userId, {
          fromId: myId,
          type: "reaction",
          message: `reacted with ${emoji} to your comment`,
          href: `/viewprofile/${post.userId}?post=${postId}`,
          entity: "comment",
          entityId: commentId,
          postId,
          postOwnerId: post.userId,
        });

        if (io) {
          io.to(String(comment.userId)).emit("notification", {
            id: shortid.generate(),
            type: "reaction",
            fromId: myId,
            postId,
            commentId,
            message: `reacted with ${emoji} to your comment`,
            createdAt: Date.now(),
          });
        }
      } catch {}
    }

    const reactionCounts = buildReactionCounts(comment.reactions || {});

    if (io && io.to) {
      io.to(String(comment.userId)).emit("comment:react", { postId, commentId, emoji });
      // also to post owner if different
      if (String(post.userId) !== String(comment.userId)) {
        io.to(String(post.userId)).emit("comment:react", { postId, commentId, emoji });
      }
    }

    return res.json({
      success: true,
      myReaction: emoji,
      reactionCounts,
      totalReactions: Object.keys(comment.reactions || {}).length,
    });
  } catch (err) {
    console.error("💥 Comment reaction error:", err);
    return res.status(500).json({ error: "Failed to react to comment" });
  }
});

/* -------------------------------------------------------------------------- */
/* DELETE: Remove reaction                                                    */
/* -------------------------------------------------------------------------- */

router.delete("/buzz/posts/:postId/comments/:commentId/react", authMiddleware, async (req, res) => {
  try {
    const { postId, commentId } = req.params;
    const myId = req.user.id;

    const post = await findPostDocAny(postId);
    if (!post) return res.status(404).json({ error: "Post not found" });

    const comment = (post.comments || []).find((c) => c.id === commentId);
    if (!comment) return res.status(404).json({ error: "Comment not found" });

    // 🔒 Ensure viewer allowed
    if (!isVisibleToViewer(comment, myId, post.userId)) {
      return res.status(403).json({ error: "Not allowed" });
    }

    if (comment.reactions && comment.reactions[myId]) {
      delete comment.reactions[myId];
      comment.updatedAt = Date.now();
      await post.save();

      if (io && io.to) {
        io.to(String(comment.userId)).emit("comment:reactRemoved", { postId, commentId });
        if (String(post.userId) !== String(comment.userId)) {
          io.to(String(post.userId)).emit("comment:reactRemoved", { postId, commentId });
        }
      }
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("💥 Remove reaction error:", err);
    return res.status(500).json({ error: "Failed to remove reaction" });
  }
});

module.exports = router;
