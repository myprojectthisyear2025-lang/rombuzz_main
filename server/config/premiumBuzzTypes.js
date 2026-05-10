/**
 * ============================================================
 * 📁 File: config/premiumBuzzTypes.js
 * 🎯 Purpose: Server-side source of truth for paid RomBuzz Buzz types.
 *
 * Used by:
 * - routes/likesMatches.js
 *
 * Important:
 * - Backend never trusts frontend price.
 * - Frontend can show labels/prices, but this file decides cost.
 * - Seasonal visibility is enforced here too.
 * ============================================================
 */

const PREMIUM_BUZZ_TYPES = {
  cupid: {
    id: "cupid",
    emoji: "💘",
    label: "Cupid Buzz",
    priceBC: 20,
    category: "always",
    availability: { type: "always" },
    notificationBody: "Someone’s aiming right at your heart.",
    overlayBody: "Someone’s aiming right at your heart.",
    animationKey: "cupid",
  },
  midnight: {
    id: "midnight",
    emoji: "🌙",
    label: "Midnight Buzz",
    priceBC: 35,
    category: "always",
    availability: { type: "always" },
    notificationBody: "You crossed their mind.",
    overlayBody: "You crossed their mind.",
    animationKey: "midnight",
  },
  rain: {
    id: "rain",
    emoji: "🌧️",
    label: "Rain Buzz",
    priceBC: 40,
    category: "always",
    availability: { type: "always" },
    notificationBody: "A little feeling just poured in.",
    overlayBody: "A little feeling just poured in.",
    animationKey: "rain",
  },
  rainbow: {
    id: "rainbow",
    emoji: "🌈",
    label: "Rainbow Buzz",
    priceBC: 45,
    category: "always",
    availability: { type: "always" },
    notificationBody: "You brightened someone’s day.",
    overlayBody: "You brightened someone’s day.",
    animationKey: "rainbow",
  },
  sunshine: {
    id: "sunshine",
    emoji: "☀️",
    label: "Sunshine Buzz",
    priceBC: 50,
    category: "always",
    availability: { type: "always" },
    notificationBody: "Someone sent you a little warmth.",
    overlayBody: "Someone sent you a little warmth.",
    animationKey: "sunshine",
  },
  teddy: {
    id: "teddy",
    emoji: "🧸",
    label: "Teddy Buzz",
    priceBC: 60,
    category: "always",
    availability: { type: "always" },
    notificationBody: "A soft little hug just arrived.",
    overlayBody: "A soft little hug just arrived.",
    animationKey: "teddy",
  },
  thunder: {
    id: "thunder",
    emoji: "⚡",
    label: "Thunder Buzz",
    priceBC: 80,
    category: "always",
    availability: { type: "always" },
    notificationBody: "You just got struck by attention.",
    overlayBody: "You just got struck by attention.",
    animationKey: "thunder",
  },
  ring: {
    id: "ring",
    emoji: "💍",
    label: "Ring Buzz",
    priceBC: 90,
    category: "always",
    availability: { type: "always" },
    notificationBody: "This one came with serious attention.",
    overlayBody: "This one came with serious attention.",
    animationKey: "ring",
  },
  spotlight: {
    id: "spotlight",
    emoji: "💫",
    label: "Spotlight Buzz",
    priceBC: 125,
    category: "always",
    availability: { type: "always" },
    notificationBody: "Someone wanted you to notice this.",
    overlayBody: "Someone wanted you to notice this.",
    animationKey: "spotlight",
  },
  soul: {
    id: "soul",
    emoji: "✨",
    label: "Soul Buzz",
    priceBC: 150,
    category: "always",
    availability: { type: "always" },
    notificationBody: "This one was meant to stand out.",
    overlayBody: "This one was meant to stand out.",
    animationKey: "soul",
  },

  valentine: {
    id: "valentine",
    emoji: "🎁",
    label: "Valentine Buzz",
    priceBC: 70,
    category: "seasonal",
    availability: { type: "date_range", startMonth: 2, startDay: 1, endMonth: 2, endDay: 15 },
    notificationBody: "A romantic surprise just arrived.",
    overlayBody: "A romantic surprise just arrived.",
    animationKey: "valentine",
  },
  snow: {
    id: "snow",
    emoji: "❄️",
    label: "Snow Buzz",
    priceBC: 65,
    category: "seasonal",
    availability: { type: "date_range", startMonth: 12, startDay: 1, endMonth: 2, endDay: 28 },
    notificationBody: "A soft winter moment just arrived.",
    overlayBody: "A soft winter moment just arrived.",
    animationKey: "snow",
  },
  spooky: {
    id: "spooky",
    emoji: "🎃",
    label: "Spooky Buzz",
    priceBC: 60,
    category: "seasonal",
    availability: { type: "date_range", startMonth: 10, startDay: 1, endMonth: 10, endDay: 31 },
    notificationBody: "A little mystery came your way.",
    overlayBody: "A little mystery came your way.",
    animationKey: "spooky",
  },
  holiday: {
    id: "holiday",
    emoji: "🎄",
    label: "Holiday Buzz",
    priceBC: 90,
    category: "seasonal",
    availability: { type: "date_range", startMonth: 12, startDay: 1, endMonth: 12, endDay: 31 },
    notificationBody: "Someone sent you a little festive warmth.",
    overlayBody: "Someone sent you a little festive warmth.",
    animationKey: "holiday",
  },
  new_year: {
    id: "new_year",
    emoji: "🎆",
    label: "New Year Buzz",
    priceBC: 120,
    category: "seasonal",
    availability: { type: "date_range", startMonth: 12, startDay: 26, endMonth: 1, endDay: 3 },
    notificationBody: "A fresh spark just arrived.",
    overlayBody: "A fresh spark just arrived.",
    animationKey: "new_year",
  },
};

function dateToMonthDayNumber(month, day) {
  return Number(month) * 100 + Number(day);
}

function isPremiumBuzzAvailable(type, date = new Date()) {
  if (!type || !type.availability) return false;
  if (type.availability.type === "always") return true;

  const current = dateToMonthDayNumber(date.getMonth() + 1, date.getDate());
  const start = dateToMonthDayNumber(
    type.availability.startMonth,
    type.availability.startDay
  );
  const end = dateToMonthDayNumber(
    type.availability.endMonth,
    type.availability.endDay
  );

  if (start <= end) {
    return current >= start && current <= end;
  }

  return current >= start || current <= end;
}

function getPremiumBuzzType(buzzTypeId, date = new Date()) {
  const id = String(buzzTypeId || "").trim().toLowerCase();
  const type = PREMIUM_BUZZ_TYPES[id];

  if (!type) {
    return {
      ok: false,
      statusCode: 400,
      code: "INVALID_PREMIUM_BUZZ",
      message: "Invalid premium Buzz type.",
    };
  }

  if (!isPremiumBuzzAvailable(type, date)) {
    return {
      ok: false,
      statusCode: 400,
      code: "PREMIUM_BUZZ_UNAVAILABLE",
      message: `${type.label} is not available right now.`,
    };
  }

  return {
    ok: true,
    type,
  };
}

module.exports = {
  PREMIUM_BUZZ_TYPES,
  isPremiumBuzzAvailable,
  getPremiumBuzzType,
};