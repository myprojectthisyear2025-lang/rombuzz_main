/**
 * ============================================================================
 * 📁 File: services/accountDeletionService.js
 * 🎯 Purpose: Central account deletion lifecycle for RomBuzz.
 *
 * What this service does:
 * - Checks BuzzCoin wallet before account deletion.
 * - Starts irreversible account deletion with a 7-day backend email hold.
 * - Removes user-facing data immediately so the deleted user disappears.
 * - Scrubs the User document into a pending_delete hold record.
 * - Permanently wipes expired pending-delete accounts after the hold window.
 *
 * Delete policy:
 * - Delete means delete. No restore flow.
 * - User disappears from every normal frontend/user-facing area immediately.
 * - Same email is blocked for 7 days to prevent spam/recreate abuse.
 * - After 7 days, the old hold record is permanently wiped.
 * ============================================================================
 */

const HOLD_DAYS = 7;
const HOLD_MS = HOLD_DAYS * 24 * 60 * 60 * 1000;

const User = require("../models/User");
const PostModel = require("../models/PostModel");
const Notification = require("../models/Notification");
const Match = require("../models/Match");
const ChatRoom = require("../models/ChatRoom");
const Relationship = require("../models/Relationship");

const Message = require("../models/Message");
const BuzzCoinWallet = require("../models/BuzzCoinWallet");
const GiftTransaction = require("../models/GiftTransaction");
const BuzzCoinLedger = require("../models/BuzzCoinLedger");
const MeetMiddleSession = require("../models/MeetMiddleSession");
const VideoCallSession = require("../models/VideoCallSession");

function normalizeId(value) {
  return String(value || "").trim();
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function getHoldUntilDate(fromDate = new Date()) {
  return new Date(fromDate.getTime() + HOLD_MS);
}

function isPendingDeleteUser(user = {}) {
  const visibility = String(user?.visibility || "").trim().toLowerCase();
  const status = String(user?.deleteStatus || "").trim().toLowerCase();

  return visibility === "pending_delete" || status === "pending_delete";
}

function getWalletNumbers(wallet = {}) {
  const balanceBC = Number(wallet?.balanceBC || 0);
  const pendingBC = Number(wallet?.pendingBC || 0);
  const earnedBC = Number(wallet?.earnedBC || 0);
  const totalBC = balanceBC + pendingBC + earnedBC;

  return {
    balanceBC,
    pendingBC,
    earnedBC,
    totalBC,
    hasBalance: totalBC > 0,
  };
}

async function getDeleteAccountPreview(userId) {
  const uid = normalizeId(userId);
  if (!uid) {
    const err = new Error("Missing user id");
    err.statusCode = 401;
    err.code = "MISSING_USER_ID";
    throw err;
  }

  const user = await User.findOne({ id: uid }).lean();
  if (!user) {
    const err = new Error("User not found");
    err.statusCode = 404;
    err.code = "USER_NOT_FOUND";
    throw err;
  }

  const wallet = await BuzzCoinWallet.findOne({ userId: uid }).lean();
  const walletSummary = getWalletNumbers(wallet);

  return {
    userId: uid,
    email: normalizeEmail(user.email),
    holdDays: HOLD_DAYS,
    deleteAfter: getHoldUntilDate().toISOString(),
    wallet: walletSummary,
    requiresForfeitConfirmation: walletSummary.hasBalance,
  };
}

async function removeUserFacingDataNow(userId) {
  const uid = normalizeId(userId);
  if (!uid) return {};

  const results = {};

  const settled = await Promise.allSettled([
    PostModel.deleteMany({ userId: uid }),
    PostModel.updateMany(
      {},
      {
        $pull: {
          comments: {
            $or: [
              { userId: uid },
              { visibleTo: uid },
            ],
          },
        },
        $unset: {
          [`comments.$[].reactions.${uid}`]: "",
        },
      }
    ),
    Notification.deleteMany({
      $or: [{ toId: uid }, { fromId: uid }],
    }),
    Match.deleteMany({
      $or: [
        { user1: uid },
        { user2: uid },
        { users: uid },
      ],
    }),
    ChatRoom.deleteMany({
      $or: [
        { participants: uid },
        { "messages.from": uid },
        { "messages.to": uid },
      ],
    }),
    Message.deleteMany({
      $or: [{ from: uid }, { to: uid }],
    }),
    Relationship.deleteMany({
      $or: [{ from: uid }, { to: uid }],
    }),
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
    VideoCallSession.deleteMany({
      $or: [
        { callerId: uid },
        { receiverId: uid },
        { caller: uid },
        { receiver: uid },
        { participants: uid },
      ],
    }),
    BuzzCoinWallet.deleteOne({ userId: uid }),
    GiftTransaction.deleteMany({
      $or: [{ senderId: uid }, { receiverId: uid }],
    }),
    BuzzCoinLedger.deleteMany({ userId: uid }),
  ]);

  settled.forEach((item, index) => {
    results[`operation_${index}`] =
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

  return results;
}

function buildScrubbedPendingDeletePatch(user, now, deleteAfter) {
  const uid = normalizeId(user?.id);
  const email = normalizeEmail(user?.email);

  return {
    visibility: "pending_delete",
    deleteStatus: "pending_delete",
    deleteRequestedAt: now,
    deleteAfter,
    originalEmail: email,
    deactivatedAt: null,

    // Keep id + email during 7-day hold.
    // Keeping email blocks instant re-signup because User.email is unique.
    email,

    // Scrub account access.
    password: "",
    passwordHash: "",
    googleId: "",
    verificationCode: "",
    codeExpiresAt: null,
    pendingEmailChange: null,

    // Scrub profile identity.
    firstName: "",
    lastName: "",
    name: "Deleted User",
    bio: "",
    avatar: "",
    photos: [],
    media: [],
    reels: [],
    voiceUrl: "",
    city: "",
    country: "",
    hometown: "",
    latitude: null,
    longitude: null,
    location: null,

    // Scrub dating/profile fields.
    gender: "",
    dob: null,
    interestedIn: "",
    lookingFor: "",
    interests: [],
    hobbies: [],
    vibeTags: [],

    // Scrub device/session traces.
    pushTokens: [],
    expoPushToken: "",
    notificationTokens: [],

    // Make it impossible to treat as active/onboarded.
    profileComplete: false,
    hasOnboarded: false,
    isOnline: false,

    updatedAt: now,
  };
}

async function startAccountDeletion(userId, options = {}) {
  const uid = normalizeId(userId);
  const confirmForfeit = !!options.confirmForfeit;

  if (!uid) {
    const err = new Error("Unauthorized: missing user ID");
    err.statusCode = 401;
    err.code = "MISSING_USER_ID";
    throw err;
  }

  const user = await User.findOne({ id: uid });
  if (!user) {
    const err = new Error("User not found");
    err.statusCode = 404;
    err.code = "USER_NOT_FOUND";
    throw err;
  }

  if (isPendingDeleteUser(user)) {
    return {
      success: true,
      alreadyPendingDelete: true,
      deleteAfter: user.deleteAfter || null,
      message: "Account is already scheduled for permanent deletion.",
    };
  }

  const wallet = await BuzzCoinWallet.findOne({ userId: uid }).lean();
  const walletSummary = getWalletNumbers(wallet);

  if (walletSummary.hasBalance && !confirmForfeit) {
    const err = new Error(
      "BuzzCoin forfeiture confirmation is required before deleting this account."
    );
    err.statusCode = 409;
    err.code = "BUZZCOIN_FORFEIT_CONFIRMATION_REQUIRED";
    err.wallet = walletSummary;
    err.holdDays = HOLD_DAYS;
    throw err;
  }

  const now = new Date();
  const deleteAfter = getHoldUntilDate(now);
  const emailLower = normalizeEmail(user.email);

  const cleanup = await removeUserFacingDataNow(uid);

  const scrubPatch = buildScrubbedPendingDeletePatch(user, now, deleteAfter);

  await User.updateOne(
    { id: uid },
    {
      $set: scrubPatch,
    }
  );

  console.log(
    `🗑️ Account scheduled for permanent deletion: ${uid} (${emailLower}) after ${deleteAfter.toISOString()}`
  );

  return {
    success: true,
    pendingDelete: true,
    holdDays: HOLD_DAYS,
    deleteAfter: deleteAfter.toISOString(),
    message:
      "Account deleted from RomBuzz. Email is held for 7 days before final wipe.",
    walletForfeited: walletSummary,
    cleanup,
  };
}

async function permanentlyWipeDeletedUser(userId) {
  const uid = normalizeId(userId);
  if (!uid) return { success: false, error: "Missing user id" };

  const cleanup = await removeUserFacingDataNow(uid);
  await User.deleteOne({ id: uid });

  console.log(`🔥 Permanently wiped pending-delete account: ${uid}`);

  return {
    success: true,
    userId: uid,
    cleanup,
  };
}

async function permanentlyWipeExpiredDeletedAccounts() {
  const now = new Date();

  const expiredUsers = await User.find({
    visibility: "pending_delete",
    deleteAfter: { $lte: now },
  })
    .select("id email deleteAfter")
    .lean();

  if (!expiredUsers.length) {
    return {
      success: true,
      count: 0,
      wiped: [],
    };
  }

  const wiped = [];

  for (const user of expiredUsers) {
    try {
      const result = await permanentlyWipeDeletedUser(user.id);
      wiped.push({
        userId: user.id,
        email: user.email || "",
        ok: true,
        result,
      });
    } catch (err) {
      console.error(
        `❌ Failed permanent wipe for pending-delete user ${user.id}:`,
        err
      );

      wiped.push({
        userId: user.id,
        email: user.email || "",
        ok: false,
        error: err?.message || String(err),
      });
    }
  }

  return {
    success: true,
    count: wiped.length,
    wiped,
  };
}

function startPendingDeletionCleanupJob() {
  const run = async () => {
    try {
      const result = await permanentlyWipeExpiredDeletedAccounts();
      if (result.count > 0) {
        console.log(
          `🧹 Pending-delete cleanup wiped ${result.count} expired account(s).`
        );
      }
    } catch (err) {
      console.error("❌ Pending-delete cleanup job failed:", err);
    }
  };

  // Run once shortly after boot so Render deploys can clean expired holds.
  setTimeout(run, 15 * 1000);

  // Run every 6 hours while server is awake.
  const interval = setInterval(run, 6 * 60 * 60 * 1000);

  if (typeof interval.unref === "function") {
    interval.unref();
  }

  return interval;
}

module.exports = {
  HOLD_DAYS,
  getDeleteAccountPreview,
  startAccountDeletion,
  permanentlyWipeDeletedUser,
  permanentlyWipeExpiredDeletedAccounts,
  startPendingDeletionCleanupJob,
  isPendingDeleteUser,
};