/**
 * ============================================================
 * 📁 File: server/instrument.js
 * 🎯 Purpose: Initialize Sentry monitoring for the RomBuzz API.
 *
 * Used by:
 *   server/index.js
 *
 * Must load before Express and other instrumented modules.
 * ============================================================
 */

const Sentry = require("@sentry/node");

const dsn = process.env.SENTRY_DSN;

const requestedTraceRate = Number(
  process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.1"
);

const tracesSampleRate =
  Number.isFinite(requestedTraceRate) &&
  requestedTraceRate >= 0 &&
  requestedTraceRate <= 1
    ? requestedTraceRate
    : 0.1;

if (dsn) {
  Sentry.init({
    dsn,

    environment:
      process.env.SENTRY_ENVIRONMENT ||
      process.env.NODE_ENV ||
      "development",

    release:
      process.env.SENTRY_RELEASE ||
      process.env.RENDER_GIT_COMMIT ||
      undefined,

    enableLogs: true,

    tracesSampleRate,

    // Never opt into Sentry's default collection of PII.
    sendDefaultPii: false,
  });
}

module.exports = Sentry;