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
 *   - Enforce server-side RomBuzz 18+ DOB requirements.
 *   - Delegate unchanged persistence behavior to focused helpers.
 *   - Validate Apple signup proof only for Apple onboarding.
 * ============================================================
 */

const express = require("express");
const router = express.Router();

const User =
  require("../../models/User");

const {
  isPendingDeleteUser,
} = require(
  "../../services/accountDeletionService"
);

const {
  requireAdultDob,
} = require(
  "../../utils/ageGate"
);

const {
  getTrustedAppleId,
  sanitizeSignupPhotos,
  sendPendingDeleteSignupResponse,
} = require(
  "./registerFullHelpers"
);

const {
  completeExistingUser,
  createNewUser,
} = require(
  "./registerFullPersistence"
);

router.post(
  "/register-full",
  async (req, res) => {
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

      if (
        !email ||
        !firstName ||
        !lastName
      ) {
        return res
          .status(400)
          .json({
            error:
              "Missing required fields.",
          });
      }

      /*
       * Never trust the mobile
       * 18+ check by itself.
       */
      const {
        dob: verifiedDob,
      } =
        requireAdultDob(dob);

      const emailLower =
        String(email || "")
          .trim()
          .toLowerCase();

      const signupPhotos =
        sanitizeSignupPhotos(
          photos
        );

      const appleId =
        getTrustedAppleId(
          req.body || {},
          emailLower
        );

      let user =
        await User.findOne({
          email: emailLower,
        });

      if (
        user &&
        isPendingDeleteUser(
          user
        )
      ) {
        return sendPendingDeleteSignupResponse(
          res,
          user
        );
      }

      if (user) {
        if (
          appleId &&
          user.appleId &&
          user.appleId !==
            appleId
        ) {
          return res
            .status(409)
            .json({
              error:
                "This email is linked to a different Apple account.",
            });
        }

        return completeExistingUser(
          {
            res,
            user,
            signupPhotos,
            appleId,

            data: {
              firstName,
              lastName,
              password,
              gender,

              dob:
                verifiedDob,

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
          }
        );
      }

      return createNewUser({
        res,
        emailLower,
        signupPhotos,
        appleId,

        data: {
          firstName,
          lastName,
          password,
          gender,

          dob:
            verifiedDob,

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
        err?.code ||
          err?.message ||
          err
      );

      if (
        err?.statusCode
      ) {
        return res
          .status(
            err.statusCode
          )
          .json({
            error:
              err.message,

            code:
              err.code ||
              "REGISTER_FULL_REJECTED",
          });
      }

      return res
        .status(500)
        .json({
          error:
            "Server error completing profile",
        });
    }
  }
);

module.exports = router;