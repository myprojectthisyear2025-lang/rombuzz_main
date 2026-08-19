/**
 * ============================================================
 * 📁 File: server/routes/auth/google.js
 * 🎯 Purpose: Handle Google login and signup verification.
 *
 * LOCATION:
 *   server/routes/auth/google.js
 *
 * USED BY:
 *   server/routes/auth/login.js
 * ============================================================
 */

const express = require("express");
const router = express.Router();

const { signToken } = require("../../utils/jwt");
const { JWT_SECRET, TOKEN_EXPIRES_IN } = require("../../config/env");
const { baseSanitizeUser } = require("../../utils/helpers");
const { googleClient } = require("../../config/config");
const User = require("../../models/User");
const {
  isPendingDeleteUser,
} = require("../../services/accountDeletionService");

const {
  computeProfileComplete,
  sendPendingDeleteAuthResponse,
} = require("./authShared");

router.post("/google", async (req, res) => {
  const { token, mode = "login" } = req.body || {};

  if (!token) {
    return res.status(400).json({
      error: "Google token required",
    });
  }

  const flowMode = String(mode).trim().toLowerCase();

  if (!["login", "signup"].includes(flowMode)) {
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
    const email = String(payload.email || "").trim().toLowerCase();
    const googleId = String(payload.sub || "").trim();
    const firstName = String(payload.given_name || "").trim();
    const lastName = String(payload.family_name || "").trim();
    const avatar = String(payload.picture || "").trim();

    if (!email || !googleId) {
      return res.status(400).json({
        status: "invalid_google_payload",
        error: "Google did not return a valid account.",
      });
    }

    if (payload.email_verified !== true) {
      return res.status(401).json({
        status: "email_not_verified",
        error: "Google email is not verified.",
      });
    }

    let user = await User.findOne({ email }).lean();

    if (flowMode === "signup") {
      if (user && isPendingDeleteUser(user)) {
        return sendPendingDeleteAuthResponse(res, user);
      }

      if (user) {
        return res.status(409).json({
          status: "account_exists",
          error: "An account already exists with this Gmail. Try logging in.",
        });
      }

      return res.json({
        status: "google_signup_ready",
        googleProfile: {
          email,
          googleId,
          firstName,
          lastName,
          avatar,
        },
      });
    }

    if (!user) {
      return res.status(404).json({
        status: "no_account",
        error: "No account associated with this email. Sign up to continue.",
      });
    }

    if (isPendingDeleteUser(user)) {
      return sendPendingDeleteAuthResponse(res, user);
    }

    const complete = computeProfileComplete(user);
    const patch = {};

    if (user.profileComplete !== complete) {
      patch.profileComplete = complete;
      user.profileComplete = complete;
    }

    if (!user.googleId) {
      patch.googleId = googleId;
      user.googleId = googleId;
    }

    if (!user.avatar && avatar) {
      patch.avatar = avatar;
      user.avatar = avatar;
    }

    if (Object.keys(patch).length) {
      await User.updateOne({ id: user.id }, patch);
    }

    const jwtToken = signToken(
      { id: user.id, email: user.email },
      JWT_SECRET,
      TOKEN_EXPIRES_IN
    );

    return res.json({
      status: complete ? "ok" : "incomplete_profile",
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

module.exports = router;