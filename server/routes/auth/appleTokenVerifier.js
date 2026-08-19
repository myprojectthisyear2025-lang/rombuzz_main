/**
 * ============================================================
 * 📁 File: server/routes/auth/appleTokenVerifier.js
 * 🎯 Purpose: Securely verify Apple identity tokens.
 *
 * LOCATION:
 *   server/routes/auth/appleTokenVerifier.js
 *
 * USED BY:
 *   server/routes/auth/apple.js
 *
 * SECURITY:
 *   - Verifies Apple's RS256 signature.
 *   - Verifies Apple issuer.
 *   - Verifies RomBuzz bundle ID audience.
 *   - Caches Apple's public keys temporarily.
 * ============================================================
 */

const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_KEYS_URL = "https://appleid.apple.com/auth/keys";
const CACHE_MS = 6 * 60 * 60 * 1000;

const DEFAULT_AUDIENCES = [
  "com.rombuzz.app",
  "com.rombuzz.app.dev",
  "com.rombuzz.app.preview",
];

let cachedKeys = [];
let cacheExpiresAt = 0;

function getAllowedAudiences() {
  const configured = String(
    process.env.APPLE_ALLOWED_AUDIENCES || ""
  )
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return configured.length
    ? configured
    : DEFAULT_AUDIENCES;
}

async function loadAppleKeys(forceRefresh = false) {
  if (
    !forceRefresh &&
    cachedKeys.length &&
    Date.now() < cacheExpiresAt
  ) {
    return cachedKeys;
  }

  const response = await fetch(APPLE_KEYS_URL);

  if (!response.ok) {
    throw new Error(
      `Apple key request failed with ${response.status}`
    );
  }

  const payload = await response.json();

  cachedKeys = Array.isArray(payload?.keys)
    ? payload.keys
    : [];

  cacheExpiresAt = Date.now() + CACHE_MS;

  return cachedKeys;
}

async function findSigningKey(kid) {
  let keys = await loadAppleKeys(false);
  let key = keys.find((item) => item.kid === kid);

  if (!key) {
    keys = await loadAppleKeys(true);
    key = keys.find((item) => item.kid === kid);
  }

  if (!key) {
    throw new Error("Apple signing key not found");
  }

  return key;
}

async function verifyAppleIdentityToken(identityToken) {
  const decoded = jwt.decode(identityToken, {
    complete: true,
  });

  const header = decoded?.header || {};

  if (!header.kid || header.alg !== "RS256") {
    throw new Error("Invalid Apple token header");
  }

  const jwk = await findSigningKey(header.kid);

  const publicKey = crypto.createPublicKey({
    key: jwk,
    format: "jwk",
  });

  return jwt.verify(identityToken, publicKey, {
    algorithms: ["RS256"],
    issuer: APPLE_ISSUER,
    audience: getAllowedAudiences(),
  });
}

module.exports = {
  verifyAppleIdentityToken,
};