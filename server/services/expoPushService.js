/**
 * ============================================================
 * 📁 File: services/expoPushService.js
 * 🔔 Purpose: Send Expo push notifications from RomBuzz backend.
 *
 * Used by:
 *   - routes/videoCalls.js
 *
 * What this file does:
 *   - Collects Expo push tokens saved on User.pushTokens
 *   - Sends push notifications through Expo Push API
 *   - Keeps backend safe if push fails
 *
 * Notes:
 *   - Uses Node 18+ global fetch.
 *   - No extra npm package required.
 * ============================================================
 */


function isExpoPushToken(token = "") {
  return /^Expo(?:nent)?PushToken\[[^\]]+\]$/.test(String(token || "").trim());
}

function uniqPushTokens(pushTokens = [], legacyPushToken = "") {
  const seen = new Set();
  const out = [];
  const candidates = [
    ...(Array.isArray(pushTokens) ? pushTokens : []),
    legacyPushToken,
  ];

  for (const entry of candidates) {
    const token = String(
      typeof entry === "string" ? entry : entry?.token || "",
    ).trim();

    if (!isExpoPushToken(token)) continue;
    if (seen.has(token)) continue;

    seen.add(token);
    out.push(token);
  }

  return out;
}

const { createExpoPushTransport } = require("./expoPushTransport");
const { saveReceipt, prune, report } = require("./expoPushReceipts");
const sendExpoPushMessages = createExpoPushTransport({
  fetchImpl: (...args) => global.fetch(...args), saveReceipt, prune, report,
});

function getUserDisplayName(user = {}) {
  const first = String(user?.firstName || "").trim();
  const last = String(user?.lastName || "").trim();
  const full = `${first} ${last}`.trim();

  return full || "Someone";
}

function getUserAvatar(user = {}) {
  return String(user?.avatar || user?.profilePic || user?.photo || "").trim();
}

async function sendIncomingVideoCallPush({ receiver, call }) {
  if (receiver?.settings?.notifications?.push === false || receiver?.settings?.notifications?.messages === false) return { ok: true, sent: 0, reason: "disabled" };
  const tokens = uniqPushTokens(
    receiver?.pushTokens || [],
    receiver?.pushToken || "",
  );
  if (!tokens.length || !call?.id) {
    return {
      ok: true,
      sent: 0,
      reason: "no_push_tokens",
    };
  }

  const callerName = getUserDisplayName(call.caller || {});
  const callerAvatar = getUserAvatar(call.caller || {});
  const callId = String(call.id || "");
  const callerId = String(call.callerId || "");
  const receiverId = String(call.receiverId || "");
  const roomId = String(call.roomId || "");
  const channelName = String(call.channelName || "");
  const expiresAt = call.expiresAt ? new Date(call.expiresAt).toISOString() : "";

  const messages = tokens.map((token) => ({
    to: token,
    sound: "default",
    title: "Incoming RomBuzz video call",
    body: `${callerName} is calling you`,
    priority: "high",
    channelId: "default",
    ttl: 45,
    data: {
      type: "video_call_incoming",
      notificationType: "video_call_incoming",
      screen: "video_call",
      callId,
      callerId,
      receiverId,
      recipientId: receiverId,
      roomId,
      channelName,
      callerName,
      callerAvatar,
      expiresAt,
      href: `/video-call/${encodeURIComponent(callId)}`,
    },
  }));

  return sendExpoPushMessages(messages);
}

module.exports = {
  isExpoPushToken,
  uniqPushTokens,
  sendExpoPushMessages,
  sendIncomingVideoCallPush,
};