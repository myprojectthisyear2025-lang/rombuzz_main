/**
 * ============================================================
 * 📁 File: routes/buzzpost/buzz.media.insights.js
 * 📊 Purpose: Owner-only insights + match-private threads for media
 *
 * INSIGHTS (OWNER ONLY):
 *   GET /api/media/:ownerId/insights/:mediaId
 *
 * THREADS (MATCH-PRIVATE):
 *   GET  /api/media/:ownerId/thread/:peerId/:mediaId
 *   POST /api/media/:ownerId/thread/:peerId/:mediaId/message
 *   body: { text }
 *
 * Privacy:
 *  - Insights: ONLY ownerId can access
 *  - Thread: ONLY (ownerId OR peerId) can access AND must be matched
 * ============================================================
 */

const express = require("express");
const router = express.Router();
const shortid = require("shortid");

const authMiddleware = require("../auth-middleware");
const User = require("../../models/User");
const Match = require("../../models/Match");
const MediaGift = require("../../models/MediaGift");
const MediaThread = require("../../models/MediaThread");
const { baseSanitizeUser } = require("../../utils/helpers");
const { getSignedMediaUrl, isR2Key } = require("../../utils/r2Media");

async function signR2Value(value, expiresInSeconds = 21600) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (!isR2Key(raw)) return raw;

  return getSignedMediaUrl(raw, expiresInSeconds);
}

async function signInsightUser(user = {}) {
  const safe = baseSanitizeUser(user || {});
  const signedAvatar = await signR2Value(
    safe.avatar || safe.avatarUrl || safe.profilePic || safe.photo || "",
    21600
  );

  safe.avatar = signedAvatar;
  safe.avatarUrl = signedAvatar;
  safe.name =
    [safe.firstName, safe.lastName].filter(Boolean).join(" ").trim() ||
    safe.username ||
    "RomBuzz User";

  return safe;
}

// --------------------------
// helpers
// --------------------------
async function assertMediaExists(ownerId, mediaId) {
  const owner = await User.findOne({ id: ownerId }).lean();
  if (!owner) return { ok: false, code: 404, error: "owner not found" };

  const media = (owner.media || []).find((m) => m.id === mediaId);
  if (!media) return { ok: false, code: 404, error: "media not found" };

  return { ok: true, owner, media };
}

async function assertMatched(a, b) {
  const m = await Match.findOne({
    status: "matched",
    users: { $all: [a, b] },
  }).lean();
  return !!m;
}

// =======================================================
// ✅ OWNER INSIGHTS (drawer)
// GET /api/media/:ownerId/insights/:mediaId
// =======================================================
router.get("/media/:ownerId/insights/:mediaId", authMiddleware, async (req, res) => {
  try {
    const me = req.user.id;
    const { ownerId, mediaId } = req.params;

    // owner-only
    if (me !== ownerId) return res.status(403).json({ error: "Owner only" });

    // ensure media exists
    const chk = await assertMediaExists(ownerId, mediaId);
    if (!chk.ok) return res.status(chk.code).json({ error: chk.error });

    // gifts
    const gifts = await MediaGift.find({ ownerId, mediaId })
      .sort({ createdAt: -1 })
      .lean();

    const totalAmount = gifts.reduce((sum, g) => sum + (Number(g.amount) || 0), 0);

    // gifters user info
      const gifterIds = [...new Set(gifts.map((g) => g.fromId).filter(Boolean))];
    const gifters = gifterIds.length
      ? await User.find({ id: { $in: gifterIds } }).lean()
      : [];

    const gifterMap = new Map(
      await Promise.all(
        gifters.map(async (u) => [u.id, await signInsightUser(u)])
      )
    );

    const giftsUi = gifts.map((g) => {
      const safeUser =
        gifterMap.get(g.fromId) ||
        { id: g.fromId, firstName: "", lastName: "", name: "", avatar: "", avatarUrl: "" };

      return {
        id: g.id,
        mediaId: g.mediaId,
        ownerId: g.ownerId,
        fromId: g.fromId,
        senderId: g.fromId,
        fromUser: safeUser,
        user: safeUser,
        giftId: g.giftId || g.stickerId || "",
        stickerId: g.stickerId || g.giftId || "",
        giftKey: g.giftId || g.stickerId || "",
        amount: Number(g.amount || g.priceBC || 0),
        priceBC: Number(g.priceBC || g.amount || 0),
        placement: g.placement || "profile_media",
        transactionId: g.transactionId || "",
        createdAt: g.createdAt,
      };
    });

    // threads list (one per match user per media)
    const threads = await MediaThread.find({ ownerId, mediaId })
      .sort({ updatedAt: -1 })
      .lean();

      const peerIds = [...new Set(threads.map((t) => t.peerId).filter(Boolean))];
    const peers = peerIds.length ? await User.find({ id: { $in: peerIds } }).lean() : [];
    const peerMap = new Map(
      await Promise.all(
        peers.map(async (u) => [u.id, await signInsightUser(u)])
      )
    );

    const threadsUi = threads.map((t) => {
      const last = (t.messages || []).slice(-1)[0] || null;
      return {
        id: t.id,
        peerId: t.peerId,
        peerUser: peerMap.get(t.peerId) || { id: t.peerId, firstName: "", lastName: "", avatar: "" },
        lastMessage: last ? { userId: last.userId, text: last.text, createdAt: last.createdAt } : null,
        updatedAt: t.updatedAt,
      };
    });

     return res.json({
      ok: true,
      mediaId,
      gifts: giftsUi,               // owner-only list of gifters + what
      rows: giftsUi,
      transactions: giftsUi,
      totalGifts: giftsUi.length,
      totalCount: giftsUi.length,
      totalAmount,
      totalBC: totalAmount,
      threads: threadsUi,           // owner-only thread list
    });
  } catch (err) {
    console.error("❌ GET /media/:ownerId/insights/:mediaId error:", err);
    return res.status(500).json({ error: "Failed to fetch insights" });
  }
});

// =======================================================
// ✅ GET THREAD (match-private)
// GET /api/media/:ownerId/thread/:peerId/:mediaId
// =======================================================
router.get("/media/:ownerId/thread/:peerId/:mediaId", authMiddleware, async (req, res) => {
  try {
    const me = req.user.id;
    const { ownerId, peerId, mediaId } = req.params;

    // only owner or peer can read
    if (me !== ownerId && me !== peerId)
      return res.status(403).json({ error: "Forbidden" });

    // ensure media exists
    const chk = await assertMediaExists(ownerId, mediaId);
    if (!chk.ok) return res.status(chk.code).json({ error: chk.error });

    // must be matched
    const ok = await assertMatched(ownerId, peerId);
    if (!ok) return res.status(403).json({ error: "Not matched" });

    // find or create thread
    let thread = await MediaThread.findOne({ ownerId, peerId, mediaId });
    if (!thread) {
      thread = await MediaThread.create({
        id: shortid.generate(),
        ownerId,
        peerId,
        mediaId,
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }

    return res.json({
      ok: true,
      thread: {
        id: thread.id,
        ownerId: thread.ownerId,
        peerId: thread.peerId,
        mediaId: thread.mediaId,
        messages: (thread.messages || []).map((m) => ({
          id: m.id,
          userId: m.userId,
          text: m.text,
          createdAt: m.createdAt,
        })),
        updatedAt: thread.updatedAt,
      },
    });
  } catch (err) {
    console.error("❌ GET /media/:ownerId/thread/:peerId/:mediaId error:", err);
    return res.status(500).json({ error: "Failed to fetch thread" });
  }
});

// =======================================================
// ✅ POST MESSAGE (match-private)
// POST /api/media/:ownerId/thread/:peerId/:mediaId/message
// body: { text }
// =======================================================
router.post("/media/:ownerId/thread/:peerId/:mediaId/message", authMiddleware, async (req, res) => {
  try {
    const me = req.user.id;
    const { ownerId, peerId, mediaId } = req.params;
    const { text } = req.body || {};

    if (!text?.trim()) return res.status(400).json({ error: "text required" });

    // only owner or peer can write
    if (me !== ownerId && me !== peerId)
      return res.status(403).json({ error: "Forbidden" });

    // ensure media exists
    const chk = await assertMediaExists(ownerId, mediaId);
    if (!chk.ok) return res.status(chk.code).json({ error: chk.error });

    // must be matched
    const ok = await assertMatched(ownerId, peerId);
    if (!ok) return res.status(403).json({ error: "Not matched" });

    // find or create thread
    let thread = await MediaThread.findOne({ ownerId, peerId, mediaId });
    if (!thread) {
      thread = await MediaThread.create({
        id: shortid.generate(),
        ownerId,
        peerId,
        mediaId,
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }

    const msg = {
      id: shortid.generate(),
      userId: me,
      text: text.trim(),
      createdAt: Date.now(),
    };

    thread.messages = thread.messages || [];
    thread.messages.push(msg);
    thread.updatedAt = Date.now();
    await thread.save();

    return res.json({ ok: true, message: msg, threadId: thread.id });
  } catch (err) {
    console.error("❌ POST /media/:ownerId/thread/:peerId/:mediaId/message error:", err);
    return res.status(500).json({ error: "Failed to send message" });
  }
});

module.exports = router;
