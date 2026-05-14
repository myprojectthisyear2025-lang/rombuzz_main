/**
 * ============================================================
 * 📁 File: services/videoCallGiftRequestService.js
 * 🎥🎁 Purpose: BuzzCoin request / accept / reject flow during
 *               an active RomBuzz 1-to-1 video call.
 *
 * Used by:
 *   - routes/videoCallGifts.js
 *
 * Flow:
 *   1. Tom requests 100 BC from Kylie during a video call.
 *   2. Kylie receives a small in-call request bubble.
 *   3. Kylie accepts or rejects.
 *   4. If accepted:
 *        Kylie balanceBC is debited.
 *        Tom earnedBC is credited.
 *   5. If rejected:
 *        No wallet balance changes.
 *
 * Notes:
 *   - This does NOT close or modify the video call.
 *   - This does NOT process real-money payout.
 *   - This stores request state in VideoCallGiftRequest.
 * ============================================================
 */

const shortid = require("shortid");

const User = require("../models/User");
const VideoCallSession = require("../models/VideoCallSession");
const VideoCallGiftRequest = require("../models/VideoCallGiftRequest");

const {
  debitBuzzCoins,
  creditBuzzCoins,
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

function publicRequest(request) {
  if (!request) return null;

  return {
    id: request.id,
    callId: request.callId,
    roomId: request.roomId || "",
    requesterId: request.requesterId,
    receiverId: request.receiverId,
    amountBC: Number(request.amountBC) || 0,
    note: request.note || "",
    status: request.status,
    acceptedAt: request.acceptedAt,
    rejectedAt: request.rejectedAt,
    expiredAt: request.expiredAt,
    cancelledAt: request.cancelledAt,
    respondedBy: request.respondedBy || "",
    transactionId: request.transactionId || "",
    failureReason: request.failureReason || "",
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
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

  // Safety cap for in-call requests. You can raise this later.
  if (amount > 100000) {
    throw Object.assign(new Error("amountBC is too large"), {
      statusCode: 400,
      code: "AMOUNT_TOO_LARGE",
    });
  }

  return amount;
}

function normalizeNote(value) {
  const note = String(value || "").trim();

  if (note.length > 100) {
    throw Object.assign(new Error("Note must be 100 characters or less"), {
      statusCode: 400,
      code: "NOTE_TOO_LONG",
    });
  }

  return note;
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

function getOtherParticipant(call, userId) {
  const me = String(userId || "");
  const participants = (call?.participants || []).map((x) => String(x));
  return participants.find((id) => id && id !== me) || "";
}

function ensurePendingRequest(request) {
  if (!request) {
    throw Object.assign(new Error("request not found"), {
      statusCode: 404,
      code: "REQUEST_NOT_FOUND",
    });
  }

  if (String(request.status || "") !== "pending") {
    throw Object.assign(new Error("Request is no longer pending"), {
      statusCode: 409,
      code: "REQUEST_NOT_PENDING",
    });
  }
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

async function createVideoCallBuzzCoinRequest({
  requesterId,
  callId,
  amountBC,
  note = "",
  metadata = {},
}) {
  const cleanRequesterId = String(requesterId || "");
  const cleanCallId = String(callId || "").trim();
  const cleanAmountBC = normalizeAmountBC(amountBC);
  const cleanNote = normalizeNote(note);

  if (!cleanRequesterId) {
    throw Object.assign(new Error("requesterId required"), {
      statusCode: 400,
      code: "REQUESTER_REQUIRED",
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
  ensureParticipant(call, cleanRequesterId);

  const receiverId = getOtherParticipant(call, cleanRequesterId);

  if (!receiverId) {
    throw Object.assign(new Error("receiver not found for call"), {
      statusCode: 400,
      code: "RECEIVER_REQUIRED",
    });
  }

  if (receiverId === cleanRequesterId) {
    throw Object.assign(new Error("Cannot request BuzzCoin from yourself"), {
      statusCode: 400,
      code: "CANNOT_REQUEST_SELF",
    });
  }

  const [requester, receiver] = await Promise.all([
    User.findOne({ id: cleanRequesterId }).lean(),
    User.findOne({ id: receiverId }).lean(),
  ]);

  if (!requester) {
    throw Object.assign(new Error("Requester not found"), {
      statusCode: 404,
      code: "REQUESTER_NOT_FOUND",
    });
  }

  if (!receiver) {
    throw Object.assign(new Error("Receiver not found"), {
      statusCode: 404,
      code: "RECEIVER_NOT_FOUND",
    });
  }

  const request = await VideoCallGiftRequest.create({
    id: `vc_req_${shortid.generate()}`,
    callId: cleanCallId,
    roomId: String(call.roomId || ""),
    requesterId: cleanRequesterId,
    receiverId,
    amountBC: cleanAmountBC,
    note: cleanNote,
    status: "pending",
    metadata,
  });

  const payload = {
    ok: true,
    type: "video_call_request_create",
    call: publicCall(call),
    request: publicRequest(request),
    callId: cleanCallId,
    roomId: String(call.roomId || ""),
    requesterId: cleanRequesterId,
    receiverId,
    amountBC: cleanAmountBC,
    note: cleanNote,
    requester: publicUser(requester),
    receiver: publicUser(receiver),
    message: `${cleanFirstName(requester.firstName) || "Someone"} requested ${cleanAmountBC} BC`,
    createdAt: new Date().toISOString(),
  };

  emitToUser(cleanRequesterId, "video-call-gift-request:created", payload);
  emitToUser(receiverId, "video-call-gift-request:received", payload);

  return payload;
}

async function acceptVideoCallBuzzCoinRequest({
  receiverId,
  requestId,
  metadata = {},
}) {
  const cleanReceiverId = String(receiverId || "");
  const cleanRequestId = String(requestId || "").trim();

  if (!cleanReceiverId) {
    throw Object.assign(new Error("receiverId required"), {
      statusCode: 400,
      code: "RECEIVER_REQUIRED",
    });
  }

  if (!cleanRequestId) {
    throw Object.assign(new Error("requestId required"), {
      statusCode: 400,
      code: "REQUEST_REQUIRED",
    });
  }

  const request = await VideoCallGiftRequest.findOne({ id: cleanRequestId });
  ensurePendingRequest(request);

  if (String(request.receiverId) !== cleanReceiverId) {
    throw Object.assign(new Error("Only the request receiver can accept"), {
      statusCode: 403,
      code: "FORBIDDEN",
    });
  }

  const call = await VideoCallSession.findOne({ id: request.callId });
  ensureAcceptedCall(call);
  ensureParticipant(call, cleanReceiverId);

  const requesterId = String(request.requesterId || "");
  const amountBC = Number(request.amountBC) || 0;
  const transactionId = `vc_req_pay_${shortid.generate()}`;

  const [requester, receiver] = await Promise.all([
    User.findOne({ id: requesterId }).lean(),
    User.findOne({ id: cleanReceiverId }).lean(),
  ]);

  if (!requester) {
    throw Object.assign(new Error("Requester not found"), {
      statusCode: 404,
      code: "REQUESTER_NOT_FOUND",
    });
  }

  if (!receiver) {
    throw Object.assign(new Error("Receiver not found"), {
      statusCode: 404,
      code: "RECEIVER_NOT_FOUND",
    });
  }

  const payerWallet = await debitBuzzCoins({
    userId: cleanReceiverId,
    amountBC,
    type: "video_call_request_accept",
    source: "video_call_gift_request",
    referenceId: transactionId,
    reason: "Accepted BuzzCoin request during video call",
    metadata: {
      requestId: cleanRequestId,
      callId: String(request.callId || ""),
      roomId: String(request.roomId || ""),
      requesterId,
      amountBC,
      ...metadata,
    },
  });

  const requesterWallet = await creditBuzzCoins({
    userId: requesterId,
    amountBC,
    type: "video_call_request_receive",
    source: "video_call_gift_request",
    referenceId: transactionId,
    reason: "Received accepted BuzzCoin request during video call",
    walletBucket: "earned",
    metadata: {
      requestId: cleanRequestId,
      callId: String(request.callId || ""),
      roomId: String(request.roomId || ""),
      payerId: cleanReceiverId,
      amountBC,
      ...metadata,
    },
  });

  request.status = "accepted";
  request.acceptedAt = new Date();
  request.respondedBy = cleanReceiverId;
  request.transactionId = transactionId;
  request.failureReason = "";
  await request.save();

  const payload = {
    ok: true,
    type: "video_call_request_accept",
    transactionId,
    call: publicCall(call),
    request: publicRequest(request),
    callId: String(request.callId || ""),
    roomId: String(request.roomId || ""),
    requesterId,
    receiverId: cleanReceiverId,
    amountBC,
    requester: publicUser(requester),
    receiver: publicUser(receiver),
    payerWallet,
    requesterWallet,
    message: `${cleanFirstName(receiver.firstName) || "Someone"} accepted your ${amountBC} BC request`,
    createdAt: new Date().toISOString(),
  };

  emitToUser(requesterId, "video-call-gift-request:accepted", payload);
  emitToUser(cleanReceiverId, "video-call-gift-request:accepted", payload);

  return payload;
}

async function rejectVideoCallBuzzCoinRequest({
  receiverId,
  requestId,
  metadata = {},
}) {
  const cleanReceiverId = String(receiverId || "");
  const cleanRequestId = String(requestId || "").trim();

  if (!cleanReceiverId) {
    throw Object.assign(new Error("receiverId required"), {
      statusCode: 400,
      code: "RECEIVER_REQUIRED",
    });
  }

  if (!cleanRequestId) {
    throw Object.assign(new Error("requestId required"), {
      statusCode: 400,
      code: "REQUEST_REQUIRED",
    });
  }

  const request = await VideoCallGiftRequest.findOne({ id: cleanRequestId });
  ensurePendingRequest(request);

  if (String(request.receiverId) !== cleanReceiverId) {
    throw Object.assign(new Error("Only the request receiver can reject"), {
      statusCode: 403,
      code: "FORBIDDEN",
    });
  }

  const call = await VideoCallSession.findOne({ id: request.callId });
  ensureAcceptedCall(call);
  ensureParticipant(call, cleanReceiverId);

  const requesterId = String(request.requesterId || "");
  const amountBC = Number(request.amountBC) || 0;

  const [requester, receiver] = await Promise.all([
    User.findOne({ id: requesterId }).lean(),
    User.findOne({ id: cleanReceiverId }).lean(),
  ]);

  request.status = "rejected";
  request.rejectedAt = new Date();
  request.respondedBy = cleanReceiverId;
  request.failureReason = "rejected_by_receiver";
  await request.save();

  const payload = {
    ok: true,
    type: "video_call_request_reject",
    call: publicCall(call),
    request: publicRequest(request),
    callId: String(request.callId || ""),
    roomId: String(request.roomId || ""),
    requesterId,
    receiverId: cleanReceiverId,
    amountBC,
    requester: publicUser(requester),
    receiver: publicUser(receiver),
    message: `${cleanFirstName(receiver?.firstName) || "Someone"} rejected your ${amountBC} BC request`,
    createdAt: new Date().toISOString(),
    metadata,
  };

  emitToUser(requesterId, "video-call-gift-request:rejected", payload);
  emitToUser(cleanReceiverId, "video-call-gift-request:rejected", payload);

  return payload;
}

module.exports = {
  createVideoCallBuzzCoinRequest,
  acceptVideoCallBuzzCoinRequest,
  rejectVideoCallBuzzCoinRequest,
};