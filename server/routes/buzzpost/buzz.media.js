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
 *   POST   /api/media/:ownerId/comment               → Add comment to media
 *   PATCH  /api/media/:ownerId/comment/:commentId    → Edit a media comment
 *   DELETE /api/media/:ownerId/comment/:commentId    → Delete a media comment
 *   PATCH  /api/media/:id/privacy                    → Toggle privacy
 *   DELETE /api/media/:id                            → Delete media
 *
 * Dependencies:
 *   - auth-middleware.js
 *   - models/User.js (MongoDB)
 *   - utils/helpers.js → sendNotification()
 * ============================================================
 */

const express = require("express");
const router = express.Router();
const shortid = require("shortid");

const authMiddleware = require("../auth-middleware");
const User = require("../../models/User");
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

    const media = (owner.media || []).find((m) => String(m.id) === String(mediaId));
    if (!media) {
      return res.status(404).json({ error: "media not found" });
    }

    media.reactions = media.reactions || {};

    // ❤️ Toggle reaction
    if (media.reactions[me] === emoji) {
      delete media.reactions[me];
    } else {
      media.reactions[me] = emoji;
    }

    owner.markModified("media");
    await owner.save();

    // Build counts
    const counts = {};
    for (const e of Object.values(media.reactions || {})) {
      counts[e] = (counts[e] || 0) + 1;
    }

    // 🔔 Notify owner if not self
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

    // Optional realtime media reaction broadcast (safe additive)
    emitToUsers([me, ownerId], "media:react", {
      ownerId: String(ownerId),
      mediaId: String(mediaId),
      counts,
      mine: media.reactions[me] || null,
    });

    res.json({
      ok: true,
      counts,
      mine: media.reactions[me] || null,
    });
  } catch (err) {
    console.error("❌ /media/:ownerId/react error:", err);
    res.status(500).json({ error: "Reaction failed" });
  }
});

// =======================================================
// ✅ Comment on a media item (MongoDB)
// ✅ NOW emits realtime comment:new using postId = mediaId
//    so existing LetsBuzzActions listeners keep working
// =======================================================
router.post("/media/:ownerId/comment", authMiddleware, async (req, res) => {
  try {
    const me = String(req.user.id);
    const { ownerId } = req.params;
    const { mediaId, text } = req.body || {};

    const cleanText = String(text || "").trim();

    if (!mediaId || !cleanText) {
      return res.status(400).json({ error: "mediaId & text required" });
    }

    const owner = await User.findOne({ id: ownerId });
    if (!owner) {
      return res.status(404).json({ error: "owner not found" });
    }

    const media = (owner.media || []).find((m) => String(m.id) === String(mediaId));
    if (!media) {
      return res.status(404).json({ error: "media not found" });
    }

    media.comments = media.comments || [];

    const comment = {
      id: shortid.generate(),
      userId: me,
      text: cleanText,
      createdAt: Date.now(),
    };

    media.comments.push(comment);

    owner.markModified("media");
    await owner.save();

    // 🔔 Notify owner
    if (String(ownerId) !== String(me)) {
      const commenter = await User.findOne({ id: me }).lean();
      await sendNotification(ownerId, {
        fromId: me,
        type: "media_comment",
        message: `${commenter?.firstName || "Someone"} commented on your photo 💬`,
        entity: "media",
        entityId: mediaId,
        postOwnerId: ownerId,
      });
    }

    // ✅ CRITICAL: match existing frontend listener contract
    // Frontend listens for "comment:new" and expects payload.postId
    emitToUsers([me, ownerId], "comment:new", {
      postId: String(mediaId),
      ownerId: String(ownerId),
      comment,
    });

    res.json({ ok: true, comment });
  } catch (err) {
    console.error("❌ /media/:ownerId/comment error:", err);
    res.status(500).json({ error: "Failed to comment" });
  }
});

// =======================================================
// ✅ Edit a media comment (MongoDB)
//    - commenter can edit own comment
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

    const media = (owner.media || []).find((m) => String(m.id) === String(mediaId));
    if (!media) {
      return res.status(404).json({ error: "media not found" });
    }

    media.comments = media.comments || [];
    const comment = media.comments.find((c) => String(c.id) === String(commentId));

    if (!comment) {
      return res.status(404).json({ error: "comment not found" });
    }

    if (String(comment.userId) !== String(me)) {
      return res.status(403).json({ error: "Not allowed to edit this comment" });
    }

    comment.text = cleanText;
    comment.editedAt = Date.now();

    owner.markModified("media");
    await owner.save();

    // Safe additive event for future UI support
    emitToUsers([me, ownerId], "comment:updated", {
      postId: String(mediaId),
      ownerId: String(ownerId),
      comment,
    });

    res.json({ ok: true, comment });
  } catch (err) {
    console.error("❌ PATCH /media/:ownerId/comment/:commentId error:", err);
    res.status(500).json({ error: "Failed to edit comment" });
  }
});

// =======================================================
// ✅ Delete a media comment (MongoDB)
//    - commenter can delete own comment
//    - media owner can delete any comment on own media
//    - emits comment:deleted with postId = mediaId
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

    const media = (owner.media || []).find((m) => String(m.id) === String(mediaId));
    if (!media) {
      return res.status(404).json({ error: "media not found" });
    }

    media.comments = media.comments || [];

    const idx = media.comments.findIndex((c) => String(c.id) === String(commentId));
    if (idx < 0) {
      return res.status(404).json({ error: "comment not found" });
    }

    const target = media.comments[idx];
    const canDelete =
      String(target.userId) === String(me) || String(ownerId) === String(me);

    if (!canDelete) {
      return res.status(403).json({ error: "Not allowed to delete this comment" });
    }

    media.comments.splice(idx, 1);

    owner.markModified("media");
    await owner.save();

    // ✅ Match existing frontend listener contract
    emitToUsers([me, ownerId], "comment:deleted", {
      postId: String(mediaId),
      ownerId: String(ownerId),
      commentId: String(commentId),
    });

    res.json({ ok: true, deleted: true, commentId: String(commentId) });
  } catch (err) {
    console.error("❌ DELETE /media/:ownerId/comment/:commentId error:", err);
    res.status(500).json({ error: "Failed to delete comment" });
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

    res.json({ success: true, media });
  } catch (err) {
    console.error("❌ PATCH /media/:id/privacy error:", err);
    res.status(500).json({ error: "Failed to update privacy" });
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

    res.json({ success: changed });
  } catch (err) {
    console.error("❌ DELETE /media/:id error:", err);
    res.status(500).json({ error: "Failed to delete media" });
  }
});

module.exports = router;