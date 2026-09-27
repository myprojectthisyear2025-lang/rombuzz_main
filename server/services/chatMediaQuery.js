const ChatRoom = require('../models/ChatRoom');
const { signChatMessages } = require('./chatMessageMedia');
const { getSignedMediaUrl, isR2Key } = require('../utils/r2Media');
const { chatMediaRow } = require('./chatMediaRows');

// Embedded history still requires a room scan. Project only media candidates,
// never ordinary text, reactions, receipts, replies or the hydrated room document.
function mediaPipeline(roomId, userId) {
  const encoded = { $eq: [{ $substrCP: [{ $ifNull: ['$$m.text', ''] }, 0, 7] }, '::RBZ::'] };
  const fields = ['id', '_id', 'from', 'to', 'time', 'createdAt', 'gift', 'ephemeral', 'url', 'mediaUrl', 'mediaType', 'provider', 'storage', 'purpose', 'context', 'streamUid', 'cloudflareStream', 'playback', 'thumbnailUrl'];
  return [
    { $match: { roomId } },
    { $project: { _id: 0, messages: { $map: {
      input: { $filter: { input: { $ifNull: ['$messages', []] }, as: 'm', cond: { $and: [
        { $ne: ['$$m.deleted', true] },
        { $not: [{ $in: [userId, { $ifNull: ['$$m.hiddenFor', []] }] }] },
        { $or: [encoded, { $ne: [{ $ifNull: ['$$m.url', ''] }, ''] }, { $ne: [{ $ifNull: ['$$m.mediaUrl', ''] }, ''] }, { $ne: [{ $ifNull: ['$$m.streamUid', ''] }, ''] }] },
      ] } } },
      as: 'm', in: { ...Object.fromEntries(fields.map(f => [f, '$$m.' + f])), text: { $cond: [encoded, '$$m.text', ''] } },
    } } } },
  ];
}
const compare = (a, b) => b.createdAtMs - a.createdAtMs || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
function decodeCursor(value) {
  if (!value) return null;
  try {
    const [createdAtMs, id] = JSON.parse(Buffer.from(String(value), 'base64url').toString());
    if (!Number.isFinite(createdAtMs) || typeof id !== 'string' || !id || id.length > 256) throw Error();
    return { createdAtMs, id };
  } catch { throw Object.assign(new Error('Invalid media cursor'), { status: 400 }); }
}
async function getChatMediaPage(roomId, userId, query, sign = signChatMessages) {
  const kind = query.kind || 'shared', mediaType = query.mediaType || 'image';
  if (!['shared', 'purchased'].includes(kind) || !['image', 'video'].includes(mediaType)) throw Object.assign(new Error('Invalid media filter'), { status: 400 });
  const limit = Math.max(1, Math.min(60, Math.floor(Number(query.limit) || 30))), cursor = decodeCursor(query.before);
  const [room] = await ChatRoom.aggregate(mediaPipeline(roomId, userId));
  const byId = new Map();
  for (const message of room?.messages || []) {
    const row = chatMediaRow(message);
    if (row) byId.set(row.id, { row, message });
  }
  const candidates = [...byId.values()].filter(({row}) => (row.giftLocked || row.giftPriceBC > 0) === (kind === 'purchased'));
  const counts = { image: 0, video: 0 };
  candidates.forEach(({row}) => counts[row.mediaType]++);
  const ordered = candidates.filter(({row}) => row.mediaType === mediaType && (!cursor || compare(row, cursor) > 0)).sort((a,b) => compare(a.row,b.row));
  const page = ordered.slice(0, limit), last = page.at(-1)?.row;
  // Legacy payload-only R2 URLs also need signing. Sign only this page.
  const signed = await sign(page.map(({message,row}) => ({ ...message, url: row.url })), 3600);
  const items = await Promise.all(signed.map(async message => {
    const row = chatMediaRow(message);
    if (row && isR2Key(row.thumbnailUrl)) row.thumbnailUrl = await getSignedMediaUrl(row.thumbnailUrl, 3600);
    return row;
  }));
  return { items: items.filter(Boolean), counts, hasMore: ordered.length > limit, nextCursor: last ? Buffer.from(JSON.stringify([last.createdAtMs, last.id])).toString('base64url') : null };
}
module.exports = { mediaPipeline, getChatMediaPage };
