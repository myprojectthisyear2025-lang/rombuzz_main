/**
 * ============================================================
 * 📁 File: server/services/appleTokenVault.js
 * 🎯 Purpose: Encrypt/decrypt Apple refresh tokens at rest.
 *
 * LOCATION:
 *   server/services/appleTokenVault.js
 *
 * USED BY:
 *   server/services/appleAuthorizationService.js
 *
 * SECURITY:
 *   - AES-256-GCM authenticated encryption.
 *   - Requires a stable 32-byte base64 environment key.
 * ============================================================
 */

const crypto = require("crypto");

function encryptionKey() {
  const raw = String(
    process.env.APPLE_TOKEN_ENCRYPTION_KEY || ""
  ).trim();

  if (!raw) {
    const err = new Error(
      "Missing required Apple token encryption key."
    );
    err.statusCode = 503;
    err.code = "APPLE_TOKEN_ENCRYPTION_KEY_MISSING";
    throw err;
  }

  const key = Buffer.from(raw, "base64");

  if (key.length !== 32) {
    const err = new Error(
      "APPLE_TOKEN_ENCRYPTION_KEY must be 32 bytes encoded as base64."
    );
    err.statusCode = 503;
    err.code = "APPLE_TOKEN_ENCRYPTION_KEY_INVALID";
    throw err;
  }

  return key;
}

function encryptAppleToken(value) {
  const token = String(value || "").trim();

  if (!token) {
    throw new Error("Missing Apple refresh token");
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    encryptionKey(),
    iv
  );

  const encrypted = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);

  return [
    "v1",
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    encrypted.toString("base64"),
  ].join(".");
}

function decryptAppleToken(value) {
  const parts = String(value || "").split(".");

  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error(
      "Invalid encrypted Apple refresh token"
    );
  }

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(parts[1], "base64")
  );

  decipher.setAuthTag(
    Buffer.from(parts[2], "base64")
  );

  return Buffer.concat([
    decipher.update(
      Buffer.from(parts[3], "base64")
    ),
    decipher.final(),
  ]).toString("utf8");
}

module.exports = {
  encryptAppleToken,
  decryptAppleToken,
};