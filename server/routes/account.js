/**
 * ============================================================
 * 📁 File: server/routes/account.js
 * 🎯 Purpose: Manage RomBuzz account lifecycle and verification.
 *
 * Endpoints:
 *   PATCH  /api/account/deactivate
 *   GET    /api/account/delete-preview
 *   DELETE /api/account/delete
 *   POST   /api/account/request-email-change
 *   POST   /api/account/confirm-email-change
 *
 * Responsibilities:
 *   - Soft-deactivate accounts
 *   - Start irreversible account deletion through MongoDB services
 *   - Preview BuzzCoin forfeiture before deletion
 *   - Handle secure two-step email changes with Resend
 *
 * Datastore:
 *   - MongoDB is the source of truth
 * ============================================================
 */

const express = require("express");
const { randomInt } = require("crypto");
const { Resend } = require("resend");

const router = express.Router();

const User = require("../models/User");
const authMiddleware = require("./auth-middleware");
const { baseSanitizeUser } = require("../utils/helpers");

const {
  getDeleteAccountPreview,
  startAccountDeletion,
} = require("../services/accountDeletionService");

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const EMAIL_CHANGE_RESEND_COOLDOWN_MS = 60 * 1000;
const EMAIL_CHANGE_MAX_ATTEMPTS = 5;

/* ============================================================
   🔒 PATCH /api/account/deactivate
   Soft-deactivate the authenticated user's account.
============================================================ */

router.patch("/deactivate", authMiddleware, async (req, res) => {
  try {
    const updatedUser = await User.findOneAndUpdate(
      { id: req.user.id },
      {
        $set: {
          visibility: "deactivated",
          deactivatedAt: Date.now(),
        },
      },
      { new: true }
    ).lean();

    if (!updatedUser) {
      return res.status(404).json({
        error: "User not found",
      });
    }

    return res.json({
      success: true,
      message: "Account deactivated",
      user: baseSanitizeUser(updatedUser),
    });
  } catch (err) {
    console.error(
      "❌ Error deactivating account:",
      err
    );

    return res.status(500).json({
      error: "Failed to deactivate account",
    });
  }
});

/* ============================================================
   🧾 GET /api/account/delete-preview
   Return wallet/forfeiture information before deletion.
============================================================ */

router.get(
  "/delete-preview",
  authMiddleware,
  async (req, res) => {
    try {
      const preview =
        await getDeleteAccountPreview(
          req.user?.id
        );

      return res.json({
        success: true,
        ...preview,
      });
    } catch (err) {
      console.error(
        "❌ delete-preview error:",
        err
      );

      return res
        .status(err.statusCode || 500)
        .json({
          error:
            err.code ||
            "DELETE_PREVIEW_FAILED",

          message:
            err.message ||
            "Failed to preview account deletion.",
        });
    }
  }
);

/* ============================================================
   🗑️ DELETE /api/account/delete
   Start irreversible account deletion.

   - User disappears from normal RomBuzz surfaces immediately
   - Email enters the configured 7-day hold
   - Cleanup retries run while the account is pending deletion
   - Final pending-delete User record is wiped after the hold
============================================================ */

router.delete(
  "/delete",
  authMiddleware,
  async (req, res) => {
    try {
      const uid = req.user?.id;

      if (!uid) {
        return res.status(401).json({
          error:
            "Unauthorized: missing user ID",
        });
      }

      const confirmForfeit =
        req.body?.confirmForfeit === true ||
        req.body?.confirmForfeit ===
          "true";

      const result =
        await startAccountDeletion(
          uid,
          {
            confirmForfeit,
          }
        );

      return res.json(result);
    } catch (err) {
      console.error(
        "❌ Error starting account deletion:",
        err
      );

      if (
        err?.code ===
        "BUZZCOIN_FORFEIT_CONFIRMATION_REQUIRED"
      ) {
        return res.status(409).json({
          error: err.code,
          code: err.code,

          message:
            "You still have BuzzCoins or Creator balance. Confirm forfeiture before deleting your account.",

          wallet: err.wallet,
          holdDays: err.holdDays,
        });
      }

      return res
        .status(err.statusCode || 500)
        .json({
          error:
            err.code ||
            "DELETE_ACCOUNT_FAILED",

          message:
            err.message ||
            "Server error deleting account",
        });
    }
  }
);

/* ============================================================
   📬 POST /api/account/request-email-change
   Send a verification code to a new email address.
============================================================ */

router.post(
  "/request-email-change",
  authMiddleware,
  async (req, res) => {
    try {
      const { newEmail } =
        req.body || {};

      if (!newEmail) {
        return res.status(400).json({
          error:
            "newEmail is required",
        });
      }

      const emailLower = String(
        newEmail
      )
        .trim()
        .toLowerCase();

      const exists = await User.exists({
        email: emailLower,
      });

      if (exists) {
        return res.status(409).json({
          error:
            "Email already in use",
        });
      }

      const user =
        await User.findOne({
          id: req.user.id,
        });

      if (!user) {
        return res.status(404).json({
          error: "User not found",
        });
      }

      const now = new Date();

      const lastSentAt =
        user.pendingEmailChange
          ?.lastSentAt;

      if (lastSentAt) {
        const elapsedMs =
          now.getTime() -
          new Date(
            lastSentAt
          ).getTime();

        if (
          elapsedMs <
          EMAIL_CHANGE_RESEND_COOLDOWN_MS
        ) {
          return res
            .status(429)
            .json({
              error:
                "Please wait before requesting another email-change code.",

              retryAfter: Math.ceil(
                (
                  EMAIL_CHANGE_RESEND_COOLDOWN_MS -
                  elapsedMs
                ) / 1000
              ),
            });
        }
      }

      const code = randomInt(
        100000,
        1000000
      ).toString();

      const expires =
        now.getTime() +
        10 * 60 * 1000;

      user.pendingEmailChange = {
        email: emailLower,
        code,
        expires,
        attempts: 0,
        lastSentAt: now,
      };

      await user.save();

      if (!resend) {
        if (
          process.env.NODE_ENV ===
          "production"
        ) {
          console.error(
            "❌ RESEND_API_KEY missing in production"
          );

          return res
            .status(503)
            .json({
              error:
                "Email service unavailable",
            });
        }

        console.log(
          `📧 [DEV] Email-change code for ${emailLower}: ${code}`
        );

        return res.json({
          success: true,
          dev: true,
        });
      }

      await resend.emails.send({
        to: emailLower,

        from:
          process.env.FROM_EMAIL ||
          "RomBuzz <onboarding@resend.dev>",

        subject:
          "Confirm your new email",

        text:
          `Your verification code is ${code}. ` +
          "It expires in 10 minutes.",

        html:
          `<p>Your verification code is ` +
          `<strong>${code}</strong>. ` +
          `It expires in 10 minutes.</p>`,
      });

      return res.json({
        success: true,
      });
    } catch (err) {
      console.error(
        "❌ request-email-change error:",
        err
      );

      return res.status(500).json({
        error:
          "Failed to send verification email",
      });
    }
  }
);

/* ============================================================
   ✅ POST /api/account/confirm-email-change
   Verify the code and apply the new email.
============================================================ */

router.post(
  "/confirm-email-change",
  authMiddleware,
  async (req, res) => {
    try {
      const { code } =
        req.body || {};

      if (!code) {
        return res.status(400).json({
          error: "code required",
        });
      }

      const user =
        await User.findOne({
          id: req.user.id,
        });

      if (!user) {
        return res.status(404).json({
          error: "User not found",
        });
      }

      const pending =
        user.pendingEmailChange;

      if (!pending) {
        return res.status(400).json({
          error:
            "No email change pending",
        });
      }

      if (
        pending.expires <
        Date.now()
      ) {
        user.pendingEmailChange =
          null;

        await user.save();

        return res.status(400).json({
          error:
            "Verification code expired",
        });
      }

      if (
        Number(
          pending.attempts || 0
        ) >=
        EMAIL_CHANGE_MAX_ATTEMPTS
      ) {
        return res.status(400).json({
          error:
            "Too many incorrect attempts. Please request a new verification code.",
        });
      }

      if (
        String(pending.code) !==
        String(code)
      ) {
        const attempts =
          Number(
            pending.attempts || 0
          ) + 1;

        user.pendingEmailChange = {
          ...pending,
          attempts,
        };

        user.markModified(
          "pendingEmailChange"
        );

        await user.save();

        if (
          attempts >=
          EMAIL_CHANGE_MAX_ATTEMPTS
        ) {
          return res
            .status(400)
            .json({
              error:
                "Too many incorrect attempts. Please request a new verification code.",
            });
        }

        return res.status(400).json({
          error: "Invalid code",
        });
      }

      user.email =
        pending.email;

      user.pendingEmailChange =
        null;

      await user.save();

      console.log(
        `📧 Email updated successfully for user ${user.id}`
      );

      return res.json({
        success: true,
        email: user.email,
      });
    } catch (err) {
      console.error(
        "❌ confirm-email-change error:",
        err
      );

      return res.status(500).json({
        error:
          "Failed to confirm email change",
      });
    }
  }
);

module.exports = router;