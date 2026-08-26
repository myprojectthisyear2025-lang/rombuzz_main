/**
 * ============================================================
 * 📁 File: server/services/appleAuthorizationService.js
 * 🎯 Purpose: Persist and revoke Sign in with Apple authorization.
 *
 * USED BY: Apple auth, register-full persistence, account deletion.
 * ============================================================
 */

const AppleAuthCredential =
  require("../models/AppleAuthCredential");

const {
  verifyAppleIdentityToken,
} = require("../routes/auth/appleTokenVerifier");

const {
  exchangeAppleAuthorizationCode,
  revokeAppleRefreshToken,
} = require("./appleTokenClient");

const {
  encryptAppleToken,
  decryptAppleToken,
} = require("./appleTokenVault");

const PENDING_SIGNUP_MS =
  60 * 60 * 1000;

function getClientId(
  identityPayload = {}
) {
  const aud =
    identityPayload?.aud;

  const clientId =
    String(
      Array.isArray(aud)
        ? aud[0] || ""
        : aud || ""
    ).trim();

  if (!clientId) {
    const err =
      new Error(
        "Apple client ID missing from identity token."
      );

    err.statusCode = 401;
    err.code =
      "APPLE_CLIENT_ID_MISSING";

    throw err;
  }

  return clientId;
}

async function captureAppleAuthorization({
  authorizationCode,
  identityPayload,
  appleId,
  userId = "",
  pendingSignup = false,
}) {
  const expectedAppleId =
    String(appleId || "").trim();

  const clientId =
    getClientId(
      identityPayload
    );

  const tokenResponse =
    await exchangeAppleAuthorizationCode({
      authorizationCode,
      clientId,
    });

  const refreshToken =
    String(
      tokenResponse?.refresh_token ||
        ""
    ).trim();

  const exchangedIdToken =
    String(
      tokenResponse?.id_token ||
        ""
    ).trim();

  if (
    !refreshToken ||
    !exchangedIdToken
  ) {
    const err =
      new Error(
        "Apple did not return the required authorization tokens."
      );

    err.statusCode = 502;
    err.code =
      "APPLE_TOKEN_RESPONSE_INCOMPLETE";

    throw err;
  }

  const exchangedPayload =
    await verifyAppleIdentityToken(
      exchangedIdToken
    );

  if (
    String(
      exchangedPayload?.sub ||
        ""
    ).trim() !== expectedAppleId
  ) {
    const err =
      new Error(
        "Apple authorization code does not match the verified user."
      );

    err.statusCode = 401;
    err.code =
      "APPLE_AUTHORIZATION_MISMATCH";

    throw err;
  }

  await AppleAuthCredential
    .findOneAndUpdate(
      {
        appleId:
          expectedAppleId,
      },

      {
        $set: {
          userId:
            String(
              userId || ""
            ).trim(),

          clientId,

          refreshTokenEncrypted:
            encryptAppleToken(
              refreshToken
            ),

          pendingSignupExpiresAt:
            pendingSignup
              ? new Date(
                  Date.now() +
                    PENDING_SIGNUP_MS
                )
              : null,

          lastRevocationAttemptAt:
            null,

          lastRevocationError:
            "",
        },
      },

      {
        upsert: true,
        new: true,
      }
    );

  return {
    success: true,
    clientId,
  };
}

async function activateAppleCredential({
  appleId,
  userId,
}) {
  const result =
    await AppleAuthCredential
      .updateOne(
        {
          appleId:
            String(
              appleId || ""
            ).trim(),
        },

        {
          $set: {
            userId:
              String(
                userId || ""
              ).trim(),

            pendingSignupExpiresAt:
              null,
          },
        }
      );

  if (!result?.matchedCount) {
    const err =
      new Error(
        "Verified Apple authorization credential was not found."
      );

    err.statusCode = 500;
    err.code =
      "APPLE_CREDENTIAL_NOT_FOUND";

    throw err;
  }

  return {
    success: true,
  };
}

async function revokeAppleAuthorizationForUser({
  userId,
  appleId = "",
}) {
  const uid =
    String(userId || "").trim();

  const aid =
    String(appleId || "").trim();

  const clauses = [];

  if (uid) {
    clauses.push({
      userId: uid,
    });
  }

  if (aid) {
    clauses.push({
      appleId: aid,
    });
  }

  if (!clauses.length) {
    return {
      success: true,
      skipped: true,
      failedCount: 0,
    };
  }

  const credential =
    await AppleAuthCredential
      .findOne({
        $or: clauses,
      })
      .select(
        "+refreshTokenEncrypted"
      );

  if (!credential) {
    return {
      success: true,
      skipped: true,

      manualRevocationRequired:
        !!aid,

      failedCount: 0,
    };
  }

  try {
    await revokeAppleRefreshToken({
      refreshToken:
        decryptAppleToken(
          credential
            .refreshTokenEncrypted
        ),

      clientId:
        credential.clientId,
    });

    await AppleAuthCredential
      .deleteOne({
        _id: credential._id,
      });

    return {
      success: true,
      revoked: true,
      failedCount: 0,
    };
  } catch (err) {
    await AppleAuthCredential
      .updateOne(
        {
          _id: credential._id,
        },

        {
          $set: {
            lastRevocationAttemptAt:
              new Date(),

            lastRevocationError:
              String(
                err?.code ||
                  err?.message ||
                  "Apple revocation failed"
              ).slice(
                0,
                300
              ),
          },
        }
      );

    return {
      success: false,
      revoked: false,
      failedCount: 1,

      error:
        "APPLE_REVOCATION_RETRY_REQUIRED",
    };
  }
}

module.exports = {
  captureAppleAuthorization,
  activateAppleCredential,
  revokeAppleAuthorizationForUser,
};