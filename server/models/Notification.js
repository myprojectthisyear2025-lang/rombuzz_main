/**
 * ============================================================
 * 📁 File: models/Notification.js
 * 💾 Purpose: Mongoose schema for user notifications
 *
 * Description:
 *   Stores all system, match, buzz, like, and AI Wingman alerts.
 *   Fully mirrors the old LowDB structure for a seamless migration.
 *
 * Used in:
 *   - routes/notifications.js
 *   - utils/helpers.js → sendNotification()
 * ============================================================
 */

const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true }, // shortid-compatible
    toId: { type: String, required: true, index: true }, // recipient user
    fromId: { type: String, default: "" }, // sender (userId or "system")
    type: {
      type: String,
          enum: [
         "wingman",
         "match",
         "buzz",
         "like",   // legacy (will be phased out)
         "gift",   // ✅ new
         "comment",
         "reaction",
         "new_post",
         "share",
         "system",
       ],

      default: "system",
    },
     message: { type: String, required: true },
    href: { type: String, default: "" },

     // Legacy routing fields
    postId: { type: String, default: "" },
    postOwnerId: { type: String, default: "" },
    entity: { type: String, default: "" },
    entityId: { type: String, default: "" },

    // ✅ Premium Buzz / source metadata
    // Used by paid Buzz so notification page can show it as a Buzz,
    // while still knowing it came from the premium Buzz system.
    via: { type: String, default: "" }, // premium_buzz | discover_like | etc.
    buzzType: { type: String, default: "" }, // cupid | midnight | rain | soul | etc.
    transactionId: { type: String, default: "" },
    priceBC: { type: Number, default: 0 },
    streak: { type: Number, default: 0 },

    // Exact notification routing fields
    // Used for comment/reply/gift/navigation:
    // - owner opens own profile/gallery/insights flow
    // - non-owner opens LetsBuzz/detail flow
    targetType: { type: String, default: "" }, // buzz_post | gallery_media | reel | post
    targetId: { type: String, default: "" }, // post id / media id / reel id
    targetOwnerId: { type: String, default: "" }, // owner of the target content
    commentId: { type: String, default: "" }, // top-level private thread/comment id
    replyId: { type: String, default: "" }, // exact reply id when notification is for reply
    routeContext: { type: String, default: "" }, // private_comment | private_reply | gift | reaction

    read: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.Notification || mongoose.model("Notification", notificationSchema);
