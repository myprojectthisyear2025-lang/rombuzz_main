/**
 * ============================================================
 * 📁 File: services/accountDeletionStorageCleanup.js
 * 🎯 Purpose: Delete external RomBuzz media during account deletion.
 * Used for:
 *  - Collecting user-owned R2 and Cloudflare Stream references
 *  - Deleting those objects before Mongo records disappear
 *  - Returning failed references so the deletion hold can retry them
 * ============================================================
 */

const User = require("../models/User");
const PostModel = require("../models/PostModel");
const ChatRoom = require("../models/ChatRoom");
const Message = require("../models/Message");
const StoryModel = require("../models/StoryModel");
const MicroBuzzPresence = require("../models/MicroBuzzPresence");

const {
  deleteR2Object,
  getStoredMediaR2Key,
  isR2Key,
} = require("../utils/r2Media");
const {
  deleteCloudflareStreamVideo,
  normalizeStreamUid,
} = require("./cloudflareStreamService");

function normalizeId(value) {
  return String(value || "").trim();
}

function getStreamUid(media = {}) {
  return normalizeStreamUid(
    media?.streamUid ||
      media?.uid ||
      media?.cloudflareStream?.uid ||
      ""
  );
}

function decodeRbzPayload(text = "") {
  const raw = String(text || "");
  if (!raw.startsWith("::RBZ::")) return null;

  try {
    const value = JSON.parse(raw.slice("::RBZ::".length));
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

function addTarget(target, r2Keys, streamUids) {
  if (!target) return;

  if (typeof target === "string") {
    const value = String(target || "").trim();
    if (isR2Key(value)) r2Keys.add(value);
    return;
  }

  // Older chat media may only exist inside ::RBZ::{...}.
  const payload = decodeRbzPayload(target?.text);

  if (payload) {
    const payloadR2Key = getStoredMediaR2Key(payload);
    if (payloadR2Key) r2Keys.add(payloadR2Key);

    const payloadStreamUid = getStreamUid(payload);
    if (payloadStreamUid) streamUids.add(payloadStreamUid);
  }

  const r2Key = getStoredMediaR2Key(target);
  if (r2Key) r2Keys.add(r2Key);

  const streamUid = getStreamUid(target);
  if (streamUid) streamUids.add(streamUid);
}

async function collectExternalStorageTargets(userId) {
  const uid = normalizeId(userId);
  const r2Keys = new Set();
  const streamUids = new Set();

  const [user, posts, rooms, messages, stories, presence] =
    await Promise.all([
      User.findOne({ id: uid })
        .select("avatar photos media voiceUrl")
        .lean(),
      PostModel.find({ userId: uid }).select("mediaUrl").lean(),
      ChatRoom.find({
        $or: [
          { participants: uid },
          { "messages.from": uid },
          { "messages.to": uid },
        ],
      })
        .select("messages")
        .lean(),
      Message.find({ $or: [{ from: uid }, { to: uid }] })
        .select("url text streamUid uid cloudflareStream r2Key key")
        .lean(),
      StoryModel.find({ userId: uid }).select("mediaUrl").lean(),
      MicroBuzzPresence.findOne({ userId: uid })
        .select("selfieUrl")
        .lean(),
    ]);

  addTarget(user?.avatar, r2Keys, streamUids);
  addTarget(user?.voiceUrl, r2Keys, streamUids);

  for (const photo of user?.photos || []) {
    addTarget(photo, r2Keys, streamUids);
  }

  for (const media of user?.media || []) {
    addTarget(media, r2Keys, streamUids);
  }

  for (const post of posts || []) {
    addTarget(post?.mediaUrl, r2Keys, streamUids);
  }

  for (const story of stories || []) {
    addTarget(story?.mediaUrl, r2Keys, streamUids);
  }

  addTarget(presence?.selfieUrl, r2Keys, streamUids);

  for (const message of messages || []) {
    addTarget(message, r2Keys, streamUids);
  }

  for (const room of rooms || []) {
    for (const message of room?.messages || []) {
      addTarget(message, r2Keys, streamUids);
    }
  }

  return {
    r2Keys: [...r2Keys],
    streamUids: [...streamUids],
  };
}

async function deleteExternalStorageNow(userId) {
  const targets = await collectExternalStorageTargets(userId);
  const failedR2Keys = [];
  const failedStreamUids = [];
  let deletedR2 = 0;
  let deletedStream = 0;

  for (const key of targets.r2Keys) {
    try {
      await deleteR2Object(key);
      deletedR2 += 1;
    } catch (err) {
      failedR2Keys.push(key);
      console.error(`⚠️ Account deletion R2 cleanup failed (${key}):`, err);
    }
  }

  for (const streamUid of targets.streamUids) {
    try {
      await deleteCloudflareStreamVideo(streamUid);
      deletedStream += 1;
    } catch (err) {
      if (Number(err?.status || 0) === 404) {
        deletedStream += 1;
        continue;
      }

      failedStreamUids.push(streamUid);
      console.error(
        `⚠️ Account deletion Stream cleanup failed (${streamUid}):`,
        err
      );
    }
  }

  return {
    r2: {
      requested: targets.r2Keys.length,
      deleted: deletedR2,
      failedKeys: failedR2Keys,
    },
    stream: {
      requested: targets.streamUids.length,
      deleted: deletedStream,
      failedUids: failedStreamUids,
    },
    failedCount: failedR2Keys.length + failedStreamUids.length,
  };
}

function buildStorageRetryManifest(storage = {}) {
  return [
    ...(storage?.r2?.failedKeys || []).map((r2Key) => ({
      deletionCleanupPending: true,
      provider: "r2",
      r2Key,
    })),
    ...(storage?.stream?.failedUids || []).map((streamUid) => ({
      deletionCleanupPending: true,
      provider: "cloudflare_stream",
      streamUid,
    })),
  ];
}

module.exports = {
  buildStorageRetryManifest,
  deleteExternalStorageNow,
};