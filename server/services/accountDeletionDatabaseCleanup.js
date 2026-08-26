/**
 * ============================================================
 * 📁 File: services/accountDeletionDatabaseCleanup.js
 * 🎯 Purpose: Remove user-facing MongoDB data for deleted accounts.
 * Used for:
 *  - Deleting feature records that should disappear immediately
 *  - Removing deleted-user references from active MongoDB documents
 *  - Pseudonymizing retained BuzzCoin/gift audit records
 * ============================================================
 */

const crypto = require("crypto");

const UserModels = {
  User: require("../models/User"),
  PostModel: require("../models/PostModel"),
  Notification: require("../models/Notification"),
  Match: require("../models/Match"),
  ChatRoom: require("../models/ChatRoom"),
  Message: require("../models/Message"),
  Relationship: require("../models/Relationship"),
  Block: require("../models/Block"),
  StoryModel: require("../models/StoryModel"),
  MicroBuzzBuzz: require("../models/MicroBuzzBuzz"),
  MicroBuzzIgnore: require("../models/MicroBuzzIgnore"),
  MicroBuzzPresence: require("../models/MicroBuzzPresence"),
  DailyStreak: require("../models/DailyStreak"),
  MatchStreak: require("../models/MatchStreak"),
  MediaThread: require("../models/MediaThread"),
  PrivateNote: require("../models/PrivateNote"),
  MeetMiddleSession: require("../models/MeetMiddleSession"),
  VideoCallSession: require("../models/VideoCallSession"),
  BuzzCoinWallet: require("../models/BuzzCoinWallet"),
  PasswordReset: require("../models/PasswordReset"),
};

const AuditModels = {
  GiftTransaction: require("../models/GiftTransaction"),
  BuzzCoinLedger: require("../models/BuzzCoinLedger"),
  GiftSummary: require("../models/GiftSummary"),
  MediaGift: require("../models/MediaGift"),
  BuzzPostGift: require("../models/BuzzPostGift"),
  VideoCallGiftRequest: require("../models/VideoCallGiftRequest"),
};

function normalizeId(value) {
  return String(value || "").trim();
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function getDeletedActorId(userId) {
  const digest = crypto
    .createHash("sha256")
    .update(`rombuzz-deleted:${normalizeId(userId)}`)
    .digest("hex")
    .slice(0, 24);

  return `deleted_${digest}`;
}

async function removeDatabaseUserDataNow(userId, options = {}) {
  const uid = normalizeId(userId);
  const email = normalizeEmail(options.email);
  const deletedId = getDeletedActorId(uid);

  const {
    User,
    PostModel,
    Notification,
    Match,
    ChatRoom,
    Message,
    Relationship,
    Block,
    StoryModel,
    MicroBuzzBuzz,
    MicroBuzzIgnore,
    MicroBuzzPresence,
    DailyStreak,
    MatchStreak,
    MediaThread,
    PrivateNote,
    MeetMiddleSession,
    VideoCallSession,
    BuzzCoinWallet,
    PasswordReset,
  } = UserModels;

  const {
    GiftTransaction,
    BuzzCoinLedger,
    GiftSummary,
    MediaGift,
    BuzzPostGift,
    VideoCallGiftRequest,
  } = AuditModels;

  const ops = [
    ["posts", PostModel.deleteMany({ userId: uid })],

    // Remove the deleted user's engagement from other users' posts.
    [
      "post_array_refs",
      PostModel.updateMany(
        { userId: { $ne: uid } },
        {
          $pull: {
            comments: { userId: uid },
            likes: { userId: uid },
            bookmarks: uid,
            shares: {
              $or: [
                { userId: uid },
                { sharedBy: uid },
              ],
            },
            sharedWith: uid,
          },
        }
      ),
    ],

    // Reaction maps store user IDs as dynamic keys.
    [
      "post_reaction_refs",
      PostModel.updateMany(
        { userId: { $ne: uid } },
        {
          $unset: {
            [`reactions.${uid}`]: "",
            [`comments.$[].reactions.${uid}`]: "",
          },
        }
      ),
    ],

    [
      "notifications",
      Notification.deleteMany({
        $or: [
          { toId: uid },
          { fromId: uid },
        ],
      }),
    ],

    [
      "matches",
      Match.deleteMany({
        $or: [
          { user1: uid },
          { user2: uid },
          { users: uid },
        ],
      }),
    ],

    [
      "chat_rooms",
      ChatRoom.deleteMany({
        $or: [
          { participants: uid },
          { "messages.from": uid },
          { "messages.to": uid },
        ],
      }),
    ],

    [
      "messages",
      Message.deleteMany({
        $or: [
          { from: uid },
          { to: uid },
        ],
      }),
    ],

    [
      "relationships",
      Relationship.deleteMany({
        $or: [
          { from: uid },
          { to: uid },
        ],
      }),
    ],

    [
      "blocks",
      Block.deleteMany({
        $or: [
          { blocker: uid },
          { blocked: uid },
        ],
      }),
    ],

    [
      "user_block_refs",
      User.updateMany(
        { blockedUsers: uid },
        {
          $pull: {
            blockedUsers: uid,
          },
        }
      ),
    ],

    ["stories", StoryModel.deleteMany({ userId: uid })],

    [
      "story_view_refs",
      StoryModel.updateMany(
        {
          userId: { $ne: uid },
          views: uid,
        },
        {
          $pull: {
            views: uid,
          },
        }
      ),
    ],

    [
      "microbuzz_buzz",
      MicroBuzzBuzz.deleteMany({
        $or: [
          { fromId: uid },
          { toId: uid },
        ],
      }),
    ],

    [
      "microbuzz_ignore",
      MicroBuzzIgnore.deleteMany({
        $or: [
          { byId: uid },
          { fromId: uid },
        ],
      }),
    ],

    [
      "microbuzz_presence",
      MicroBuzzPresence.deleteOne({ userId: uid }),
    ],

    ["daily_streak", DailyStreak.deleteMany({ userId: uid })],

    [
      "match_streak",
      MatchStreak.deleteMany({
        $or: [
          { from: uid },
          { to: uid },
        ],
      }),
    ],

    [
      "media_threads",
      MediaThread.deleteMany({
        $or: [
          { ownerId: uid },
          { peerId: uid },
          { "messages.userId": uid },
        ],
      }),
    ],

    ["private_notes", PrivateNote.deleteMany({ userId: uid })],

    [
      "meet_middle",
      MeetMiddleSession.deleteMany({
        $or: [
          { users: uid },
          { requestedBy: uid },
          { peerId: uid },
          { selectedBy: uid },
          { confirmedBy: uid },
          { cancelledBy: uid },
          { completedBy: uid },
        ],
      }),
    ],

    [
      "video_calls",
      VideoCallSession.deleteMany({
        $or: [
          { callerId: uid },
          { receiverId: uid },
          { caller: uid },
          { receiver: uid },
          { participants: uid },
        ],
      }),
    ],

    ["wallet", BuzzCoinWallet.deleteOne({ userId: uid })],

    [
      "password_reset",
      email
        ? PasswordReset.deleteMany({ email })
        : Promise.resolve({ deletedCount: 0 }),
    ],

    // Retain financial/audit history while removing the live account ID.
    [
      "gift_tx_sender",
      GiftTransaction.updateMany(
        { senderId: uid },
        { $set: { senderId: deletedId } }
      ),
    ],

    [
      "gift_tx_receiver",
      GiftTransaction.updateMany(
        { receiverId: uid },
        { $set: { receiverId: deletedId } }
      ),
    ],

    [
      "ledger",
      BuzzCoinLedger.updateMany(
        { userId: uid },
        { $set: { userId: deletedId } }
      ),
    ],

    [
      "gift_summary_owner",
      GiftSummary.deleteMany({ receiverId: uid }),
    ],

    [
      "gift_summary_sender",
      GiftSummary.updateMany(
        { latestSenderId: uid },
        { $set: { latestSenderId: deletedId } }
      ),
    ],

    [
      "media_gift_owner",
      MediaGift.updateMany(
        { ownerId: uid },
        { $set: { ownerId: deletedId } }
      ),
    ],

    [
      "media_gift_from",
      MediaGift.updateMany(
        { fromId: uid },
        { $set: { fromId: deletedId } }
      ),
    ],

    [
      "media_gift_buyer",
      MediaGift.updateMany(
        { buyerId: uid },
        { $set: { buyerId: deletedId } }
      ),
    ],

    [
      "media_gift_seller",
      MediaGift.updateMany(
        { sellerId: uid },
        { $set: { sellerId: deletedId } }
      ),
    ],

    [
      "post_gift_owner",
      BuzzPostGift.updateMany(
        { ownerId: uid },
        { $set: { ownerId: deletedId } }
      ),
    ],

    [
      "post_gift_from",
      BuzzPostGift.updateMany(
        { fromId: uid },
        { $set: { fromId: deletedId } }
      ),
    ],

    [
      "call_gift_requester",
      VideoCallGiftRequest.updateMany(
        { requesterId: uid },
        { $set: { requesterId: deletedId } }
      ),
    ],

    [
      "call_gift_receiver",
      VideoCallGiftRequest.updateMany(
        { receiverId: uid },
        { $set: { receiverId: deletedId } }
      ),
    ],

    [
      "call_gift_responder",
      VideoCallGiftRequest.updateMany(
        { respondedBy: uid },
        { $set: { respondedBy: deletedId } }
      ),
    ],
  ];

  const settled = await Promise.allSettled(
    ops.map(([, task]) => task)
  );

  const results = {};

  settled.forEach((item, index) => {
    const name = ops[index][0];

    results[name] =
      item.status === "fulfilled"
        ? {
            ok: true,
            deletedCount: item.value?.deletedCount,
            modifiedCount: item.value?.modifiedCount,
          }
        : {
            ok: false,
            error: item.reason?.message || String(item.reason),
          };
  });

  const failedCount = Object.values(results).filter(
    (item) => !item.ok
  ).length;

  return {
    operations: results,
    failedCount,
    hasFailures: failedCount > 0,
  };
}

module.exports = {
  removeDatabaseUserDataNow,
};