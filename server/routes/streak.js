/**
 * ============================================================
 * 📁 File: routes/streak.js
 * 🔥 Purpose: Manage BuzzStreak (match streaks + daily check-ins)
 *
 * Endpoints:
 *   POST  /api/matchstreak/:toId   → Increment match-based BuzzStreak
 *   GET   /api/streak/get          → Retrieve user’s daily check-in streak
 *   POST  /api/streak/checkin      → Record today’s daily check-in
 *
 * Features:
 *   - Fully migrated to MongoDB
 *   - Tracks mutual buzz streaks between matched users
 *   - Tracks personal daily login streaks
 *   - Applies reward tiers (avatar glow, boost, badges, etc.)
 *   - Sends live notifications via global socket helpers
 *
 * Dependencies:
 *   - models/User.js
 *   - models/MatchStreak.js
 *   - models/DailyStreak.js
 *   - auth-middleware.js
 * ============================================================
 */

const express = require("express");
const router = express.Router();
const shortid = require("shortid");
const authMiddleware = require("../routes/auth-middleware");

const User = require("../models/User");
const MatchStreak = require("../models/MatchStreak");
const {
  getDailyBuzzStreak,
  checkInDailyBuzzStreak,
} = require("../services/buzzStreakDailyService");

/* ============================================================
   🔥 SECTION 1: MATCH-BASED BUZZSTREAK API (MongoDB)
============================================================ */
router.post("/matchstreak/:toId", authMiddleware, async (req, res) => {
  try {
    const fromId = req.user.id;
    const { toId } = req.params;

    if (fromId === toId) {
      return res.status(400).json({ error: "Cannot buzz yourself" });
    }

    // Ensure both users exist
    const [fromUser, toUser] = await Promise.all([
      User.findOne({ id: fromId }).lean(),
      User.findOne({ id: toId }).lean(),
    ]);
    if (!fromUser || !toUser)
      return res.status(404).json({ error: "User not found" });

    // Retrieve or create streak
    const key = `${fromId}_${toId}`;
    let streak = await MatchStreak.findOne({ key });

    if (!streak) {
      streak = await MatchStreak.create({
        id: shortid.generate(),
        key,
        from: fromId,
        to: toId,
        count: 0,
        lastBuzz: null,
        createdAt: Date.now(),
      });
    }

    streak.count += 1;
    streak.lastBuzz = Date.now();
    await streak.save();

    // 📨 Optional: Notification
    if (global.sendNotification) {
      await global.sendNotification(toId, {
        fromId,
        type: "buzzstreak",
        message: `🔥 ${streak.count} BuzzStreak from someone!`,
        href: `/viewprofile/${fromId}`,
      });
    }

    // --- BuzzStreak reward tiers ---
    const BUZZSTREAK_REWARDS = [
      { day: 1, reward: "🎉 Welcome back! Confetti" },
      { day: 3, reward: "✨ Avatar Glow for 24h" },
      { day: 7, reward: "⚡ 1-Day Discover Boost" },
      { day: 14, reward: "🏅 BuzzChampion Badge" },
      { day: 30, reward: "💖 LoyalHeart Title" },
      { day: 50, reward: "🌈 Premium Trial / Wingman Bonus" },
    ];

    // --- Helper: apply reward to user ---
    async function applyBuzzReward(userId, rewardObj) {
      const user = await User.findOne({ id: userId });
      if (!user) return;

      switch (rewardObj.day) {
        case 3:
          user.effects = user.effects || {};
          user.effects.avatarGlow = {
            active: true,
            expiresAt: Date.now() + 24 * 60 * 60 * 1000,
          };
          await user.save();
          if (global.sendNotification) {
            await global.sendNotification(userId, {
              type: "buzzreward",
              message: "✨ Avatar Glow unlocked for 24 hours!",
            });
          }
          break;

        case 7:
          user.boostActiveUntil = Date.now() + 24 * 60 * 60 * 1000;
          await user.save();
          if (global.sendNotification) {
            await global.sendNotification(userId, {
              type: "buzzreward",
              message: "⚡ Discover Boost activated for 1 day!",
            });
          }
          break;

        case 14:
          user.badges = Array.isArray(user.badges) ? user.badges : [];
          if (!user.badges.includes("BuzzChampion"))
            user.badges.push("BuzzChampion");
          await user.save();
          if (global.sendNotification) {
            await global.sendNotification(userId, {
              type: "buzzreward",
              message: "🏅 You earned the BuzzChampion badge!",
            });
          }
          break;

        case 30:
          user.title = "LoyalHeart";
          await user.save();
          if (global.sendNotification) {
            await global.sendNotification(userId, {
              type: "buzzreward",
              message: "💖 You’ve unlocked the LoyalHeart title!",
            });
          }
          break;

        case 50:
          user.premiumTrialUntil = Date.now() + 3 * 24 * 60 * 60 * 1000;
          user.premiumTier = "plus";
          await user.save();
          if (global.sendNotification) {
            await global.sendNotification(userId, {
              type: "buzzreward",
              message: "🌈 Premium trial activated for 3 days!",
            });
          }
          break;
      }
    }

    // --- Check for milestones ---
    const hitReward = BUZZSTREAK_REWARDS.find((r) => r.day === streak.count);
    if (hitReward) await applyBuzzReward(fromId, hitReward);

    const nextReward =
      BUZZSTREAK_REWARDS.find((r) => r.day > streak.count) || null;

    res.json({
      success: true,
      streak,
      nextReward,
      rewardJustUnlocked: hitReward || null,
    });
  } catch (err) {
    console.error("❌ /matchstreak error:", err);
    res.status(500).json({ error: "Failed to update match streak" });
  }
});

/* ============================================================
   📅 SECTION 2: DAILY CHECK-IN STREAK API (MongoDB)
============================================================ */

// ✅ GET /api/streak/get
router.get("/streak/get", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const payload = await getDailyBuzzStreak(userId);

    return res.json(payload);
  } catch (err) {
    console.error("❌ GET /streak/get error:", err);
    return res.status(500).json({ error: "Failed to get streak" });
  }
});

// ✅ POST /api/streak/checkin
router.post("/streak/checkin", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const payload = await checkInDailyBuzzStreak(userId);

    if (payload.rewarded) {
      console.log("🎉 BuzzStreak reward paid:", {
        userId,
        amountBC: payload.reward?.amountBC,
        streakDay: payload.reward?.streakDay,
      });
    } else {
      console.log("🔥 BuzzStreak check-in updated:", {
        userId,
        count: payload.streak?.count,
        alreadyCheckedIn: payload.alreadyCheckedIn,
      });
    }

    return res.json(payload);
  } catch (err) {
    console.error("❌ POST /streak/checkin error:", err);

    const statusCode = Number(err?.statusCode || 500);
    return res.status(statusCode).json({
      error: err?.message || "Failed to record check-in",
      code: err?.code || "STREAK_CHECKIN_FAILED",
    });
  }
});

console.log("✅ BuzzStreak (match + daily) routes initialized (MongoDB)");

module.exports = router;
