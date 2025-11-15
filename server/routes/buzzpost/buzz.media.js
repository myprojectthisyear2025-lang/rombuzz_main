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
 *   POST   /api/media/:ownerId/react     → React / unreact to media
 *   POST   /api/media/:ownerId/comment   → Add comment to media
 *   PATCH  /api/media/:id/privacy        → Toggle privacy
 *   DELETE /api/media/:id                → Delete media
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

// =======================================================
// ✅ React / unreact to a media item (MongoDB)
// =======================================================
router.post("/media/:ownerId/react", authMiddleware, async (req, res) => {
  try {
    const me = req.user.id;
    const { ownerId } = req.params;
    const { mediaId, emoji = "❤️" } = req.body || {};
    if (!mediaId) return res.status(400).json({ error: "mediaId required" });

    const owner = await User.findOne({ id: ownerId });
    if (!owner) return res.status(404).json({ error: "owner not found" });

    const media = (owner.media || []).find((m) => m.id === mediaId);
    if (!media) return res.status(404).json({ error: "media not found" });

    media.reactions = media.reactions || {};

    // ❤️ Toggle reaction
    if (media.reactions[me] === emoji) delete media.reactions[me];
    else media.reactions[me] = emoji;

    await owner.save();

    // Build counts
    const counts = {};
    for (const e of Object.values(media.reactions))
      counts[e] = (counts[e] || 0) + 1;

    // 🔔 Notify owner if not self
    if (ownerId !== me) {
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
// =======================================================
router.post("/media/:ownerId/comment", authMiddleware, async (req, res) => {
  try {
    const me = req.user.id;
    const { ownerId } = req.params;
    const { mediaId, text } = req.body || {};

    if (!mediaId || !text)
      return res.status(400).json({ error: "mediaId & text required" });

    const owner = await User.findOne({ id: ownerId });
    if (!owner) return res.status(404).json({ error: "owner not found" });

    const media = (owner.media || []).find((m) => m.id === mediaId);
    if (!media) return res.status(404).json({ error: "media not found" });

    media.comments = media.comments || [];
    const comment = {
      id: shortid.generate(),
      userId: me,
      text: text.trim(),
      createdAt: Date.now(),
    };

    media.comments.push(comment);
    await owner.save();

    // 🔔 Notify owner
    if (ownerId !== me) {
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

    res.json({ ok: true, comment });
  } catch (err) {
    console.error("❌ /media/:ownerId/comment error:", err);
    res.status(500).json({ error: "Failed to comment" });
  }
});

// =======================================================
// ✅ Toggle media privacy (MongoDB)
// =======================================================
router.patch("/media/:id/privacy", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { privacy } = req.body || {};
    const me = req.user.id;

    const user = await User.findOne({ id: me });
    if (!user) return res.status(404).json({ error: "User not found" });

    const media = user.media.find((m) => m.id === id);
    if (!media) return res.status(404).json({ error: "Media not found" });

    media.privacy =
      privacy || (media.privacy === "private" ? "public" : "private");

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
    const me = req.user.id;

    const user = await User.findOne({ id: me });
    if (!user) return res.status(404).json({ error: "User not found" });

    const before = user.media.length;
    user.media = user.media.filter((m) => m.id !== id);
    const changed = before !== user.media.length;

    if (changed) await user.save();

    res.json({ success: changed });
  } catch (err) {
    console.error("❌ DELETE /media/:id error:", err);
    res.status(500).json({ error: "Failed to delete media" });
  }
});

module.exports = router;
