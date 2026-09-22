/**
 * Path: server/scripts/lowdb/legacyShapes.js
 * Purpose: Resolve legacy keyed structures without guessing underscore-containing user ids.
 */
function resolvePair(key, userIds, directional = false) {
  const candidates = [];
  for (let i = 0; i < key.length; i++) {
    if (key[i] !== "_") continue;
    for (const width of [1, 2]) {
      if (width === 2 && key[i + 1] !== "_") continue;
      const a = key.slice(0, i), b = key.slice(i + width);
      if (a !== b && userIds.has(a) && userIds.has(b)) candidates.push([a, b]);
    }
  }
  const unique = new Map(candidates.map((pair) => [JSON.stringify(directional ? pair : [...pair].sort()), pair]));
  return unique.size === 1 ? [...unique.values()][0] : null;
}

function normalizeShapes(input) {
  const data = structuredClone(input);
  const warnings = [];
  const users = Array.isArray(data.users) ? data.users : [];
  const userIds = new Set(users.map((user) => String(user.id || "")).filter(Boolean));
  // Some older users stored their block list only on the account. Relationship
  // is the current authoritative safety model; preserve those blocks there too.
  for (const [index, user] of users.entries()) {
    if (!Array.isArray(user.blockedUsers)) continue;
    for (const blocked of user.blockedUsers) {
      const from = String(user.id || ""), to = String(blocked);
      const all = [...(Array.isArray(data.blocks) ? data.blocks : []), ...(Array.isArray(data.relationships) ? data.relationships : [])];
      const exists = all.some((r) => (r.from || r.blocker) === from && (r.to || r.blocked) === to && (!r.type || r.type === "block"));
      if (exists) continue;
      if (data.blocks !== undefined && !Array.isArray(data.blocks)) continue; // The planner reports malformed input.
      data.blocks ||= [];
      data.blocks.push({ from, to, type: "block", createdAt: user.createdAt });
      warnings.push({ collection: "users", sourceIndex: String(index), reason: "Converted embedded blockedUsers entry to Relationship. Block time was absent; account createdAt is retained as the available legacy timestamp." });
    }
  }
  if (data.matchStreaks && !Array.isArray(data.matchStreaks) && typeof data.matchStreaks === "object") {
    for (const [key, streak] of Object.entries(data.matchStreaks)) {
      if (!streak || typeof streak !== "object" || (streak.from && streak.to)) continue;
      const pair = resolvePair(key, userIds, true);
      if (pair) { streak.from = pair[0]; streak.to = pair[1]; }
    }
  }
  return { data, warnings };
}
module.exports = { normalizeShapes, resolvePair };
