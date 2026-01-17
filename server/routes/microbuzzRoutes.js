/**
 * ============================================================
 * 📁 File: routes/microbuzzRoutes.js
 * ✅ RomBuzz FIX: Unify MicroBuzz backend (Option A)
 *
 * WHY:
 * - The old factory-based MicroBuzzRoutes used "lastActive"
 *   which is NOT in the MicroBuzzPresence schema, causing
 *   nearby queries to return 0 users.
 *
 * WHAT THIS DOES:
 * - Keeps the SAME exported function signature:
 *     initMicroBuzzRoutes(io, onlineUsers)
 *   so your server/index.js does NOT need changes.
 *
 * - Internally returns the SINGLE source of truth router:
 *     routes/microbuzz.js
 *   (the one that already works on web and includes filtering).
 *
 * Result:
 * - Mobile radar will show nearby active users the same way web does.
 * ============================================================
 */

function initMicroBuzzRoutes(_io, _onlineUsers) {
  // Single source of truth (web + mobile parity)
  // routes/microbuzz.js already handles:
  // - /selfie, /activate, /nearby, /deactivate, /buzz
  // - presence via MicroBuzzPresence.updatedAt
  // - preference filtering + distance
  // - socket match/buzz events via getIO() + onlineUsers from state
  // eslint-disable-next-line global-require
  return require("./microbuzz");
}

module.exports = initMicroBuzzRoutes;
