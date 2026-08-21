/**
 * ============================================================
 * 📁 File: server/modules/sentryPrivacy.js
 * 🎯 Purpose: Remove sensitive RomBuzz data from Sentry events.
 *
 * Protects:
 *   - all request headers except a tiny safe allowlist
 *   - request bodies, cookies, and query strings
 *   - user email, phone, IP, username, and other PII
 *   - query parameters from captured URLs
 *   - console breadcrumbs that may contain private app data
 * ============================================================
 */

const SAFE_HEADERS = new Set([
  "content-type",
  "content-length",
  "accept",
]);

function stripUrlQuery(value) {
  if (typeof value !== "string") return value;

  const queryIndex = value.indexOf("?");
  return queryIndex >= 0 ? value.slice(0, queryIndex) : value;
}

function sanitizeHeaders(headers) {
  if (!headers || typeof headers !== "object") return undefined;

  const safeHeaders = Object.entries(headers).filter(([key]) =>
    SAFE_HEADERS.has(key.toLowerCase())
  );

  return safeHeaders.length
    ? Object.fromEntries(safeHeaders)
    : undefined;
}

function sanitizeUser(user) {
  if (!user || typeof user !== "object") return undefined;

  return user.id
    ? { id: String(user.id) }
    : undefined;
}

function sanitizeBreadcrumbs(breadcrumbs) {
  if (!Array.isArray(breadcrumbs)) return breadcrumbs;

  return breadcrumbs
    .filter((breadcrumb) => breadcrumb?.category !== "console")
    .map((breadcrumb) => {
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
    delete event.request.env;
  }

  event.user = sanitizeUser(event.user);
  event.breadcrumbs = sanitizeBreadcrumbs(event.breadcrumbs);

  return event;
}

module.exports = {
  sanitizeSentryEvent,
};