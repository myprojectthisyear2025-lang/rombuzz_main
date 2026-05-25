/**
 * ============================================================
 * 📁 File: services/geoapifyService.js
 * 🗺️ Purpose: Geoapify Places provider wrapper for Meet in the Middle
 *
 * Used by:
 *   - services/meetMiddleService.js
 *
 * Security:
 *   - Uses process.env.GEOAPIFY_API_KEY only on backend.
 *   - Never expose this key to Expo/mobile.
 *
 * Output:
 *   - Returns normalized RomBuzz place objects.
 *   - Does NOT leak raw Geoapify payloads to mobile.
 * ============================================================
 */

const axios = require("axios");
const {
  assertValidCoords,
  distanceMeters,
  clampNumber,
} = require("../utils/geo");

const DEFAULT_GEOAPIFY_BASE_URL = "https://api.geoapify.com";

const DEFAULT_MEET_CATEGORIES = [
  "catering.cafe",
  "catering.restaurant",
  "catering.fast_food",
  "entertainment.cinema",
  "leisure.park",
  "commercial.shopping_mall",
  "tourism.attraction",
];

function getGeoapifyConfig() {
  const apiKey = String(process.env.GEOAPIFY_API_KEY || "").trim();
  const baseUrl = String(
    process.env.GEOAPIFY_BASE_URL || DEFAULT_GEOAPIFY_BASE_URL
  ).replace(/\/+$/, "");

  if (!apiKey) {
    const err = new Error("GEOAPIFY_API_KEY is missing from backend env");
    err.code = "GEOAPIFY_API_KEY_MISSING";
    err.statusCode = 500;
    throw err;
  }

  return { apiKey, baseUrl };
}

function getMaxResults(rawLimit) {
  const fallback = Number(process.env.MEET_MIDDLE_MAX_RESULTS || 20);
  return clampNumber(Number(rawLimit || fallback), 1, 50);
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function pickDisplayCategory(properties = {}) {
  const categories = Array.isArray(properties.categories)
    ? properties.categories
    : [];

  if (categories.includes("catering.cafe")) return "Cafe";
  if (categories.includes("catering.restaurant")) return "Restaurant";
  if (categories.includes("catering.fast_food")) return "Quick Bite";
  if (categories.includes("entertainment.cinema")) return "Cinema";
  if (categories.includes("leisure.park")) return "Park";
  if (categories.includes("commercial.shopping_mall")) return "Mall";
  if (categories.includes("tourism.attraction")) return "Public Place";

  const firstCategory = cleanText(categories[0]);
  if (!firstCategory) return "Place";

  return firstCategory
    .split(".")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getFeatureCoords(feature = {}) {
  const geometryCoords = feature?.geometry?.coordinates;

  if (
    Array.isArray(geometryCoords) &&
    geometryCoords.length >= 2 &&
    Number.isFinite(Number(geometryCoords[0])) &&
    Number.isFinite(Number(geometryCoords[1]))
  ) {
    return {
      lat: Number(geometryCoords[1]),
      lng: Number(geometryCoords[0]),
    };
  }

  const properties = feature?.properties || {};
  const lat = Number(properties.lat);
  const lng = Number(properties.lon ?? properties.lng);

  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return { lat, lng };
  }

  return null;
}

function normalizeGeoapifyPlace(feature = {}, midpoint) {
  const properties = feature?.properties || {};
  const coords = getFeatureCoords(feature);

  if (!coords) return null;

  const name =
    cleanText(properties.name) ||
    cleanText(properties.datasource?.raw?.name) ||
    "Unnamed Place";

  const address =
    cleanText(properties.formatted) ||
    cleanText(properties.address_line2) ||
    cleanText(properties.address_line1) ||
    cleanText(
      [
        properties.street,
        properties.housenumber,
        properties.city,
        properties.state,
        properties.country,
      ]
        .filter(Boolean)
        .join(", ")
    );

  const calculatedDistance = distanceMeters(midpoint, coords);

  return {
    id:
      cleanText(properties.place_id) ||
      cleanText(properties.osm_id) ||
      `${coords.lat},${coords.lng}`,
    name,
    category: pickDisplayCategory(properties),
    address: address || null,
    coords: {
      lat: Number(coords.lat),
      lng: Number(coords.lng),
    },
    rating: null,
    image: null,
    distance: calculatedDistance,
    provider: "geoapify",
  };
}

async function searchPlacesAroundPoint({
  midpoint,
  radiusMeters,
  categories = DEFAULT_MEET_CATEGORIES,
  limit,
  lang = "en",
}) {
  const safeMidpoint = assertValidCoords(midpoint, "midpoint");
  const safeRadius = clampNumber(Number(radiusMeters || 2000), 100, 32000);
  const safeLimit = getMaxResults(limit);

  const { apiKey, baseUrl } = getGeoapifyConfig();

  const categoryList = Array.isArray(categories) && categories.length
    ? categories.map(String).filter(Boolean).join(",")
    : DEFAULT_MEET_CATEGORIES.join(",");

  const response = await axios.get(`${baseUrl}/v2/places`, {
    timeout: 10000,
    params: {
      categories: categoryList,
      filter: `circle:${safeMidpoint.lng},${safeMidpoint.lat},${safeRadius}`,
      bias: `proximity:${safeMidpoint.lng},${safeMidpoint.lat}`,
      limit: safeLimit,
      lang,
      apiKey,
    },
  });

  const features = Array.isArray(response?.data?.features)
    ? response.data.features
    : [];

  const normalized = features
    .map((feature) => normalizeGeoapifyPlace(feature, safeMidpoint))
    .filter(Boolean)
    .sort((a, b) => Number(a.distance || 0) - Number(b.distance || 0));

  return normalized;
}

async function searchMeetPlacesWithRadiusExpansion({
  midpoint,
  limit,
  categories,
  radiusesMeters,
}) {
  const safeMidpoint = assertValidCoords(midpoint, "midpoint");

  const defaultRadius = Number(
    process.env.MEET_MIDDLE_DEFAULT_RADIUS_METERS || 2000
  );

  const maxRadius = Number(process.env.MEET_MIDDLE_MAX_RADIUS_METERS || 32000);

  const radiusSteps =
    Array.isArray(radiusesMeters) && radiusesMeters.length
      ? radiusesMeters
      : [defaultRadius, 8000, 16000, maxRadius];

  const cleanRadiusSteps = [...new Set(
    radiusSteps
      .map((r) => clampNumber(Number(r), 100, maxRadius))
      .filter((r) => Number.isFinite(r) && r > 0)
  )].sort((a, b) => a - b);

  let lastPlaces = [];
  let lastRadiusUsed = cleanRadiusSteps[0] || defaultRadius;

  for (const radius of cleanRadiusSteps) {
    const places = await searchPlacesAroundPoint({
      midpoint: safeMidpoint,
      radiusMeters: radius,
      categories,
      limit,
    });

    lastPlaces = places;
    lastRadiusUsed = radius;

    if (places.length > 0) {
      break;
    }
  }

  return {
    provider: "geoapify",
    midpoint: safeMidpoint,
    radiusUsedMeters: lastRadiusUsed,
    places: lastPlaces,
  };
}

function getGeoapifyHealthStatus() {
  const apiKey = String(process.env.GEOAPIFY_API_KEY || "").trim();
  const baseUrl = String(
    process.env.GEOAPIFY_BASE_URL || DEFAULT_GEOAPIFY_BASE_URL
  ).replace(/\/+$/, "");

  return {
    provider: "geoapify",
    configured: !!apiKey,
    hasApiKey: !!apiKey,
    apiKeyPreview: apiKey
      ? `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`
      : null,
    baseUrl,
    meetMiddle: {
      cacheTtlSeconds: Number(process.env.MEET_MIDDLE_CACHE_TTL_SECONDS || 600),
      defaultRadiusMeters: Number(process.env.MEET_MIDDLE_DEFAULT_RADIUS_METERS || 2000),
      maxRadiusMeters: Number(process.env.MEET_MIDDLE_MAX_RADIUS_METERS || 32000),
      maxResults: Number(process.env.MEET_MIDDLE_MAX_RESULTS || 20),
      requestCooldownSeconds: Number(process.env.MEET_MIDDLE_REQUEST_COOLDOWN_SECONDS || 30),
      sessionTtlMinutes: Number(process.env.MEET_MIDDLE_SESSION_TTL_MINUTES || 45),
    },
  };
}

module.exports = {
  DEFAULT_MEET_CATEGORIES,
  getGeoapifyHealthStatus,
  searchPlacesAroundPoint,
  searchMeetPlacesWithRadiusExpansion,
};