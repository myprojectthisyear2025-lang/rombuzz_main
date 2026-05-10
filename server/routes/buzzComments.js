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

function ensurePrivateVisibleTo(postOwnerId, commenterId, existing = [], extraViewerIds = []) {
  const base = Array.isArray(existing) ? existing : [];
  const extras = Array.isArray(extraViewerIds) ? extraViewerIds : [];

  const set = new Set(base.map(String));

  set.add(String(postOwnerId));
  set.add(String(commenterId));

  for (const id of extras) {
    if (id) set.add(String(id));
  }

  return Array.from(set).filter(Boolean);
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
    const {
      text = "",
      parentId = null,
      imageUrl = null,
      photoUrl = null,
      mediaUrl = null,
      attachmentUrl = null,
    } = req.body || {};

    const myId = req.user.id;
    const cleanText = String(text || "").trim();
    const cleanImageUrl = String(
      imageUrl || photoUrl || mediaUrl || attachmentUrl || ""
    ).trim();

    if (!cleanText && !cleanImageUrl) {
      return res.status(400).json({ error: "Comment text or photo required" });
    }

    const post = await findPostDocAny(postId);
    if (!post) return res.status(404).json({ error: "Post not found" });

       // ✅ Ensure post.comments exists
    if (!Array.isArray(post.comments)) post.comments = [];

    let parentComment = null;

    if (parentId) {
      parentComment = post.comments.find(
        (comment) => String(comment?.id || "") === String(parentId)
      );

      if (!parentComment) {
        return res.status(404).json({ error: "Parent comment not found" });
      }

      if (!isVisibleToViewer(parentComment, myId, post.userId)) {
        return res.status(403).json({ error: "Not allowed to reply to this comment" });
      }
    }

    const comment = {
      id: shortid.generate(),
      userId: myId,
      text: cleanText,
      imageUrl: cleanImageUrl || null,
      photoUrl: cleanImageUrl || null,
      mediaUrl: cleanImageUrl || null,
      attachmentUrl: cleanImageUrl || null,
      parentId: parentComment ? String(parentComment.id) : null,
      replyToCommentId: parentComment ? String(parentComment.id) : null,
      replyToUserId: parentComment ? String(parentComment.userId) : null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      // 🔒 PRIVATE:
      // Normal comment: owner + commenter
      // Reply: owner + replier + original comment author
      visibleTo: ensurePrivateVisibleTo(post.userId, myId, [], [
        parentComment?.userId,
      ]),
      reactions: {},
    };

      post.comments.push(comment);
    post.updatedAt = Date.now();
    await post.save();

    // 🔔 Notify the correct private-thread recipient(s)
    // Top-level comment:
    //   Kylie comments on Tom's post -> notify Tom.
    //
    // Reply:
    //   Tom replies inside Kylie's private thread -> notify Kylie.
    //   Kylie replies back -> notify Tom.
    //
    // Never notify the sender.
    const user = await User.findOne({ id: myId }).lean();
    const commenterName = user?.firstName || "Someone";

    const previewText = cleanText
      ? `"${cleanText.slice(0, 50)}${cleanText.length > 50 ? "..." : ""}"`
      : "a photo";

    const visibleRecipients = Array.isArray(comment.visibleTo)
      ? comment.visibleTo.map(String).filter(Boolean)
      : [String(post.userId), String(myId)].filter(Boolean);

    const notifyRecipients = parentComment
      ? visibleRecipients.filter((id) => String(id) !== String(myId))
      : String(post.userId) !== String(myId)
      ? [String(post.userId)]
      : [];

    const uniqueNotifyRecipients = [...new Set(notifyRecipients.map(String))];

    for (const toId of uniqueNotifyRecipients) {
      const isReply = !!parentComment;

      const notif = {
        id: shortid.generate(),
        toId,
        fromId: myId,
        type: "comment",
        message: isReply
          ? `${commenterName} replied in your comment thread: ${previewText}`
          : `${commenterName} commented on your post: ${previewText}`,

        // Keep href for older frontend/web fallback.
        // Mobile will use targetType/targetId/targetOwnerId/commentId/replyId.
        href: `/letsbuzz?post=${postId}`,

        // Legacy fields
        postId,
        postOwnerId: post.userId,
        entity: "buzz_post",
        entityId: postId,

        // Exact routing fields
        targetType: "buzz_post",
        targetId: postId,
        targetOwnerId: post.userId,
        commentId: parentComment ? String(parentComment.id) : String(comment.id),
        replyId: parentComment ? String(comment.id) : "",
        routeContext: parentComment ? "private_reply" : "private_comment",

        createdAt: Date.now(),
      };

      // If your sendNotification helper is reliable, use it; else fallback to model
      try {
        if (sendNotification) {
          await sendNotification(toId, notif);
        } else {
          await Notification.create(notif);
        }
      } catch {
        await Notification.create(notif);
      }

      // 🔥 Real-time navbar update
      if (io) io.to(String(toId)).emit("notification", notif);
    }

    // 📡 Real-time comment broadcast to every private participant
    if (io) {
      const broadcastRecipients = [...new Set([...visibleRecipients, String(myId)])];

      for (const userId of broadcastRecipients) {
        io.to(String(userId)).emit("comment:new", {
          postId,
          targetType: "buzz_post",
          targetId: postId,
          targetOwnerId: post.userId,
          comment,
        });
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
