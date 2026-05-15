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

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

function isExpoPushToken(token = "") {
  return /^Expo(?:nent)?PushToken\[[^\]]+\]$/.test(String(token || "").trim());
}

function uniqPushTokens(pushTokens = []) {
  const seen = new Set();
  const out = [];

  for (const entry of Array.isArray(pushTokens) ? pushTokens : []) {
    const token = String(entry?.token || "").trim();

    if (!isExpoPushToken(token)) continue;
    if (seen.has(token)) continue;

    seen.add(token);
    out.push(token);
  }

  return out;
}

function chunkList(list = [], size = 100) {
  const chunks = [];

  for (let i = 0; i < list.length; i += size) {
    chunks.push(list.slice(i, i + size));
  }

  return chunks;
}

async function sendExpoPushMessages(messages = []) {
  const safeMessages = Array.isArray(messages) ? messages.filter(Boolean) : [];
  if (!safeMessages.length) {
    return {
      ok: true,
      sent: 0,
      chunks: 0,
      results: [],
    };
  }

  const chunks = chunkList(safeMessages, 100);
  const results = [];

  for (const chunk of chunks) {
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip, deflate",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(chunk),
      });

      const text = await res.text();
      let json = null;

      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = { raw: text };
      }

      results.push({
        ok: res.ok,
        status: res.status,
        body: json,
      });
    } catch (err) {
      results.push({
        ok: false,
        status: 0,
        error: err?.message || "expo_push_failed",
      });
    }
  }

  return {
    ok: results.every((item) => item.ok),
    sent: safeMessages.length,
    chunks: chunks.length,
    results,
  };
}

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
  const tokens = uniqPushTokens(receiver?.pushTokens || []);
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