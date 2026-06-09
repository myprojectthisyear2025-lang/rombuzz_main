/**
 * ============================================================
 * 📁 File: services/cloudflareStreamService.js
 * 🎬 Purpose: Cloudflare Stream API service for RomBuzz reels/videos.
 *
 * Handles:
 *   - direct creator upload URL creation
 *   - Stream video status lookup
 *   - temporary signed playback token creation
 *   - normalized playback payloads for mobile
 *
 * Important:
 *   - Frontend never receives CF_STREAM_API_TOKEN.
 *   - New videos/reels should store provider + streamUid in MongoDB.
 *   - Old Cloudinary URLs remain supported elsewhere.
 * ============================================================
 */

const {
  CF_STREAM_API_TOKEN,
  CF_STREAM_MAX_REEL_SECONDS,
  getCloudflareStreamApiUrl,
  requireCloudflareStreamEnv,
} = require("../config/cloudflareStream");

function normalizeText(value = "") {
  return String(value || "").trim();
}

function normalizePrivacy(value = "") {
  const text = normalizeText(value).toLowerCase();

  if (
    text === "private" ||
    text === "hidden" ||
    text === "specific"
  ) {
    return "private";
  }

  if (
    text === "matches" ||
    text === "matched" ||
    text === "matched-only" ||
    text === "matched_only" ||
    text === "match-only" ||
    text === "match_only"
  ) {
    return "matches";
  }

  return "public";
}

function normalizeStreamUid(value = "") {
  return normalizeText(value).replace(/[^a-zA-Z0-9_-]/g, "");
}

function normalizeCreatorId(value = "") {
  return normalizeText(value).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;

  const text = normalizeText(value).toLowerCase();
  if (["true", "1", "yes", "y"].includes(text)) return true;
  if (["false", "0", "no", "n"].includes(text)) return false;

  return fallback;
}

function resolveRequireSignedUrls({ privacy, requireSignedURLs } = {}) {
  if (requireSignedURLs !== undefined) {
    return normalizeBoolean(requireSignedURLs, true);
  }

  return normalizePrivacy(privacy) !== "public";
}

async function streamApiFetch(path, options = {}) {
  requireCloudflareStreamEnv();

  if (typeof fetch !== "function") {
    throw new Error(
      "Global fetch is not available. Use Node 18+ on Render for Cloudflare Stream API calls."
    );
  }

  const response = await fetch(getCloudflareStreamApiUrl(path), {
    ...options,
    headers: {
      Authorization: `Bearer ${CF_STREAM_API_TOKEN}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const json = await response.json().catch(() => ({}));

  if (!response.ok || json?.success === false) {
    const message =
      json?.errors?.[0]?.message ||
      json?.message ||
      `Cloudflare Stream API failed with ${response.status}`;

    const err = new Error(message);
    err.status = response.status;
    err.cloudflare = json;
    throw err;
  }

  return json.result || json;
}

function buildPlaybackUrls(identifier = "") {
  const clean = normalizeText(identifier);
  if (!clean) {
    return {
      hls: "",
      dash: "",
      iframe: "",
      thumbnailUrl: "",
    };
  }

  return {
    hls: `https://videodelivery.net/${clean}/manifest/video.m3u8`,
    dash: `https://videodelivery.net/${clean}/manifest/video.mpd`,
    iframe: `https://iframe.videodelivery.net/${clean}`,
    thumbnailUrl: `https://videodelivery.net/${clean}/thumbnails/thumbnail.jpg`,
  };
}

function normalizeStreamStatus(video = {}) {
  const state = normalizeText(
    video?.status?.state ||
      video?.readyToStreamAt ||
      video?.state ||
      ""
  ).toLowerCase();

  if (video?.readyToStream === true || state === "ready") return "ready";
  if (state === "error" || state === "failed") return "failed";

  return "processing";
}

function normalizeStreamVideo(video = {}) {
  const uid = normalizeStreamUid(video?.uid || video?.id || "");
  const duration = Number(video?.duration || 0);

  return {
    provider: "cloudflare_stream",
    streamUid: uid,
    uid,
    duration: Number.isFinite(duration) ? duration : 0,
    status: normalizeStreamStatus(video),
    requireSignedURLs: !!video?.requireSignedURLs,
    readyToStream: !!video?.readyToStream,
    readyToStreamAt: video?.readyToStreamAt || null,
    created: video?.created || null,
    modified: video?.modified || null,
    thumbnailUrl: uid ? buildPlaybackUrls(uid).thumbnailUrl : "",
    playback: uid ? buildPlaybackUrls(uid) : buildPlaybackUrls(""),
    raw: video,
  };
}

async function createDirectUpload({
  userId,
  privacy = "matches",
  name = "",
  context = "profile_reel",
  requireSignedURLs,
  meta = {},
} = {}) {
  const creator = normalizeCreatorId(userId);
  if (!creator) throw new Error("Missing creator user id");

  const shouldRequireSignedUrls = resolveRequireSignedUrls({
    privacy,
    requireSignedURLs,
  });

  const payload = {
    maxDurationSeconds: CF_STREAM_MAX_REEL_SECONDS,
    creator,
    requireSignedURLs: shouldRequireSignedUrls,
    meta: {
      app: "rombuzz",
      context: normalizeText(context) || "profile_reel",
      privacy: normalizePrivacy(privacy),
      name: normalizeText(name),
      ownerId: creator,
      ...(meta && typeof meta === "object" ? meta : {}),
    },
  };

  const result = await streamApiFetch("direct_upload", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  return {
    provider: "cloudflare_stream",
    uid: normalizeStreamUid(result?.uid || ""),
    streamUid: normalizeStreamUid(result?.uid || ""),
    uploadURL: result?.uploadURL || "",
    maxDurationSeconds: CF_STREAM_MAX_REEL_SECONDS,
    requireSignedURLs: shouldRequireSignedUrls,
    privacy: normalizePrivacy(privacy),
  };
}

async function getStreamVideo(uid) {
  const cleanUid = normalizeStreamUid(uid);
  if (!cleanUid) throw new Error("Missing Stream video uid");

  const result = await streamApiFetch(cleanUid, {
    method: "GET",
  });

  return normalizeStreamVideo(result);
}

async function deleteCloudflareStreamVideo(uid) {
  const cleanUid = normalizeStreamUid(uid);
  if (!cleanUid) throw new Error("Missing Stream video uid");

  await streamApiFetch(cleanUid, {
    method: "DELETE",
  });

  return {
    deleted: true,
    provider: "cloudflare_stream",
    streamUid: cleanUid,
  };
}

async function deleteCloudflareStreamVideoBestEffort(uid, context = "") {
  const cleanUid = normalizeStreamUid(uid);

  if (!cleanUid) {
    return {
      deleted: false,
      provider: "cloudflare_stream",
      streamUid: "",
      reason: "no_stream_uid",
    };
  }

  try {
    return await deleteCloudflareStreamVideo(cleanUid);
  } catch (err) {
    console.error(
      `⚠️ Cloudflare Stream delete failed${context ? ` (${context})` : ""}:`,
      err?.message || err
    );

    return {
      deleted: false,
      provider: "cloudflare_stream",
      streamUid: cleanUid,
      reason: "delete_failed",
      error: err?.message || String(err),
    };
  }
}

async function createSignedPlaybackToken(uid) {
  const cleanUid = normalizeStreamUid(uid);
  if (!cleanUid) throw new Error("Missing Stream video uid");

  const result = await streamApiFetch(`${cleanUid}/token`, {
    method: "POST",
  });

  const token = normalizeText(result?.token || result?.uid || result?.id || "");

  return {
    token,
    expiresInSeconds: 3600,
    playback: buildPlaybackUrls(token || cleanUid),
  };
}

module.exports = {
  CF_STREAM_MAX_REEL_SECONDS,
  buildPlaybackUrls,
  createDirectUpload,
  createSignedPlaybackToken,
  deleteCloudflareStreamVideo,
  deleteCloudflareStreamVideoBestEffort,
  getStreamVideo,
  normalizePrivacy,
  normalizeStreamUid,
  normalizeStreamVideo,
  resolveRequireSignedUrls,
};