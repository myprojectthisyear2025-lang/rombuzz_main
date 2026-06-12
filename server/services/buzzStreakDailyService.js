/**
 * ============================================================
 * 📁 File: services/buzzStreakDailyService.js
 * 🔥 Purpose: Daily BuzzStreak check-in logic + weekly BuzzCoin reward
 *
 * Rules:
 *  - One check-in per UTC day
 *  - Consecutive daily check-ins increase streak
 *  - Missing any day resets streak to Day 1 on next check-in
 *  - Every 7th consecutive day rewards 100 BC to spendable balance
 * ============================================================
 */

const shortid = require("shortid");

const DailyStreak = require("../models/DailyStreak");
const {
  creditBuzzCoins,
  getWalletSnapshot,
} = require("../services/buzzCoinService");

const REWARD_EVERY_DAYS = 7;
const WEEKLY_REWARD_BC = 100;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function getTodayKey(date = new Date()) {
  return date.toISOString().split("T")[0];
}

function getUtcDayMs(dateKey = "") {
  const parsed = Date.parse(`${dateKey}T00:00:00.000Z`);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getDayDiff(fromDateKey = "", toDateKey = "") {
  const fromMs = getUtcDayMs(fromDateKey);
  const toMs = getUtcDayMs(toDateKey);

  if (!fromMs || !toMs) return null;

  return Math.round((toMs - fromMs) / ONE_DAY_MS);
}

function getNextRewardInDays(count = 0) {
  const safeCount = Math.max(0, Number(count || 0));
  const remainder = safeCount % REWARD_EVERY_DAYS;

  if (safeCount > 0 && remainder === 0) {
    return REWARD_EVERY_DAYS;
  }

  return REWARD_EVERY_DAYS - remainder;
}

function normalizeStreakForResponse(streak = {}) {
  const count = Number(streak.count || 0);

  return {
    id: streak.id || "",
    userId: streak.userId || "",
    count,
    lastCheckIn: streak.lastCheckIn || null,
    rewardEveryDays: REWARD_EVERY_DAYS,
    rewardAmountBC: WEEKLY_REWARD_BC,
    nextRewardInDays: getNextRewardInDays(count),
  };
}

async function getDailyBuzzStreak(userId) {
  const today = getTodayKey();

  let streak = await DailyStreak.findOne({ userId: String(userId) });

  if (!streak) {
    streak = await DailyStreak.create({
      id: shortid.generate(),
      userId: String(userId),
      count: 0,
      lastCheckIn: null,
    });
  }

  const lastCheckIn = streak.lastCheckIn || null;
  const checkedToday = lastCheckIn === today;
  const dayDiff = lastCheckIn ? getDayDiff(lastCheckIn, today) : null;

  // If user missed a day, show Day 0 before they check in again.
  if (dayDiff !== null && dayDiff > 1 && Number(streak.count || 0) !== 0) {
    streak.count = 0;
    await streak.save();
  }

  const wallet = await getWalletSnapshot(userId);

  return {
    success: true,
    streak: normalizeStreakForResponse(streak),
    checkedToday,
    missed: dayDiff !== null && dayDiff > 1,
    rewarded: false,
    reward: null,
    wallet,
  };
}

async function checkInDailyBuzzStreak(userId) {
  const now = new Date();
  const today = getTodayKey(now);

  let streak = await DailyStreak.findOne({ userId: String(userId) });

  if (!streak) {
    streak = await DailyStreak.create({
      id: shortid.generate(),
      userId: String(userId),
      count: 0,
      lastCheckIn: null,
    });
  }

  if (streak.lastCheckIn === today) {
    const wallet = await getWalletSnapshot(userId);

    return {
      success: true,
      streak: normalizeStreakForResponse(streak),
      checkedToday: true,
      alreadyCheckedIn: true,
      missed: false,
      rewarded: false,
      reward: null,
      wallet,
    };
  }

  const previousCheckIn = streak.lastCheckIn || null;
  const dayDiff = previousCheckIn ? getDayDiff(previousCheckIn, today) : null;
  const missed = dayDiff !== null && dayDiff > 1;

  if (dayDiff === 1) {
    streak.count = Number(streak.count || 0) + 1;
  } else {
    streak.count = 1;
  }

  streak.lastCheckIn = today;

  let rewarded = false;
  let reward = null;
  let wallet = null;

  if (Number(streak.count || 0) % REWARD_EVERY_DAYS === 0) {
    const referenceId = `buzzstreak_${userId}_${today}_${shortid.generate()}`;

    wallet = await creditBuzzCoins({
      userId,
      amountBC: WEEKLY_REWARD_BC,
      type: "buzzstreak_reward",
      source: "buzzstreak",
      referenceId,
      reason: `BuzzStreak ${REWARD_EVERY_DAYS}-day reward`,
      walletBucket: "balance",
      metadata: {
        streakDay: Number(streak.count || 0),
        rewardEveryDays: REWARD_EVERY_DAYS,
        checkedInAt: now.toISOString(),
      },
    });

    rewarded = true;
    reward = {
      amountBC: WEEKLY_REWARD_BC,
      streakDay: Number(streak.count || 0),
      referenceId,
    };
  } else {
    wallet = await getWalletSnapshot(userId);
  }

  await streak.save();

  return {
    success: true,
    streak: normalizeStreakForResponse(streak),
    checkedToday: true,
    alreadyCheckedIn: false,
    missed,
    rewarded,
    reward,
    wallet,
  };
}

module.exports = {
  REWARD_EVERY_DAYS,
  WEEKLY_REWARD_BC,
  getDailyBuzzStreak,
  checkInDailyBuzzStreak,
};