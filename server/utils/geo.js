/**
 * ============================================================
 * 📁 File: utils/geo.js
 * 🧭 Purpose: Shared geographic helpers for Meet in the Middle
 *
 * Used by:
 *   - services/meetMiddleService.js
 *   - services/geoapifyService.js
 *   - routes/meetMiddle.js
 *
 * Notes:
 *   - No external dependencies.
 *   - Keeps coordinate validation and midpoint math out of routes.
 * ============================================================
 */

const EARTH_RADIUS_METERS = 6371000;

function toRadians(value) {
  return (Number(value) * Math.PI) / 180;
}

function toDegrees(value) {
  return (Number(value) * 180) / Math.PI;
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeCoordinateInput(coords = {}) {
  const lat = Number(coords.lat);
  const lng = Number(coords.lng);

  return { lat, lng };
}

function isValidLatitude(lat) {
  return isFiniteNumber(lat) && lat >= -90 && lat <= 90;
}

function isValidLongitude(lng) {
  return isFiniteNumber(lng) && lng >= -180 && lng <= 180;
}

function isValidCoords(coords = {}) {
  const normalized = normalizeCoordinateInput(coords);
  return isValidLatitude(normalized.lat) && isValidLongitude(normalized.lng);
}

function assertValidCoords(coords = {}, label = "coords") {
  const normalized = normalizeCoordinateInput(coords);

  if (!isValidCoords(normalized)) {
    const err = new Error(`${label} must contain valid lat/lng numbers`);
    err.code = "INVALID_COORDS";
    err.statusCode = 400;
    throw err;
  }

  return normalized;
}

function normalizeLongitude(lng) {
  let value = Number(lng);

  while (value > 180) value -= 360;
  while (value < -180) value += 360;

  return value;
}

/**
 * Calculates the geographic midpoint between two coordinates.
 * This is better than simple averaging because it handles curvature.
 */
function calculateMidpoint(a, b) {
  const pointA = assertValidCoords(a, "first coordinate");
  const pointB = assertValidCoords(b, "second coordinate");

  const lat1 = toRadians(pointA.lat);
  const lng1 = toRadians(pointA.lng);
  const lat2 = toRadians(pointB.lat);
  const lng2 = toRadians(pointB.lng);

  const deltaLng = lng2 - lng1;

  const bx = Math.cos(lat2) * Math.cos(deltaLng);
  const by = Math.cos(lat2) * Math.sin(deltaLng);

  const midpointLat = Math.atan2(
    Math.sin(lat1) + Math.sin(lat2),
    Math.sqrt((Math.cos(lat1) + bx) ** 2 + by ** 2)
  );

  const midpointLng = lng1 + Math.atan2(by, Math.cos(lat1) + bx);

  return {
    lat: Number(toDegrees(midpointLat).toFixed(7)),
    lng: Number(normalizeLongitude(toDegrees(midpointLng)).toFixed(7)),
  };
}

function distanceMeters(a, b) {
  const pointA = assertValidCoords(a, "first coordinate");
  const pointB = assertValidCoords(b, "second coordinate");

  const lat1 = toRadians(pointA.lat);
  const lat2 = toRadians(pointB.lat);
  const deltaLat = toRadians(pointB.lat - pointA.lat);
  const deltaLng = toRadians(pointB.lng - pointA.lng);

  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;

  const centralAngle =
    2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));

  return Math.round(EARTH_RADIUS_METERS * centralAngle);
}

function metersToMiles(meters) {
  return Number((Number(meters || 0) / 1609.344).toFixed(2));
}

function clampNumber(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

module.exports = {
  EARTH_RADIUS_METERS,
  toRadians,
  toDegrees,
  isFiniteNumber,
  normalizeCoordinateInput,
  isValidLatitude,
  isValidLongitude,
  isValidCoords,
  assertValidCoords,
  calculateMidpoint,
  distanceMeters,
  metersToMiles,
  clampNumber,
};