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
const BuzzCoinWallet = require("../models/BuzzCoinWallet");

const {
  removeDatabaseUserDataNow,
} = require("./accountDeletionDatabaseCleanup");
const {
  buildStorageRetryManifest,
  deleteExternalStorageNow,
} = require("./accountDeletionStorageCleanup");

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

async function removeUserFacingDataNow(userId, options = {}) {
  const uid = normalizeId(userId);
  if (!uid) return {};

  const storage = await deleteExternalStorageNow(uid);
  const database = await removeDatabaseUserDataNow(uid, options);

  const failedCount =
    Number(storage?.failedCount || 0) +
    Number(database?.failedCount || 0);

  return {
    storage,
    database,
    failedCount,
    hasFailures: failedCount > 0,
  };
}

function buildScrubbedPendingDeletePatch(
  user,
  now,
  deleteAfter,
  cleanup = {}
) {
  const email = normalizeEmail(user?.email);

  return {
    // Account deletion lifecycle.
    visibility: "pending_delete",
    deleteStatus: "pending_delete",
    deleteRequestedAt: now,
    deleteAfter,
    originalEmail: email,
    deactivatedAt: now,

    // Keep email only during the 7-day anti-abuse hold.
    email,

    // Authentication identities.
    passwordHash: "",
    googleId: "",
    appleId: "",
    verificationCode: "",
    codeExpiresAt: null,

    // Profile identity.
    firstName: "",
    lastName: "",
    bio: "",
    avatar: "",
    photos: [],

    // Keep ONLY failed external-storage references here so the
    // six-hour cleanup worker can retry them.
    media: buildStorageRetryManifest(cleanup?.storage),

    voiceUrl: "",

    // Location.
    city: "",
    country: "",
    hometown: "",
    latitude: null,
    longitude: null,
    location: null,
    distanceVisibility: "",
    travelMode: false,

    // Identity / dating profile.
    gender: "",
    genderVisibility: "",
    pronouns: "",
    orientation: "",
    orientationVisibility: "",
    dob: "",
    lookingFor: "",
    relationshipStyle: "",
    interestedIn: [],

    // Body / lifestyle.
    height: "",
    bodyType: "",
    fitnessLevel: "",
    smoking: "",
    drinking: "",
    workoutFrequency: "",
    diet: "",
    sleepSchedule: "",

    // Background / beliefs.
    educationLevel: "",
    school: "",
    jobTitle: "",
    company: "",
    languages: [],
    religion: "",
    politicalViews: "",
    zodiac: "",

    // Interests.
    interests: [],
    hobbies: [],
    favoriteMusic: [],
    favoriteMovies: [],
    travelStyle: "",
    petsPreference: "",
    vibeTags: [],

    // Legacy profile fields.
    likes: "",
    dislikes: "",
    favorites: [],

    // Preferences / visibility.
    visibilityMode: "",
    fieldVisibility: {},
    preferences: {},
    settings: {},
    matchPref: {},
    locationRadius: 0,
    ageRange: {},
    blockedUsers: [],

    // Device/session traces.
    pushTokens: [],
    lastActive: null,

    // Profile activity.
    profileViews: {
      total: 0,
      today: 0,
      lastViewDate: "",
    },

    // Account state.
    profileComplete: false,
    hasOnboarded: false,
    premiumTier: "free",
    isPremium: false,
    isVerified: false,

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

  const cleanup = await removeUserFacingDataNow(uid, {
    email: emailLower,
  });

  const scrubPatch = buildScrubbedPendingDeletePatch(
    user,
    now,
    deleteAfter,
    cleanup
  );

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
    cleanupPending: !!cleanup?.hasFailures,
    cleanup,
  };
}
async function retryPendingDeletionCleanupBeforeExpiry() {
  const now = new Date();

  const pendingUsers = await User.find({
    $and: [
      {
        $or: [
          { visibility: "pending_delete" },
          { deleteStatus: "pending_delete" },
        ],
      },
      {
        $or: [
          { deleteAfter: { $gt: now } },
          { deleteAfter: null },
        ],
      },
    ],
  })
    .select("id email")
    .lean();

  let retried = 0;
  let failed = 0;

  for (const user of pendingUsers) {
    const cleanup = await removeUserFacingDataNow(user.id, {
      email: normalizeEmail(user.email),
    });

    await User.updateOne(
      { id: user.id },
      {
        $set: {
          media: buildStorageRetryManifest(cleanup?.storage),
        },
      }
    );

    retried += 1;

    if (cleanup?.hasFailures) {
      failed += 1;
    }
  }

  return {
    retried,
    failed,
  };
}
async function permanentlyWipeDeletedUser(userId) {
  const uid = normalizeId(userId);
  if (!uid) return { success: false, error: "Missing user id" };

  const user = await User.findOne({ id: uid })
    .select("id email media")
    .lean();

  if (!user) {
    return {
      success: true,
      alreadyMissing: true,
      userId: uid,
    };
  }

  const cleanup = await removeUserFacingDataNow(uid, {
    email: normalizeEmail(user.email),
  });

  if (cleanup?.hasFailures) {
    await User.updateOne(
      { id: uid },
      {
        $set: {
          media: buildStorageRetryManifest(cleanup?.storage),
        },
      }
    );

    console.warn(
      `⚠️ Permanent wipe postponed for ${uid}; cleanup still has failures.`
    );

    return {
      success: false,
      pendingCleanup: true,
      userId: uid,
      cleanup,
    };
  }

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
    $or: [
      { visibility: "pending_delete" },
      { deleteStatus: "pending_delete" },
    ],
    deleteAfter: { $lte: now },
  })
    .select("id email deleteAfter")
    .lean();

  if (!expiredUsers.length) {
    return {
      success: true,
      count: 0,
      attempted: 0,
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
        ok: !!result?.success,
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

  const count = wiped.filter((item) => item.ok).length;

  return {
    success: wiped.every((item) => item.ok),
    count,
    attempted: wiped.length,
    wiped,
  };
}

function startPendingDeletionCleanupJob() {
  const run = async () => {
    try {
      const retry = await retryPendingDeletionCleanupBeforeExpiry();
      const result = await permanentlyWipeExpiredDeletedAccounts();

      if (retry.failed > 0) {
        console.warn(
          `⚠️ Pending-delete cleanup still has ${retry.failed} account(s) with retryable failures.`
        );
      }

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