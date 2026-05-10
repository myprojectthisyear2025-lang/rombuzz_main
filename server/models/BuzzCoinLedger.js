/**
 * ============================================================
 * 📁 File: models/BuzzCoinLedger.js
 * 🧾 Purpose: Immutable-ish BuzzCoin ledger entries.
 *
 * Used by:
 *  - services/buzzCoinService.js
 *
 * Notes:
 *  - Always create a ledger row when balance changes.
 *  - Do not delete ledger rows in production.
 * ============================================================
 */

const mongoose = require("mongoose");

const buzzCoinLedgerSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true },

    userId: { type: String, required: true, index: true },

     type: {
      type: String,
      required: true,
      enum: [
        "credit",
        "debit",
        "refund",
        "gift_send",
        "gift_receive",
        "premium_buzz_send",
        "withdrawal_request",
        "withdrawal_cancel",
        "admin_adjustment",
        "dev_credit",
      ],
      index: true,
    },

    amountBC: { type: Number, required: true },
    balanceAfterBC: { type: Number, required: true, min: 0 },

    source: { type: String, default: "" },
    referenceId: { type: String, default: "", index: true },
    reason: { type: String, default: "" },

    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

buzzCoinLedgerSchema.index({ userId: 1, createdAt: -1 });

module.exports =
  mongoose.models.BuzzCoinLedger ||
  mongoose.model("BuzzCoinLedger", buzzCoinLedgerSchema);
