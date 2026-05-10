/**
 * ============================================================
 * 📁 File: routes/buzzpost/buzz.media.js
 * 💬 Purpose: Manage all profile media actions (react, comment,
 *             privacy toggle, delete) for user galleries.
 *
 * Description:
 *   - Handles photos, videos, voice, and reels from user.media[].
 *   - Allows matched users to react ❤️ or comment 💬.
 *   - Owner can toggle privacy or delete items.
 *   - Used across ViewProfile.jsx and MyBuzz.jsx.
 *
 * Endpoints:
 *   POST   /api/media/:ownerId/react                 → React / unreact to media
 *   POST   /api/media/:ownerId/comment               → Add comment / reply to media
 *   PATCH  /api/media/:ownerId/comment/:commentId    → Edit a media comment
 *   DELETE /api/media/:ownerId/comment/:commentId    → Delete a media comment
 *   PATCH  /api/media/:id/privacy                    → Toggle privacy
 *   DELETE /api/media/:id                            → Delete media
 *
 * Notes:
 *   - Supports reply threading via parentId
 *   - Keeps backward compatibility with existing flat comments
 *   - Emits comment:new / comment:updated / comment:deleted using postId = mediaId
 *     so existing LetsBuzz frontend listeners continue to work
 * ============================================================
 */

const express = require("express");
const router = express.Router();
const shortid = require("shortid");

const authMiddleware = require("../auth-middleware");
const User = require("../../models/User");
const Match = require("../../models/Match");
const { sendNotification } = require("../../utils/helpers");

function getIO() {
  const io = global.io;
  if (io && typeof io.to === "function") return io;
  return null;
}

function emitToUsers(userIds, event, payload) {
  try {
    const io = getIO();
    if (!io) return;

    const uniqueIds = [...new Set((userIds || []).filter(Boolean).map(String))];
    for (const id of uniqueIds) {
      io.to(id).emit(event, payload);
    }
  } catch (err) {
    console.error(`❌ socket emit ${event} error:`, err);
  }
}

function getMediaKeyCandidates(media = {}) {
  return [
    media?.id,
    media?._id,
    media?.mediaId,
    media?.postId,
    media?.url,
    media?.mediaUrl,
    media?.secureUrl,
    media?.secure_url,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function getMedia(owner, mediaId) {
  const target = String(mediaId || "").trim();
  if (!target) return null;

  return (owner?.media || []).find((m) =>
    getMediaKeyCandidates(m).includes(target)
  );
}

function getComment(media, commentId) {
  return (media?.comments || []).find((c) => String(c?.id) === String(commentId));
}

async function canInteractWithOwnerMedia(viewerId, ownerId) {
  const me = String(viewerId || "");
  const owner = String(ownerId || "");

  if (!me || !owner) return false;
  if (me === owner) return true;

  const match = await Match.findOne({
    status: "matched",
    users: { $all: [me, owner] },
  }).lean();

  return !!match;
}
function ensurePrivateVisibleTo(ownerId, commenterId, existing = [], extraViewerIds = []) {
  const set = new Set(Array.isArray(existing) ? existing.map(String) : []);
  const extras = Array.isArray(extraViewerIds) ? extraViewerIds : [];

  set.add(String(ownerId || ""));
  set.add(String(commenterId || ""));

  for (const id of extras) {
    if (id) set.add(String(id));
  }

  return Array.from(set).filter(Boolean);
}

function canSeePrivateComment(comment, viewerId, ownerId) {
  const visibleTo = Array.isArray(comment?.visibleTo)
    ? comment.visibleTo.map(String)
    : ensurePrivateVisibleTo(ownerId, comment?.userId);

  return visibleTo.includes(String(viewerId || ""));
}

// =======================================================
// ✅ React / unreact to a media item (MongoDB)
// =======================================================
router.post("/media/:ownerId/react", authMiddleware, async (req, res) => {
  try {
    const me = String(req.user.id);
    const { ownerId } = req.params;
    const { mediaId, emoji = "❤️" } = req.body || {};

    if (!mediaId) {
      return res.status(400).json({ error: "mediaId required" });
    }

    const owner = await User.findOne({ id: ownerId });
    if (!owner) {
      return res.status(404).json({ error: "owner not found" });
    }

    const media = getMedia(owner, mediaId);
    if (!media) {
      return res.status(404).json({ error: "media not found" });
    }

    media.reactions = media.reactions || {};

    if (media.reactions[me] === emoji) {
      delete media.reactions[me];
    } else {
      media.reactions[me] = emoji;
    }

    owner.markModified("media");
    await owner.save();

    const counts = {};
    for (const e of Object.values(media.reactions || {})) {
      counts[e] = (counts[e] || 0) + 1;
    }

    if (String(ownerId) !== String(me)) {
      const reactor = await User.findOne({ id: me }).lean();
      await sendNotification(ownerId, {
        fromId: me,
        type: "media_reaction",
        message: `${reactor?.firstName || "Someone"} reacted ${emoji} to your photo.`,
        entity: "media",
        entityId: mediaId,
        postOwnerId: ownerId,
      });
    }

    emitToUsers([me, ownerId], "media:react", {
      ownerId: String(ownerId),
      mediaId: String(mediaId),
      counts,
      mine: media.reactions[me] || null,
    });

    return res.json({
      ok: true,
      counts,
      mine: media.reactions[me] || null,
    });
  } catch (err) {
    console.error("❌ /media/:ownerId/react error:", err);
    return res.status(500).json({ error: "Reaction failed" });
  }
});

// =======================================================
// ✅ Comment / reply on a media item (MongoDB)
//    - supports parentId for threaded replies
//    - keeps backward compatibility for normal comments
// =======================================================
router.post("/media/:ownerId/comment", authMiddleware, async (req, res) => {
  try {
    const me = String(req.user.id);
    const { ownerId } = req.params;
    const {
      mediaId,
      text = "",
      parentId = null,
      imageUrl = null,
      photoUrl = null,
      mediaUrl = null,
      attachmentUrl = null,
    } = req.body || {};

    const cleanText = String(text || "").trim();
    const cleanImageUrl = String(
      imageUrl || photoUrl || mediaUrl || attachmentUrl || ""
    ).trim();

      if (!mediaId || (!cleanText && !cleanImageUrl)) {
      return res.status(400).json({ error: "mediaId and text or photo required" });
    }

    const owner = await User.findOne({ id: ownerId });
    if (!owner) {
      return res.status(404).json({ error: "owner not found" });
    }

    const canComment = await canInteractWithOwnerMedia(me, ownerId);
    if (!canComment) {
      return res.status(403).json({ error: "Only matched users can comment on this media" });
    }

    const media = getMedia(owner, mediaId);
    if (!media) {
      return res.status(404).json({
        error: "media not found",
        mediaId: String(mediaId),
        ownerId: String(ownerId),
      });
    }

     media.comments = media.comments || [];

    let parent = null;
    if (parentId) {
      parent = getComment(media, parentId);
      if (!parent) {
        return res.status(404).json({ error: "parent comment not found" });
      }

      if (!canSeePrivateComment(parent, me, ownerId)) {
        return res.status(403).json({ error: "Not allowed to reply to this comment" });
      }
    }

    const comment = {
      id: shortid.generate(),
      userId: me,
      text: cleanText,
      imageUrl: cleanImageUrl || null,
      photoUrl: cleanImageUrl || null,
      mediaUrl: cleanImageUrl || null,
      attachmentUrl: cleanImageUrl || null,
      createdAt: Date.now(),
      updatedAt: Date.now(),

      // 🔒 PRIVATE:
      // Normal comment: media owner + commenter
      // Reply: media owner + replier + original comment author
      visibleTo: ensurePrivateVisibleTo(ownerId, me, [], [
        parent?.userId,
      ]),

      // reply support
      parentId: parent ? String(parent.id) : null,
      replyToCommentId: parent ? String(parent.id) : null,
      replyToUserId: parent ? String(parent.userId) : null,
    };

    media.comments.push(comment);

    owner.markModified("media");
    await owner.save();

      if (String(ownerId) !== String(me)) {
      const commenter = await User.findOne({ id: me }).lean();

      const isReply = !!parent;
      const actionText = cleanImageUrl && !cleanText ? "sent a photo comment" : "commented";

      try {
        await sendNotification(ownerId, {
          fromId: me,

          // ✅ Use safe existing notification enum.
          // Your Notification model rejected "media_comment" / "media_reply".
          type: "comment",

          message: isReply
            ? `${commenter?.firstName || "Someone"} replied to a comment on your photo 💬`
            : `${commenter?.firstName || "Someone"} ${actionText} on your photo 💬`,
          entity: "media",
          entityId: mediaId,
          postOwnerId: ownerId,
        });
      } catch (notificationError) {
        console.error("⚠️ media comment notification failed:", notificationError);
      }
    }

    const notifyUsers = [me, ownerId];
    if (parent?.userId && String(parent.userId) !== String(ownerId)) {
      notifyUsers.push(String(parent.userId));
    }

    emitToUsers(notifyUsers, "comment:new", {
      postId: String(mediaId),
      ownerId: String(ownerId),
      comment,
    });

    return res.json({ ok: true, comment });
  } catch (err) {
    console.error("❌ /media/:ownerId/comment error:", err);
    return res.status(500).json({ error: "Failed to comment" });
  }
});

// =======================================================
// ✅ Edit a media comment (MongoDB)
//    - commenter can edit own comment only
//    - keeps parent/reply metadata intact
// =======================================================
router.patch("/media/:ownerId/comment/:commentId", authMiddleware, async (req, res) => {
  try {
    const me = String(req.user.id);
    const { ownerId, commentId } = req.params;
    const { mediaId, text } = req.body || {};

    const cleanText = String(text || "").trim();

    if (!mediaId || !cleanText) {
      return res.status(400).json({ error: "mediaId & text required" });
    }

      const owner = await User.findOne({ id: ownerId });
    if (!owner) {
      return res.status(404).json({ error: "owner not found" });
    }

     const canComment = await canInteractWithOwnerMedia(me, ownerId);
    if (!canComment) {
      return res.status(403).json({ error: "Only matched users can edit comments on this media" });
    }

    const media = getMedia(owner, mediaId);
    if (!media) {
      return res.status(404).json({
        error: "media not found",
        mediaId: String(mediaId),
        ownerId: String(ownerId),
      });
    }

    media.comments = media.comments || [];
    const comment = getComment(media, commentId);

    if (!comment) {
      return res.status(404).json({ error: "comment not found" });
    }

    if (String(comment.userId) !== String(me)) {
      return res.status(403).json({ error: "Not allowed to edit this comment" });
    }

     comment.text = cleanText;
    comment.editedAt = Date.now();
    comment.updatedAt = Date.now();

    // 🔒 Preserve private visibility after edit.
    comment.visibleTo = ensurePrivateVisibleTo(
      ownerId,
      comment.userId,
      comment.visibleTo
    );

    owner.markModified("media");
    await owner.save();

    emitToUsers([me, ownerId], "comment:updated", {
      postId: String(mediaId),
      ownerId: String(ownerId),
      comment,
    });

    return res.json({ ok: true, comment });
  } catch (err) {
    console.error("❌ PATCH /media/:ownerId/comment/:commentId error:", err);
    return res.status(500).json({ error: "Failed to edit comment" });
  }
});

// =======================================================
// ✅ Delete a media comment (MongoDB)
//    - commenter can delete own comment
//    - media owner can delete any comment
//    - deleting a parent also deletes its direct/indirect replies
// =======================================================
router.delete("/media/:ownerId/comment/:commentId", authMiddleware, async (req, res) => {
  try {
    const me = String(req.user.id);
    const { ownerId, commentId } = req.params;
    const { mediaId } = req.body || {};

    if (!mediaId) {
      return res.status(400).json({ error: "mediaId required" });
    }

       const owner = await User.findOne({ id: ownerId });
    if (!owner) {
      return res.status(404).json({ error: "owner not found" });
    }

        const canComment = await canInteractWithOwnerMedia(me, ownerId);
    if (!canComment) {
      return res.status(403).json({ error: "Only matched users can delete comments on this media" });
    }

    const media = getMedia(owner, mediaId);
    if (!media) {
      return res.status(404).json({
        error: "media not found",
        mediaId: String(mediaId),
        ownerId: String(ownerId),
      });
    }

    media.comments = media.comments || [];

    const target = getComment(media, commentId);
    if (!target) {
      return res.status(404).json({ error: "comment not found" });
    }

      if (!canSeePrivateComment(target, me, ownerId)) {
      return res.status(403).json({ error: "Not allowed to access this comment" });
    }

    const canDelete =
      String(target.userId) === String(me) || String(ownerId) === String(me);

    if (!canDelete) {
      return res.status(403).json({ error: "Not allowed to delete this comment" });
    }

    const idsToDelete = new Set([String(commentId)]);
    let changed = true;

    // delete whole reply tree (parent + descendants)
    while (changed) {
      changed = false;
      for (const c of media.comments) {
        const p = c?.parentId ? String(c.parentId) : null;
        const id = String(c?.id || "");
        if (p && idsToDelete.has(p) && !idsToDelete.has(id)) {
          idsToDelete.add(id);
          changed = true;
        }
      }
    }

    const before = media.comments.length;
    media.comments = media.comments.filter((c) => !idsToDelete.has(String(c.id)));
    const removedCount = before - media.comments.length;

    owner.markModified("media");
    await owner.save();

    for (const removedId of idsToDelete) {
      emitToUsers([me, ownerId], "comment:deleted", {
        postId: String(mediaId),
        ownerId: String(ownerId),
        commentId: String(removedId),
      });
    }

    return res.json({
      ok: true,
      deleted: true,
      commentId: String(commentId),
      removedCount,
    });
  } catch (err) {
    console.error("❌ DELETE /media/:ownerId/comment/:commentId error:", err);
    return res.status(500).json({ error: "Failed to delete comment" });
  }
});

// =======================================================
// ✅ Toggle media privacy (MongoDB)
// =======================================================
router.patch("/media/:id/privacy", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { privacy } = req.body || {};
    const me = String(req.user.id);

    const user = await User.findOne({ id: me });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const media = (user.media || []).find((m) => String(m.id) === String(id));
    if (!media) {
      return res.status(404).json({ error: "Media not found" });
    }

    media.privacy =
      privacy || (media.privacy === "private" ? "public" : "private");

    user.markModified("media");
    await user.save();

    return res.json({ success: true, media });
  } catch (err) {
    console.error("❌ PATCH /media/:id/privacy error:", err);
    return res.status(500).json({ error: "Failed to update privacy" });
  }
});

// =======================================================
// ✅ Delete media (MongoDB)
// =======================================================
router.delete("/media/:id", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const me = String(req.user.id);

    const user = await User.findOne({ id: me });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const before = Array.isArray(user.media) ? user.media.length : 0;
    user.media = (user.media || []).filter((m) => String(m.id) !== String(id));
    const changed = before !== user.media.length;

    if (changed) {
      user.markModified("media");
      await user.save();
    }

    return res.json({ success: changed });
  } catch (err) {
    console.error("❌ DELETE /media/:id error:", err);
    return res.status(500).json({ error: "Failed to delete media" });
  }
});

module.exports = router;