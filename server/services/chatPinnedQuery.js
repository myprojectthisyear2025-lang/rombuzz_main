const ChatRoom = require('../models/ChatRoom');

function pinnedPipeline(roomId, userId) {
  return [
    { $match: { roomId } },
    // Include every version of a pinned ID so a later unpin/deletion cannot
    // resurrect an older duplicate. The room history stays inside MongoDB.
    { $project: { _id: 0, messages: 1, pinnedIds: { $map: {
      input: { $filter: { input: { $ifNull: ['$messages', []] }, as: 'm', cond: { $eq: ['$$m.pinned', true] } } },
      as: 'm', in: '$$m.id',
    } } } },
    { $project: { messages: { $filter: { input: { $ifNull: ['$messages', []] }, as: 'm', cond: { $and: [
      { $in: ['$$m.id', '$pinnedIds'] },
      { $not: [{ $in: [userId, { $ifNull: ['$$m.hiddenFor', []] }] }] },
    ] } } } } },
  ];
}
const time = value => typeof value === 'number' ? (value < 1e12 ? value * 1000 : value) : new Date(value || 0).getTime() || 0;
async function getPinnedMessages(roomId, userId) {
  const [room] = await ChatRoom.aggregate(pinnedPipeline(roomId, userId));
  const byId = new Map((room?.messages || []).filter(m => m.id).map(m => [String(m.id), m]));
  const messages = [...byId.values()].filter(m => m.pinned && !m.deleted && !m._temp)
    .sort((a, b) => time(b.pinnedAt || b.createdAt || b.time) - time(a.pinnedAt || a.createdAt || a.time));
  // Pinned cards display text/type labels and navigate via focusMsgId. Retain
  // full message metadata, but defer playback lookup/signing to the thread.
  return { messages };
}
module.exports = { pinnedPipeline, getPinnedMessages };
