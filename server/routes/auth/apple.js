/**
 * ============================================================
 * 📁 File: server/routes/auth/apple.js
 * 🎯 Purpose: Handle native iOS Sign in with Apple.
 *
 * LOCATION:
 *   server/routes/auth/apple.js
 *
 * USED BY:
 *   server/routes/auth/login.js
 *
 * ROUTES:
 *   POST /api/auth/apple
 * ============================================================
 */

const express = require("express");
const router = express.Router();

const { signToken } = require("../../utils/jwt");
const { JWT_SECRET, TOKEN_EXPIRES_IN } = require("../../config/env");
const { baseSanitizeUser } = require("../../utils/helpers");
const User = require("../../models/User");

const {
  isPendingDeleteUser,
} = require("../../services/accountDeletionService");

const {
  verifyAppleIdentityToken,
} = require("./appleTokenVerifier");

const {
  computeProfileComplete,
  sendPendingDeleteAuthResponse,
} = require("./authShared");

const { createAppleSignupTicket } =
  require("./appleSignupTicket");

function isVerifiedEmail(value) {
  return value === true || value === "true";
}

router.post("/apple", async (req, res) => {
  const { token, mode = "login" } = req.body || {};

  if (!token) {
    return res.status(400).json({
      error: "Apple token required",
    });
  }

  const flowMode = String(mode).trim().toLowerCase();

  if (!["login", "signup"].includes(flowMode)) {
    return res.status(400).json({
      status: "invalid_mode",
      error: "Invalid Apple auth mode.",
    });
  }

  try {
    const payload = await verifyAppleIdentityToken(token);

    const appleId = String(payload?.sub || "").trim();
    const email = String(payload?.email || "")
      .trim()
      .toLowerCase();

    if (!appleId) {
      return res.status(400).json({
        status: "invalid_apple_payload",
        error: "Apple did not return a valid account.",
      });
    }

    if (
      email &&
      !isVerifiedEmail(payload?.email_verified)
    ) {
      return res.status(401).json({
        status: "email_not_verified",
        error: "Apple email is not verified.",
      });
    }

    let user = await User.findOne({
      appleId,
    }).lean();

    if (!user && email) {
      user = await User.findOne({
        email,
      }).lean();
    }

    if (flowMode === "signup") {
      if (!email) {
        return res.status(400).json({
          status: "apple_email_required",
          error: "Apple did not provide an email for signup.",
        });
      }

      if (user && isPendingDeleteUser(user)) {
        return sendPendingDeleteAuthResponse(res, user);
      }

      if (user) {
        return res.status(409).json({
          status: "account_exists",
          error:
            "An account already exists with this Apple email. Try logging in.",
        });
      }

      const appleSignupTicket =
        createAppleSignupTicket({ email, appleId });

      return res.json({
        status: "apple_signup_ready",
        appleSignupTicket,
        appleProfile: { email, appleId },
      });
    }

    if (!user) {
      return res.status(404).json({
        status: "no_account",
        error:
          "No account associated with this Apple ID. Sign up to continue.",
      });
    }

    if (isPendingDeleteUser(user)) {
      return sendPendingDeleteAuthResponse(res, user);
    }

    if (
      user.appleId &&
      user.appleId !== appleId
    ) {
      return res.status(409).json({
        status: "apple_account_mismatch",
        error:
          "This email is already linked to a different Apple account.",
      });
    }

    const complete = computeProfileComplete(user);
    const patch = {};

    if (!user.appleId) {
      patch.appleId = appleId;
      user.appleId = appleId;
    }

    if (user.profileComplete !== complete) {
      patch.profileComplete = complete;
      user.profileComplete = complete;
    }

    if (Object.keys(patch).length) {
      await User.updateOne(
        { id: user.id },
        patch
      );
    }

    const jwtToken = signToken(
      {
        id: user.id,
        email: user.email,
      },
      JWT_SECRET,
      TOKEN_EXPIRES_IN
    );

    return res.json({
      status: complete
        ? "ok"
        : "incomplete_profile",
      token: jwtToken,
      user: baseSanitizeUser(user),
    });
  } catch (err) {
    console.error(
      "❌ Apple auth failed:",
      err?.message || err
    );

    return res.status(401).json({
      status: "apple_auth_failed",
      error: "Apple authentication failed.",
    });
  }
});

module.exports = router;