/**
 * File: server/config/rombuzzGifts.js
 * Purpose: Server-side source of truth for RomBuzz gift validation and pricing.
 * Use: Import this file in gift purchase routes. Never trust gift price from the frontend.
 */

const ROMBUZZ_GIFT_CONFIG = [
  {"giftId": "smile_spark", "priceBC": 5, "category": "sweet", "rarity": "common", "animated": true, "enabled": true, "premiumOnly": false, "seasonalOnly": false, "allowedPlacements": ["reels", "posts", "profile_media", "chat", "buzzpoke", "microbuzz", "match_celebration", "streak", "universal"]},
  {"giftId": "soft_hello", "priceBC": 5, "category": "sweet", "rarity": "common", "animated": false, "enabled": true, "premiumOnly": false, "seasonalOnly": false, "allowedPlacements": ["chat", "universal"]},
  {"giftId": "tiny_heart_ping", "priceBC": 8, "category": "attention", "rarity": "common", "animated": true, "enabled": true, "premiumOnly": false, "seasonalOnly": false, "allowedPlacements": ["buzzpoke", "universal"]},
  {"giftId": "blush_note", "priceBC": 8, "category": "sweet", "rarity": "common", "animated": false, "enabled": true, "premiumOnly": false, "seasonalOnly": false, "allowedPlacements": ["chat", "universal"]},
  {"giftId": "starry_like", "priceBC": 10, "category": "playful", "rarity": "common", "animated": true, "enabled": true, "premiumOnly": false, "seasonalOnly": false, "allowedPlacements": ["posts", "universal"]},
  {"giftId": "cozy_wave", "priceBC": 10, "category": "sweet", "rarity": "common", "animated": true, "enabled": true, "premiumOnly": false, "seasonalOnly": false, "allowedPlacements": ["chat", "universal"]},
  {"giftId": "mini_rose", "priceBC": 12, "category": "romantic", "rarity": "common", "animated": false, "enabled": true, "premiumOnly": false, "seasonalOnly": false, "allowedPlacements": ["reels", "posts", "profile_media", "chat", "buzzpoke", "microbuzz", "match_celebration", "streak", "universal"]},
  {"giftId": "sunny_smile", "priceBC": 12, "category": "sweet", "rarity": "common", "animated": true, "enabled": true, "premiumOnly": false, "seasonalOnly": false, "allowedPlacements": ["reels", "universal"]},
  {"giftId": "gentle_nudge", "priceBC": 15, "category": "buzzpoke", "rarity": "common", "animated": true, "enabled": true, "premiumOnly": false, "seasonalOnly": false, "allowedPlacements": ["buzzpoke", "universal"]},
  {"giftId": "kind_glow", "priceBC": 15, "category": "sweet", "rarity": "common", "animated": false, "enabled": true, "premiumOnly": false, "seasonalOnly": false, "allowedPlacements": ["profile_media", "universal"]},
  {"giftId": "cute_comet", "priceBC": 18, "category": "playful", "rarity": "common", "animated": true, "enabled": true, "premiumOnly": false, "seasonalOnly": false, "allowedPlacements": ["reels", "universal"]},
  {"giftId": "soft_star", "priceBC": 18, "category": "attention", "rarity": "common", "animated": false, "enabled": true, "premiumOnly": false, "seasonalOnly": false, "allowedPlacements": ["posts", "universal"]},
  {"giftId": "warm_ping", "priceBC": 20, "category": "buzzpoke", "rarity": "common", "animated": true, "enabled": true, "premiumOnly": false, "seasonalOnly": false, "allowedPlacements": ["buzzpoke", "universal"]},
  {"giftId": "pocket_charm", "priceBC": 20, "category": "playful", "rarity": "common", "animated": false, "enabled": true, "premiumOnly": false, "seasonalOnly": false, "allowedPlacements": ["chat", "universal"]},
  {"giftId": "happy_sparkle", "priceBC": 22, "category": "celebration", "rarity": "common", "animated": true, "enabled": true, "premiumOnly": false, "seasonalOnly": false, "allowedPlacements": ["reels", "posts", "profile_media", "chat", "buzzpoke", "microbuzz", "match_celebration", "streak", "universal"]},
  {"giftId": "sweet_pebble", "priceBC": 22, "category": "sweet", "rarity": "common", "animated": false, "enabled": true, "premiumOnly": false, "seasonalOnly": false, "allowedPlacements": ["posts", "universal"]},
  {"giftId": "heart_confetti", "priceBC": 25, "category": "celebration", "rarity": "uncommon", "animated": true, "enabled": true, "premiumOnly": false, "seasonalOnly": false, "allowedPlacements": ["match_celebration", "chat", "universal"]},
  {"giftId": "soft_bloom", "priceBC": 25, "category": "romantic", "rarity": "uncommon", "animated": true, "enabled": true, "premiumOnly": false, "seasonalOnly": false, "allowedPlacements": ["profile_media", "universal"]},
  {"giftId": "moonlit_hi", "priceBC": 28, "category": "romantic", "rarity": "uncommon", "animated": false, "enabled": true, "premiumOnly": false, "seasonalOnly": false, "allowedPlacements": ["chat", "universal"]},
  {"giftId": "thought_bubble", "priceBC": 28, "category": "attention", "rarity": "uncommon", "animated": true, "enabled": true, "premiumOnly": false, "seasonalOnly": false, "allowedPlacements": ["chat", "universal"]},
  {"giftId": "reel_spark", "priceBC": 30, "category": "playful", "rarity": "uncommon", "animated": true, "enabled": true, "premiumOnly": false, "seasonalOnly": false, "allowedPlacements": ["reels", "universal"]},
  {"giftId": "photo_glow", "priceBC": 30, "category": "sweet", "rarity": "uncommon", "animated": false, "enabled": true, "premiumOnly": false, "seasonalOnly": false, "allowedPlacements": ["profile_media", "universal"]},
  {"giftId": "buzz_beam", "priceBC": 35, "category": "buzzpoke", "rarity": "uncommon", "animated": true, "enabled": true, "premiumOnly": false, "seasonalOnly": false, "allowedPlacements": ["buzzpoke", "universal"]},
  {"giftId": "soft_laugh", "priceBC": 35, "category": "funny", "rarity": "uncommon", "animated": true, "enabled": true, "premiumOnly": false, "seasonalOnly": false, "allowedPlacements": ["reels", "universal"]},
  {"giftId": "charming_wink", "priceBC": 40, "category": "playful", "rarity": "uncommon", "animated": false, "enabled": true, "premiumOnly": false, "seasonalOnly": false, "allowedPlacements": ["chat", "universal"]},
  {"giftId": "nearby_spark", "priceBC": 40, "category": "microbuzz", "rarity": "uncommon", "animated": true, "enabled": true, "premiumOnly": false, "seasonalOnly": false, "allowedPlacements": ["microbuzz", "universal"]},
  {"giftId": "first_match_pop", "priceBC": 45, "category": "celebration", "rarity": "uncommon", "animated": true, "enabled": true, "premiumOnly": false, "seasonalOnly": false, "allowedPlacements": ["match_celebration", "chat", "universal"]},
  {"giftId": "gentle_retry", "priceBC": 45, "category": "apology", "rarity": "uncommon", "animated": false, "enabled": true, "premiumOnly": false, "seasonalOnly": false, "allowedPlacements": ["chat", "universal"]},
  {"giftId": "streak_flamelet", "priceBC": 50, "category": "streak", "rarity": "uncommon", "animated": true, "enabled": true, "premiumOnly": false, "seasonalOnly": false, "allowedPlacements": ["streak", "universal"]},
  {"giftId": "soft_apology", "priceBC": 50, "category": "apology", "rarity": "uncommon", "animated": false, "enabled": true, "premiumOnly": false, "seasonalOnly": false, "allowedPlacements": ["chat", "universal"]},
  {"giftId": "rose_spark", "priceBC": 60, "category": "romantic", "rarity": "rare", "animated": true, "enabled": true, "premiumOnly": false, "seasonalOnly": false, "allowedPlacements": ["reels", "posts", "profile_media", "chat", "buzzpoke", "microbuzz", "match_celebration", "streak", "universal"]},
  {"giftId": "midnight_note", "priceBC": 60, "category": "romantic", "rarity": "rare", "animated": false, "enabled": true, "premiumOnly": false, "seasonalOnly": false, "allowedPlacements": ["chat", "universal"]},
  {"giftId": "golden_ping", "priceBC": 65, "category": "buzzpoke", "rarity": "rare", "animated": true, "enabled": true, "premiumOnly": false, "seasonalOnly": false, "allowedPlacements": ["buzzpoke", "universal"]},
  {"giftId": "micro_magnet", "priceBC": 65, "category": "microbuzz", "rarity": "rare", "animated": true, "enabled": true, "premiumOnly": false, "seasonalOnly": false, "allowedPlacements": ["microbuzz", "universal"]},
  {"giftId": "reel_ribbon", "priceBC": 70, "category": "playful", "rarity": "rare", "animated": true, "enabled": true, "premiumOnly": false, "seasonalOnly": false, "allowedPlacements": ["reels", "universal"]},
  {"giftId": "profile_shimmer", "priceBC": 70, "category": "attention", "rarity": "rare", "animated": true, "enabled": true, "premiumOnly": false, "seasonalOnly": false, "allowedPlacements": ["profile_media", "universal"]},
  {"giftId": "sweet_rewind", "priceBC": 75, "category": "apology", "rarity": "rare", "animated": true, "enabled": true, "premiumOnly": false, "seasonalOnly": false, "allowedPlacements": ["chat", "universal"]},
  {"giftId": "laugh_cloud", "priceBC": 75, "category": "funny", "rarity": "rare", "animated": true, "enabled": true, "premiumOnly": false, "seasonalOnly": false, "allowedPlacements": ["posts", "universal"]},
  {"giftId": "match_moment", "priceBC": 80, "category": "celebration", "rarity": "rare", "animated": true, "enabled": true, "premiumOnly": false, "seasonalOnly": false, "allowedPlacements": ["match_celebration", "chat", "universal"]},
  {"giftId": "streak_star", "priceBC": 80, "category": "streak", "rarity": "rare", "animated": true, "enabled": true, "premiumOnly": false, "seasonalOnly": false, "allowedPlacements": ["streak", "universal"]},
  {"giftId": "velvet_rose", "priceBC": 85, "category": "romantic", "rarity": "rare", "animated": false, "enabled": true, "premiumOnly": false, "seasonalOnly": false, "allowedPlacements": ["profile_media", "universal"]},
  {"giftId": "glow_pulse", "priceBC": 85, "category": "attention", "rarity": "rare", "animated": true, "enabled": true, "premiumOnly": false, "seasonalOnly": false, "allowedPlacements": ["buzzpoke", "universal"]},
  {"giftId": "tiny_fireworks", "priceBC": 90, "category": "celebration", "rarity": "rare", "animated": true, "enabled": true, "premiumOnly": false, "seasonalOnly": false, "allowedPlacements": ["reels", "universal"]},
  {"giftId": "daydream_badge", "priceBC": 90, "category": "sweet", "rarity": "rare", "animated": false, "enabled": true, "premiumOnly": false, "seasonalOnly": false, "allowedPlacements": ["reels", "posts", "profile_media", "chat", "buzzpoke", "microbuzz", "match_celebration", "streak", "universal"]},
  {"giftId": "coffee_smile", "priceBC": 95, "category": "sweet", "rarity": "rare", "animated": true, "enabled": true, "premiumOnly": false, "seasonalOnly": false, "allowedPlacements": ["chat", "universal"]},
  {"giftId": "nearby_orbit", "priceBC": 95, "category": "microbuzz", "rarity": "rare", "animated": true, "enabled": true, "premiumOnly": false, "seasonalOnly": false, "allowedPlacements": ["microbuzz", "universal"]},
  {"giftId": "golden_rose", "priceBC": 120, "category": "premium", "rarity": "epic", "animated": true, "enabled": true, "premiumOnly": true, "seasonalOnly": false, "allowedPlacements": ["reels", "posts", "profile_media", "chat", "buzzpoke", "microbuzz", "match_celebration", "streak", "universal"]},
  {"giftId": "soft_spotlight", "priceBC": 120, "category": "attention", "rarity": "epic", "animated": true, "enabled": true, "premiumOnly": true, "seasonalOnly": false, "allowedPlacements": ["profile_media", "universal"]},
  {"giftId": "superbuzz_trail", "priceBC": 130, "category": "buzzpoke", "rarity": "epic", "animated": true, "enabled": true, "premiumOnly": false, "seasonalOnly": false, "allowedPlacements": ["buzzpoke", "universal"]},
  {"giftId": "heart_ribbon_drop", "priceBC": 130, "category": "romantic", "rarity": "epic", "animated": true, "enabled": true, "premiumOnly": false, "seasonalOnly": false, "allowedPlacements": ["reels", "universal"]},
  {"giftId": "moonbeam_message", "priceBC": 140, "category": "romantic", "rarity": "epic", "animated": true, "enabled": true, "premiumOnly": false, "seasonalOnly": false, "allowedPlacements": ["chat", "universal"]},
  {"giftId": "streak_crownlet", "priceBC": 140, "category": "streak", "rarity": "epic", "animated": true, "enabled": true, "premiumOnly": false, "seasonalOnly": false, "allowedPlacements": ["streak", "universal"]},
  {"giftId": "reconnect_bloom", "priceBC": 150, "category": "apology", "rarity": "epic", "animated": true, "enabled": true, "premiumOnly": false, "seasonalOnly": false, "allowedPlacements": ["chat", "universal"]},
  {"giftId": "match_glowburst", "priceBC": 150, "category": "celebration", "rarity": "epic", "animated": true, "enabled": true, "premiumOnly": false, "seasonalOnly": false, "allowedPlacements": ["match_celebration", "chat", "universal"]},
  {"giftId": "microbuzz_signal", "priceBC": 160, "category": "microbuzz", "rarity": "epic", "animated": true, "enabled": true, "premiumOnly": false, "seasonalOnly": false, "allowedPlacements": ["microbuzz", "universal"]},
  {"giftId": "silver_charm", "priceBC": 160, "category": "premium", "rarity": "epic", "animated": false, "enabled": true, "premiumOnly": true, "seasonalOnly": false, "allowedPlacements": ["reels", "posts", "profile_media", "chat", "buzzpoke", "microbuzz", "match_celebration", "streak", "universal"]},
  {"giftId": "floating_lantern", "priceBC": 170, "category": "romantic", "rarity": "epic", "animated": true, "enabled": true, "premiumOnly": false, "seasonalOnly": false, "allowedPlacements": ["profile_media", "universal"]},
  {"giftId": "reel_ovation", "priceBC": 170, "category": "celebration", "rarity": "epic", "animated": true, "enabled": true, "premiumOnly": false, "seasonalOnly": false, "allowedPlacements": ["reels", "universal"]},
  {"giftId": "gentle_comeback", "priceBC": 180, "category": "apology", "rarity": "epic", "animated": false, "enabled": true, "premiumOnly": false, "seasonalOnly": false, "allowedPlacements": ["chat", "universal"]},
  {"giftId": "spark_ring", "priceBC": 180, "category": "attention", "rarity": "epic", "animated": true, "enabled": true, "premiumOnly": false, "seasonalOnly": false, "allowedPlacements": ["buzzpoke", "universal"]},
  {"giftId": "butterfly_ping", "priceBC": 190, "category": "sweet", "rarity": "epic", "animated": true, "enabled": true, "premiumOnly": false, "seasonalOnly": false, "allowedPlacements": ["reels", "posts", "profile_media", "chat", "buzzpoke", "microbuzz", "match_celebration", "streak", "universal"]},
  {"giftId": "starlit_compliment", "priceBC": 190, "category": "romantic", "rarity": "epic", "animated": false, "enabled": true, "premiumOnly": false, "seasonalOnly": false, "allowedPlacements": ["chat", "universal"]},
  {"giftId": "dreamy_applause", "priceBC": 200, "category": "celebration", "rarity": "epic", "animated": true, "enabled": true, "premiumOnly": false, "seasonalOnly": false, "allowedPlacements": ["posts", "universal"]},
  {"giftId": "soft_meteor", "priceBC": 200, "category": "playful", "rarity": "epic", "animated": true, "enabled": true, "premiumOnly": false, "seasonalOnly": false, "allowedPlacements": ["reels", "universal"]},
  {"giftId": "premium_glow_note", "priceBC": 220, "category": "premium", "rarity": "epic", "animated": true, "enabled": true, "premiumOnly": true, "seasonalOnly": false, "allowedPlacements": ["chat", "universal"]},
  {"giftId": "nearby_firefly", "priceBC": 220, "category": "microbuzz", "rarity": "epic", "animated": true, "enabled": true, "premiumOnly": false, "seasonalOnly": false, "allowedPlacements": ["microbuzz", "universal"]},
  {"giftId": "diamond_smile", "priceBC": 300, "category": "premium", "rarity": "legendary", "animated": true, "enabled": true, "premiumOnly": true, "seasonalOnly": false, "allowedPlacements": ["reels", "posts", "profile_media", "chat", "buzzpoke", "microbuzz", "match_celebration", "streak", "universal"]},
  {"giftId": "rose_comet", "priceBC": 320, "category": "romantic", "rarity": "legendary", "animated": true, "enabled": true, "premiumOnly": true, "seasonalOnly": false, "allowedPlacements": ["reels", "universal"]},
  {"giftId": "golden_superbuzz", "priceBC": 350, "category": "buzzpoke", "rarity": "legendary", "animated": true, "enabled": true, "premiumOnly": true, "seasonalOnly": false, "allowedPlacements": ["buzzpoke", "universal"]},
  {"giftId": "seven_day_spark", "priceBC": 350, "category": "streak", "rarity": "legendary", "animated": true, "enabled": true, "premiumOnly": true, "seasonalOnly": false, "allowedPlacements": ["streak", "universal"]},
  {"giftId": "match_firefly_cascade", "priceBC": 375, "category": "celebration", "rarity": "legendary", "animated": true, "enabled": true, "premiumOnly": true, "seasonalOnly": false, "allowedPlacements": ["match_celebration", "chat", "universal"]},
  {"giftId": "aurora_note", "priceBC": 400, "category": "romantic", "rarity": "legendary", "animated": true, "enabled": true, "premiumOnly": true, "seasonalOnly": false, "allowedPlacements": ["chat", "universal"]},
  {"giftId": "profile_aura", "priceBC": 425, "category": "premium", "rarity": "legendary", "animated": true, "enabled": true, "premiumOnly": true, "seasonalOnly": false, "allowedPlacements": ["profile_media", "universal"]},
  {"giftId": "microbuzz_beacon", "priceBC": 450, "category": "microbuzz", "rarity": "legendary", "animated": true, "enabled": true, "premiumOnly": true, "seasonalOnly": false, "allowedPlacements": ["microbuzz", "universal"]},
  {"giftId": "velvet_sky", "priceBC": 475, "category": "romantic", "rarity": "legendary", "animated": true, "enabled": true, "premiumOnly": true, "seasonalOnly": false, "allowedPlacements": ["reels", "posts", "profile_media", "chat", "buzzpoke", "microbuzz", "match_celebration", "streak", "universal"]},
  {"giftId": "rare_reconnect", "priceBC": 500, "category": "apology", "rarity": "legendary", "animated": true, "enabled": true, "premiumOnly": true, "seasonalOnly": false, "allowedPlacements": ["chat", "universal"]},
  {"giftId": "spotlight_bloom", "priceBC": 525, "category": "attention", "rarity": "legendary", "animated": true, "enabled": true, "premiumOnly": true, "seasonalOnly": false, "allowedPlacements": ["profile_media", "universal"]},
  {"giftId": "reel_constellation", "priceBC": 550, "category": "celebration", "rarity": "legendary", "animated": true, "enabled": true, "premiumOnly": true, "seasonalOnly": false, "allowedPlacements": ["reels", "universal"]},
  {"giftId": "golden_streak_path", "priceBC": 575, "category": "streak", "rarity": "legendary", "animated": true, "enabled": true, "premiumOnly": true, "seasonalOnly": false, "allowedPlacements": ["streak", "universal"]},
  {"giftId": "heart_aurora", "priceBC": 600, "category": "premium", "rarity": "legendary", "animated": true, "enabled": true, "premiumOnly": true, "seasonalOnly": false, "allowedPlacements": ["reels", "posts", "profile_media", "chat", "buzzpoke", "microbuzz", "match_celebration", "streak", "universal"]},
  {"giftId": "soft_crown", "priceBC": 625, "category": "premium", "rarity": "legendary", "animated": false, "enabled": true, "premiumOnly": true, "seasonalOnly": false, "allowedPlacements": ["profile_media", "universal"]},
  {"giftId": "supernova_smile", "priceBC": 650, "category": "celebration", "rarity": "legendary", "animated": true, "enabled": true, "premiumOnly": true, "seasonalOnly": false, "allowedPlacements": ["match_celebration", "chat", "universal"]},
  {"giftId": "secret_garden", "priceBC": 675, "category": "exclusive", "rarity": "legendary", "animated": true, "enabled": true, "premiumOnly": true, "seasonalOnly": false, "allowedPlacements": ["reels", "posts", "profile_media", "chat", "buzzpoke", "microbuzz", "match_celebration", "streak", "universal"]},
  {"giftId": "glimmer_bridge", "priceBC": 700, "category": "romantic", "rarity": "legendary", "animated": true, "enabled": true, "premiumOnly": true, "seasonalOnly": false, "allowedPlacements": ["microbuzz", "universal"]},
  {"giftId": "platinum_ping", "priceBC": 750, "category": "buzzpoke", "rarity": "legendary", "animated": true, "enabled": true, "premiumOnly": true, "seasonalOnly": false, "allowedPlacements": ["buzzpoke", "universal"]},
  {"giftId": "winter_warmth", "priceBC": 90, "category": "seasonal", "rarity": "rare", "animated": true, "enabled": true, "premiumOnly": false, "seasonalOnly": true, "allowedPlacements": ["reels", "posts", "profile_media", "chat", "buzzpoke", "microbuzz", "match_celebration", "streak", "universal"]},
  {"giftId": "spring_bloom_ping", "priceBC": 90, "category": "seasonal", "rarity": "rare", "animated": true, "enabled": true, "premiumOnly": false, "seasonalOnly": true, "allowedPlacements": ["reels", "posts", "profile_media", "chat", "buzzpoke", "microbuzz", "match_celebration", "streak", "universal"]},
  {"giftId": "summer_glow", "priceBC": 95, "category": "seasonal", "rarity": "rare", "animated": false, "enabled": true, "premiumOnly": false, "seasonalOnly": true, "allowedPlacements": ["reels", "posts", "profile_media", "chat", "buzzpoke", "microbuzz", "match_celebration", "streak", "universal"]},
  {"giftId": "autumn_note", "priceBC": 95, "category": "seasonal", "rarity": "rare", "animated": false, "enabled": true, "premiumOnly": false, "seasonalOnly": true, "allowedPlacements": ["reels", "posts", "profile_media", "chat", "buzzpoke", "microbuzz", "match_celebration", "streak", "universal"]},
  {"giftId": "new_year_spark", "priceBC": 200, "category": "seasonal", "rarity": "epic", "animated": true, "enabled": true, "premiumOnly": false, "seasonalOnly": true, "allowedPlacements": ["match_celebration", "chat", "universal"]},
  {"giftId": "valentine_glow", "priceBC": 240, "category": "seasonal", "rarity": "epic", "animated": true, "enabled": true, "premiumOnly": false, "seasonalOnly": true, "allowedPlacements": ["reels", "posts", "profile_media", "chat", "buzzpoke", "microbuzz", "match_celebration", "streak", "universal"]},
  {"giftId": "birthday_bloom", "priceBC": 240, "category": "celebration", "rarity": "epic", "animated": true, "enabled": true, "premiumOnly": false, "seasonalOnly": false, "allowedPlacements": ["chat", "universal"]},
  {"giftId": "anniversary_light", "priceBC": 700, "category": "romantic", "rarity": "legendary", "animated": true, "enabled": true, "premiumOnly": true, "seasonalOnly": false, "allowedPlacements": ["chat", "universal"]},
  {"giftId": "exclusive_orbit", "priceBC": 800, "category": "exclusive", "rarity": "legendary", "animated": true, "enabled": true, "premiumOnly": true, "seasonalOnly": false, "allowedPlacements": ["reels", "posts", "profile_media", "chat", "buzzpoke", "microbuzz", "match_celebration", "streak", "universal"]},
  {"giftId": "moon_rose_cascade", "priceBC": 1000, "category": "exclusive", "rarity": "ultra", "animated": true, "enabled": true, "premiumOnly": true, "seasonalOnly": false, "allowedPlacements": ["reels", "posts", "profile_media", "chat", "buzzpoke", "microbuzz", "match_celebration", "streak", "universal"]},
  {"giftId": "aurora_heartfall", "priceBC": 1200, "category": "exclusive", "rarity": "ultra", "animated": true, "enabled": true, "premiumOnly": true, "seasonalOnly": false, "allowedPlacements": ["match_celebration", "chat", "universal"]},
  {"giftId": "infinity_glow", "priceBC": 1500, "category": "premium", "rarity": "ultra", "animated": true, "enabled": true, "premiumOnly": true, "seasonalOnly": false, "allowedPlacements": ["profile_media", "universal"]},
  {"giftId": "legendary_superbuzz", "priceBC": 1800, "category": "buzzpoke", "rarity": "ultra", "animated": true, "enabled": true, "premiumOnly": true, "seasonalOnly": false, "allowedPlacements": ["buzzpoke", "universal"]},
  {"giftId": "seven_sky_streak", "priceBC": 2000, "category": "streak", "rarity": "ultra", "animated": true, "enabled": true, "premiumOnly": true, "seasonalOnly": false, "allowedPlacements": ["streak", "universal"]},
  {"giftId": "romance_constellation", "priceBC": 2500, "category": "exclusive", "rarity": "ultra", "animated": true, "enabled": true, "premiumOnly": true, "seasonalOnly": false, "allowedPlacements": ["reels", "posts", "profile_media", "chat", "buzzpoke", "microbuzz", "match_celebration", "streak", "universal"]},

];

const GIFT_MAP = new Map(ROMBUZZ_GIFT_CONFIG.map((gift) => [gift.giftId, gift]));

function getGiftConfig(giftId) {
  return GIFT_MAP.get(giftId) || null;
}

function isGiftEnabled(giftId) {
  const gift = getGiftConfig(giftId);
  return Boolean(gift && gift.enabled);
}

function getGiftPriceBC(giftId) {
  const gift = getGiftConfig(giftId);
  return gift ? gift.priceBC : null;
}

function canUseGiftInPlacement(giftId, placement) {
  const gift = getGiftConfig(giftId);
  return Boolean(gift && gift.enabled && Array.isArray(gift.allowedPlacements) && gift.allowedPlacements.includes(placement));
}

function validateGiftPurchase({ giftId, placement }) {
  const gift = getGiftConfig(giftId);
  if (!gift) return { ok: false, code: "INVALID_GIFT", message: "Gift does not exist." };
  if (!gift.enabled) return { ok: false, code: "GIFT_DISABLED", message: "Gift is not currently available." };
  if (!gift.allowedPlacements.includes(placement)) return { ok: false, code: "INVALID_PLACEMENT", message: "Gift cannot be used in this placement." };
  return { ok: true, gift, priceBC: gift.priceBC };
}

module.exports = {
  ROMBUZZ_GIFT_CONFIG,
  getGiftConfig,
  isGiftEnabled,
  getGiftPriceBC,
  canUseGiftInPlacement,
  validateGiftPurchase,
};
