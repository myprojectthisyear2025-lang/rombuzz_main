// Transfer installation tokens atomically; shared guards prevent concurrent first-claim write skew.
const { createHash } = require("node:crypto");
const User = require("../models/User");
const Guard = require("../models/PushTokenGuard");

async function claimPushToken(userId, entry) {
  const key = createHash("sha256").update(entry.token).digest("hex");
  // Materialize outside the transaction. Concurrent first creation may hit the built-in _id index.
  try {
    await Guard.updateOne({ _id: key }, { $setOnInsert: { revision: 0 } }, { upsert: true, writeConcern: { w: "majority" } });
  } catch (error) { if (error.code !== 11000) throw error; }

  return User.db.transaction(async session => {
    // This real write forces conflicting claims (even for two previously empty users) to retry.
    const guard = await Guard.updateOne({ _id: key }, { $inc: { revision: 1 } }, { session });
    if (!guard.matchedCount) throw new Error("Push ownership guard missing");
    const user = await User.findOne({ id: userId }).select("pushTokens").session(session).lean();
    if (!user) throw Object.assign(new Error("User not found"), { statusCode: 404 });
    const createdAt = user.pushTokens?.find(item => item.token === entry.token)?.createdAt || entry.createdAt;

    await User.updateMany({ "pushTokens.token": entry.token }, { $pull: { pushTokens: { token: entry.token } } }, { session });
    await User.updateMany({ pushToken: entry.token }, { $unset: { pushToken: "" } }, { session, strict: false });
    // Only append this entry. Never save a previously read whole User or replace its token array.
    return User.findOneAndUpdate({ _id: user._id }, {
      $push: { pushTokens: { ...entry, createdAt } },
    }, { session, new: true }).select("pushTokens").lean();
  }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary" });
}

module.exports = { claimPushToken };
