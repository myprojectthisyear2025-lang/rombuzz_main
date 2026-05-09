/**
 * ============================================================
 * 📁 File: services/giftService.js
 * 🎁 Purpose: Central gift sending, transaction storage, summaries,
 * notifications, and socket events.
 *
 * Used by:
 *  - routes/gifts.js
 *  - future wrappers inside existing LetsBuzz/profile/chat routes
 *
 * Rules:
 *  - Backend validates giftId and price.
 *  - Frontend never controls price.
 *  - Wallet debit happens before completed transaction save.
 * ============================================================
 */

const shortid = require("shortid");

const User = require("../models/User");
const GiftTransaction = require("../models/GiftTransaction");
const GiftSummary = require("../models/GiftSummary");
const { validateGiftPurchase } = require("../config/rombuzzGifts");
const { debitBuzzCoins } = require("./buzzCoinService");
const { sendNotification } = require("../utils/helpers");

function getIO() {
  return global.io || null;
}

function getOnlineUsers() {
  global.onlineUsers ||= {};
  return global.onlineUsers;
}

function normalizePlacement(placement) {
  return String(placement || "universal").trim().toLowerCase();
}

function normalizeTargetType(targetType) {
  return String(targetType || "gift").trim().toLowerCase();
}

async function updateGiftSummary({
  receiverId,
  targetType,
  targetId,
  giftId,
  priceBC,
  senderId,
  transactionId,
}) {
  return GiftSummary.findOneAndUpdate(
    {
      receiverId: String(receiverId),
      targetType: String(targetType),
      targetId: String(targetId),
      giftId: String(giftId),
    },
    {
      $inc: {
        count: 1,
        totalBC: Number(priceBC) || 0,
      },
      $set: {
        latestSenderId: String(senderId),
        latestTransactionId: String(transactionId),
        latestGiftedAt: new Date(),
      },
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    }
  ).lean();
}

async function emitGiftEvent({ senderId, receiverId, payload }) {
  const io = getIO();
  if (!io) return;

  const onlineUsers = getOnlineUsers();
  const senderSocket = onlineUsers[String(senderId)];
  const receiverSocket = onlineUsers[String(receiverId)];

  if (senderSocket) {
    io.to(String(senderSocket)).emit("gift:new", payload);
  }

  if (receiverSocket) {
    io.to(String(receiverSocket)).emit("gift:new", payload);
  }
}

async function sendGift({
  senderId,
  receiverId,
  giftId,
  placement,
  targetType,
  targetId,
  appPlatform = "",
  appVersion = "",
  metadata = {},
}) {
  const cleanSenderId = String(senderId || "");
  const cleanReceiverId = String(receiverId || "");
  const cleanGiftId = String(giftId || "").trim();
  const cleanPlacement = normalizePlacement(placement);
  const cleanTargetType = normalizeTargetType(targetType);
  const cleanTargetId = String(targetId || "").trim();

  if (!cleanSenderId) {
    throw Object.assign(new Error("senderId required"), {
      statusCode: 400,
      code: "SENDER_REQUIRED",
    });
  }

  if (!cleanReceiverId) {
    throw Object.assign(new Error("receiverId required"), {
      statusCode: 400,
      code: "RECEIVER_REQUIRED",
    });
  }

  if (cleanSenderId === cleanReceiverId) {
    throw Object.assign(new Error("Cannot send gift to yourself"), {
      statusCode: 400,
      code: "CANNOT_GIFT_SELF",
    });
  }

  if (!cleanGiftId) {
    throw Object.assign(new Error("giftId required"), {
      statusCode: 400,
      code: "GIFT_REQUIRED",
    });
  }

  if (!cleanTargetId) {
    throw Object.assign(new Error("targetId required"), {
      statusCode: 400,
      code: "TARGET_REQUIRED",
    });
  }

  const giftCheck = validateGiftPurchase({
    giftId: cleanGiftId,
    placement: cleanPlacement,
  });

  if (!giftCheck.ok) {
    throw Object.assign(new Error(giftCheck.message || "Invalid gift"), {
      statusCode: 400,
      code: giftCheck.code || "INVALID_GIFT",
    });
  }

  const receiver = await User.findOne({ id: cleanReceiverId }).lean();
  if (!receiver) {
    throw Object.assign(new Error("Receiver not found"), {
      statusCode: 404,
      code: "RECEIVER_NOT_FOUND",
    });
  }

  const transactionId = shortid.generate();
  const priceBC = Number(giftCheck.priceBC) || 0;

  await debitBuzzCoins({
    userId: cleanSenderId,
    amountBC: priceBC,
    type: "gift_send",
    source: "gift",
    referenceId: transactionId,
    reason: `Sent ${cleanGiftId}`,
    metadata: {
      giftId: cleanGiftId,
      receiverId: cleanReceiverId,
      placement: cleanPlacement,
      targetType: cleanTargetType,
      targetId: cleanTargetId,
    },
  });

  const transaction = await GiftTransaction.create({
    id: shortid.generate(),
    transactionId,
    senderId: cleanSenderId,
    receiverId: cleanReceiverId,
    giftId: cleanGiftId,
    priceBC,
    placement: cleanPlacement,
    targetType: cleanTargetType,
    targetId: cleanTargetId,
    status: "completed",
    appPlatform,
    appVersion,
    metadata,
  });

  const summary = await updateGiftSummary({
    receiverId: cleanReceiverId,
    targetType: cleanTargetType,
    targetId: cleanTargetId,
    giftId: cleanGiftId,
    priceBC,
    senderId: cleanSenderId,
    transactionId,
  });

  try {
    const sender = await User.findOne({ id: cleanSenderId }).lean();
    const fromName = sender?.firstName || "Someone";

    await sendNotification(cleanReceiverId, {
      fromId: cleanSenderId,
      type: "gift",
      message: `${fromName} sent you a gift 🎁`,
      entity: cleanTargetType,
      entityId: cleanTargetId,
      giftId: cleanGiftId,
      transactionId,
    });
  } catch (err) {
    console.warn("Gift notification failed:", err?.message || err);
  }

  const payload = {
    transactionId,
    senderId: cleanSenderId,
    receiverId: cleanReceiverId,
    giftId: cleanGiftId,
    priceBC,
    placement: cleanPlacement,
    targetType: cleanTargetType,
    targetId: cleanTargetId,
    createdAt: transaction.createdAt,
  };

  await emitGiftEvent({
    senderId: cleanSenderId,
    receiverId: cleanReceiverId,
    payload,
  });

  return {
    ok: true,
    transaction,
    summary,
    giftId: cleanGiftId,
    priceBC,
    transactionId,
  };
}

async function getGiftSummary({
  viewerId,
  receiverId,
  targetType,
  targetId,
  includeTransactions = true,
  transactionLimit = 500,
}) {
  const cleanViewerId = String(viewerId || "");
  const cleanReceiverId = String(receiverId || "");
  const cleanTargetType = String(targetType || "").trim().toLowerCase();
  const cleanTargetId = String(targetId || "").trim();

  if (!cleanViewerId) {
    throw Object.assign(new Error("viewerId required"), {
      statusCode: 401,
      code: "VIEWER_REQUIRED",
    });
  }

  if (!cleanReceiverId) {
    throw Object.assign(new Error("receiverId required"), {
      statusCode: 400,
      code: "RECEIVER_REQUIRED",
    });
  }

  if (!cleanTargetType) {
    throw Object.assign(new Error("targetType required"), {
      statusCode: 400,
      code: "TARGET_TYPE_REQUIRED",
    });
  }

  if (!cleanTargetId) {
    throw Object.assign(new Error("targetId required"), {
      statusCode: 400,
      code: "TARGET_REQUIRED",
    });
  }

  const isOwner = cleanViewerId === cleanReceiverId;
  const baseQuery = {
    receiverId: cleanReceiverId,
    targetType: cleanTargetType,
    targetId: cleanTargetId,
    status: "completed",
  };

  const visibleQuery = isOwner
    ? baseQuery
    : {
        ...baseQuery,
        senderId: cleanViewerId,
      };

  const safeLimit = Math.min(
    Math.max(Number(transactionLimit) || 500, 1),
    1000
  );

  const transactions = await GiftTransaction.find(visibleQuery)
    .sort({ createdAt: -1 })
    .limit(safeLimit)
    .lean();

  const totalCount = transactions.length;
  const totalBC = transactions.reduce(
    (sum, tx) => sum + (Number(tx.priceBC) || 0),
    0
  );

  if (!totalCount) {
    return {
      viewerRole: isOwner ? "owner" : "viewer",
      receiverId: cleanReceiverId,
      targetType: cleanTargetType,
      targetId: cleanTargetId,
      totalCount: 0,
      totalBC: 0,
      rows: [],
      transactions: [],
    };
  }

  const senderIds = Array.from(
    new Set(transactions.map((tx) => String(tx.senderId || "")).filter(Boolean))
  );

  const users = await User.find({ id: { $in: senderIds } })
    .select("id firstName lastName avatar photos")
    .lean();

  const userMap = new Map(users.map((user) => [String(user.id), user]));
  const grouped = new Map();

  for (const tx of transactions) {
    const senderId = String(tx.senderId || "");
    if (!senderId) continue;

    if (!grouped.has(senderId)) {
      const user = userMap.get(senderId) || {};

      grouped.set(senderId, {
        userId: senderId,
        user: {
          id: senderId,
          firstName: user.firstName || "",
          lastName: user.lastName || "",
          avatar:
            user.avatar ||
            (Array.isArray(user.photos) && user.photos.length
              ? user.photos[0]
              : ""),
        },
        totalCount: 0,
        totalBC: 0,
        lastGiftAt: tx.createdAt || tx.updatedAt || null,
        gifts: [],
        recentGifts: [],
      });
    }

    const row = grouped.get(senderId);
    const sentAt = tx.createdAt || tx.updatedAt || null;

    row.totalCount += 1;
    row.totalBC += Number(tx.priceBC) || 0;

    if (
      sentAt &&
      (!row.lastGiftAt || new Date(sentAt).getTime() > new Date(row.lastGiftAt).getTime())
    ) {
      row.lastGiftAt = sentAt;
    }

    row.recentGifts.push({
      transactionId: tx.transactionId,
      giftId: tx.giftId,
      priceBC: Number(tx.priceBC) || 0,
      sentAt,
    });

    const existingGift = row.gifts.find(
      (gift) => String(gift.giftId) === String(tx.giftId)
    );

    if (existingGift) {
      existingGift.count += 1;
      existingGift.totalBC += Number(tx.priceBC) || 0;
      if (
        sentAt &&
        (!existingGift.lastGiftAt ||
          new Date(sentAt).getTime() > new Date(existingGift.lastGiftAt).getTime())
      ) {
        existingGift.lastGiftAt = sentAt;
      }
    } else {
      row.gifts.push({
        giftId: tx.giftId,
        count: 1,
        totalBC: Number(tx.priceBC) || 0,
        lastGiftAt: sentAt,
      });
    }
  }

  const rows = Array.from(grouped.values())
    .map((row) => ({
      ...row,
      gifts: row.gifts.sort((a, b) => {
        return new Date(b.lastGiftAt || 0).getTime() - new Date(a.lastGiftAt || 0).getTime();
      }),
      recentGifts: row.recentGifts.sort((a, b) => {
        return new Date(b.sentAt || 0).getTime() - new Date(a.sentAt || 0).getTime();
      }),
    }))
    .sort((a, b) => {
      return new Date(b.lastGiftAt || 0).getTime() - new Date(a.lastGiftAt || 0).getTime();
    });

  return {
    viewerRole: isOwner ? "owner" : "gifter",
    receiverId: cleanReceiverId,
    targetType: cleanTargetType,
    targetId: cleanTargetId,
    totalCount,
    totalBC,
    rows,
    transactions: includeTransactions ? transactions : [],
  };
}

async function listGiftTransactions({ userId, role = "all", limit = 50 }) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const id = String(userId);

  let query = {};
  if (role === "sent") query.senderId = id;
  else if (role === "received") query.receiverId = id;
  else query = { $or: [{ senderId: id }, { receiverId: id }] };

  return GiftTransaction.find(query)
    .sort({ createdAt: -1 })
    .limit(safeLimit)
    .lean();
}

module.exports = {
  sendGift,
  getGiftSummary,
  listGiftTransactions,
};
