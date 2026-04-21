const shortid = require("shortid");
const Notification = require("../models/Notification");
const MatchStreak = require("../models/MatchStreak");
const Relationship = require("../models/Relationship");
const User = require("../models/User");

const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const DEFAULT_NOTIFICATION_SETTINGS = {
  likes: true,
  messages: true,
  buzz: true,
  wingman: true,
  email: false,
};
const EXPO_PUSH_TOKEN_RE = /^Expo(?:nent)?PushToken\[[^\]]+\]$/;

function fullName(user = {}) {
  return [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim();
}

function truncateText(value, max = 120) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max - 3).trimEnd()}...` : text;
}

function notificationSettingKeyForType(type = "") {
  switch (String(type || "").toLowerCase()) {
    case "message":
      return "messages";
    case "buzz":
    case "match":
      return "buzz";
    case "wingman":
      return "wingman";
    case "like":
    case "gift":
    case "comment":
    case "reaction":
    case "new_post":
    case "share":
      return "likes";
    default:
      return "";
  }
}

function isPushEnabledForUser(user = {}, type = "") {
  const key = notificationSettingKeyForType(type);
  if (!key) return true;

  const prefs = {
    ...DEFAULT_NOTIFICATION_SETTINGS,
    ...(user?.settings?.notifications || {}),
  };

  return prefs[key] !== false;
}

function isValidExpoPushToken(token = "") {
  return EXPO_PUSH_TOKEN_RE.test(String(token || "").trim());
}

function getUserPushTokens(user = {}) {
  const list = [];

  if (Array.isArray(user?.pushTokens)) {
    for (const entry of user.pushTokens) {
      const token = String(entry?.token || "").trim();
      if (isValidExpoPushToken(token)) list.push(token);
    }
  }

  if (isValidExpoPushToken(user?.pushToken)) {
    list.push(String(user.pushToken).trim());
  }

  return [...new Set(list)];
}

function chunkArray(list = [], size = 100) {
  const chunks = [];
  for (let i = 0; i < list.length; i += size) {
    chunks.push(list.slice(i, i + size));
  }
  return chunks;
}

async function getFetchImpl() {
  if (typeof global.fetch === "function") {
    return global.fetch.bind(global);
  }

  const mod = await import("node-fetch");
  return mod.default;
}

async function pruneInvalidPushTokens(userId, tokens = []) {
  const uniqueTokens = [...new Set((tokens || []).filter(Boolean))];
  if (!userId || !uniqueTokens.length) return;

  try {
    await User.updateOne(
      { id: String(userId) },
      {
        $pull: {
          pushTokens: {
            token: { $in: uniqueTokens },
          },
        },
      }
    );
  } catch (err) {
    console.error("Failed to prune invalid push tokens:", err);
  }
}

async function sendExpoPushMessages(messages = []) {
  const validMessages = Array.isArray(messages)
    ? messages.filter((msg) => isValidExpoPushToken(msg?.to))
    : [];

  if (!validMessages.length) {
    return { invalidTokens: [], sentCount: 0 };
  }

  const fetchImpl = await getFetchImpl();
  const invalidTokens = [];

  for (const batch of chunkArray(validMessages, 100)) {
    try {
      const response = await fetchImpl(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip, deflate",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(batch),
      });

      const json = await response.json().catch(() => ({}));
      const tickets = Array.isArray(json?.data) ? json.data : [];

      tickets.forEach((ticket, index) => {
        if (ticket?.details?.error === "DeviceNotRegistered") {
          const token = batch[index]?.to;
          if (token) invalidTokens.push(token);
        }
      });
    } catch (err) {
      console.error("Expo push send error:", err);
    }
  }

  return {
    invalidTokens: [...new Set(invalidTokens)],
    sentCount: validMessages.length,
  };
}

async function sendPushToUser(user = {}, payload = {}) {
  const tokens = getUserPushTokens(user);
  if (!tokens.length) {
    return { sentCount: 0, invalidTokens: [] };
  }

  const messages = tokens.map((token) => ({
    to: token,
    sound: "default",
    title: String(payload?.title || "RomBuzz"),
    body: String(payload?.body || "You have a new notification."),
    data: payload?.data && typeof payload.data === "object" ? payload.data : {},
  }));

  const result = await sendExpoPushMessages(messages);

  if (result.invalidTokens.length) {
    await pruneInvalidPushTokens(user?.id, result.invalidTokens);
  }

  return result;
}

function buildNotificationPushData(notif = {}, data = {}) {
  return {
    notificationId: String(notif?.id || ""),
    notificationType: String(data?.notificationType || notif?.type || "system"),
    type: String(data?.type || notif?.type || "system"),
    href: String(data?.href || notif?.href || ""),
    fromId: String(data?.fromId || notif?.fromId || ""),
    userId: String(data?.userId || notif?.fromId || notif?.entityId || ""),
    postId: String(data?.postId || notif?.postId || notif?.entityId || ""),
    postOwnerId: String(data?.postOwnerId || notif?.postOwnerId || ""),
    entity: String(data?.entity || notif?.entity || ""),
    entityId: String(data?.entityId || notif?.entityId || ""),
    peerId: String(data?.peerId || ""),
    screen: String(data?.screen || ""),
  };
}

function buildNotificationPushContent(notif = {}, data = {}, actor = null) {
  const actorName = String(data?.actorName || fullName(actor) || "").trim();
  const fallbackBody = String(notif?.message || data?.body || "You have a new notification.").trim();
  const type = String(notif?.type || data?.type || "system").toLowerCase();

  switch (type) {
    case "wingman":
      return {
        title: "AI Wingman",
        body: fallbackBody || "Your AI Wingman has something new for you.",
      };
    case "buzz":
      return {
        title: actorName || "New buzz",
        body: fallbackBody || `${actorName || "Someone"} buzzed you.`,
      };
    case "match":
      return {
        title: actorName || "New match",
        body: fallbackBody || `${actorName || "Someone"} matched with you.`,
      };
    case "like":
    case "gift":
      return {
        title: actorName || "New like",
        body: fallbackBody || `${actorName || "Someone"} liked your post.`,
      };
    case "comment":
      return {
        title: actorName || "New comment",
        body: fallbackBody || `${actorName || "Someone"} commented on your post.`,
      };
    case "reaction":
      return {
        title: actorName || "New reaction",
        body: fallbackBody || `${actorName || "Someone"} reacted to your post.`,
      };
    case "new_post":
      return {
        title: actorName || "New post",
        body: fallbackBody || `${actorName || "Someone"} shared something new.`,
      };
    case "share":
      return {
        title: actorName || "Shared with you",
        body: fallbackBody || `${actorName || "Someone"} shared a post with you.`,
      };
    default:
      return {
        title: actorName || "RomBuzz",
        body: fallbackBody || "You have a new notification.",
      };
  }
}

function buildChatPushBody(message = {}) {
  const preview = truncateText(message?.text, 120);
  if (preview && !preview.startsWith("::RBZ::")) {
    return preview;
  }

  const type = String(message?.type || "").toLowerCase();

  if (["photo", "image"].includes(type)) return "Sent you a photo";
  if (["video", "reel", "share_reel"].includes(type)) return "Shared a reel";
  if (["audio", "voice"].includes(type)) return "Sent you a voice message";
  if (["share_post", "post"].includes(type)) return "Shared a post";
  if (message?.url) return "Sent you an attachment";

  return "Sent you a message";
}

async function sendNotificationPush(notif = {}, data = {}) {
  if (!notif?.toId || data?.skipPush === true) return null;

  try {
    const recipient = await User.findOne({ id: String(notif.toId) })
      .select("id firstName lastName settings pushTokens pushToken")
      .lean();

    if (!recipient) return null;
    if (!isPushEnabledForUser(recipient, notif.type)) return null;

    let actor = null;
    const actorId = String(data?.fromId || notif?.fromId || "").trim();
    if (actorId && actorId !== "system") {
      actor = await User.findOne({ id: actorId }).select("id firstName lastName").lean();
    }

    const content = buildNotificationPushContent(notif, data, actor);
    return sendPushToUser(recipient, {
      title: content.title,
      body: content.body,
      data: buildNotificationPushData(notif, data),
    });
  } catch (err) {
    console.error("sendNotificationPush error:", err);
    return null;
  }
}

async function sendChatMessagePush({ message, sender, recipient }) {
  if (!message || !sender?.id || !recipient?.id) return null;
  if (!isPushEnabledForUser(recipient, "message")) return null;

  try {
    return await sendPushToUser(recipient, {
      title: fullName(sender) || "New message",
      body: buildChatPushBody(message),
      data: {
        notificationId: String(message?.id || ""),
        notificationType: "message",
        type: "message",
        screen: "chat",
        peerId: String(sender.id),
        fromId: String(sender.id),
        userId: String(sender.id),
        roomId: [String(sender.id), String(recipient.id)].sort().join("_"),
      },
    });
  } catch (err) {
    console.error("sendChatMessagePush error:", err);
    return null;
  }
}

async function sendNotification(toId, data = {}) {
  try {
    if (!toId) {
      console.warn("sendNotification called without toId");
      return null;
    }

    const notif = {
      id: shortid.generate(),
      toId,
      fromId: data.fromId || "",
      type: data.type || "system",
      message: data.message || "",
      href: data.href || "",
      entity: data.entity || "",
      entityId: data.entityId || "",
      postId: data.postId || "",
      postOwnerId: data.postOwnerId || "",
      createdAt: Date.now(),
      read: false,
    };

    const mongoNotif = await Notification.create(notif);

    const io = global.io || null;
    const onlineUsers = global.onlineUsers || {};
    const socketId = onlineUsers[toId];

    if (io && socketId) {
      io.to(String(socketId)).emit(
        "notification",
        mongoNotif.toObject ? mongoNotif.toObject() : mongoNotif
      );
    }

    await sendNotificationPush(
      mongoNotif.toObject ? mongoNotif.toObject() : mongoNotif,
      data
    );

    console.log(`Notification -> ${toId}: ${notif.message}`);
    return mongoNotif;
  } catch (err) {
    console.error("sendNotification error:", err);
    return null;
  }
}

function baseSanitizeUser(user) {
  if (!user) return null;
  const {
    passwordHash,
    emailVerificationCode,
    pendingEmailChange,
    ...safe
  } = user;
  return {
    ...safe,
    profileComplete: user.profileComplete || false,
  };
}

async function isBlocked(a, b, c) {
  let user1;
  let user2;

  if (typeof a === "string" && typeof b === "string") {
    user1 = a;
    user2 = b;
  } else {
    user1 = b;
    user2 = c;
  }

  if (!user1 || !user2) return false;

  try {
    const exists = await Relationship.exists({
      type: "block",
      $or: [
        { from: String(user1), to: String(user2) },
        { from: String(user2), to: String(user1) },
      ],
    });
    return !!exists;
  } catch (err) {
    console.error("isBlocked Mongo error:", err);
    return false;
  }
}

function msToDays(ms) {
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

function distanceKm(loc1, loc2) {
  if (!loc1 || !loc2) return 0;
  const R = 6371;
  const dLat = ((loc2.lat - loc1.lat) * Math.PI) / 180;
  const dLon = ((loc2.lng - loc1.lng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((loc1.lat * Math.PI) / 180) *
      Math.cos((loc2.lat * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

const roomStore = global._roomMessages || (global._roomMessages = new Map());

async function getRoomDoc(_dbIgnored, roomId) {
  const key = String(roomId);
  let doc = roomStore.get(key);
  if (!doc) {
    doc = { roomId: key, list: [] };
    roomStore.set(key, doc);
  }
  return doc;
}

async function incMatchStreakOut(fromId, toId) {
  const from = String(fromId);
  const to = String(toId);
  const key = `${from}_${to}`;

  try {
    let streak = await MatchStreak.findOne({ key });

    if (!streak) {
      streak = await MatchStreak.create({
        id: shortid.generate(),
        key,
        from,
        to,
        count: 1,
        lastBuzz: new Date(),
      });
    } else {
      streak.count = Number(streak.count || 0) + 1;
      streak.lastBuzz = new Date();
      await streak.save();
    }

    return {
      from: streak.from,
      to: streak.to,
      count: Number(streak.count || 0),
      lastBuzz: streak.lastBuzz || null,
      createdAt: streak.createdAt || null,
    };
  } catch (err) {
    console.error("incMatchStreakOut Mongo error:", err);
    return {
      from,
      to,
      count: 0,
      lastBuzz: null,
      createdAt: null,
    };
  }
}

const RESTRICTED_VALUES = new Set([
  "flirty",
  "chill",
  "timepass",
  "ons",
  "threesome",
  "onlyfans",
]);

function isRestricted(value = "") {
  return RESTRICTED_VALUES.has(String(value || "").toLowerCase().trim());
}

function canUseRestricted(user = {}) {
  const tier = String(user?.premiumTier || "").toLowerCase().trim();

  return !!(
    user?.isPremium ||
    user?.isVerified ||
    tier === "premium" ||
    tier === "gold" ||
    tier === "platinum"
  );
}

module.exports = {
  sendNotification,
  sendNotificationPush,
  sendChatMessagePush,
  sendExpoPushMessages,
  baseSanitizeUser,
  isBlocked,
  msToDays,
  distanceKm,
  getRoomDoc,
  incMatchStreakOut,
  isRestricted,
  canUseRestricted,
  THIRTY_DAYS,
};
