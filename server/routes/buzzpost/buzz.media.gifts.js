/**
 * ============================================================
 * 📁 File: routes/buzzpost/buzz.media.gifts.js
 * 🎁 Purpose: Matched-only gifting for profile media (gallery photos/reels)
 *
 * RULES:
 *  - Only matched users can gift
 *  - Gifts are OWNER-ONLY visible (insights)
 *  - Viewer may see what they personally sent later via receipt/thread
 *
 * Endpoint:
 *   POST /api/media/:ownerId/gift
 *   body: { mediaId, giftId }
 *
 * Upgrade:
 *  - Uses server/config/rombuzzGifts.js as backend source of truth
 *  - Does NOT trust frontend price/amount
 *  - Still accepts legacy stickerId as fallback during transition
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
const { validateGiftPurchase } = require("../../config/rombuzzGifts");

router.post("/media/:ownerId/gift", authMiddleware, async (req, res) => {
  try {
    const me = req.user.id;
    const { ownerId } = req.params;
    const { mediaId } = req.body || {};

    const requestedGiftId = String(req.body?.giftId || req.body?.stickerId || "").trim();
    const placement = "profile_media";

    if (!mediaId) return res.status(400).json({ error: "mediaId required" });
    if (!requestedGiftId) return res.status(400).json({ error: "giftId required" });
    if (ownerId === me) return res.status(400).json({ error: "Cannot gift yourself" });

    const giftCheck = validateGiftPurchase({
      giftId: requestedGiftId,
      placement,
    });

    if (!giftCheck.ok) {
      return res.status(400).json({
        error: giftCheck.code || "invalid_gift",
        message: giftCheck.message || "Invalid gift",
      });
    }

    const owner = await User.findOne({ id: ownerId });
    if (!owner) return res.status(404).json({ error: "owner not found" });

    const media = (owner.media || []).find((m) => m.id === mediaId);
    if (!media) return res.status(404).json({ error: "media not found" });

    const isMatched = await Match.findOne({
      status: "matched",
      users: { $all: [me, ownerId] },
    }).lean();

    if (!isMatched) return res.status(403).json({ error: "Not matched" });

    const transactionId = shortid.generate();
    const giftId = String(giftCheck.gift.giftId);
    const priceBC = Number(giftCheck.priceBC) || 0;

    const giftDoc = await MediaGift.create({
      id: shortid.generate(),
      mediaId,
      ownerId,
      fromId: me,

      giftId,
      priceBC,
      placement,
      targetType: "profile_media",
      targetId: mediaId,
      transactionId,
      status: "completed",

      stickerId: giftId,
      amount: 1,

      createdAt: Date.now(),
    });

    const gifter = await User.findOne({ id: me }).lean();
    await sendNotification(ownerId, {
      fromId: me,
      type: "media_gift",
      message: `${gifter?.firstName || "Someone"} sent you a gift 🎁`,
      entity: "media",
      entityId: mediaId,
      postOwnerId: ownerId,
      giftId,
      transactionId,
    });

    return res.json({
      ok: true,
      gift: giftDoc,
      giftId,
      priceBC,
      placement,
      transactionId,
    });
  } catch (err) {
    console.error("❌ POST /media/:ownerId/gift error:", err);
    return res.status(500).json({ error: "Failed to gift media" });
  }
});

module.exports = router;
