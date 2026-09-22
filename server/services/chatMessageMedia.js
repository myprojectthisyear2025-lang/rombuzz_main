/**
 * Path: server/services/chatMessageMedia.js
 * Purpose: Shared chat media signing and reference helpers used by HTTP and socket messages.
 */
const { getSignedMediaUrl, getStoredMediaR2Key, isR2Key } = require("../utils/r2Media");
const { createSignedPlaybackToken, getStreamVideo, normalizeStreamUid } = require("./cloudflareStreamService");
function normalizeMediaString(value = "") {
  return String(value || "").trim();
}

async function signR2Value(value, expiresInSeconds = 3600) {
  const raw = normalizeMediaString(value);
  if (!raw) return null;
  if (!isR2Key(raw)) return raw;

  return getSignedMediaUrl(raw, expiresInSeconds);
}

function decodeRbzPayload(text = "") {
  const raw = String(text || "");
  if (!raw.startsWith("::RBZ::")) return null;

  try {
    const payload = JSON.parse(raw.slice("::RBZ::".length));
    return payload && typeof payload === "object" ? payload : null;
  } catch {
    return null;
  }
}

function getChatMessageStoredMedia(message = {}) {
  const raw =
    typeof message?.toObject === "function"
      ? message.toObject({ flattenMaps: true })
      : { ...(message || {}) };

  const payload = decodeRbzPayload(raw.text) || {};

  return {
    r2Key:
      raw.r2Key ||
      payload.r2Key ||
      payload.key ||
      "",
    key:
      raw.key ||
      payload.key ||
      "",
    url:
      raw.url ||
      payload.url ||
      payload.mediaUrl ||
      payload.fileUrl ||
      payload.previewUrl ||
      "",
    mediaUrl:
      raw.mediaUrl ||
      payload.mediaUrl ||
      "",
    fileUrl:
      raw.fileUrl ||
      payload.fileUrl ||
      "",
    imageUrl:
      raw.imageUrl ||
      payload.imageUrl ||
      payload.photoUrl ||
      "",
    photoUrl:
      raw.photoUrl ||
      payload.photoUrl ||
      "",
    attachmentUrl:
      raw.attachmentUrl ||
      payload.attachmentUrl ||
      "",
  };
}

function isChatR2KeyStillReferenced(room, key, excludedMsgId = "") {
  const cleanKey = String(key || "").trim();
  if (!cleanKey) return false;

  return (room?.messages || []).some((candidate) => {
    if (String(candidate?.id || "") === String(excludedMsgId || "")) {
      return false;
    }

    return getStoredMediaR2Key(getChatMessageStoredMedia(candidate)) === cleanKey;
  });
}

function getChatMessageStreamUid(message = {}) {
  const raw =
    typeof message?.toObject === "function"
      ? message.toObject({ flattenMaps: true })
      : { ...(message || {}) };

  const payload = decodeRbzPayload(raw.text) || {};

  return normalizeStreamUid(
    raw.streamUid ||
      raw.uid ||
      raw.cloudflareStream?.uid ||
      payload.streamUid ||
      payload.uid ||
      payload.cloudflareStream?.uid ||
      ""
  );
}

function isChatStreamUidStillReferenced(room, streamUid, excludedMsgId = "") {
  const cleanUid = normalizeStreamUid(streamUid);
  if (!cleanUid) return false;

  return (room?.messages || []).some((candidate) => {
    if (String(candidate?.id || "") === String(excludedMsgId || "")) {
      return false;
    }

    return getChatMessageStreamUid(candidate) === cleanUid;
  });
}

function replaceRbzPayloadUrl(text = "", signedUrl = "") {
  const raw = String(text || "");
  const nextUrl = String(signedUrl || "").trim();

  if (!raw.startsWith("::RBZ::") || !nextUrl) return raw;

  try {
    const payload = JSON.parse(raw.slice("::RBZ::".length));
    if (!payload || typeof payload !== "object") return raw;

    payload.url = nextUrl;
    return `::RBZ::${JSON.stringify(payload)}`;
  } catch {
    return raw;
  }
}

function replaceRbzPayloadStreamPlayback(text = "", stream = {}) {
  const raw = String(text || "");
  if (!raw.startsWith("::RBZ::")) return raw;

  try {
    const payload = JSON.parse(raw.slice("::RBZ::".length));
    if (!payload || typeof payload !== "object") return raw;

    payload.provider = "cloudflare_stream";
    payload.storage = "cloudflare_stream";
    payload.purpose = "chat_video";
    payload.context = "chat_video";
    payload.streamUid = stream.streamUid || payload.streamUid || "";
    payload.uid = stream.streamUid || payload.uid || "";
    payload.url = stream.playback?.hls || payload.url || "";
    payload.previewUrl = stream.playback?.hls || payload.previewUrl || "";
    payload.playback = stream.playback || payload.playback || {};
    payload.thumbnailUrl = stream.thumbnailUrl || payload.thumbnailUrl || "";
    payload.status = stream.status || payload.status || "processing";
    payload.duration = Number(stream.duration || payload.duration || 0);
    payload.cloudflareStream = {
      ...(payload.cloudflareStream || {}),
      uid: stream.streamUid || payload.cloudflareStream?.uid || "",
      provider: "cloudflare_stream",
      purpose: "chat_video",
      context: "chat_video",
      status: stream.status || payload.cloudflareStream?.status || "processing",
      duration: Number(stream.duration || payload.cloudflareStream?.duration || 0),
      requireSignedURLs: true,
    };

    return `::RBZ::${JSON.stringify(payload)}`;
  } catch {
    return raw;
  }
}

function getChatStreamUid(base = {}, payload = {}) {
  return normalizeStreamUid(
    base?.streamUid ||
      base?.cloudflareStream?.uid ||
      payload?.streamUid ||
      payload?.uid ||
      payload?.cloudflareStream?.uid ||
      ""
  );
}

function isChatStreamVideo(base = {}, payload = {}) {
  const provider = String(
    base?.provider ||
      base?.storage ||
      payload?.provider ||
      payload?.storage ||
      ""
  ).toLowerCase();

  const purpose = String(
    base?.purpose ||
      base?.cloudflareStream?.purpose ||
      base?.cloudflareStream?.context ||
      payload?.purpose ||
      payload?.context ||
      payload?.cloudflareStream?.purpose ||
      payload?.cloudflareStream?.context ||
      ""
  ).toLowerCase();

  const mediaType = String(base?.mediaType || payload?.mediaType || "").toLowerCase();

  return (
    mediaType === "video" &&
    provider === "cloudflare_stream" &&
    purpose === "chat_video" &&
    !!getChatStreamUid(base, payload)
  );
}

async function signChatStreamVideoMessage(base = {}, payload = {}) {
  const streamUid = getChatStreamUid(base, payload);
  if (!streamUid) return base;

  try {
    const video = await getStreamVideo(streamUid);
    const signed = await createSignedPlaybackToken(streamUid);
    const playback = signed?.playback || {};

    const streamPayload = {
      streamUid,
      playback,
      thumbnailUrl: playback?.thumbnailUrl || video?.thumbnailUrl || "",
      status: video?.status || "processing",
      duration: Number(video?.duration || 0),
    };

    return {
      ...base,
      provider: "cloudflare_stream",
      storage: "cloudflare_stream",
      purpose: "chat_video",
      streamUid,
      url: playback?.hls || "",
      playback,
      thumbnailUrl: streamPayload.thumbnailUrl,
      status: streamPayload.status,
      duration: streamPayload.duration,
      cloudflareStream: {
        ...(base.cloudflareStream || {}),
        uid: streamUid,
        provider: "cloudflare_stream",
        purpose: "chat_video",
        context: "chat_video",
        status: streamPayload.status,
        duration: streamPayload.duration,
        requireSignedURLs: true,
      },
      text: replaceRbzPayloadStreamPlayback(base.text, streamPayload),
    };
  } catch (err) {
    console.warn("signChatStreamVideoMessage failed:", err?.message || err);
    return base;
  }
}

async function signChatMessageMedia(message = {}, expiresInSeconds = 3600) {
  const base =
    typeof message?.toObject === "function"
      ? message.toObject({ flattenMaps: true })
      : { ...(message || {}) };

  const payload = decodeRbzPayload(base.text);

  if (isChatStreamVideo(base, payload || {})) {
    return signChatStreamVideoMessage(base, payload || {});
  }

  const rawUrl = normalizeMediaString(base.url || "");
  const key = isR2Key(rawUrl) ? rawUrl : "";

  if (!key) return base;

  const signedUrl = await getSignedMediaUrl(key, expiresInSeconds);

  return {
    ...base,
    url: signedUrl,
    r2Key: key,
    text: replaceRbzPayloadUrl(base.text, signedUrl),
  };
}

async function signChatMessages(messages = [], expiresInSeconds = 3600) {
  return Promise.all(
    (messages || []).map((message) =>
      signChatMessageMedia(message, expiresInSeconds)
    )
  );
}


module.exports = { signChatMessageMedia, signChatMessages, getChatMessageStoredMedia, isChatR2KeyStillReferenced, getChatMessageStreamUid, isChatStreamUidStillReferenced };
