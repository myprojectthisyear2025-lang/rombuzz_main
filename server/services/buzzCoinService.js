/**
 * ============================================================
 * 📁 File: services/buzzCoinService.js
 * 🪙 Purpose: Central BuzzCoin wallet + ledger service.
 *
 * Used by:
 *  - services/giftService.js
 *  - routes/gifts.js
 *
 * Rules:
 *  - Never let routes directly mutate wallet balances.
 *  - Always write a ledger entry when balance changes.
 *  - This is app-currency accounting, not real-money payout logic.
 * ============================================================
 */

const shortid = require("shortid");

const BuzzCoinWallet = require("../models/BuzzCoinWallet");
const BuzzCoinLedger = require("../models/BuzzCoinLedger");

async function getOrCreateWallet(userId) {
  const id = String(userId);

  let wallet = await BuzzCoinWallet.findOne({ userId: id });
  if (!wallet) {
    wallet = await BuzzCoinWallet.create({
      userId: id,
      balanceBC: 0,
      pendingBC: 0,
      earnedBC: 0,
      lastTransactionAt: null,
    });
  }

  return wallet;
}

async function getWalletSnapshot(userId) {
  const wallet = await getOrCreateWallet(userId);

  return {
    userId: String(wallet.userId),
    balanceBC: Number(wallet.balanceBC) || 0,
    pendingBC: Number(wallet.pendingBC) || 0,
    earnedBC: Number(wallet.earnedBC) || 0,
    locked: Boolean(wallet.locked),
    lockReason: wallet.lockReason || "",
    updatedAt: wallet.updatedAt,
  };
}

async function addLedgerEntry({
  userId,
  type,
  amountBC,
  balanceAfterBC,
  source = "",
  referenceId = "",
  reason = "",
  metadata = {},
}) {
  return BuzzCoinLedger.create({
    id: shortid.generate(),
    userId: String(userId),
    type,
    amountBC: Number(amountBC) || 0,
    balanceAfterBC: Number(balanceAfterBC) || 0,
    source,
    referenceId,
    reason,
    metadata,
  });
}

function normalizeCreditBucket(bucket) {
  const safe = String(bucket || "balance").trim().toLowerCase();

  if (safe === "earned" || safe === "creator" || safe === "creator_earnings") {
    return "earned";
  }

  if (safe === "pending" || safe === "payout_pending") {
    return "pending";
  }

  return "balance";
}

async function creditBuzzCoins({
  userId,
  amountBC,
  type = "credit",
  source = "",
  referenceId = "",
  reason = "",
  metadata = {},
  walletBucket = "balance",
}) {
  const amount = Math.floor(Number(amountBC) || 0);
  if (amount <= 0) {
    throw Object.assign(new Error("amountBC must be greater than 0"), {
      statusCode: 400,
      code: "INVALID_AMOUNT",
    });
  }

  const wallet = await getOrCreateWallet(userId);

   if (wallet.locked) {
    throw Object.assign(new Error(wallet.lockReason || "Wallet is locked"), {
      statusCode: 403,
      code: "WALLET_LOCKED",
    });
  }

  const bucket = normalizeCreditBucket(walletBucket);

  if (bucket === "earned") {
    wallet.earnedBC = (Number(wallet.earnedBC) || 0) + amount;
  } else if (bucket === "pending") {
    wallet.pendingBC = (Number(wallet.pendingBC) || 0) + amount;
  } else {
    wallet.balanceBC = (Number(wallet.balanceBC) || 0) + amount;
  }

  wallet.lastTransactionAt = new Date();
  await wallet.save();

  const balanceAfterBC =
    bucket === "earned"
      ? wallet.earnedBC
      : bucket === "pending"
      ? wallet.pendingBC
      : wallet.balanceBC;

  await addLedgerEntry({
    userId,
    type,
    amountBC: amount,
    balanceAfterBC,
    source,
    referenceId,
    reason,
    metadata: {
      ...metadata,
      walletBucket: bucket,
    },
  });

  return getWalletSnapshot(userId);
}

async function debitBuzzCoins({
  userId,
  amountBC,
  type = "debit",
  source = "",
  referenceId = "",
  reason = "",
  metadata = {},
}) {
  const amount = Math.floor(Number(amountBC) || 0);
  if (amount <= 0) {
    throw Object.assign(new Error("amountBC must be greater than 0"), {
      statusCode: 400,
      code: "INVALID_AMOUNT",
    });
  }

  const wallet = await getOrCreateWallet(userId);

  if (wallet.locked) {
    throw Object.assign(new Error(wallet.lockReason || "Wallet is locked"), {
      statusCode: 403,
      code: "WALLET_LOCKED",
    });
  }

  const currentBalance = Number(wallet.balanceBC) || 0;
  if (currentBalance < amount) {
    throw Object.assign(new Error("Insufficient BuzzCoin balance"), {
      statusCode: 402,
      code: "INSUFFICIENT_BUZZCOIN",
      balanceBC: currentBalance,
      requiredBC: amount,
    });
  }

  wallet.balanceBC = currentBalance - amount;
  wallet.lastTransactionAt = new Date();
  await wallet.save();

  await addLedgerEntry({
    userId,
    type,
    amountBC: -amount,
    balanceAfterBC: wallet.balanceBC,
    source,
    referenceId,
    reason,
    metadata,
  });

  return getWalletSnapshot(userId);
}

async function listLedger({ userId, limit = 50 }) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);

  return BuzzCoinLedger.find({ userId: String(userId) })
    .sort({ createdAt: -1 })
    .limit(safeLimit)
    .lean();
}

module.exports = {
  getOrCreateWallet,
  getWalletSnapshot,
  creditBuzzCoins,
  debitBuzzCoins,
  listLedger,
};
