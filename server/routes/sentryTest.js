/**
 * ============================================================
 * 📁 File: server/routes/sentryTest.js
 * 🎯 Purpose: Safely verify RomBuzz backend Sentry reporting.
 *
 * The route is disabled unless SENTRY_TEST_ENABLED=true
 * and requires the private X-Sentry-Test-Key header.
 * ============================================================
 */

const express = require("express");
const crypto = require("crypto");

const router = express.Router();

function safeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") {
    return false;
  }

  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

router.get("/", (req, res, next) => {
  const enabled = process.env.SENTRY_TEST_ENABLED === "true";
  const expectedKey = process.env.SENTRY_TEST_KEY;
  const suppliedKey = req.get("x-sentry-test-key");

  // Behave like the route doesn't exist unless explicitly enabled.
  if (!enabled || !expectedKey || !safeEqual(suppliedKey, expectedKey)) {
    return res.status(404).json({
      success: false,
      error: "Not found",
    });
  }

  const error = new Error("RomBuzz Sentry backend verification test");
  error.status = 500;

  next(error);
});

module.exports = router;