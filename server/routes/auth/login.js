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
   GOOGLE LOGIN / SIGNUP
   ------------------------------------------------------------
   mode: "login"
     - Google email MUST already exist
     - returns no_account if missing

   mode: "signup"
     - Google email MUST NOT already exist
     - returns account_exists if already registered
     - returns google_signup_ready if email is available

   default mode is "login" to preserve existing web behavior.
============================================================ */
router.post("/google", async (req, res) => {
  const { token, mode = "login" } = req.body || {};

  if (!token) {
    return res.status(400).json({ error: "Google token required" });
  }

  const flowMode = String(mode || "login").trim().toLowerCase();
  const allowedModes = new Set(["login", "signup"]);

  if (!allowedModes.has(flowMode)) {
    return res.status(400).json({
      status: "invalid_mode",
      error: "Invalid Google auth mode.",
    });
  }

  try {
    const audiences = [
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_WEB_CLIENT_ID,
      process.env.GOOGLE_ANDROID_CLIENT_ID,
      process.env.GOOGLE_IOS_CLIENT_ID,
    ].filter(Boolean);

    const ticket = await googleClient.verifyIdToken({
      idToken: token,
      audience: audiences,
    });

    const payload = ticket.getPayload() || {};
    const emailLower = String(payload.email || "").trim().toLowerCase();
    const googleId = String(payload.sub || "").trim();
    const firstName = String(payload.given_name || "").trim();
    const lastName = String(payload.family_name || "").trim();
    const avatar = String(payload.picture || "").trim();
    const emailVerified = payload.email_verified === true;

    if (!emailLower || !googleId) {
      return res.status(400).json({
        status: "invalid_google_payload",
        error: "Google did not return a valid account.",
      });
    }

    if (!emailVerified) {
      return res.status(401).json({
        status: "email_not_verified",
        error: "Google email is not verified.",
      });
    }

    let user = await User.findOne({ email: emailLower }).lean();

    console.log("GOOGLE AUTH →", {
      mode: flowMode,
      email: emailLower,
      foundUser: user ? "YES" : "NO",
    });

    /* ------------------------------------------------------------
       SIGNUP MODE
       - Existing account blocks signup.
       - New email returns a clean profile draft for mobile onboarding.
    ------------------------------------------------------------ */
    if (flowMode === "signup") {
      if (user) {
        return res.status(409).json({
          status: "account_exists",
          error: "An account already exists with this Gmail. Try logging in.",
        });
      }

      return res.json({
        status: "google_signup_ready",
        googleProfile: {
          email: emailLower,
          googleId,
          firstName,
          lastName,
          avatar,
        },
      });
    }

    /* ------------------------------------------------------------
       LOGIN MODE
       - Missing account blocks login.
    ------------------------------------------------------------ */
    if (!user) {
      console.log("❌ Google login attempted with NO ACCOUNT:", emailLower);
      return res.status(404).json({
        status: "no_account",
        error: "No account associated with this email. Sign up to continue.",
      });
    }

    const isProfileComplete = computeProfileComplete(user);

    const updatePatch = {};
    if (user.profileComplete !== isProfileComplete) {
      updatePatch.profileComplete = isProfileComplete;
      user.profileComplete = isProfileComplete;
    }
    if (!user.googleId && googleId) {
      updatePatch.googleId = googleId;
      user.googleId = googleId;
    }
    if (!user.avatar && avatar) {
      updatePatch.avatar = avatar;
      user.avatar = avatar;
    }

    if (Object.keys(updatePatch).length > 0) {
      await User.updateOne({ id: user.id }, updatePatch);
    }

    const jwtToken = signToken(
      { id: user.id, email: user.email },
      JWT_SECRET,
      TOKEN_EXPIRES_IN
    );

    if (!isProfileComplete) {
      console.log("🧩 Returning INCOMPLETE_PROFILE for:", user.email);
      return res.json({
        status: "incomplete_profile",
        token: jwtToken,
        user: baseSanitizeUser(user),
      });
    }

    return res.json({
      status: "ok",
      token: jwtToken,
      user: baseSanitizeUser(user),
    });
  } catch (err) {
    console.error("❌ Google auth failed:", err);
    return res.status(401).json({
      status: "google_auth_failed",
      error: "Google authentication failed.",
    });
  }
});

console.log("✅ Auth: Login + Google routes initialized");
module.exports = router;
