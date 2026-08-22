/**
 * ============================================================
 * 📁 File: server/routes/auth/registerFull.js
 * 🎯 Purpose: Route entry for completing verified RomBuzz signup.
 *
 * LOCATION:
 *   server/routes/auth/registerFull.js
 *
 * USED BY:
 *   server/routes/auth.js
 *
 * RESPONSIBILITIES:
 *   - Preserve the existing /register-full request flow.
 *   - Delegate unchanged persistence behavior to focused helpers.
 *   - Validate Apple signup proof only for Apple onboarding.
 * ============================================================
 */

const express = require("express");
const router = express.Router();

const User = require("../../models/User");
const {
  isPendingDeleteUser,
} = require("../../services/accountDeletionService");

const {
  getTrustedSignupIdentity,
  sanitizeSignupPhotos,
  sendPendingDeleteSignupResponse,
} = require("./registerFullHelpers");

const {
  completeExistingUser,
  createNewUser,
} = require("./registerFullPersistence");

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

      city,
      height,

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
      return res.status(400).json({
        error: "Missing required fields.",
      });
    }

    const emailLower = String(email || "")
      .trim()
      .toLowerCase();

    const signupPhotos =
      sanitizeSignupPhotos(photos);

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

    let user = await User.findOne({
      email: emailLower,
    });

    if (
      user &&
      isPendingDeleteUser(user)
    ) {
      return sendPendingDeleteSignupResponse(
        res,
        user
      );
    }

    // Email OTP signup already owns a temporary Mongo user
    // created by /send-code. Only that verified placeholder
    // may be completed.
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

      return completeExistingUser({
        res,
        user,
        signupPhotos,
        appleId,
        data: {
          firstName,
          lastName,
          password,
          gender,
          dob,
          lookingFor,
          interestedIn,
          city,
          height,
          likes,
          dislikes,
          preferences,
          visibilityMode,
          interests,
          avatar,
          phone,
          voiceUrl,
          voiceDurationSec,
        },
      });
    }

    // Google/Apple signup only issues a ticket after proving that
    // no account currently exists for that verified identity.
    if (user) {
      return res.status(409).json({
        status: "account_exists",
        error:
          "An account already exists with this email. Try logging in.",
      });
    }

    return createNewUser({
      res,
      emailLower,
      signupPhotos,
      appleId,
      googleId,
      data: {
        firstName,
        lastName,
        password,
        gender,
        dob,
        lookingFor,
        interestedIn,
        city,
        height,
        likes,
        dislikes,
        preferences,
        visibilityMode,
        interests,
        avatar,
        phone,
        voiceUrl,
        voiceDurationSec,
      },
    });
  } catch (err) {
    console.error(
      "❌ /register-full hybrid error:",
      err
    );

    if (err?.statusCode) {
      return res
        .status(err.statusCode)
        .json({
          error: err.message,
        });
    }

    return res.status(500).json({
      error:
        "Server error completing profile",
    });
  }
});

module.exports = router;