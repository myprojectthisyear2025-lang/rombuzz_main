/**
 * ============================================================
 * 📁 File: routes/buzzpost/buzz.comments.js
 * 💬 Purpose: Handles comment creation, fetching, editing,
 *             and deletion for LetsBuzz posts.
 *
 * Description:
 *   - Allows matched users to comment on each other's posts.
 *   - Supports editing and deletion by comment owner only.
 *   - Automatically attaches sanitized author info for frontend.
 *   - Used across LetsBuzz feed, ViewProfile, and MyBuzz pages.
 *
 * Endpoints:
 *   POST   /api/posts/:postId/comment
 *   GET    /api/posts/:postId/comments
 *   PATCH  /api/posts/:postId/comments/:commentId
 *   DELETE /api/posts/:postId/comments/:commentId
 *
 * Dependencies:
 *   - auth-middleware.js
 *   - models/PostModel.js
 *   - models/User.js
 *   - utils/helpers.js → baseSanitizeUser()
 * ============================================================
 */

const express = require("express");
const router = express.Router();
const shortid = require("shortid");

const authMiddleware = require("../auth-middleware");
const PostModel = require("../../models/PostModel");
const User = require("../../models/User");
const { baseSanitizeUser } = require("../../utils/helpers");

function isVisibleToViewer(comment, viewerId, postOwnerId) {
  const visibleTo = Array.isArray(comment?.visibleTo)
    ? comment.visibleTo.map(String)
    : [String(postOwnerId), String(comment?.userId)];

  return visibleTo.includes(String(viewerId));
}

function ensurePrivateVisibleTo(postOwnerId, commenterId, existing = []) {
  const set = new Set(
    Array.isArray(existing) ? existing.map(String) : []
  );

  set.add(String(postOwnerId));
  set.add(String(commenterId));

  return Array.from(set);
}

// =======================================================
// ✅ Add a new private comment
// =======================================================
router.post("/posts/:postId/comment", authMiddleware, async (req, res) => {
  try {
    const { postId } = req.params;
    const { text } = req.body || {};
    const myId = req.user.id;

    if (!text?.trim()) {
      return res.status(400).json({ error: "Text required" });
    }

     const post = await PostModel.findOne({ id: postId });
    if (!post) return res.status(404).json({ error: "Post not found" });

    if (!Array.isArray(post.comments)) {
      post.comments = [];
    }

    const newComment = {
      id: shortid.generate(),
      userId: myId,
      text: text.trim(),
      createdAt: Date.now(),
      updatedAt: Date.now(),

      // 🔒 PRIVATE: only post owner + comment author can see this comment
      visibleTo: ensurePrivateVisibleTo(post.userId, myId),

      reactions: {},
    };

    post.comments.push(newComment);
    await post.save();

    res.json({ success: true, comment: newComment });
  } catch (err) {
    console.error("❌ Mongo POST /posts/:postId/comment error:", err);
    res.status(500).json({ error: "Failed to add comment" });
  }
});

// =======================================================
// ✅ Fetch private comments for a post
// =======================================================
router.get("/posts/:postId/comments", authMiddleware, async (req, res) => {
  try {
    const { postId } = req.params;
    const myId = req.user.id;

    const post = await PostModel.findOne({ id: postId }).lean();
    if (!post) return res.status(404).json({ error: "Post not found" });

    const postOwnerId = post.userId;
    const allComments = Array.isArray(post.comments) ? post.comments : [];

    // 🔒 PRIVATE:
    // Post owner sees all comments on their post.
    // Comment author sees only their own private comment thread.
    // Everyone else sees nothing.
    const visibleComments = allComments.filter((c) =>
      isVisibleToViewer(c, myId, postOwnerId)
    );

    const userIds = [...new Set(visibleComments.map((c) => c.userId))];

    const authors = await User.find({ id: { $in: userIds } }).lean();
    const authorMap = new Map(
      authors.map((u) => [String(u.id), baseSanitizeUser(u)])
    );

    const comments = visibleComments.map((c) => ({
      ...c,
      visibleTo: ensurePrivateVisibleTo(postOwnerId, c.userId, c.visibleTo),
      author:
        authorMap.get(String(c.userId)) || {
          id: c.userId,
          firstName: "",
          lastName: "",
          avatar: "",
        },
      canEdit: String(c.userId) === String(myId),
      canDelete:
        String(c.userId) === String(myId) ||
        String(postOwnerId) === String(myId),
      canReply:
        String(c.userId) === String(myId) ||
        String(postOwnerId) === String(myId),
      isPostOwner: String(postOwnerId) === String(myId),
    }));

    res.json({
      comments,
      commentCount:
        String(postOwnerId) === String(myId) ? allComments.length : comments.length,
      isOwner: String(postOwnerId) === String(myId),
    });
  } catch (err) {
    console.error("❌ Mongo GET /posts/:postId/comments error:", err);
    res.status(500).json({ error: "Failed to fetch comments" });
  }
});

// =======================================================
// ✅ Edit own comment
// =======================================================
router.patch(
  "/posts/:postId/comments/:commentId",
  authMiddleware,
  async (req, res) => {
    try {
      const { postId, commentId } = req.params;
      const { text } = req.body || {};
      const myId = req.user.id;

      if (!text?.trim()) {
        return res.status(400).json({ error: "Text required" });
      }

      const post = await PostModel.findOne({ id: postId });
      if (!post) return res.status(404).json({ error: "Post not found" });

      const comment = post.comments.find((c) => c.id === commentId);
      if (!comment) return res.status(404).json({ error: "Comment not found" });

          if (String(comment.userId) !== String(myId)) {
        return res.status(403).json({ error: "Not your comment" });
      }

      comment.text = text.trim();
      comment.updatedAt = Date.now();

      // 🔒 Preserve private visibility after edit
      comment.visibleTo = ensurePrivateVisibleTo(
        post.userId,
        comment.userId,
        comment.visibleTo
      );

      await post.save();

      res.json({ success: true, comment });
    } catch (err) {
      console.error("❌ Mongo PATCH /posts/:postId/comments/:commentId error:", err);
      res.status(500).json({ error: "Failed to edit comment" });
    }
  }
);

// =======================================================
// ✅ Delete own comment
// =======================================================
router.delete(
  "/posts/:postId/comments/:commentId",
  authMiddleware,
  async (req, res) => {
    try {
      const { postId, commentId } = req.params;
      const myId = req.user.id;

      const post = await PostModel.findOne({ id: postId });
      if (!post) return res.status(404).json({ error: "Post not found" });

      const before = post.comments.length;

      post.comments = post.comments.filter(
        (c) => !(c.id === commentId && c.userId === myId)
      );

      const changed = before !== post.comments.length;

      if (changed) await post.save();

      res.json({ success: changed });
    } catch (err) {
      console.error("❌ Mongo DELETE /posts/:postId/comments/:commentId error:", err);
      res.status(500).json({ error: "Failed to delete comment" });
    }
  }
);

module.exports = router;
