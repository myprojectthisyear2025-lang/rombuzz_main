/**
 * ============================================================
 * 📁 File: routes/auth/login.js
 * 🧩 Handles email/password login & Google OAuth hybrid flow.
 * ============================================================
 */
const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const shortid = require("shortid");
const { signToken } = require("../../utils/jwt");
const { JWT_SECRET, TOKEN_EXPIRES_IN } = require("../../config/env");
const { baseSanitizeUser } = require("../../utils/helpers");
const { googleClient } = require("../../config/config");
const User = require("../../models/User");

/* ============================================================
   🧠 Helper: Dynamically check if profile is complete
============================================================ */
function computeProfileComplete(user) {
  if (!user) return false;

  const required = [
    user.firstName,
    user.lastName,
    user.gender,
    user.dob,
    user.avatar,
  ];

  const hasPhotos =
    Array.isArray(user.photos) && user.photos.length > 0;

  const hasInterests =
    Array.isArray(user.interests) && user.interests.length > 0;

  const hasLookingFor = Boolean(user.lookingFor);

  const basicFieldsOk = required.every(Boolean);

  return basicFieldsOk && hasPhotos && hasInterests && hasLookingFor;
}

/* ============================================================
   EMAIL / PASSWORD LOGIN
============================================================ */
router.post("/login", async (req, res) => {
  console.log("🟢 Login API hit with body:", req.body);

  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "Email & password required" });

  const emailLower = String(email || "").trim().toLowerCase();
  const user = await User.findOne({ email: emailLower }).lean();

  if (!user) {
    return res.status(401).json({
      status: "no_account",
      error: "No account found. Please sign up first.",
    });
  }

  // 🧠 Compute profile complete
  const isProfileComplete = computeProfileComplete(user);

  // 🔧 Sync DB if needed
  if (user.profileComplete !== isProfileComplete) {
    await User.updateOne(
      { id: user.id },
      { profileComplete: isProfileComplete }
    );
  }

  console.log("DEBUG LOGIN →", {
    email: emailLower,
    hasPasswordHash: !!user.passwordHash,
    profileComplete: isProfileComplete,
  });

  let match = false;
  try {
    if (user.passwordHash && user.passwordHash.length > 0) {
      match = await bcrypt.compare(password, user.passwordHash);
      console.log("🔐 Bcrypt comparison:", match);
    }
  } catch (err) {
    console.error("bcrypt compare error:", err);
  }

  if (!match) {
    console.warn("⚠️ Login failed for", emailLower);
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const token = signToken(
    { id: user.id, email: user.email },
    JWT_SECRET,
    TOKEN_EXPIRES_IN
  );

  res.json({ token, user: baseSanitizeUser(user) });
});

/* ============================================================
   GOOGLE LOGIN
============================================================ */
router.post("/google", async (req, res) => {
  const { token } = req.body;

  if (!token)
    return res.status(400).json({ error: "Google token required" });

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: token,
      audience: [
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_WEB_CLIENT_ID,
        process.env.GOOGLE_ANDROID_CLIENT_ID,
        process.env.GOOGLE_IOS_CLIENT_ID,
      ],
    });


    const payload = ticket.getPayload();
    const emailLower = String(payload.email || "").toLowerCase();

    // 🔍 Fetch user from DB
    let user = await User.findOne({ email: emailLower }).lean();

    console.log("GOOGLE EMAIL →", emailLower);
    console.log("FOUND USER? →", user ? "YES" : "NO");

    // ❗ No account found
    if (!user) {
      console.log("❌ Google login attempted with NO ACCOUNT:", emailLower);
      return res.json({
        status: "no_account",
        error: "No account found. Please sign up first.",
      });
    }

    // Existing user → issue token
    const jwtToken = signToken(
      { id: user.id, email: user.email },
      JWT_SECRET,
      TOKEN_EXPIRES_IN
    );

    // 🧠 Compute profile completeness
    const isProfileComplete = computeProfileComplete(user);

    // 🔧 Sync DB if needed
    if (user.profileComplete !== isProfileComplete) {
      await User.updateOne(
        { id: user.id },
        { profileComplete: isProfileComplete }
      );
      user.profileComplete = isProfileComplete;
    }

    // Incomplete → redirect to complete profile
    if (!isProfileComplete) {
      console.log("🧩 Returning INCOMPLETE_PROFILE for:", user.email);
      return res.json({
        status: "incomplete_profile",
        token: jwtToken,
        user: baseSanitizeUser(user),
      });
    }

    // Complete → direct login
    return res.json({
      status: "ok",
      token: jwtToken,
      user: baseSanitizeUser(user),
    });

  } catch (err) {
    console.error("❌ Google login failed:", err);
    return res.status(401).json({ error: "Google login failed" });
  }
});

console.log("✅ Auth: Login + Google routes initialized");
module.exports = router;
