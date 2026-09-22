/**
 * Path: server/services/chatUnread.js
 * Purpose: Shared existing Mongo unread summary for HTTP and socket writes.
 */
const ChatRoom = require("../models/ChatRoom");
const User = require("../models/User");
const Match = require("../models/Match");
function countUnreadForRoom(room, me) {
  const myId = String(me);
  const prefs = room.chatPrefsByUser?.get?.(myId) || room.chatPrefsByUser?.[myId] || {};

  const lastRead =
    (room.lastReadAtByUser?.get && room.lastReadAtByUser.get(myId)) ||
    (room.lastReadAtByUser && room.lastReadAtByUser[myId]) ||
    new Date(0);

  const msgs = room.messages || [];
  let n = 0;

  for (const m of msgs) {
    if (!m) continue;
    if (String(m.to) !== myId) continue;
    if (m.deleted) continue;
    if (m.seen) continue;
    if (m.expireAt && new Date(m.expireAt) <= new Date()) continue;
    if (m.hiddenFor?.includes?.(myId)) continue;

    const t = new Date(m.time || 0);
    if (t > new Date(lastRead || 0)) n++;
  }

  // ✅ Manual "Mark as unread" should show a badge even if there are no new messages.
  if (n === 0 && prefs.forceUnread) return 1;

  return n;
}

async function computeUnreadSummaryForUser(userId) {
  const me = String(userId);
  const rooms = await ChatRoom.find({ participants: me }).lean(false);

  const roomPeerIds = [
    ...new Set(
      rooms
        .map((room) => {
          const participants = room?.participants || [];
          return String(
            participants.find((p) => String(p) !== me) || ""
          );
        })
        .filter(Boolean)
    ),
  ];

  if (!roomPeerIds.length) {
    return { total: 0, byPeer: {} };
  }

  const [activeUsers, matchDocs] = await Promise.all([
    User.find({
      id: { $in: roomPeerIds },
      visibility: { $ne: "pending_delete" },
      deleteStatus: { $ne: "pending_delete" },
    })
      .select("id")
      .lean(),

    Match.find({
      $or: [
        { users: me },
        { status: "matched", user1: me },
        { status: "matched", user2: me },
      ],
    })
      .select("users user1 user2 status")
      .lean(),
  ]);

  const activePeerIds = new Set(
    activeUsers.map((user) => String(user.id || ""))
  );

  const matchedPeerIds = new Set();

  for (const match of matchDocs) {
    let peerId = "";

    if (Array.isArray(match?.users)) {
      peerId =
        match.users
          .map(String)
          .find((id) => id !== me) || "";
    } else {
      const user1 = String(match?.user1 || "");
      const user2 = String(match?.user2 || "");

      if (user1 === me) peerId = user2;
      if (user2 === me) peerId = user1;
    }

    if (peerId) {
      matchedPeerIds.add(peerId);
    }
  }

  const byPeer = {};
  let total = 0;

  for (const room of rooms) {
    const participants = room.participants || [];
    const peerId = String(
      participants.find((p) => String(p) !== me) || ""
    );

    if (!peerId) continue;
    if (!activePeerIds.has(peerId)) continue;
    if (!matchedPeerIds.has(peerId)) continue;

    const c = countUnreadForRoom(room, me);

    if (c > 0) {
      byPeer[peerId] = c;
    }

    total += c;
  }

  return { total, byPeer };
}

module.exports = { computeUnreadSummaryForUser, countUnreadForRoom };
