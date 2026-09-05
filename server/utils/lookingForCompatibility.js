/**
 * ============================================================================
 * 📁 File: server/utils/lookingForCompatibility.js
 * 🎯 Purpose: Backward-compatible RomBuzz "Looking For" normalization.
 *
 * Mobile uses the newer relationship-intention catalog.
 * Web may continue using additional legacy/adult intent categories.
 *
 * IMPORTANT:
 * - Do NOT remove or collapse web-only categories.
 * - Backend remains compatible with both mobile and website.
 * ============================================================================
 */

const SUPPORTED_VALUES = new Set([
  // Shared/new mobile values
  "life-partner",
  "long-term",
  "short-term",
  "casual",
  "friendship",
  "new-connections",
  "figuring-it-out",

  // Website / legacy values — KEEP SUPPORTED
  "gymbuddy",
  "flirty",
  "chill",
  "timepass",
  "ons",
  "threesome",
  "onlyfans",
]);

const LEGACY_ALIASES = {
  serious: "long-term",
  "serious relationship": "long-term",
  "long term": "long-term",
  longterm: "long-term",

  "casual dating": "casual",

  friends: "friendship",
  friend: "friendship",

  unsure: "figuring-it-out",
  "not sure": "figuring-it-out",
  exploring: "figuring-it-out",

  "gym buddy": "gymbuddy",

  "one night stand": "ons",
  "one-night stand": "ons",
  "one-night-stand": "ons",

  "only fans": "onlyfans",
  "only-fans": "onlyfans",
};

function normalizeLookingFor(value = "") {
  const raw = String(value || "")
    .trim()
    .toLowerCase();

  if (!raw) return "";

  if (SUPPORTED_VALUES.has(raw)) {
    return raw;
  }

  return LEGACY_ALIASES[raw] || raw;
}

function getLookingForMatchValues(value = "") {
  const normalized = normalizeLookingFor(value);

  if (!normalized) return [];

  const values = [normalized];

  for (const [legacy, canonical] of Object.entries(LEGACY_ALIASES)) {
    if (canonical === normalized) {
      values.push(legacy);
    }
  }

  return [...new Set(values)];
}

module.exports = {
  normalizeLookingFor,
  getLookingForMatchValues,
};