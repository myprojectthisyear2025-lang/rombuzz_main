/**
 * ============================================================
 * 📁 File: server/modules/sentryPrivacy.js
 * 🎯 Purpose: Remove sensitive RomBuzz data from Sentry events.
 *
 * Protects:
 *   - auth/session headers
 *   - request bodies
 *   - query strings
 *   - cookies
 *   - email/phone/IP user fields
 *   - signed/private URLs
 * ============================================================
 */

const SENSITIVE_HEADERS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-auth-token",
]);

function stripUrlQuery(value) {
  if (typeof value !== "string") return value;

  const queryIndex = value.indexOf("?");
  return queryIndex >= 0 ? value.slice(0, queryIndex) : value;
}

function sanitizeHeaders(headers) {
  if (!headers || typeof headers !== "object") return headers;

  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      SENSITIVE_HEADERS.has(key.toLowerCase()) ? "[Filtered]" : value,
    ])
  );
}

function sanitizeUser(user) {
  if (!user || typeof user !== "object") return user;

  return {
    ...(user.id ? { id: user.id } : {}),
  };
}

function sanitizeBreadcrumbs(breadcrumbs) {
  if (!Array.isArray(breadcrumbs)) return breadcrumbs;

  return breadcrumbs.map((breadcrumb) => {
    if (!breadcrumb?.data) return breadcrumb;

    return {
      ...breadcrumb,
      data: {
        ...breadcrumb.data,
        url: stripUrlQuery(breadcrumb.data.url),
      },
    };
  });
}

function sanitizeSentryEvent(event) {
  if (!event || typeof event !== "object") return event;

  if (event.request) {
    event.request.url = stripUrlQuery(event.request.url);
    event.request.headers = sanitizeHeaders(event.request.headers);

    delete event.request.data;
    delete event.request.cookies;
    delete event.request.query_string;
  }

  event.user = sanitizeUser(event.user);
  event.breadcrumbs = sanitizeBreadcrumbs(event.breadcrumbs);

  return event;
}

module.exports = {
  sanitizeSentryEvent,
};