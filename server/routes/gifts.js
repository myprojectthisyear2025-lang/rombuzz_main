/**
 * ============================================================
 * 📁 File: routes/gifts.js
 * 🎁 Purpose: Modular RomBuzz gifts + BuzzCoin route layer.
 *
 * Mounted at:
 *  app.use("/api/gifts", require("./routes/gifts"));
 *
 * Endpoints:
 *  GET  /api/gifts/catalog
 *  GET  /api/gifts/wallet
 *  GET  /api/gifts/ledger
 *  GET  /api/gifts/transactions
 *  GET  /api/gifts/summary
 *  POST /api/gifts/send
 *  POST /api/gifts/wallet/dev-credit
 *  POST /api/gifts/withdrawals/request
 *  GET  /api/gifts/withdrawals
 *
 * Notes:
 *  - dev-credit is blocked in production.
 *  - withdrawal request does NOT send money.
 * ============================================================
 */

const express = require("express");
const router = express.Router();
const shortid = require("shortid");

const authMiddleware = require("./auth-middleware");
const User = require("../models/User");
const GiftWithdrawalRequest = require("../models/GiftWithdrawalRequest");

const {
  ROMBUZZ_GIFT_CONFIG,
  validateGiftPurchase,
} = require("../config/rombuzzGifts");

const {
  getWalletSnapshot,
  creditBuzzCoins,
  listLedger,
} = require("../services/buzzCoinService");

const {
  sendGift,
  getGiftSummary,
  listGiftTransactions,
} = require("../services/giftService");

function getMe(req) {
  return String(req.user?.id || "");
}

function isProduction() {
  return String(process.env.NODE_ENV || "").toLowerCase() === "production";
}

function hasValidGiftTestSecret(req) {
  const expectedSecret = String(process.env.GIFTS_ADMIN_TEST_SECRET || "").trim();
  const receivedSecret = String(req.headers["x-gifts-admin-secret"] || "").trim();

  return Boolean(expectedSecret && receivedSecret && expectedSecret === receivedSecret);
}

function sendRouteError(res, err) {
  const status = err?.statusCode || 500;
  return res.status(status).json({
    ok: false,
    error: err?.code || "INTERNAL_ERROR",
    message: err?.message || "Something went wrong",
    balanceBC: err?.balanceBC,
    requiredBC: err?.requiredBC,
  });
}

// =======================================================
// ✅ Catalog
// =======================================================
router.get("/catalog", authMiddleware, async (req, res) => {
  try {
    return res.json({
      ok: true,
      gifts: ROMBUZZ_GIFT_CONFIG.filter((gift) => gift.enabled),
    });
  } catch (err) {
    return sendRouteError(res, err);
  }
});

// =======================================================
// ✅ Wallet snapshot
// =======================================================
router.get("/wallet", authMiddleware, async (req, res) => {
  try {
    const wallet = await getWalletSnapshot(getMe(req));
    return res.json({ ok: true, wallet });
  } catch (err) {
    return sendRouteError(res, err);
  }
});

// =======================================================
// ✅ Wallet ledger
// =======================================================
router.get("/ledger", authMiddleware, async (req, res) => {
  try {
    const rows = await listLedger({
      userId: getMe(req),
      limit: req.query.limit,
    });

    return res.json({ ok: true, ledger: rows });
  } catch (err) {
    return sendRouteError(res, err);
  }
});

// =======================================================
// ✅ DEV ONLY: credit test BuzzCoin balance
// Use only for local/dev testing before real App Store / Play
// purchase integration.
// =======================================================
router.post("/wallet/dev-credit", authMiddleware, async (req, res) => {
  try {
    if (isProduction() && !hasValidGiftTestSecret(req)) {
      return res.status(403).json({
        ok: false,
        error: "DEV_CREDIT_DISABLED",
        message: "Dev credit is disabled unless a valid admin test secret is provided.",
      });
    }

    const amountBC = Math.floor(Number(req.body?.amountBC) || 0);
    const reason = String(req.body?.reason || "Gift system test credit");

    const wallet = await creditBuzzCoins({
      userId: getMe(req),
      amountBC,
      type: "dev_credit",
      source: "dev",
      referenceId: shortid.generate(),
      reason,
      metadata: {
        route: "/api/gifts/wallet/dev-credit",
      },
    });

    return res.json({ ok: true, wallet });
  } catch (err) {
    return sendRouteError(res, err);
  }
});

// =======================================================
// ✅ Send gift
// =======================================================
router.post("/send", authMiddleware, async (req, res) => {
  try {
    const result = await sendGift({
      senderId: getMe(req),
      receiverId: req.body?.receiverId,
      giftId: req.body?.giftId,
      placement: req.body?.placement,
      targetType: req.body?.targetType,
      targetId: req.body?.targetId,
      appPlatform: req.body?.appPlatform || "",
      appVersion: req.body?.appVersion || "",
      metadata: req.body?.metadata || {},
    });

    return res.json(result);
  } catch (err) {
    return sendRouteError(res, err);
  }
});

// =======================================================
// ✅ Validate gift without sending
// Useful for frontend debugging.
// =======================================================
router.post("/validate", authMiddleware, async (req, res) => {
  try {
    const result = validateGiftPurchase({
      giftId: req.body?.giftId,
      placement: req.body?.placement,
    });

    return res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    return sendRouteError(res, err);
  }
});

// =======================================================
// ✅ Gift transactions
// role can be: all | sent | received
// =======================================================
router.get("/transactions", authMiddleware, async (req, res) => {
  try {
    const transactions = await listGiftTransactions({
      userId: getMe(req),
      role: req.query.role || "all",
      limit: req.query.limit,
    });

    return res.json({ ok: true, transactions });
  } catch (err) {
    return sendRouteError(res, err);
  }
});

// =======================================================
// ✅ Gift summaries
// Optional query: receiverId, targetType, targetId
// =======================================================
router.get("/summary", authMiddleware, async (req, res) => {
  try {
    const rows = await getGiftSummary({
      receiverId: req.query.receiverId,
      targetType: req.query.targetType,
      targetId: req.query.targetId,
    });

    return res.json({ ok: true, summary: rows });
  } catch (err) {
    return sendRouteError(res, err);
  }
});

// =======================================================
// ✅ Future withdrawal request
// IMPORTANT: this only creates a request. It does not pay money.
// =======================================================
router.post("/withdrawals/request", authMiddleware, async (req, res) => {
  try {
    const me = getMe(req);
    const amountBC = Math.floor(Number(req.body?.amountBC) || 0);

    if (amountBC <= 0) {
      return res.status(400).json({
        ok: false,
        error: "INVALID_AMOUNT",
        message: "amountBC must be greater than 0.",
      });
    }

    const user = await User.findOne({ id: me }).lean();
    const kycStatus =
      user?.kycStatus ||
      user?.verificationStatus ||
      user?.idVerificationStatus ||
      "unknown";

    const request = await GiftWithdrawalRequest.create({
      id: shortid.generate(),
      userId: me,
      amountBC,
      status: "pending_review",
      payoutMethod: String(req.body?.payoutMethod || ""),
      payoutAccountLast4: String(req.body?.payoutAccountLast4 || "").slice(-4),
      legalName: String(req.body?.legalName || ""),
      kycStatusAtRequest: String(kycStatus),
      metadata: {
        note:
          "Withdrawal is request-only. No payout is processed by this route.",
      },
    });

    return res.json({
      ok: true,
      request,
      warning:
        "Withdrawal request created for future review only. No money has been paid.",
    });
  } catch (err) {
    return sendRouteError(res, err);
  }
});

router.get("/withdrawals", authMiddleware, async (req, res) => {
  try {
    const rows = await GiftWithdrawalRequest.find({ userId: getMe(req) })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    return res.json({ ok: true, withdrawals: rows });
  } catch (err) {
    return sendRouteError(res, err);
  }
});

module.exports = router;
