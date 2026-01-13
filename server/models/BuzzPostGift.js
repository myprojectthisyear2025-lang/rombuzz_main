/**
 * ============================================================
 * 📁 File: models/BuzzPostGift.js
 * 💾 Purpose: Gifts for LetsBuzz posts/reels (matched feed items)
 * ============================================================
 */

const mongoose = require("mongoose");

const buzzPostGiftSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true },

    postId: { type: String, required: true, index: true },     // PostModel.id
    ownerId: { type: String, required: true, index: true },    // PostModel.userId
    fromId: { type: String, required: true, index: true },     // gifter userId

    giftKey: { type: String, required: true },                 // e.g. "rose", "heart"
    amount: { type: Number, default: 1 },

    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

buzzPostGiftSchema.index({ postId: 1, ownerId: 1, fromId: 1, giftKey: 1 });

module.exports =
  mongoose.models.BuzzPostGift ||
  mongoose.model("BuzzPostGift", buzzPostGiftSchema);
