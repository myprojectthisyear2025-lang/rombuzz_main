/** Count inside Mongo; return no message history or media metadata to Node. */
function unreadRoomsPipeline(userId, now = new Date()) {
  const me = String(userId);
  const literalMe = { $literal: me };
  const epoch = new Date(0);
  // Map keys are user ids, not field paths. This also supports legacy maps.
  const mapValue = (field) => ({
    $let: {
      vars: { entry: { $arrayElemAt: [{ $filter: {
        input: { $objectToArray: { $ifNull: [field, {}] } },
        as: "entry", cond: { $eq: ["$$entry.k", literalMe] },
      } }, 0] } },
      in: "$$entry.v",
    },
  });
  const date = (input, fallback) => ({ $convert: { input, to: "date", onError: null, onNull: fallback } });
  return [
    { $match: { participants: me } },
    { $project: {
      _id: 0,
      participants: 1,
      unreadCount: { $let: {
        vars: {
          lastRead: date(mapValue("$lastReadAtByUser"), epoch),
          prefs: { $ifNull: [mapValue("$chatPrefsByUser"), {}] },
        },
        in: { $let: {
          vars: { count: { $reduce: {
            input: { $ifNull: ["$messages", []] }, initialValue: 0,
            in: { $let: {
              vars: {
                // Mongoose previously supplied Date.now for a missing time.
                time: date({ $cond: [{ $eq: [{ $type: "$$this.time" }, "missing"] }, now, "$$this.time"] }, epoch),
                expiry: date("$$this.expireAt", null),
              },
              in: { $add: ["$$value", { $cond: [{ $and: [
                { $ne: ["$$this", null] },
                { $eq: [{ $convert: { input: "$$this.to", to: "string", onError: "", onNull: "" } }, literalMe] },
                { $not: [{ $ifNull: ["$$this.deleted", false] }] },
                { $not: [{ $ifNull: ["$$this.seen", false] }] },
                { $or: [{ $eq: ["$$expiry", null] }, { $gt: ["$$expiry", now] }] },
                { $not: [{ $in: [literalMe, { $ifNull: ["$$this.hiddenFor", []] }] }] },
                { $ne: ["$$time", null] }, { $ne: ["$$lastRead", null] },
                { $gt: ["$$time", "$$lastRead"] },
              ] }, 1, 0] }] },
            } },
          } } },
          in: { $cond: [{ $and: [{ $eq: ["$$count", 0] }, { $ifNull: ["$$prefs.forceUnread", false] }] }, 1, "$$count"] },
        } },
      } },
    } },
  ];
}

module.exports = { unreadRoomsPipeline };
