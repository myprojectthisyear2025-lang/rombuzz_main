/**
 * Path: server/services/matchQueries.js
 * Purpose: Mongo-backed match membership shared by posts and stories.
 */
const Match = require("../models/Match");

async function matchedUserIds(userId) {
  const id = String(userId);
  const matches = await Match.find({ users: id }).select("users").lean();
  return [...new Set(matches.flatMap((m) => m.users).filter((peer) => peer !== id))];
}

module.exports = { matchedUserIds };
