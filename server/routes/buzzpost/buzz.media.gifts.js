/**
 * ============================================================
 * 📁 File: routes/buzzpost/buzz.media.gifts.js
 * 🎁 Purpose: Matched-only gifting for profile media (gallery photos/reels)
 *
 * RULES:
 *  - Only matched users can gift
 *  - Gifts are OWNER-ONLY visible (insights)
 *  - Viewer may see what they personally sent (later via thread/receipt if needed)
 *
 * Endpoint:
 *   POST /api/media/:ownerId/gift
 *   body: { mediaId, stickerId, amount }
 * ============================================================
 */

const express = require("express");
const router = express.Router();
const shortid = require("shortid");

const authMiddleware = require("../auth-middleware");
const User = require("../../models/User");
const Match = require("../../models/Match");
const MediaGift = require("../../models/MediaGift");
const { sendNotification } = require("../../utils/helpers");

// =======================================================
// ✅ Gift a media item (MATCH-ONLY)
// =======================================================
router.post("/media/:ownerId/gift", authMiddleware, async (req, res) => {
  try {
    const me = req.user.id;
    const { ownerId } = req.params;
    const { mediaId, stickerId = "sticker_basic", amount = 0 } = req.body || {};

    if (!mediaId) return res.status(400).json({ error: "mediaId required" });
    if (ownerId === me) return res.status(400).json({ error: "Cannot gift yourself" });

    // 1) Validate owner + media exists
    const owner = await User.findOne({ id: ownerId });
    if (!owner) return res.status(404).json({ error: "owner not found" });

    const media = (owner.media || []).find((m) => m.id === mediaId);
    if (!media) return res.status(404).json({ error: "media not found" });

    // 2) Match gate
    const isMatched = await Match.findOne({
      status: "matched",
      users: { $all: [me, ownerId] },
    }).lean();

    if (!isMatched) return res.status(403).json({ error: "Not matched" });

    // 3) Create gift record
    const giftDoc = await MediaGift.create({
      id: shortid.generate(),
      mediaId,
      ownerId,     // toId (owner)
      fromId: me,
      stickerId,
      amount: Number(amount) || 0,
      createdAt: Date.now(),
    });

    // 4) Notify owner
    const gifter = await User.findOne({ id: me }).lean();
    await sendNotification(ownerId, {
      fromId: me,
      type: "media_gift",
      message: `${gifter?.firstName || "Someone"} sent you a gift 🎁`,
      entity: "media",
      entityId: mediaId,
      postOwnerId: ownerId,
    });

    return res.json({ ok: true, gift: giftDoc });
  } catch (err) {
    console.error("❌ POST /media/:ownerId/gift error:", err);
    return res.status(500).json({ error: "Failed to gift media" });
  }
});

module.exports = router;
