/**
 * ============================================================
 * 📁 File: models/ChatRoom.js
 * 💾 Purpose: Mongoose schema for chat rooms and embedded messages
 *
 * Description:
 *   Each ChatRoom document represents a conversation between two users.
 *   Messages are stored as embedded subdocuments inside `messages` array.
 *   This mirrors the previous LowDB structure exactly, enabling a clean
 *   migration without changing route logic or Socket.IO behavior.
 *
 * ============================================================
 */

const mongoose = require("mongoose");

const replyToSchema = new mongoose.Schema(
  {
    id: { type: String, default: "" },
    from: { type: String, default: "" },
    type: { type: String, default: "text" },
    text: { type: String, default: "" },
    url: { type: String, default: null },
    mediaType: { type: String, enum: ["image", "video", "audio", null], default: null },
    deleted: { type: Boolean, default: false },
  },
  { _id: false }
);

const messageSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, index: true },   // shortid-style
    from: { type: String, required: true },
    to: { type: String, required: true },
      text: { type: String, default: "" },

    // ✅ important: store media fields so realtime + refresh behave the same
    url: { type: String, default: null }, // cloudinary url for media
mediaType: { type: String, enum: ["image", "video", "audio", null], default: null },
    overlayText: { type: String, default: "" },

    type: { type: String, enum: ["text", "media", "meetup", "system_pin"], default: "text" },
    action: { type: String, enum: ["pin", "unpin", null], default: null },
    time: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now },

  edited: { type: Boolean, default: false },
deleted: { type: Boolean, default: false },

// ✅ system bubble marker (view-once removed notice etc.)
system: { type: Boolean, default: false },

reactions: { type: Map, of: String, default: {} },   // { userId: "❤️" }
hiddenFor: [{ type: String, default: [] }],

   ephemeral: {
  mode: { type: String, enum: ["none", "once", "twice"], default: "none" },
  viewsLeft: { type: Number, default: 0 }, // receiver views remaining
},
gift: {
  locked: { type: Boolean, default: false },

  // ✅ Backward-compatible legacy fields
  stickerId: { type: String, default: "sticker_basic" },
  amount: { type: Number, default: 0 },

  // ✅ Gifted media unlock price
  priceBC: { type: Number, default: 0 },
  currency: { type: String, default: "BC" },

  // ✅ Unlock ownership/payment tracking
  unlockedBy: [{ type: String, default: [] }], // userIds who unlocked (1:1 => receiver)
  unlockedAt: { type: Date, default: null },
  unlockTransactionId: { type: String, default: "" },
},
replyTo: { type: replyToSchema, default: null },
  pinned: { type: Boolean, default: false },
  pinnedAt: { type: Date, default: null },
  pinnedBy: { type: String, default: null },
  actorId: { type: String, default: null },
  actorName: { type: String, default: null },
  pinnedTargetId: { type: String, default: null },

  },
  { _id: false }
);

const chatRoomSchema = new mongoose.Schema(
  {
    roomId: { type: String, required: true, unique: true, index: true },
    participants: [{ type: String, required: true }],     // [a, b]

    // ✅ NEW: read state (per conversation, per user)
    // lastReadAtByUser.get(userId) => Date
    lastReadAtByUser: { type: Map, of: Date, default: {} },

    // ✅ Chat list controls per user
    // Example:
    // chatPrefsByUser.get(userId) => {
    //   pinned: true,
    //   muted: true,
    //   alertOnline: true,
    //   deletedForMe: true,
    //   forceUnread: true
    // }
    chatPrefsByUser: {
      type: Map,
      of: new mongoose.Schema(
        {
          pinned: { type: Boolean, default: false },
          muted: { type: Boolean, default: false },
          alertOnline: { type: Boolean, default: false },
          deletedForMe: { type: Boolean, default: false },
          forceUnread: { type: Boolean, default: false },
          updatedAt: { type: Date, default: Date.now },
        },
        { _id: false }
      ),
      default: {},
    },

    messages: [messageSchema],
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.ChatRoom || mongoose.model("ChatRoom", chatRoomSchema);
