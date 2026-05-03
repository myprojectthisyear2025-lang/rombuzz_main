/**
 * ============================================================
 * 📁 File: routes/buzzpost/buzz.post.gifts.js
 * 🎁 Purpose: Gifts for LetsBuzz posts/reels (match-only feed items)
 *
 * Endpoints:
 *  POST /api/buzz/posts/:postId/gifts
 *    body: { giftId, placement? }
 *
 *  GET  /api/buzz/posts/:postId/gifts/summary
 *    - Everyone can see total + byGift
 *    - ONLY owner can see byUser breakdown (who sent what)
 *
 * Realtime:
 *  - Emits "buzz:gift:new" to post owner + gifter
 *
 * Upgrade:
 *  - Uses server/config/rombuzzGifts.js as backend source of truth
 *  - Does NOT trust frontend price/amount
 *  - Still accepts legacy giftKey as fallback during transition
 * ============================================================
 */

const express = require("express");
const router = express.Router();
const shortid = require("shortid");

const authMiddleware = require("../auth-middleware");
const Match = require("../../models/Match");
const User = require("../../models/User");
const PostModel = require("../../models/PostModel");
const BuzzPostGift = require("../../models/BuzzPostGift");
const { baseSanitizeUser, sendNotification } = require("../../utils/helpers");
const { validateGiftPurchase } = require("../../config/rombuzzGifts");

function getIO() {
  return global.io || null;
}

function getOnlineUsers() {
  global.onlineUsers ||= {};
  return global.onlineUsers;
}

async function assertMatched(a, b) {
  const m = await Match.findOne({
    status: "matched",
    users: { $all: [String(a), String(b)] },
  }).lean();
  return !!m;
}

function normalizePostGiftPlacement(value) {
  const placement = String(value || "posts").toLowerCase();
  if (placement === "reels") return "reels";
  return "posts";
}

router.post("/buzz/posts/:postId/gifts", authMiddleware, async (req, res) => {
  try {
    const me = String(req.user.id);
    const { postId } = req.params;

    const requestedGiftId = String(req.body?.giftId || req.body?.giftKey || "").trim();
    const placement = normalizePostGiftPlacement(req.body?.placement);

    if (!requestedGiftId) {
      return res.status(400).json({ error: "giftId required" });
    }

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

    const post = await PostModel.findOne({ id: postId }).lean();
    if (!post) return res.status(404).json({ error: "Post not found" });

    if (String(post.userId) === me) {
      return res.status(400).json({ error: "cannot_gift_own_post" });
    }

    const ok = await assertMatched(me, post.userId);
    if (!ok) return res.status(403).json({ error: "not_matched" });

    const transactionId = shortid.generate();
    const giftId = String(giftCheck.gift.giftId);
    const priceBC = Number(giftCheck.priceBC) || 0;

    const giftDoc = await BuzzPostGift.create({
      id: shortid.generate(),
      postId,
      ownerId: String(post.userId),
      fromId: me,

      giftId,
      priceBC,
      placement,
      targetType: placement === "reels" ? "buzz_reel" : "buzz_post",
      targetId: postId,
      transactionId,
      status: "completed",

      giftKey: giftId,
      amount: 1,

      createdAt: new Date(),
    });

    try {
      const meUser = await User.findOne({ id: me }).lean();
      const fromName = meUser?.firstName || "Someone";

      await sendNotification(String(post.userId), {
        fromId: me,
        type: "gift",
        message: `${fromName} sent you a gift 🎁`,
        href: `/viewProfile/${me}`,
        entity: placement === "reels" ? "buzz_reel" : "buzz_post",
        entityId: postId,
        giftId,
        transactionId,
      });
    } catch {}

    const io = getIO();
    const onlineUsers = getOnlineUsers();
    const payload = {
      postId,
      gift: giftDoc,
      giftId,
      priceBC,
      placement,
      transactionId,
    };

    if (io) {
      if (onlineUsers[me]) io.to(String(onlineUsers[me])).emit("buzz:gift:new", payload);

      if (onlineUsers[String(post.userId)]) {
        io.to(String(onlineUsers[String(post.userId)])).emit("buzz:gift:new", payload);
      }
    }

    return res.json({
      success: true,
      gift: giftDoc,
      giftId,
      priceBC,
      placement,
      transactionId,
    });
  } catch (e) {
    console.error("Buzz post gift error:", e);
    return res.status(500).json({ error: "internal_error" });
  }
});

router.get("/buzz/posts/:postId/gifts/summary", authMiddleware, async (req, res) => {
  try {
    const me = String(req.user.id);
    const { postId } = req.params;

    const post = await PostModel.findOne({ id: postId }).lean();
    if (!post) return res.status(404).json({ error: "Post not found" });

    if (String(post.userId) !== me) {
      const ok = await assertMatched(me, post.userId);
      if (!ok) return res.status(403).json({ error: "not_matched" });
    }

    const gifts = await BuzzPostGift.find({ postId })
      .sort({ createdAt: -1 })
      .lean();

    const total = gifts.reduce((s, g) => s + (Number(g.amount) || 0), 0);
    const totalBC = gifts.reduce((s, g) => s + (Number(g.priceBC) || 0), 0);

    const byGiftMap = {};
    for (const g of gifts) {
      const k = String(g.giftId || g.giftKey || "unknown_gift");
      byGiftMap[k] ||= {
        giftId: k,
        giftKey: k,
        count: 0,
        totalBC: 0,
      };

      byGiftMap[k].count += Number(g.amount) || 0;
      byGiftMap[k].totalBC += Number(g.priceBC) || 0;
    }

    const byGift = Object.values(byGiftMap).sort((a, b) => b.count - a.count);

    let byUser = null;
    if (String(post.userId) === me) {
      const byUserMap = {};

      for (const g of gifts) {
        const uid = String(g.fromId);
        const giftId = String(g.giftId || g.giftKey || "unknown_gift");

        byUserMap[uid] ||= { userId: uid, gifts: {}, total: 0, totalBC: 0 };
        byUserMap[uid].gifts[giftId] = (byUserMap[uid].gifts[giftId] || 0) + (Number(g.amount) || 0);
        byUserMap[uid].total += Number(g.amount) || 0;
        byUserMap[uid].totalBC += Number(g.priceBC) || 0;
      }

      const userIds = Object.keys(byUserMap);
      const users = await User.find({ id: { $in: userIds } }).lean();

      byUser = userIds
        .map((uid) => {
          const u = users.find((x) => String(x.id) === String(uid));
          return {
            ...byUserMap[uid],
            user: u
              ? baseSanitizeUser(u)
              : { id: uid, firstName: "Unknown", lastName: "", avatar: "" },
          };
        })
        .sort((a, b) => (b.total || 0) - (a.total || 0));
    }

    return res.json({
      postId,
      ownerId: String(post.userId),
      total,
      totalBC,
      byGift,
      byUser,
    });
  } catch (e) {
    console.error("Buzz post gifts summary error:", e);
    return res.status(500).json({ error: "internal_error" });
  }
});

module.exports = router;
