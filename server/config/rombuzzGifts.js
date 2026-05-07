/**
 * ============================================================
 * 📁 File: config/rombuzzGifts.js
 * 🎁 Purpose: Server-side source of truth for RomBuzz gift validation,
 * pricing, Cloudinary image URLs, and placement rules.
 *
 * Used by:
 *  - routes/gifts.js
 *  - routes/buzzpost/buzz.post.gifts.js
 *  - routes/buzzpost/buzz.media.gifts.js
 *
 * Important:
 *  - Never trust frontend gift price.
 *  - Frontend sends only giftId.
 *  - Backend validates giftId, placement, priceBC, and enabled state.
 *  - Gift names are internal only and should not be shown in the app UI.
 * ============================================================
 */

const ALL_PLACEMENTS = [
  "reels",
  "posts",
  "profile_media",
  "chat",
  "buzzpoke",
  "microbuzz",
  "match_celebration",
  "streak",
  "universal",
];

const ROMBUZZ_GIFT_CONFIG = [
  {
    giftId: "pink_heart",
    name: "Pink Heart",
    imageUrl: "https://res.cloudinary.com/drhx99m5f/image/upload/v1778097131/pink_heart_u0byvz.png",
    priceBC: 5,
    category: "romantic",
    rarity: "common",
    animation: "heartPop",
    animated: true,
    enabled: true,
    premiumOnly: false,
    seasonalOnly: false,
    allowedPlacements: ALL_PLACEMENTS,
  },
  {
    giftId: "heart_red",
    name: "Red Heart",
    imageUrl: "https://res.cloudinary.com/drhx99m5f/image/upload/v1778097124/heart_red_wpi6mn.png",
    priceBC: 8,
    category: "romantic",
    rarity: "common",
    animation: "heartPop",
    animated: true,
    enabled: true,
    premiumOnly: false,
    seasonalOnly: false,
    allowedPlacements: ALL_PLACEMENTS,
  },
  {
    giftId: "tea_cup",
    name: "Tea Cup",
    imageUrl: "https://res.cloudinary.com/drhx99m5f/image/upload/v1778097135/tea_cup_tddkrl.png",
    priceBC: 10,
    category: "sweet",
    rarity: "common",
    animation: "softFloat",
    animated: true,
    enabled: true,
    premiumOnly: false,
    seasonalOnly: false,
    allowedPlacements: ALL_PLACEMENTS,
  },
  {
    giftId: "three_buns",
    name: "Three Buns",
    imageUrl: "https://res.cloudinary.com/drhx99m5f/image/upload/v1778097136/three_buns_secb0a.png",
    priceBC: 12,
    category: "sweet",
    rarity: "common",
    animation: "bounceIn",
    animated: true,
    enabled: true,
    premiumOnly: false,
    seasonalOnly: false,
    allowedPlacements: ALL_PLACEMENTS,
  },
  {
    giftId: "cherry_love",
    name: "Cherry Love",
    imageUrl: "https://res.cloudinary.com/drhx99m5f/image/upload/v1778097120/cherry_love_l7q10k.png",
    priceBC: 15,
    category: "playful",
    rarity: "common",
    animation: "cherryBounce",
    animated: true,
    enabled: true,
    premiumOnly: false,
    seasonalOnly: false,
    allowedPlacements: ALL_PLACEMENTS,
  },
  {
    giftId: "love_ribbon",
    name: "Love Ribbon",
    imageUrl: "https://res.cloudinary.com/drhx99m5f/image/upload/v1778097130/love_ribbon_auytjx.png",
    priceBC: 18,
    category: "romantic",
    rarity: "common",
    animation: "ribbonWave",
    animated: true,
    enabled: true,
    premiumOnly: false,
    seasonalOnly: false,
    allowedPlacements: ALL_PLACEMENTS,
  },
  {
    giftId: "autumn_love",
    name: "Autumn Love",
    imageUrl: "https://res.cloudinary.com/drhx99m5f/image/upload/v1778097119/autumn_love_cx8v8h.png",
    priceBC: 20,
    category: "seasonal",
    rarity: "common",
    animation: "autumnDrift",
    animated: true,
    enabled: true,
    premiumOnly: false,
    seasonalOnly: false,
    allowedPlacements: ALL_PLACEMENTS,
  },
  {
    giftId: "red_rose",
    name: "Red Rose",
    imageUrl: "https://res.cloudinary.com/drhx99m5f/image/upload/v1778097132/red_rose_uhu0nz.png",
    priceBC: 25,
    category: "romantic",
    rarity: "common",
    animation: "roseBloom",
    animated: true,
    enabled: true,
    premiumOnly: false,
    seasonalOnly: false,
    allowedPlacements: ALL_PLACEMENTS,
  },
  {
    giftId: "sparkling_rose",
    name: "Sparkling Rose",
    imageUrl: "https://res.cloudinary.com/drhx99m5f/image/upload/v1778097133/sparkling_rose_hj6imz.png",
    priceBC: 30,
    category: "romantic",
    rarity: "common",
    animation: "sparkleRise",
    animated: true,
    enabled: true,
    premiumOnly: false,
    seasonalOnly: false,
    allowedPlacements: ALL_PLACEMENTS,
  },
  {
    giftId: "cuddle_love",
    name: "Cuddle Love",
    imageUrl: "https://res.cloudinary.com/drhx99m5f/image/upload/v1778097122/cuddle_love_d0h9yv.png",
    priceBC: 35,
    category: "sweet",
    rarity: "uncommon",
    animation: "zoomPop",
    animated: true,
    enabled: true,
    premiumOnly: false,
    seasonalOnly: false,
    allowedPlacements: ALL_PLACEMENTS,
  },
  {
    giftId: "cute_birds",
    name: "Cute Birds",
    imageUrl: "https://res.cloudinary.com/drhx99m5f/image/upload/v1778097122/cute_birds_av7c4u.png",
    priceBC: 40,
    category: "romantic",
    rarity: "uncommon",
    animation: "birdsFlutter",
    animated: true,
    enabled: true,
    premiumOnly: false,
    seasonalOnly: false,
    allowedPlacements: ALL_PLACEMENTS,
  },
  {
    giftId: "love_birds",
    name: "Love Birds",
    imageUrl: "https://res.cloudinary.com/drhx99m5f/image/upload/v1778097127/love_birds_n3dy21.png",
    priceBC: 45,
    category: "romantic",
    rarity: "uncommon",
    animation: "birdsFlutter",
    animated: true,
    enabled: true,
    premiumOnly: false,
    seasonalOnly: false,
    allowedPlacements: ALL_PLACEMENTS,
  },
  {
    giftId: "love_candle",
    name: "Love Candle",
    imageUrl: "https://res.cloudinary.com/drhx99m5f/image/upload/v1778097127/love_candle_mdhh0y.png",
    priceBC: 50,
    category: "romantic",
    rarity: "uncommon",
    animation: "candleFlicker",
    animated: true,
    enabled: true,
    premiumOnly: false,
    seasonalOnly: false,
    allowedPlacements: ALL_PLACEMENTS,
  },
  {
    giftId: "candle_light",
    name: "Candle Light",
    imageUrl: "https://res.cloudinary.com/drhx99m5f/image/upload/v1778097119/candle_light_mzncuw.png",
    priceBC: 55,
    category: "romantic",
    rarity: "uncommon",
    animation: "lanternGlow",
    animated: true,
    enabled: true,
    premiumOnly: false,
    seasonalOnly: false,
    allowedPlacements: ALL_PLACEMENTS,
  },
  {
    giftId: "love_lantern",
    name: "Love Lantern",
    imageUrl: "https://res.cloudinary.com/drhx99m5f/image/upload/v1778097130/love_lantern_hdqnio.png",
    priceBC: 60,
    category: "romantic",
    rarity: "uncommon",
    animation: "lanternGlow",
    animated: true,
    enabled: true,
    premiumOnly: false,
    seasonalOnly: false,
    allowedPlacements: ALL_PLACEMENTS,
  },
  {
    giftId: "lantern_blue",
    name: "Blue Lantern",
    imageUrl: "https://res.cloudinary.com/drhx99m5f/image/upload/v1778097125/lantern_blue_jv8vhy.png",
    priceBC: 65,
    category: "romantic",
    rarity: "uncommon",
    animation: "glowPulse",
    animated: true,
    enabled: true,
    premiumOnly: false,
    seasonalOnly: false,
    allowedPlacements: ALL_PLACEMENTS,
  },
  {
    giftId: "love_capsule",
    name: "Love Capsule",
    imageUrl: "https://res.cloudinary.com/drhx99m5f/image/upload/v1778097128/love_capsule_ta0dbc.png",
    priceBC: 70,
    category: "romantic",
    rarity: "rare",
    animation: "capsuleDrop",
    animated: true,
    enabled: true,
    premiumOnly: false,
    seasonalOnly: false,
    allowedPlacements: ALL_PLACEMENTS,
  },
  {
    giftId: "lock_key",
    name: "Lock Key",
    imageUrl: "https://res.cloudinary.com/drhx99m5f/image/upload/v1778097126/lock_key_hyqsfj.png",
    priceBC: 75,
    category: "romantic",
    rarity: "rare",
    animation: "lockShake",
    animated: true,
    enabled: true,
    premiumOnly: false,
    seasonalOnly: false,
    allowedPlacements: ALL_PLACEMENTS,
  },
  {
    giftId: "flower_vase",
    name: "Flower Vase",
    imageUrl: "https://res.cloudinary.com/drhx99m5f/image/upload/v1778097124/flower_vase_pxkt3h.png",
    priceBC: 80,
    category: "romantic",
    rarity: "rare",
    animation: "sway",
    animated: true,
    enabled: true,
    premiumOnly: false,
    seasonalOnly: false,
    allowedPlacements: ALL_PLACEMENTS,
  },
  {
    giftId: "bonsai_love",
    name: "Bonsai Love",
    imageUrl: "https://res.cloudinary.com/drhx99m5f/image/upload/v1778097120/bonsai_love_hf11ft.png",
    priceBC: 90,
    category: "premium",
    rarity: "rare",
    animation: "bonsaiBreath",
    animated: true,
    enabled: true,
    premiumOnly: false,
    seasonalOnly: false,
    allowedPlacements: ALL_PLACEMENTS,
  },
  {
    giftId: "rombuzz_love",
    name: "RomBuzz Love",
    imageUrl: "https://res.cloudinary.com/drhx99m5f/image/upload/v1778097133/rombuzz_love_mjkaak.png",
    priceBC: 100,
    category: "premium",
    rarity: "rare",
    animation: "glowPulse",
    animated: true,
    enabled: true,
    premiumOnly: false,
    seasonalOnly: false,
    allowedPlacements: ALL_PLACEMENTS,
  },
  {
    giftId: "velvet_kiss",
    name: "Velvet Kiss",
    imageUrl: "https://res.cloudinary.com/drhx99m5f/image/upload/v1778097137/velvet_kiss_taofc4.png",
    priceBC: 120,
    category: "premium",
    rarity: "epic",
    animation: "kissBurst",
    animated: true,
    enabled: true,
    premiumOnly: false,
    seasonalOnly: false,
    allowedPlacements: ALL_PLACEMENTS,
  },
  {
    giftId: "love_compass",
    name: "Love Compass",
    imageUrl: "https://res.cloudinary.com/drhx99m5f/image/upload/v1778097129/love_compass_iinnhg.png",
    priceBC: 150,
    category: "premium",
    rarity: "epic",
    animation: "compassSpin",
    animated: true,
    enabled: true,
    premiumOnly: false,
    seasonalOnly: false,
    allowedPlacements: ALL_PLACEMENTS,
  },
  {
    giftId: "star_compass",
    name: "Star Compass",
    imageUrl: "https://res.cloudinary.com/drhx99m5f/image/upload/v1778097134/star_compass_m0fitn.png",
    priceBC: 180,
    category: "premium",
    rarity: "epic",
    animation: "twinkle",
    animated: true,
    enabled: true,
    premiumOnly: false,
    seasonalOnly: false,
    allowedPlacements: ALL_PLACEMENTS,
  },
  {
    giftId: "crystal_swan",
    name: "Crystal Swan",
    imageUrl: "https://res.cloudinary.com/drhx99m5f/image/upload/v1778097121/crystal_swan_gzjhyu.png",
    priceBC: 250,
    category: "premium",
    rarity: "legendary",
    animation: "crystalShine",
    animated: true,
    enabled: true,
    premiumOnly: false,
    seasonalOnly: false,
    allowedPlacements: ALL_PLACEMENTS,
  },
];

const GIFT_MAP = new Map(
  ROMBUZZ_GIFT_CONFIG.map((gift) => [String(gift.giftId), gift])
);

function getGiftConfig(giftId) {
  return GIFT_MAP.get(String(giftId || "")) || null;
}

function isGiftEnabled(giftId) {
  const gift = getGiftConfig(giftId);
  return Boolean(gift && gift.enabled);
}

function getGiftPriceBC(giftId) {
  const gift = getGiftConfig(giftId);
  return gift ? Number(gift.priceBC) : null;
}

function canUseGiftInPlacement(giftId, placement) {
  const gift = getGiftConfig(giftId);
  const place = String(placement || "universal");

  return Boolean(
    gift &&
      gift.enabled &&
      Array.isArray(gift.allowedPlacements) &&
      gift.allowedPlacements.includes(place)
  );
}

function validateGiftPurchase({ giftId, placement }) {
  const gift = getGiftConfig(giftId);
  const place = String(placement || "universal");

  if (!gift) {
    return {
      ok: false,
      code: "INVALID_GIFT",
      message: "Gift does not exist.",
    };
  }

  if (!gift.enabled) {
    return {
      ok: false,
      code: "GIFT_DISABLED",
      message: "Gift is not currently available.",
    };
  }

  if (
    !Array.isArray(gift.allowedPlacements) ||
    !gift.allowedPlacements.includes(place)
  ) {
    return {
      ok: false,
      code: "INVALID_PLACEMENT",
      message: "Gift cannot be used in this placement.",
    };
  }

  return {
    ok: true,
    gift,
    priceBC: Number(gift.priceBC) || 0,
  };
}

module.exports = {
  ROMBUZZ_GIFT_CONFIG,
  getGiftConfig,
  isGiftEnabled,
  getGiftPriceBC,
  canUseGiftInPlacement,
  validateGiftPurchase,
};