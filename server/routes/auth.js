/**
 * ============================================================
 * 📁 File: routes/auth.js
 * 🧩 Purpose: Handles all user authentication and account recovery flows.
 *
 * Endpoints:
 *   POST /api/auth/send-code           → Send verification OTP via email
 *   POST /api/auth/register            → Create account after code verification
 *   POST /api/auth/register-full       → Complete signup with profile fields
 *   POST /api/auth/google              → Google OAuth signup/login
 *   POST /api/auth/login               → Standard email/password login
 *   POST /api/auth/forgot-password     → Send password reset code
 *   POST /api/auth/reset-password      → Verify reset code + update password
 *   POST /api/auth/direct-signup       → Direct email signup (no OTP flow)
 *
 * Dependencies:
 *   - db.lowdb.js          → Database (LowDB)
 *   - sendgrid.js          → Email sending (SendGrid)
 *   - jwt.js               → Token generation
 *   - bcrypt               → Password hashing
 *   - config/config.js     → Environment + feature flags
 *
 * Notes:
 *   - Used by Login.jsx, Register.jsx, and ForgotPassword.jsx on frontend.
 *   - All routes return sanitized user objects (no passwordHash).
 * ============================================================
 */


const express = require("express");
const router = express.Router();
const shortid = require("shortid");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const { baseSanitizeUser } = require("../utils/helpers");

// =======================
// JWT + ENV (for consistent token signing)
// =======================
const { signToken } = require("../utils/jwt");
const { JWT_SECRET, TOKEN_EXPIRES_IN } = require("../config/env");

// =======================
// GOOGLE CLIENT (for OAuth verification)
// =======================
const { googleClient } = require("../config/config");

// =======================
// MONGO MODEL (Mongo-native auth)
// =======================
const User = require("../models/User");
const PasswordReset = require("../models/PasswordReset");
const { isPendingDeleteUser } = require("../services/accountDeletionService");
const {
  getTrustedSignupIdentity,
} = require("./auth/registerFullHelpers");

function sendPendingDeleteSignupResponse(res, user) {
  return res.status(423).json({
    status: "",
    error:
      "This email is on a 7-day deletion hold. You can create a fresh account with this email after the hold ends.",
    reusableAfter: user?.deleteAfter || null,
  });
}

function sanitizeSignupPhotos(photos = []) {
  const list = Array.isArray(photos) ? photos : [];
  const seenUrls = new Set();
  const cleanPhotos = [];

  for (const photo of list) {
    const url = String(photo || "").trim();
    if (!url || seenUrls.has(url)) continue;
    seenUrls.add(url);
    cleanPhotos.push(url);
  }

  return cleanPhotos;
}

function mergeSignupPhotosIntoMedia(existingMedia = [], photos = []) {
  const mediaList = Array.isArray(existingMedia) ? [...existingMedia] : [];
  const photoUrls = sanitizeSignupPhotos(photos);
  const seenUrls = new Set(
    mediaList
      .map((item) => String(item?.url || "").trim())
      .filter(Boolean)
  );

  for (const photo of photoUrls) {
    const url = String(photo || "").trim();
    if (!url || seenUrls.has(url)) continue;

    mediaList.push({
      id: shortid.generate(),
      url,
      type: "image",
      caption: "kind:photo scope:public intent:letsbuzz",
      privacy: "public",
      createdAt: Date.now(),
      comments: [],
      reactions: {},
    });
    seenUrls.add(url);
  }

  return mediaList;
}

// =======================
// AUTH: OTP ROUTES
// =======================
router.use("/", require("./auth/otp"));

// ============================================================
// REGISTER-FULL — MODULAR MIGRATION
// ============================================================
// IMPORTANT:
// The original /register-full implementation remains below
// untouched during migration.
//
// Express will hit the modular route first.
// If rollback is ever needed during testing, remove/comment ONLY
// this router.use line and the original route becomes active again.
// ============================================================
router.use("/", require("./auth/registerFull"));

// =======================
// REGISTER-FULL (Hybrid: Mongo + fallback LowDB)
// LEGACY IMPLEMENTATION — KEEP UNTOUCHED DURING MIGRATION
// =======================
router.post("/register-full", async (req, res) => {
  try {
  const {
  email,
  firstName,
  lastName,
  password,
  gender,
  dob,
  lookingFor,
  interestedIn,

  // ✅ Basics (optional for now)
  city,
  height,

  // ✅ Vibe (optional for now)
  likes,
  dislikes,

  preferences,
  visibilityMode,
  interests,
  avatar,
  photos,
  phone,
  voiceUrl,
  voiceDurationSec,
} = req.body || {};


    if (!email || !firstName || !lastName) {
      return res.status(400).json({ error: "Missing required fields." });
    }

    const emailLower = String(email || "").trim().toLowerCase();
    const signupPhotos = sanitizeSignupPhotos(photos);

    const signupIdentity =
      getTrustedSignupIdentity(
        req.body || {},
        emailLower
      );

    const {
      provider: authProvider,
      appleId,
      googleId,
    } = signupIdentity;

      // 🧩 Try Mongo first — upgrade if already verified
    let user = await User.findOne({ email: emailLower });

    if (user && isPendingDeleteUser(user)) {
      return sendPendingDeleteSignupResponse(res, user);
    }

    if (authProvider === "email") {
      if (!user) {
        return res.status(401).json({
          error:
            "Email verification record not found. Please verify your email again.",
        });
      }

      if (!user.isVerified) {
        return res.status(401).json({
          error:
            "Email verification is required before signup can be completed.",
        });
      }

      if (
        user.profileComplete ||
        user.hasOnboarded ||
        user.passwordHash
      ) {
        return res.status(409).json({
          status: "account_exists",
          error:
            "An account already exists with this email. Try logging in.",
        });
      }
    } else if (user) {
      return res.status(409).json({
        status: "account_exists",
        error:
          "An account already exists with this email. Try logging in.",
      });
    }

    if (user) {
      user.firstName = firstName;
      user.lastName = lastName;
    user.gender = gender;
user.dob = dob;
user.lookingFor = lookingFor;

if (city !== undefined) user.city = city;
if (height !== undefined) user.height = height;
if (likes !== undefined) user.likes = likes;
if (dislikes !== undefined) user.dislikes = dislikes;

      user.interestedIn = interestedIn || [];
      user.preferences = preferences || {};
      user.visibilityMode = visibilityMode || "public";
         user.interests = interests || [];
      user.avatar = avatar || user.avatar;
      user.photos = signupPhotos;
      user.media = mergeSignupPhotosIntoMedia(user.media, user.photos);
      user.phone = phone || "";
      user.voiceUrl = voiceUrl || "";
      user.voiceDurationSec = Number(voiceDurationSec || 0);
      if (password) user.passwordHash = await bcrypt.hash(password, 10);
      if (appleId) user.appleId = appleId;
      if (googleId) user.googleId = googleId;
      user.isVerified = true;
      user.profileComplete = true;
      user.hasOnboarded = true;
      user.updatedAt = Date.now();
      await user.save();

      // 🔏 JWT
      const token = signToken({ id: user.id, email: user.email }, JWT_SECRET, TOKEN_EXPIRES_IN);
      return res.json({ token, user: baseSanitizeUser(user) });
    }

    // 🔁 Fallback: no Mongo record yet → create new
    const passwordHash = password ? await bcrypt.hash(password, 10) : null;
   const newUser = {
  id: shortid.generate(),
  email: emailLower,
  firstName,
  lastName,
  passwordHash,

  gender,
  dob,
  lookingFor,
  interestedIn,

  // ✅ Basics
  city: city || "",
  height: height || "",

  // ✅ Vibe
  likes: likes || "",
  dislikes: dislikes || "",

  preferences,
  visibilityMode,
  interests,
  avatar,
  photos: signupPhotos,
   media: mergeSignupPhotosIntoMedia([], signupPhotos),
  phone,
  voiceUrl,
  voiceDurationSec: Number(voiceDurationSec || 0),

  ...(appleId ? { appleId } : {}),
  ...(googleId ? { googleId } : {}),

  isVerified: true,
  profileComplete: true,
  hasOnboarded: true,
  createdAt: Date.now(),
};


    await User.create(newUser);

    // 🖼 Create welcome posts in MongoDB (for feed display)
const PostModel = require("../models/PostModel");
const welcomeMedia = (newUser.photos || []).slice(0, 2);

if (welcomeMedia.length > 0) {
  const welcomePosts = welcomeMedia.map((url) => ({
    id: shortid.generate(),
    userId: newUser.id,
    mediaUrl: url,
    text: `${newUser.firstName} just joined RomBuzz! 💖`,
    type: "photo",
    privacy: "public",
    reactions: {},
    comments: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }));

  await PostModel.insertMany(welcomePosts);
  console.log(`🌸 Created ${welcomePosts.length} welcome post(s) for ${newUser.email}`);
}


    const token = signToken({ id: newUser.id, email: newUser.email }, JWT_SECRET, TOKEN_EXPIRES_IN);
    res.json({ token, user: baseSanitizeUser(newUser) });
  } catch (err) {
    console.error("❌ /register-full hybrid error:", err);

    if (err?.statusCode) {
      return res
        .status(err.statusCode)
        .json({ error: err.message });
    }

    res.status(500).json({ error: "Server error completing profile" });
  }
});

// =======================
// AUTH: LOGIN + GOOGLE ROUTES
// =======================
router.use("/", require("./auth/login"));

// =======================
// AUTH: PASSWORD RESET ROUTES
// =======================
router.use("/", require("./auth/password"));


// =======================
// DIRECT EMAIL SIGNUP — DISABLED
// =======================
// Security: all new accounts must complete a verified Email,
// Google, or Apple signup flow before account creation.
router.post("/direct-signup", (_req, res) => {
  return res.status(410).json({
    status: "direct_signup_disabled",
    error:
      "Direct signup is disabled. Use the verified signup flow.",
  });
});

console.log("✅ Auth routes initialized (login + register + google + password + otp)");
module.exports = router;
