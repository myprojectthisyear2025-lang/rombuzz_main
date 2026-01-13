/**
 * ============================================================
 * 📁 File: routes/buzzpost/buzz.post.gifts.js
 * 🎁 Purpose: Gifts for LetsBuzz posts/reels (match-only feed items)
 *
 * Endpoints:
 *  POST /api/buzz/posts/:postId/gifts
 *    body: { giftKey, amount? }
 *
 *  GET  /api/buzz/posts/:postId/gifts/summary
 *    - Everyone can see total + byGift
 *    - ONLY owner can see byUser breakdown (who sent what)
 *
 * Realtime:
 *  - Emits "buzz:gift:new" to post owner + gifter
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

router.post("/buzz/posts/:postId/gifts", authMiddleware, async (req, res) => {
  try {
    const me = String(req.user.id);
    const { postId } = req.params;
    const { giftKey, amount = 1 } = req.body || {};

    if (!giftKey) return res.status(400).json({ error: "giftKey required" });

    const post = await PostModel.findOne({ id: postId }).lean();
    if (!post) return res.status(404).json({ error: "Post not found" });

    // Must be matched (gifter <-> owner) OR owner gifting themselves (block self gifting)
    if (String(post.userId) === me) {
      return res.status(400).json({ error: "cannot_gift_own_post" });
    }

    const ok = await assertMatched(me, post.userId);
    if (!ok) return res.status(403).json({ error: "not_matched" });

    const giftDoc = await BuzzPostGift.create({
      id: shortid.generate(),
      postId,
      ownerId: String(post.userId),
      fromId: me,
      giftKey: String(giftKey),
      amount: Math.max(1, Number(amount) || 1),
      createdAt: new Date(),
    });

    // notify owner
    try {
      const meUser = await User.findOne({ id: me }).lean();
      const fromName = meUser?.firstName || "Someone";
      await sendNotification(String(post.userId), {
        fromId: me,
        type: "gift",
        message: `${fromName} sent you a gift 🎁`,
        href: `/viewProfile/${me}`,
        entity: "buzz_post",
        entityId: postId,
      });
    } catch {}

    // realtime
    const io = getIO();
    const onlineUsers = getOnlineUsers();
    const payload = { postId, gift: giftDoc };

    if (io) {
      // to gifter
      if (onlineUsers[me]) io.to(String(onlineUsers[me])).emit("buzz:gift:new", payload);
      // to owner
      if (onlineUsers[String(post.userId)])
        io.to(String(onlineUsers[String(post.userId)])).emit("buzz:gift:new", payload);
    }

    return res.json({ success: true, gift: giftDoc });
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

    // Must be matched with owner OR owner
    if (String(post.userId) !== me) {
      const ok = await assertMatched(me, post.userId);
      if (!ok) return res.status(403).json({ error: "not_matched" });
    }

    const gifts = await BuzzPostGift.find({ postId })
      .sort({ createdAt: -1 })
      .lean();

    const total = gifts.reduce((s, g) => s + (Number(g.amount) || 0), 0);

    const byGiftMap = {};
    for (const g of gifts) {
      const k = String(g.giftKey);
      byGiftMap[k] = (byGiftMap[k] || 0) + (Number(g.amount) || 0);
    }
    const byGift = Object.entries(byGiftMap)
      .map(([giftKey, count]) => ({ giftKey, count }))
      .sort((a, b) => b.count - a.count);

    // owner-only breakdown
    let byUser = null;
    if (String(post.userId) === me) {
      const byUserMap = {};
      for (const g of gifts) {
        const uid = String(g.fromId);
        byUserMap[uid] ||= { userId: uid, gifts: {}, total: 0 };
        byUserMap[uid].gifts[g.giftKey] = (byUserMap[uid].gifts[g.giftKey] || 0) + (Number(g.amount) || 0);
        byUserMap[uid].total += (Number(g.amount) || 0);
      }

      const userIds = Object.keys(byUserMap);
      const users = await User.find({ id: { $in: userIds } }).lean();
      byUser = userIds
        .map((uid) => {
          const u = users.find((x) => String(x.id) === String(uid));
          return {
            ...byUserMap[uid],
            user: u ? baseSanitizeUser(u) : { id: uid, firstName: "Unknown", lastName: "", avatar: "" },
          };
        })
        .sort((a, b) => (b.total || 0) - (a.total || 0));
    }

    return res.json({ postId, ownerId: String(post.userId), total, byGift, byUser });
  } catch (e) {
    console.error("Buzz post gifts summary error:", e);
    return res.status(500).json({ error: "internal_error" });
  }
});

module.exports = router;
