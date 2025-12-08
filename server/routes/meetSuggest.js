/**
 * ============================================================
 * 📁 File: routes/meetSuggest.js
 * 🧭 Purpose: Handle “Meet-in-Middle” location suggestions.
 *
 * This route computes the midpoint between two users and
 * fetches nearby venues (cafés, restaurants, parks, cinemas)
 * using the OpenStreetMap Overpass API.
 *
 * ✅ Endpoint:
 *    POST /api/meet/suggest
 * 
 * ✅ Request body:
 *    {
 *      "a": { "lat": <number>, "lng": <number> },
 *      "b": { "lat": <number>, "lng": <number> }
 *    }
 *
 * ✅ Response:
 *    {
 *      "midpoint": { "lat": <number>, "lng": <number> },
 *      "places": [
 *        {
 *          "id": "node12345",
 *          "name": "Coffee House",
 *          "category": "cafe",
 *          "coords": { "lat": ..., "lng": ... },
 *          "address": "Street, City"
 *        },
 *        ...
 *      ]
 *    }
 *
 * 🧩 Features:
 *   - Calculates midpoint between two users
 *   - Queries Overpass API for nearby public meeting spots
 *   - Provides graceful fallback if API fails
 *   - Returns up to 15 results (filtered + normalized)
 *   - Fully stateless — no DB reads/writes
 *
 * 🧱 Dependencies:
 *   - node-fetch (ESM-safe import)
 *   - express
 *
 * 🧠 Used in:
 *   - Meet-in-Middle feature (Frontend map suggestion modal)
 *
 * ============================================================
 */

const express = require("express");
const router = express.Router();

// ✅ ESM-safe fetch wrapper (works with CommonJS)
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

/* ============================================================
   📍 POST /api/meet/suggest
   ------------------------------------------------------------
   Takes two location objects (a, b) and returns:
   - Midpoint between them
   - Suggested nearby venues within 1.5 km radius
   ------------------------------------------------------------
============================================================ */
router.post("/suggest", async (req, res) => {
  try {
    const { a, b, radiusMiles } = req.body || {};

    // 🔒 Validate inputs
    if (!a || !b) {
      return res.status(400).json({ error: "Both coordinates (a & b) required" });
    }

    // 🎯 True midpoint between the two coordinates
    const midpoint = {
      lat: (Number(a.lat) + Number(b.lat)) / 2,
      lng: (Number(a.lng) + Number(b.lng)) / 2,
    };

       // 👉 Smart midpoint (conceptually 1 mile in from each side around here)
    const smartMidpoint = { ...midpoint };

    // 📏 Radius in miles (default 5; can be overridden by caller)
    const miles = Number(radiusMiles) || 5;
    const radiusMeters = miles * 1609.34;

    // Overpass API query for social / dating-friendly venues
    // 🔥 Includes node + way + relation and many amenity types
    const overpassQuery = `
      [out:json][timeout:25];
      (
        // Cafés & restaurants
        node["amenity"="cafe"](around:${radiusMeters},${smartMidpoint.lat},${smartMidpoint.lng});
        way["amenity"="cafe"](around:${radiusMeters},${smartMidpoint.lat},${smartMidpoint.lng});
        relation["amenity"="cafe"](around:${radiusMeters},${smartMidpoint.lat},${smartMidpoint.lng});

        node["amenity"="restaurant"](around:${radiusMeters},${smartMidpoint.lat},${smartMidpoint.lng});
        way["amenity"="restaurant"](around:${radiusMeters},${smartMidpoint.lat},${smartMidpoint.lng});
        relation["amenity"="restaurant"](around:${radiusMeters},${smartMidpoint.lat},${smartMidpoint.lng});

        node["amenity"="fast_food"](around:${radiusMeters},${smartMidpoint.lat},${smartMidpoint.lng});
        way["amenity"="fast_food"](around:${radiusMeters},${smartMidpoint.lat},${smartMidpoint.lng});
        relation["amenity"="fast_food"](around:${radiusMeters},${smartMidpoint.lat},${smartMidpoint.lng});

        // Drinks / bars
        node["amenity"="bar"](around:${radiusMeters},${smartMidpoint.lat},${smartMidpoint.lng});
        way["amenity"="bar"](around:${radiusMeters},${smartMidpoint.lat},${smartMidpoint.lng});
        relation["amenity"="bar"](around:${radiusMeters},${smartMidpoint.lat},${smartMidpoint.lng});

        node["amenity"="pub"](around:${radiusMeters},${smartMidpoint.lat},${smartMidpoint.lng});
        way["amenity"="pub"](around:${radiusMeters},${smartMidpoint.lat},${smartMidpoint.lng});
        relation["amenity"="pub"](around:${radiusMeters},${smartMidpoint.lat},${smartMidpoint.lng});

        node["amenity"="ice_cream"](around:${radiusMeters},${smartMidpoint.lat},${smartMidpoint.lng});
        way["amenity"="ice_cream"](around:${radiusMeters},${smartMidpoint.lat},${smartMidpoint.lng});
        relation["amenity"="ice_cream"](around:${radiusMeters},${smartMidpoint.lat},${smartMidpoint.lng});

        node["amenity"="tea"](around:${radiusMeters},${smartMidpoint.lat},${smartMidpoint.lng});
        way["amenity"="tea"](around:${radiusMeters},${smartMidpoint.lat},${smartMidpoint.lng});
        relation["amenity"="tea"](around:${radiusMeters},${smartMidpoint.lat},${smartMidpoint.lng});

        node["amenity"="food_court"](around:${radiusMeters},${smartMidpoint.lat},${smartMidpoint.lng});
        way["amenity"="food_court"](around:${radiusMeters},${smartMidpoint.lat},${smartMidpoint.lng});
        relation["amenity"="food_court"](around:${radiusMeters},${smartMidpoint.lat},${smartMidpoint.lng});

        node["amenity"="bakery"](around:${radiusMeters},${smartMidpoint.lat},${smartMidpoint.lng});
        way["amenity"="bakery"](around:${radiusMeters},${smartMidpoint.lat},${smartMidpoint.lng});
        relation["amenity"="bakery"](around:${radiusMeters},${smartMidpoint.lat},${smartMidpoint.lng});

        // Parks (Lake Park etc.)
        node["leisure"="park"](around:${radiusMeters},${smartMidpoint.lat},${smartMidpoint.lng});
        way["leisure"="park"](around:${radiusMeters},${smartMidpoint.lat},${smartMidpoint.lng});
        relation["leisure"="park"](around:${radiusMeters},${smartMidpoint.lat},${smartMidpoint.lng});

        // Malls & cinemas
        node["shop"="mall"](around:${radiusMeters},${smartMidpoint.lat},${smartMidpoint.lng});
        way["shop"="mall"](around:${radiusMeters},${smartMidpoint.lat},${smartMidpoint.lng});
        relation["shop"="mall"](around:${radiusMeters},${smartMidpoint.lat},${smartMidpoint.lng});

        node["amenity"="cinema"](around:${radiusMeters},${smartMidpoint.lat},${smartMidpoint.lng});
        way["amenity"="cinema"](around:${radiusMeters},${smartMidpoint.lat},${smartMidpoint.lng});
        relation["amenity"="cinema"](around:${radiusMeters},${smartMidpoint.lat},${smartMidpoint.lng});
      );
      out center;
    `;

    const overpassURL = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(
      overpassQuery
    )}`;

    let places = [];

    try {
      const response = await fetch(overpassURL, { timeout: 15000 });
      const data = await response.json();

      if (Array.isArray(data.elements)) {
        places = data.elements.slice(0, 15).map((p) => ({
          id: p.id,
          name:
            p.tags?.name ||
            p.tags?.brand ||
            `${p.tags?.amenity || p.tags?.leisure || "Place"} #${p.id}`,
          category: p.tags?.amenity || p.tags?.leisure || "venue",
          coords: { lat: p.lat, lng: p.lon },
          address:
            p.tags?.addr_full ||
            [p.tags?.addr_street, p.tags?.addr_city].filter(Boolean).join(", ") ||
            "Unknown",
        }));
      }
    } catch (err) {
      console.warn("⚠️ Overpass /api/meet/suggest failed:", err.message);
    }

    // ❗No fake fallback place here either.
    // If there are still no places, we return an empty list and let the
    // frontend decide whether to keep expanding even further or just
    // show the exact midpoint.
    const canExpand = places.length === 0 && miles < 20;

    return res.json({
      midpoint,
      smartMidpoint,
      places,
      radiusMiles: miles,
      canExpand,
    });
  } catch (err) {
    console.error("❌ /api/meet/suggest error:", err);
    res.status(500).json({ error: "Failed to fetch meet suggestions" });
  }
});


module.exports = router;
