/**
 * ============================================================
 * 📁 File: server/models/AppleAuthCredential.js
 * 🎯 Purpose: Store encrypted Sign in with Apple refresh tokens.
 *
 * LOCATION:
 *   server/models/AppleAuthCredential.js
 *
 * USED BY:
 *   server/services/appleAuthorizationService.js
 *
 * RESPONSIBILITIES:
 *   - Store Apple refresh tokens encrypted at rest.
 *   - Link active credentials to RomBuzz user IDs.
 *   - Auto-expire abandoned Apple signup credentials.
 * ============================================================
 */

const mongoose = require("mongoose");

const appleAuthCredentialSchema = new mongoose.Schema(
  {
    appleId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    userId: {
      type: String,
      default: "",
      index: true,
    },
    clientId: {
      type: String,
      required: true,
    },
    refreshTokenEncrypted: {
      type: String,
      required: true,
      select: false,
    },
    pendingSignupExpiresAt: {
      type: Date,
      default: null,
      index: { expires: 0 },
    },
    lastRevocationAttemptAt: {
      type: Date,
      default: null,
    },
    lastRevocationError: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
    minimize: true,
  }
);

module.exports =
  mongoose.models.AppleAuthCredential ||
  mongoose.model(
    "AppleAuthCredential",
    appleAuthCredentialSchema
  );