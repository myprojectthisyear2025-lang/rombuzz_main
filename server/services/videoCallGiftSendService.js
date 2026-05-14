/**
 * ============================================================
 * 📁 File: services/videoCallGiftSendService.js
 * 🎥🎁 Purpose: Direct BuzzCoin sending during an active
 *               RomBuzz 1-to-1 video call.
 *
 * Used by:
 *   - routes/videoCallGifts.js
 *
 * Flow:
 *   1. Tom sends 50 BC to Kylie while video call stays active.
 *   2. Tom's spendable wallet balanceBC is debited.
 *   3. Kylie's creator earnings earnedBC is credited.
 *   4. Both users receive socket events for in-call UI bubbles.
 *
 * Notes:
 *   - This does NOT close or modify the video call.
 *   - This does NOT use GiftTransaction because this is a raw BC
 *     creator earning transfer, not a catalog gift item.
 *   - This does NOT process real-money withdrawal.
 * ============================================================
 */

const shortid = require("shortid");

const User = require("../models/User");
const VideoCallSession = require("../models/VideoCallSession");

const {
  debitBuzzCoins,
  creditBuzzCoins,
  getWalletSnapshot,
} = require("./buzzCoinService");

const { getIO } = require("../socket");
const { onlineUsers } = require("../models/state");

function cleanText(value) {
  return String(value || "").trim();
}

function cleanFirstName(value) {
  const text = cleanText(value);
  if (!text) return "";
  return text.split(/\s+/).find(Boolean) || "";
}

function publicUser(user) {
  if (!user) return null;

  return {
    id: cleanText(user.id || user._id),
    firstName: cleanFirstName(user.firstName),
    lastName: cleanText(user.lastName),
    avatar: cleanText(user.avatar || user.profilePic || user.photo),
  };
}

function publicCall(call) {
  if (!call) return null;

  return {
    id: call.id,
    status: call.status,
    callerId: call.callerId,
    receiverId: call.receiverId,
    participants: call.participants || [],
    roomId: call.roomId,
    channelName: call.channelName,
    acceptedAt: call.acceptedAt,
    endedAt: call.endedAt,
    createdAt: call.createdAt,
    updatedAt: call.updatedAt,
  };
}

function normalizeAmountBC(value) {
  const amount = Math.floor(Number(value) || 0);

  if (amount <= 0) {
    throw Object.assign(new Error("amountBC must be greater than 0"), {
      statusCode: 400,
      code: "INVALID_AMOUNT",
    });
  }

  // Safety cap for in-call gifting. You can raise this later.
  if (amount > 100000) {
    throw Object.assign(new Error("amountBC is too large"), {
      statusCode: 400,
      code: "AMOUNT_TOO_LARGE",
    });
  }

  return amount;
}

function ensureParticipant(call, userId) {
  const me = String(userId || "");
  const participants = (call?.participants || []).map((x) => String(x));

  if (!participants.includes(me)) {
    throw Object.assign(new Error("forbidden"), {
      statusCode: 403,
      code: "FORBIDDEN",
    });
  }
}

function ensureAcceptedCall(call) {
  if (!call) {
    throw Object.assign(new Error("call not found"), {
      statusCode: 404,
      code: "CALL_NOT_FOUND",
    });
  }

  if (String(call.status || "") !== "accepted") {
    throw Object.assign(new Error("Video call is not active"), {
      statusCode: 409,
      code: "CALL_NOT_ACTIVE",
    });
  }
}

function getOtherParticipant(call, senderId) {
  const sender = String(senderId || "");
  const participants = (call?.participants || []).map((x) => String(x));
  return participants.find((id) => id && id !== sender) || "";
}

function emitToUser(userId, eventName, payload) {
  const io = getIO();
  if (!io) return;

  const uid = String(userId || "");
  const sid = onlineUsers?.[uid];

  if (sid) io.to(sid).emit(eventName, payload);

  // Also emit to user room if sockets join by user id.
  io.to(uid).emit(eventName, payload);
}

async function sendVideoCallBuzzCoinGift({
  senderId,
  callId,
  amountBC,
  metadata = {},
}) {
  const cleanSenderId = String(senderId || "");
  const cleanCallId = String(callId || "").trim();
  const cleanAmountBC = normalizeAmountBC(amountBC);

  if (!cleanSenderId) {
    throw Object.assign(new Error("senderId required"), {
      statusCode: 400,
      code: "SENDER_REQUIRED",
    });
  }

  if (!cleanCallId) {
    throw Object.assign(new Error("callId required"), {
      statusCode: 400,
      code: "CALL_REQUIRED",
    });
  }

  const call = await VideoCallSession.findOne({ id: cleanCallId });
  ensureAcceptedCall(call);
  ensureParticipant(call, cleanSenderId);

  const receiverId = getOtherParticipant(call, cleanSenderId);

  if (!receiverId) {
    throw Object.assign(new Error("receiver not found for call"), {
      statusCode: 400,
      code: "RECEIVER_REQUIRED",
    });
  }

  if (receiverId === cleanSenderId) {
    throw Object.assign(new Error("Cannot send BuzzCoin to yourself"), {
      statusCode: 400,
      code: "CANNOT_SEND_SELF",
    });
  }

  const [sender, receiver] = await Promise.all([
    User.findOne({ id: cleanSenderId }).lean(),
    User.findOne({ id: receiverId }).lean(),
  ]);

  if (!sender) {
    throw Object.assign(new Error("Sender not found"), {
      statusCode: 404,
      code: "SENDER_NOT_FOUND",
    });
  }

  if (!receiver) {
    throw Object.assign(new Error("Receiver not found"), {
      statusCode: 404,
      code: "RECEIVER_NOT_FOUND",
    });
  }

  const transactionId = `vc_gift_${shortid.generate()}`;

  const senderWallet = await debitBuzzCoins({
    userId: cleanSenderId,
    amountBC: cleanAmountBC,
    type: "video_call_gift_send",
    source: "video_call_gift",
    referenceId: transactionId,
    reason: "Sent BuzzCoin during video call",
    metadata: {
      callId: cleanCallId,
      roomId: String(call.roomId || ""),
      receiverId,
      amountBC: cleanAmountBC,
      ...metadata,
    },
  });

  const receiverWallet = await creditBuzzCoins({
    userId: receiverId,
    amountBC: cleanAmountBC,
    type: "video_call_gift_receive",
    source: "video_call_gift",
    referenceId: transactionId,
    reason: "Received creator earnings during video call",
    walletBucket: "earned",
    metadata: {
      callId: cleanCallId,
      roomId: String(call.roomId || ""),
      senderId: cleanSenderId,
      amountBC: cleanAmountBC,
      ...metadata,
    },
  });

  const payload = {
    ok: true,
    transactionId,
    type: "video_call_gift_send",
    call: publicCall(call),
    callId: cleanCallId,
    roomId: String(call.roomId || ""),
    senderId: cleanSenderId,
    receiverId,
    amountBC: cleanAmountBC,
    sender: publicUser(sender),
    receiver: publicUser(receiver),
    senderWallet,
    receiverWallet,
    message: `${cleanFirstName(sender.firstName) || "Someone"} sent you ${cleanAmountBC} BC`,
    createdAt: new Date().toISOString(),
  };

  emitToUser(cleanSenderId, "video-call-gift:sent", payload);
  emitToUser(receiverId, "video-call-gift:received", payload);

  return payload;
}

module.exports = {
  sendVideoCallBuzzCoinGift,
};