/**
 * 📁 File: server/services/profileMediaDeletion.js
 * 🎯 Purpose: Permanently remove owner gallery media from profile references,
 * related RomBuzz content, and its underlying R2/Stream storage object.
 */
const User = require("../models/User");
const PostModel = require("../models/PostModel");
const StoryModel = require("../models/StoryModel");
const Notification = require("../models/Notification");
const MediaThread = require("../models/MediaThread");
const {
  deleteStoredR2ObjectBestEffort,
  getStoredMediaR2Key,
  isR2Key,
} = require("../utils/r2Media");
const {
  deleteCloudflareStreamVideoBestEffort,
  normalizeStreamUid,
} = require("./cloudflareStreamService");

const clean = (value = "") => String(value || "").trim();
const unique = (values) => [...new Set(values.map(clean).filter(Boolean))];

function mediaRawValues(item = {}) {
  return [
    item?.r2Key,
    item?.key,
    item?.url,
    item?.mediaUrl,
    item?.fileUrl,
    item?.videoUrl,
    item?.secureUrl,
    item?.secure_url,
  ]
    .map(clean)
    .filter(Boolean);
}

function streamUidOf(item = {}) {
  return normalizeStreamUid(
    item?.streamUid ||
      item?.uid ||
      item?.cloudflareStream?.uid ||
      ""
  );
}

function locatorMatchesStoredValue(storedValue = "", locator = "") {
  const stored = clean(storedValue);
  const target = clean(locator);

  if (!stored || !target) return false;
  if (stored === target) return true;

  if (isR2Key(stored) && /^https?:\/\//i.test(target)) {
    try {
      const path = decodeURIComponent(new URL(target).pathname || "");

      return (
        path === `/${stored}` ||
        path.endsWith(`/${stored}`)
      );
    } catch {
      return false;
    }
  }

  return false;
}

const matchesAny = (value, locators) =>
  locators.some((locator) =>
    locatorMatchesStoredValue(value, locator)
  );

function mediaMatches(item, mediaId, locators, streamUid) {
  if (mediaId && clean(item?.id) === mediaId) return true;

  if (streamUid && streamUidOf(item) === streamUid) {
    return true;
  }

  const key = getStoredMediaR2Key(item);

  if (key && matchesAny(key, locators)) {
    return true;
  }

  return mediaRawValues(item).some((value) =>
    matchesAny(value, locators)
  );
}

async function deleteProfileMediaEverywhere({
  userId,
  mediaId,
  mediaUrl,
  r2Key,
  streamUid,
}) {
  const ownerId = clean(userId);
  const requestedId = clean(mediaId);
  const requestedStreamUid = normalizeStreamUid(
    streamUid || ""
  );

  const locators = unique([
    r2Key,
    mediaUrl,
  ]);

  const user = await User.findOne({ id: ownerId });

  if (!user) {
    return {
      found: false,
      reason: "user_not_found",
    };
  }

  const mediaList = Array.isArray(user.media)
    ? user.media
    : [];

  const targets = mediaList.filter((item) =>
    mediaMatches(
      item,
      requestedId,
      locators,
      requestedStreamUid
    )
  );

  const targetIds = unique(
    targets.map((item) => item?.id)
  );

  const targetKeys = unique([
    r2Key,
    ...targets.map((item) =>
      getStoredMediaR2Key(item)
    ),
  ]).filter(isR2Key);

  const targetStreams = unique([
    requestedStreamUid,
    ...targets.map(streamUidOf),
  ]);

  const targetValues = unique([
    ...locators,
    ...targetKeys,
    ...targets.flatMap(mediaRawValues),
  ]);

  const matchesTarget = (value) =>
    matchesAny(value, targetValues);

  const oldPhotos = Array.isArray(user.photos)
    ? user.photos
    : [];

  const removedPhotos =
    oldPhotos.filter(matchesTarget);

  const oldAvatar = clean(user.avatar);

  const avatarRemoved =
    !!oldAvatar && matchesTarget(oldAvatar);

  const keptMedia = mediaList.filter((item) => {
    if (targetIds.includes(clean(item?.id))) {
      return false;
    }

    if (
      targetKeys.includes(
        getStoredMediaR2Key(item)
      )
    ) {
      return false;
    }

    if (
      targetStreams.includes(
        streamUidOf(item)
      )
    ) {
      return false;
    }

    return !mediaRawValues(item).some(
      matchesTarget
    );
  });

  const changedMedia =
    keptMedia.length !== mediaList.length;

  const changedPhotos =
    removedPhotos.length > 0;

  if (changedMedia) {
    user.media = keptMedia;
  }

  if (changedPhotos) {
    user.photos = oldPhotos.filter(
      (photo) => !matchesTarget(photo)
    );
  }

  if (avatarRemoved) {
    user.avatar = "";
  }

  if (changedMedia) {
    user.markModified("media");
  }

  if (changedPhotos) {
    user.markModified("photos");
  }

  if (
    changedMedia ||
    changedPhotos ||
    avatarRemoved
  ) {
    await user.save();
  }

  const storageKeys = unique([
    ...targetKeys,
    ...removedPhotos.filter(isR2Key),
    ...(
      avatarRemoved &&
      isR2Key(oldAvatar)
        ? [oldAvatar]
        : []
    ),
  ]);

  const persistedValues = unique([
    ...storageKeys,
    ...targets.flatMap(mediaRawValues),
    ...removedPhotos,
    ...(avatarRemoved ? [oldAvatar] : []),
  ]);

  const posts = persistedValues.length
    ? await PostModel.find({
        userId: ownerId,
        mediaUrl: {
          $in: persistedValues,
        },
      })
        .select("id")
        .lean()
    : [];

  const postIds = unique(
    posts.map((post) => post?.id)
  );

  if (persistedValues.length) {
    await Promise.all([
      PostModel.deleteMany({
        userId: ownerId,
        mediaUrl: {
          $in: persistedValues,
        },
      }),

      StoryModel.deleteMany({
        userId: ownerId,
        mediaUrl: {
          $in: persistedValues,
        },
      }),
    ]);
  }

  const staleTargetIds = unique([
    ...targetIds,
    requestedId,
    ...postIds,
  ]);

  if (staleTargetIds.length) {
    await Promise.all([
      MediaThread.deleteMany({
        ownerId,
        mediaId: {
          $in: staleTargetIds,
        },
      }),

      Notification.deleteMany({
        $or: [
          {
            targetOwnerId: ownerId,
            targetId: {
              $in: staleTargetIds,
            },
          },
          {
            postOwnerId: ownerId,
            postId: {
              $in: staleTargetIds,
            },
          },
        ],
      }),
    ]);
  }

  const storageDeletes =
    await Promise.all(
      storageKeys.map((key) =>
        deleteStoredR2ObjectBestEffort(
          { r2Key: key },
          `profile-media-everywhere:${ownerId}:${requestedId || key}`
        )
      )
    );

  const streamDeletes =
    await Promise.all(
      targetStreams.map((uid) =>
        deleteCloudflareStreamVideoBestEffort(
          uid,
          `profile-media-everywhere:${ownerId}:${requestedId || uid}`
        )
      )
    );

  const success =
    changedMedia ||
    changedPhotos ||
    avatarRemoved ||
    postIds.length > 0;

  return {
    found:
      success ||
      targets.length > 0,

    success:
      success ||
      targets.length > 0,

    deletedMediaIds: targetIds,
    deletedLegacyPhotos:
      removedPhotos.length,

    avatarCleared:
      avatarRemoved,

    deletedPostIds:
      postIds,

    deletedFromR2:
      storageDeletes.some(
        (item) => item?.deleted
      ),

    deletedFromStream:
      streamDeletes.some(
        (item) => item?.deleted
      ),

    storageDelete:
      storageDeletes[0] || null,

    streamDelete:
      streamDeletes[0] || null,
  };
}

module.exports = {
  deleteProfileMediaEverywhere,
};