/**
 * ============================================================================
 * 📁 File: server/utils/relationshipStyleCompatibility.js
 * 🎯 Purpose: Backward-compatible Relationship Style normalization for RomBuzz.
 *
 * Mobile uses the newer Relationship Style catalog.
 * Existing users / website may still contain legacy values.
 *
 * IMPORTANT:
 * - Never destroy or rewrite unknown website-specific values.
 * - Used for Discover matching/scoring only.
 * ============================================================================
 */

const SUPPORTED_VALUES = new Set([
  "monogamous",
  "open-relationship",
  "polyamorous",
  "exploring",
  "not-sure",
  "open-to-discuss",
]);

const LEGACY_ALIASES = {
  monogamy: "monogamous",
  monogamous: "monogamous",

  open: "open-relationship",
  "open relationship": "open-relationship",
  "open-relationship": "open-relationship",

  poly: "polyamorous",
  polyamory: "polyamorous",
  polyamorous: "polyamorous",

  exploring: "exploring",
  "exploring my options": "exploring",

  unsure: "not-sure",
  "not sure": "not-sure",
  "not sure yet": "not-sure",
  "not-sure": "not-sure",

  "open to discussing": "open-to-discuss",
  "open-to-discuss": "open-to-discuss",
};

function normalizeRelationshipStyle(value = "") {
  const raw = String(value || "").trim().toLowerCase();

  if (!raw) return "";

  if (SUPPORTED_VALUES.has(raw)) {
    return raw;
  }

  return LEGACY_ALIASES[raw] || raw;
}

function getRelationshipStyleMatchValues(value = "") {
  const normalized = normalizeRelationshipStyle(value);

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
  normalizeRelationshipStyle,
  getRelationshipStyleMatchValues,
};