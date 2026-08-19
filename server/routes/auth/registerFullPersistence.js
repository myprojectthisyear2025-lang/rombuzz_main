/**
 * ============================================================
 * 📁 File: server/routes/auth/registerFullPersistence.js
 * 🎯 Purpose: Preserve register-full user update/create behavior.
 *
 * LOCATION:
 *   server/routes/auth/registerFullPersistence.js
 *
 * USED BY:
 *   server/routes/auth/registerFull.js
 *
 * RESPONSIBILITIES:
 *   - Preserve existing-user signup completion behavior.
 *   - Preserve new-user creation and welcome-post behavior.
 *   - Add verified Apple ID linking.
 * ============================================================
 */

const bcrypt = require("bcrypt");
const shortid = require("shortid");

const User = require("../../models/User");

const {
  baseSanitizeUser,
} = require("../../utils/helpers");

const {
  signToken,
} = require("../../utils/jwt");

const {
  JWT_SECRET,
  TOKEN_EXPIRES_IN,
} = require("../../config/env");

const {
  mergeSignupPhotosIntoMedia,
} = require("./registerFullHelpers");

async function completeExistingUser({
  res,
  user,
  data,
  signupPhotos,
  appleId,
}) {
  user.firstName = data.firstName;
  user.lastName = data.lastName;
  user.gender = data.gender;
  user.dob = data.dob;
  user.lookingFor = data.lookingFor;

  if (data.city !== undefined) {
    user.city = data.city;
  }

  if (data.height !== undefined) {
    user.height = data.height;
  }

  if (data.likes !== undefined) {
    user.likes = data.likes;
  }

  if (data.dislikes !== undefined) {
    user.dislikes = data.dislikes;
  }

  user.interestedIn =
    data.interestedIn || [];

  user.preferences =
    data.preferences || {};

  user.visibilityMode =
    data.visibilityMode || "public";

  user.interests =
    data.interests || [];

  user.avatar =
    data.avatar || user.avatar;

  user.photos = signupPhotos;

  user.media =
    mergeSignupPhotosIntoMedia(
      user.media,
      user.photos
    );

  user.phone = data.phone || "";
  user.voiceUrl =
    data.voiceUrl || "";

  user.voiceDurationSec =
    Number(
      data.voiceDurationSec || 0
    );

  if (data.password) {
    user.passwordHash =
      await bcrypt.hash(
        data.password,
        10
      );
  }

  if (appleId) {
    user.appleId = appleId;
  }

  user.isVerified = true;
  user.profileComplete = true;
  user.hasOnboarded = true;
  user.updatedAt = Date.now();

  await user.save();

  const token = signToken(
    {
      id: user.id,
      email: user.email,
    },
    JWT_SECRET,
    TOKEN_EXPIRES_IN
  );

  return res.json({
    token,
    user: baseSanitizeUser(user),
  });
}

async function createNewUser({
  res,
  data,
  emailLower,
  signupPhotos,
  appleId,
}) {
  const passwordHash = data.password
    ? await bcrypt.hash(
        data.password,
        10
      )
    : null;

  const newUser = {
    id: shortid.generate(),
    email: emailLower,
    firstName: data.firstName,
    lastName: data.lastName,
    passwordHash,

    gender: data.gender,
    dob: data.dob,
    lookingFor: data.lookingFor,
    interestedIn:
      data.interestedIn,

    city: data.city || "",
    height: data.height || "",

    likes: data.likes || "",
    dislikes:
      data.dislikes || "",

    preferences: data.preferences,
    visibilityMode:
      data.visibilityMode,
    interests: data.interests,
    avatar: data.avatar,

    photos: signupPhotos,

    media:
      mergeSignupPhotosIntoMedia(
        [],
        signupPhotos
      ),

    phone: data.phone,
    voiceUrl: data.voiceUrl,

    voiceDurationSec:
      Number(
        data.voiceDurationSec || 0
      ),

    ...(appleId
      ? { appleId }
      : {}),

    isVerified: true,
    profileComplete: true,
    hasOnboarded: true,
    createdAt: Date.now(),
  };

  await User.create(newUser);

  // Preserve existing welcome-post behavior.
  const PostModel =
    require("../../models/PostModel");

  const welcomeMedia =
    (newUser.photos || [])
      .slice(0, 2);

  if (welcomeMedia.length > 0) {
    const welcomePosts =
      welcomeMedia.map((url) => ({
        id: shortid.generate(),
        userId: newUser.id,
        mediaUrl: url,
        text:
          `${newUser.firstName} just joined RomBuzz! 💖`,
        type: "photo",
        privacy: "public",
        reactions: {},
        comments: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }));

    await PostModel.insertMany(
      welcomePosts
    );

    console.log(
      `🌸 Created ${welcomePosts.length} welcome post(s) for ${newUser.email}`
    );
  }

  const token = signToken(
    {
      id: newUser.id,
      email: newUser.email,
    },
    JWT_SECRET,
    TOKEN_EXPIRES_IN
  );

  return res.json({
    token,
    user:
      baseSanitizeUser(newUser),
  });
}

module.exports = {
  completeExistingUser,
  createNewUser,
};