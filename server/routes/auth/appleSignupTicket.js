/**
 * ============================================================
 * 📁 File: server/routes/auth/appleSignupTicket.js
 * 🎯 Purpose: Issue and verify short-lived Apple signup tickets.
 *
 * LOCATION:
 *   server/routes/auth/appleSignupTicket.js
 *
 * USED BY:
 *   apple.js and registerFull.js
 *
 * RESPONSIBILITIES:
 *   - Bind verified Apple ID + email to signup onboarding.
 *   - Prevent the client from choosing an arbitrary appleId.
 * ============================================================
 */

const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("../../config/env");

const ISSUER = "rombuzz-api";
const AUDIENCE = "rombuzz-apple-signup";

function clean(value) {
  return String(value || "").trim();
}

function createAppleSignupTicket({ email, appleId }) {
  const cleanEmail = clean(email).toLowerCase();
  const cleanAppleId = clean(appleId);

  if (!cleanEmail || !cleanAppleId) {
    throw new Error("Apple signup identity is incomplete.");
  }

  return jwt.sign(
    {
      purpose: "apple_signup",
      email: cleanEmail,
      appleId: cleanAppleId,
    },
    JWT_SECRET,
    {
      algorithm: "HS256",
      expiresIn: "45m",
      issuer: ISSUER,
      audience: AUDIENCE,
    }
  );
}

function verifyAppleSignupTicket(ticket) {
  let payload;

  try {
    payload = jwt.verify(
      String(ticket || ""),
      JWT_SECRET,
      {
        algorithms: ["HS256"],
        issuer: ISSUER,
        audience: AUDIENCE,
      }
    );
  } catch {
    throw Object.assign(
      new Error(
        "Apple signup verification is invalid or expired."
      ),
      { statusCode: 401 }
    );
  }

  const email = clean(payload?.email).toLowerCase();
  const appleId = clean(payload?.appleId);

  if (
    payload?.purpose !== "apple_signup" ||
    !email ||
    !appleId
  ) {
    throw Object.assign(
      new Error("Invalid Apple signup verification."),
      { statusCode: 400 }
    );
  }

  return { email, appleId };
}

module.exports = {
  createAppleSignupTicket,
  verifyAppleSignupTicket,
};