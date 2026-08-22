/**
 * ============================================================
 * 📁 File: server/routes/auth/signupVerificationTicket.js
 * 🎯 Purpose: Issue and verify short-lived trusted signup proof
 *    for verified email and Google onboarding.
 *
 * LOCATION:
 *   server/routes/auth/signupVerificationTicket.js
 *
 * USED BY:
 *   otp.js, google.js, and registerFullHelpers.js
 * ============================================================
 */

const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("../../config/env");

const ISSUER = "rombuzz-api";
const AUDIENCE = "rombuzz-signup-verification";
const ALLOWED_PROVIDERS = new Set(["email", "google"]);

function clean(value) {
  return String(value || "").trim();
}

function createSignupVerificationTicket({
  provider,
  email,
  providerId = "",
}) {
  const cleanProvider = clean(provider).toLowerCase();
  const cleanEmail = clean(email).toLowerCase();
  const cleanProviderId = clean(providerId);

  if (
    !ALLOWED_PROVIDERS.has(cleanProvider) ||
    !cleanEmail ||
    (cleanProvider === "google" && !cleanProviderId)
  ) {
    throw new Error("Signup verification identity is incomplete.");
  }

  return jwt.sign(
    {
      purpose: "signup_verification",
      provider: cleanProvider,
      email: cleanEmail,
      ...(cleanProviderId
        ? { providerId: cleanProviderId }
        : {}),
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

function verifySignupVerificationTicket(ticket) {
  let payload;

  try {
    payload = jwt.verify(String(ticket || ""), JWT_SECRET, {
      algorithms: ["HS256"],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
  } catch {
    throw Object.assign(
      new Error("Signup verification is invalid or expired."),
      { statusCode: 401 }
    );
  }

  const provider = clean(payload?.provider).toLowerCase();
  const email = clean(payload?.email).toLowerCase();
  const providerId = clean(payload?.providerId);

  if (
    payload?.purpose !== "signup_verification" ||
    !ALLOWED_PROVIDERS.has(provider) ||
    !email ||
    (provider === "google" && !providerId)
  ) {
    throw Object.assign(
      new Error("Invalid signup verification."),
      { statusCode: 400 }
    );
  }

  return { provider, email, providerId };
}

module.exports = {
  createSignupVerificationTicket,
  verifySignupVerificationTicket,
};