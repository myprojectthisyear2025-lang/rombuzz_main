/**
 * ============================================================
 * 📁 File: server/services/appleTokenClient.js
 * 🎯 Purpose: Call Apple's Sign in with Apple token endpoints.
 *
 * LOCATION:
 *   server/services/appleTokenClient.js
 *
 * USED BY:
 *   server/services/appleAuthorizationService.js
 *
 * RESPONSIBILITIES:
 *   - Generate short-lived Apple client-secret JWTs.
 *   - Exchange authorization codes for user tokens.
 *   - Revoke Apple refresh tokens during account deletion.
 * ============================================================
 */

const jwt = require("jsonwebtoken");

const APPLE_AUDIENCE =
  "https://appleid.apple.com";

const APPLE_TOKEN_URL =
  `${APPLE_AUDIENCE}/auth/token`;

const APPLE_REVOKE_URL =
  `${APPLE_AUDIENCE}/auth/revoke`;

function requiredEnv(name) {
  const value =
    String(process.env[name] || "").trim();

  if (!value) {
    const err = new Error(
      `Missing required Apple server configuration: ${name}`
    );

    err.statusCode = 503;
    err.code =
      "APPLE_SERVER_CONFIG_MISSING";

    throw err;
  }

  return value;
}

function getPrivateKey() {
  let value =
    requiredEnv("APPLE_PRIVATE_KEY");

  if (
    value.startsWith('"') &&
    value.endsWith('"')
  ) {
    value = value.slice(1, -1);
  }

  return value.replace(/\\n/g, "\n");
}

function createAppleClientSecret(
  clientId
) {
  const cleanClientId =
    String(clientId || "").trim();

  if (!cleanClientId) {
    const err =
      new Error("Missing Apple client ID");

    err.statusCode = 400;
    err.code =
      "APPLE_CLIENT_ID_MISSING";

    throw err;
  }

  return jwt.sign(
    {},
    getPrivateKey(),
    {
      algorithm: "ES256",

      keyid:
        requiredEnv("APPLE_KEY_ID"),

      issuer:
        requiredEnv("APPLE_TEAM_ID"),

      audience:
        APPLE_AUDIENCE,

      subject:
        cleanClientId,

      expiresIn: "5m",
    }
  );
}

async function postAppleForm(
  url,
  values
) {
  const response =
    await fetch(url, {
      method: "POST",

      headers: {
        "Content-Type":
          "application/x-www-form-urlencoded",
      },

      body:
        new URLSearchParams(
          values
        ).toString(),
    });

  const text =
    await response.text();

  let payload = {};

  if (text) {
    try {
      payload =
        JSON.parse(text);
    } catch {
      payload = {};
    }
  }

  if (!response.ok) {
    const err =
      new Error(
        `Apple token service rejected the request (${response.status}).`
      );

    err.statusCode = 502;

    err.code =
      String(
        payload?.error ||
        "APPLE_TOKEN_REQUEST_FAILED"
      );

    err.appleStatus =
      response.status;

    throw err;
  }

  return payload;
}

async function exchangeAppleAuthorizationCode({
  authorizationCode,
  clientId,
}) {
  const code =
    String(
      authorizationCode || ""
    ).trim();

  const cleanClientId =
    String(clientId || "").trim();

  if (!code || !cleanClientId) {
    const err =
      new Error(
        "Apple authorization code and client ID are required."
      );

    err.statusCode = 400;
    err.code =
      "APPLE_AUTHORIZATION_CODE_MISSING";

    throw err;
  }

  return postAppleForm(
    APPLE_TOKEN_URL,
    {
      grant_type:
        "authorization_code",

      code,

      client_id:
        cleanClientId,

      client_secret:
        createAppleClientSecret(
          cleanClientId
        ),
    }
  );
}

async function revokeAppleRefreshToken({
  refreshToken,
  clientId,
}) {
  const token =
    String(refreshToken || "").trim();

  const cleanClientId =
    String(clientId || "").trim();

  if (!token || !cleanClientId) {
    const err =
      new Error(
        "Apple refresh token and client ID are required."
      );

    err.statusCode = 400;
    err.code =
      "APPLE_REVOCATION_TOKEN_MISSING";

    throw err;
  }

  await postAppleForm(
    APPLE_REVOKE_URL,
    {
      client_id:
        cleanClientId,

      client_secret:
        createAppleClientSecret(
          cleanClientId
        ),

      token,

      token_type_hint:
        "refresh_token",
    }
  );

  return {
    success: true,
  };
}

module.exports = {
  exchangeAppleAuthorizationCode,
  revokeAppleRefreshToken,
};