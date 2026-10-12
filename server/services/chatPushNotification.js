// Called only by the transport that inserted a message; retries of that ID never push twice.
const User = require("../models/User");
const ChatRoom = require("../models/ChatRoom");
const { sendChatMessagePush } = require("../utils/helpers");
async function sendPersistedChatPush(message, roomId) {
  try {
    const [sender, recipient, room] = await Promise.all([
      User.findOne({ id: message.from }).select("id firstName lastName").lean(),
      User.findOne({ id: message.to }).select("id settings pushTokens pushToken visibility deleteStatus").lean(),
      ChatRoom.findOne({ roomId }).select("chatPrefsByUser").lean(),
    ]);
    if (!recipient || recipient.deleteStatus === "pending_delete" || ["pending_delete", "deactivated"].includes(recipient.visibility)) return;
    if (room?.chatPrefsByUser?.[message.to]?.muted) return;
    await sendChatMessagePush({ message, sender, recipient });
  } catch { console.warn("Chat push dispatch failed"); }
}
module.exports = { sendPersistedChatPush };
