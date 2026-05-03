/**
 * ============================================================
 * 📁 File: models/BuzzCoinWallet.js
 * 🪙 Purpose: Stores each user's BuzzCoin balance.
 *
 * Used by:
 *  - services/buzzCoinService.js
 *
 * Notes:
 *  - balanceBC is the spendable in-app BuzzCoin balance.
 *  - pendingBC is reserved for future payout/withdrawal workflows.
 *  - earnedBC is only for future receiver earning rules.
 * ============================================================
 */

const mongoose = require("mongoose");

const buzzCoinWalletSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true, index: true },

    balanceBC: { type: Number, default: 0, min: 0 },
    pendingBC: { type: Number, default: 0, min: 0 },
    earnedBC: { type: Number, default: 0, min: 0 },

    locked: { type: Boolean, default: false },
    lockReason: { type: String, default: "" },

    lastTransactionAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.BuzzCoinWallet ||
  mongoose.model("BuzzCoinWallet", buzzCoinWalletSchema);
