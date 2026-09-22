/**
 * Path: server/services/chatMessageBuilder.js
 * Purpose: Preserve the existing chat media, reply, expiry, and gift payload construction for both transports.
 */
const shortid = require("shortid");
const { normalizeStreamUid } = require("./cloudflareStreamService");

function sanitizeReplyToSnapshot(input) {
  if (!input || typeof input !== "object") return null;

  const id = String(input.id || "");
  const from = String(input.from || "");
  if (!id || !from) return null;

  return {
    id,
    from,
    type: String(input.type || "text"),
    text: String(input.text || ""),
    url: input.url ? String(input.url) : null,
    mediaType:
      input.mediaType === "image" ||
      input.mediaType === "video" ||
      input.mediaType === "audio"
        ? input.mediaType
        : null,
    deleted: !!input.deleted,
  };
}

function normalizeGiftUnlockPrice(value) {
  const n = Math.floor(Number(value) || 0);

  // Gifted media must be paid media, but keep a sane app-side cap.
  // You can raise this later after wallet/payout rules are finalized.
  if (n <= 0) return 0;
  return Math.min(n, 10000);
}


function buildChatMessage({ text, replyTo, fromId, toId, id }) {
let epMode = "none";
let viewsLeft = 0;

let giftLocked = false;
let giftStickerId = "sticker_basic";
let giftAmount = 0;
let giftPriceBC = 0;

// ✅ NEW: media fields (so realtime doesn’t render black/blank)
let mediaUrl = null;
let mediaType = null; // "image" | "video" | "audio"
let overlayText = "";
let muted = false;

// ✅ Chat video Stream fields. Old Cloudinary videos keep using url only.
let provider = "";
let storage = "";
let purpose = "";
let streamUid = "";
let thumbnailUrl = "";
let status = "";
let duration = 0;
let playback = {};
let cloudflareStream = {
  uid: "",
  provider: "",
  purpose: "",
  context: "",
  status: "",
  duration: 0,
  requireSignedURLs: true,
};

if (text.startsWith("::RBZ::")) {
  try {
    const payload = JSON.parse(text.slice("::RBZ::".length));

    const mode =
      payload?.ephemeral?.mode ||
      payload?.ephemeral ||
      (payload?.viewOnce ? "once" : null);

    if (mode === "once") {
      epMode = "once";
      viewsLeft = 1;
    } else if (mode === "twice") {
      epMode = "twice";
      viewsLeft = 2;
    }

     if (payload?.gift?.locked) {
      giftLocked = true;
      giftStickerId = String(payload?.gift?.stickerId || "sticker_basic");

      const rawPrice =
        payload?.gift?.priceBC ??
        payload?.gift?.amount ??
        payload?.priceBC ??
        0;

      giftPriceBC = normalizeGiftUnlockPrice(rawPrice);
      giftAmount = giftPriceBC;
    }

      // ✅ NEW: store media fields explicitly
    if (payload?.url) mediaUrl = String(payload.url);

    if (
      payload?.mediaType === "video" ||
      payload?.mediaType === "image" ||
      payload?.mediaType === "audio"
    ) {
      mediaType = payload.mediaType;
    } else if (payload?.type === "media" && payload?.url) {
      mediaType = "image";
    }

    provider = String(payload?.provider || "").trim();
    storage = String(payload?.storage || provider || "").trim();
    purpose = String(payload?.purpose || payload?.context || "").trim();

    streamUid = normalizeStreamUid(
      payload?.streamUid ||
        payload?.uid ||
        payload?.cloudflareStream?.uid ||
        ""
    );

    if (
      mediaType === "video" &&
      (provider === "cloudflare_stream" || storage === "cloudflare_stream") &&
      streamUid
    ) {
      provider = "cloudflare_stream";
      storage = "cloudflare_stream";
      purpose = "chat_video";
      mediaUrl = streamUid;
      thumbnailUrl = String(payload?.thumbnailUrl || "");
      status = String(payload?.status || payload?.cloudflareStream?.status || "processing");
      duration = Number(payload?.duration || payload?.cloudflareStream?.duration || 0);
      playback =
        payload?.playback && typeof payload.playback === "object"
          ? payload.playback
          : {};

      cloudflareStream = {
        uid: streamUid,
        provider: "cloudflare_stream",
        purpose: "chat_video",
        context: "chat_video",
        status,
        duration,
        requireSignedURLs: true,
      };
    }

    muted = !!payload?.muted;

    if (payload?.overlayText) overlayText = String(payload.overlayText || "");
  } catch (e) {
    console.warn("RBZ payload parse failed:", e);
  }
}

const isRBZ = text.startsWith("::RBZ::");
const safeReplyTo = sanitizeReplyToSnapshot(replyTo);

const msg = {
  id: id || shortid.generate(),
  from: fromId,
  to: toId,
  text,
  type: isRBZ ? "media" : "text",

  // ✅ NEW: keep media as real fields too
  url: isRBZ ? mediaUrl : null,
  mediaType: isRBZ ? mediaType : null,
  overlayText: isRBZ ? overlayText : "",
  muted: isRBZ ? muted : false,

  // ✅ Chat video Stream metadata. Old Cloudinary videos keep provider empty/cloudinary.
  provider: isRBZ ? provider : "",
  storage: isRBZ ? storage : "",
  purpose: isRBZ ? purpose : "",
  streamUid: isRBZ ? streamUid : "",
  thumbnailUrl: isRBZ ? thumbnailUrl : "",
  status: isRBZ ? status : "",
  duration: isRBZ ? duration : 0,
  playback: isRBZ ? playback : {},
  cloudflareStream: isRBZ ? cloudflareStream : {},

  time: new Date(),
  edited: false,
  deleted: false,
  reactions: {},
  hiddenFor: [],
  ephemeral: { mode: epMode, viewsLeft },
  gift: {
    locked: giftLocked,
    stickerId: giftStickerId,
    amount: giftAmount,
    priceBC: giftPriceBC,
    currency: "BC",
    unlockedBy: [],
    unlockedAt: null,
    unlockTransactionId: "",
  },
  replyTo: safeReplyTo,
};

return msg;
}
module.exports = { buildChatMessage, normalizeGiftUnlockPrice };
