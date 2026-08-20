/**
 * ============================================================
 * 📁 File: server/middleware/authRateLimit.js
 * 🎯 Purpose: Targeted in-memory rate limits for authentication
 *    and verification endpoints that are exposed before login.
 *
 * Notes:
 *  - Uses Render's X-Forwarded-For client IP when present.
 *  - Keeps separate counters per limiter and auto-prunes them.
 *  - No external package or database dependency.
 * ============================================================
 */

const stores = new Set();
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

function getClientIp(req) {
  const forwarded = req.headers?.["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const firstForwarded = String(raw || "").split(",")[0].trim();

  return firstForwarded || req.socket?.remoteAddress || req.ip || "unknown";
}

function getBodyKey(req, field) {
  const value = String(req.body?.[field] || "")
    .trim()
    .toLowerCase();

  return value || `missing:${getClientIp(req)}`;
}

function createStore() {
  const store = new Map();
  stores.add(store);
  return store;
}

function getActiveEntry(store, key, windowMs) {
  const now = Date.now();
  let entry = store.get(key);

  if (!entry || entry.resetAt <= now) {
    entry = {
      count: 0,
      resetAt: now + windowMs,
    };

    store.set(key, entry);
  }

  return entry;
}

function sendRateLimit(res, entry, message) {
  const retryAfter = Math.max(
    1,
    Math.ceil((entry.resetAt - Date.now()) / 1000)
  );

  res.setHeader("Retry-After", String(retryAfter));

  return res.status(429).json({
    status: "rate_limited",
    error: message,
    retryAfter,
  });
}

function createFixedWindowLimiter({
  name,
  windowMs,
  max,
  keyFn,
  message,
}) {
  const store = createStore();

  return function fixedWindowLimiter(req, res, next) {
    if (req.method === "OPTIONS") {
      return next();
    }

    const key = `${name}:${keyFn(req)}`;
    const entry = getActiveEntry(
      store,
      key,
      windowMs
    );

    if (entry.count >= max) {
      return sendRateLimit(
        res,
        entry,
        message
      );
    }

    entry.count += 1;
    return next();
  };
}

function createFailureLimiter({
  name,
  windowMs,
  max,
  keyFn,
  isFailure,
  message,
}) {
  const store = createStore();

  return function failureLimiter(req, res, next) {
    if (req.method === "OPTIONS") {
      return next();
    }

    const key = `${name}:${keyFn(req)}`;
    const entry = getActiveEntry(
      store,
      key,
      windowMs
    );

    if (entry.count >= max) {
      return sendRateLimit(
        res,
        entry,
        message
      );
    }

    res.once("finish", () => {
      if (isFailure(res.statusCode)) {
        const active = getActiveEntry(
          store,
          key,
          windowMs
        );

        active.count += 1;
      } else if (
        res.statusCode >= 200 &&
        res.statusCode < 300
      ) {
        store.delete(key);
      }
    });

    return next();
  };
}

function setupAuthRateLimits(app) {
  const fifteenMinutes =
    15 * 60 * 1000;

  const ip = (req) =>
    getClientIp(req);

  const email = (req) =>
    getBodyKey(req, "email");

  const newEmail = (req) =>
    getBodyKey(req, "newEmail");

  const ipLimit = (
    name,
    max,
    message
  ) =>
    createFixedWindowLimiter({
      name,
      windowMs: fifteenMinutes,
      max,
      keyFn: ip,
      message,
    });

  const emailLimit = (
    name,
    max,
    message,
    keyFn = email
  ) =>
    createFixedWindowLimiter({
      name,
      windowMs: fifteenMinutes,
      max,
      keyFn,
      message,
    });

  app.use(
    "/api/auth/login",
    ipLimit(
      "login-ip",
      30,
      "Too many login attempts. Please try again later."
    ),
    createFailureLimiter({
      name: "login-email",
      windowMs: fifteenMinutes,
      max: 10,
      keyFn: email,
      isFailure: (status) =>
        status === 401,
      message:
        "Too many failed login attempts. Please try again later.",
    })
  );

  app.use(
    "/api/auth/send-code",
    ipLimit(
      "otp-send-ip",
      20,
      "Too many verification-code requests. Please try again later."
    ),
    emailLimit(
      "otp-send-email",
      6,
      "Too many verification-code requests for this email. Please try again later."
    )
  );

  app.use(
    "/api/auth/verify-code",
    ipLimit(
      "otp-verify-ip",
      60,
      "Too many verification attempts. Please try again later."
    )
  );

  app.use(
    "/api/auth/forgot-password",
    ipLimit(
      "reset-send-ip",
      15,
      "Too many password-reset requests. Please try again later."
    ),
    emailLimit(
      "reset-send-email",
      6,
      "Too many password-reset requests. Please try again later."
    )
  );

  const resetVerifyIp = ipLimit(
    "reset-verify-ip",
    60,
    "Too many password-reset attempts. Please try again later."
  );

  app.use(
    "/api/auth/verify-reset-code",
    resetVerifyIp
  );

  app.use(
    "/api/auth/reset-password",
    resetVerifyIp
  );

  const socialAuthIp = ipLimit(
    "social-auth-ip",
    30,
    "Too many authentication attempts. Please try again later."
  );

  app.use(
    "/api/auth/google",
    socialAuthIp
  );

  app.use(
    "/api/auth/apple",
    socialAuthIp
  );

  app.use(
    "/api/account/request-email-change",
    ipLimit(
      "email-change-send-ip",
      15,
      "Too many email-change requests. Please try again later."
    ),
    emailLimit(
      "email-change-email",
      6,
      "Too many requests for this email. Please try again later.",
      newEmail
    )
  );

  app.use(
    "/api/account/confirm-email-change",
    ipLimit(
      "email-change-verify-ip",
      60,
      "Too many email-change verification attempts. Please try again later."
    )
  );
}

const cleanupTimer = setInterval(() => {
  const now = Date.now();

  for (const store of stores) {
    for (
      const [key, entry]
      of store.entries()
    ) {
      if (entry.resetAt <= now) {
        store.delete(key);
      }
    }
  }
}, CLEANUP_INTERVAL_MS);

if (
  typeof cleanupTimer.unref ===
  "function"
) {
  cleanupTimer.unref();
}

module.exports = {
  setupAuthRateLimits,
};