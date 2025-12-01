// src/components/MeetMap.jsx
import React, { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap } from "react-leaflet";
import { FaHeart, FaTimes, FaMapMarkerAlt } from "react-icons/fa";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { getSocket } from "../socket";
import { API_BASE } from "../config";

// Fix Leaflet icon paths
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
  iconUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
  shadowUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
});


//distance helper function
function distanceMiles(lat1, lon1, lat2, lon2) {
  if (
    typeof lat1 !== "number" ||
    typeof lon1 !== "number" ||
    typeof lat2 !== "number" ||
    typeof lon2 !== "number"
  )
    return null;

  const R = 3958.8; // radius of Earth in miles
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

 // ======================================================
// ⭐ CUSTOM ROMBUZZ MIDPOINT ICONS (animated emoji badges)
// ======================================================

const emojiMarker = (emoji, bgColor) =>
  L.divIcon({
    html: `
      <div style="
        background:${bgColor};
        width:40px;
        height:40px;
        border-radius:50%;
        display:flex;
        justify-content:center;
        align-items:center;
        color:white;
        font-size:22px;
        box-shadow:0 2px 6px rgba(0,0,0,0.25);
        animation: rbzBounce 0.3s ease-out;
      ">
        ${emoji}
      </div>
    `,
    className: "",
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });

// 🧭 Exact midpoint
const exactMidIcon = emojiMarker("🧭", "#3B82F6");

// ⭐ Smart midpoint (RomBuzz pink)
const smartMidIcon = emojiMarker("⭐", "#ff2d55");

// Add bounce animation
const styleEl = document.createElement("style");
styleEl.innerHTML = `
@keyframes rbzBounce {
  0% { transform: scale(0.3) translateY(-10px); opacity: 0; }
  70% { transform: scale(1.1) translateY(0); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
}`;
document.head.appendChild(styleEl);

//const API_BASE = "http://localhost:4000";
//const API_BASE = process.env.REACT_APP_API_BASE || "https://rombuzz-api.onrender.com/api";

function FlyTo({ center }) {
  const map = useMap();
  useEffect(() => {
    if (center) map.flyTo(center, 13);
  }, [center]);
  return null;
}

export default function MeetMap({ me, peer, onClose, autoStart = false }) {
  const socket = getSocket();
  const [prompt, setPrompt] = useState(null);
  const [myLoc, setMyLoc] = useState(null);
  const [peerLoc, setPeerLoc] = useState(null);

  const [midpoint, setMidpoint] = useState(null);
  const [smartMidpoint, setSmartMidpoint] = useState(null);
  const [places, setPlaces] = useState([]);
  const [selected, setSelected] = useState(null);

  // 🆕 pending place prompt (when peer picks one)
  const [pendingPlace, setPendingPlace] = useState(null);
  const [pendingFrom, setPendingFrom] = useState(null);

  const [loading, setLoading] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [showMap, setShowMap] = useState(false);

  // 🆕 No-places & radius control
  const [canExpand, setCanExpand] = useState(false);
    const [radiusMiles, setRadiusMiles] = useState(2);
  const [showNoPlacesCard, setShowNoPlacesCard] = useState(false);

  // 📍 Bottom sheet open/closed
  const [sheetOpen, setSheetOpen] = useState(false);

  // 🧭 Focus point for centering (used when user picks a place)
  const [focusCenter, setFocusCenter] = useState(null);

    // 🔁 When BOTH myLoc and peerLoc exist → compute midpoint, fetch places, show map
  useEffect(() => {
    if (
      myLoc &&
      peerLoc &&
      typeof myLoc.lat === "number" &&
      typeof myLoc.lng === "number" &&
      typeof peerLoc.lat === "number" &&
      typeof peerLoc.lng === "number"
    ) {
      const mid = {
        lat: (myLoc.lat + peerLoc.lat) / 2,
        lng: (myLoc.lng + peerLoc.lng) / 2,
      };

      console.log("📍 FINAL midpoint (from both coords):", mid);
      setMidpoint(mid);

      // Use your existing suggestion endpoint
      fetchSuggestions(myLoc, peerLoc);

      // Make sure both sides actually see the map and stop "waiting"
      setShowMap(true);
      setWaiting(false);
      setShowNoPlacesCard(false);
    }
  }, [myLoc, peerLoc, fetchSuggestions]);



  const myId = me?.id || me?._id;
  const peerId = peer?.id || peer?._id;

  // 🔹 Fetch midpoint suggestions
  const fetchSuggestions = useCallback(async (a, b) => {
    try {
      const r = await fetch(`${API_BASE}/api/meet/suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ a, b }),
      });
      const j = await r.json();
      setPlaces(Array.isArray(j.places) ? j.places : []);
    } catch (e) {
      console.error("❌ meet-suggest error", e);
      setPlaces([]);
    }
  }, []);

  // 🔹 Socket listeners
  useEffect(() => {
    if (!socket) return;

    socket.on("meet:request", ({ from }) => {
      console.log("📍 meet:request received from", from);
      if (from.id !== myId)
        setPrompt(`${from.firstName || "Someone"} ${from.lastName || ""}`.trim());
    });

 socket.on("meet:accept", ({ from, coords }) => {
  console.log("✅ meet:accept received from", from, coords);

  if (!coords || typeof coords.lat !== "number" || typeof coords.lng !== "number") {
    console.warn("⚠️ Invalid peer coordinates received:", coords);
    return;
  }

  // STEP 1 — update peer location
  setPeerLoc(coords);
  setWaiting(false);

  // STEP 2 — ensure I have MY location
  if (!myLoc) {
    getMyLocation(() => {});
    return;
  }

  // STEP 3 — if BOTH locations exist → compute midpoint
  if (myLoc && coords) {
    const mid = {
      lat: (myLoc.lat + coords.lat) / 2,
      lng: (myLoc.lng + coords.lng) / 2,
    };

    console.log("📍 midpoint via accept()", mid);
    setMidpoint(mid);

    // fetch place suggestions
    fetchSuggestions(myLoc, coords);

    // show map
    setShowMap(true);
    setWaiting(false);
  }
});



// 🆕 When partner chooses a place
// partner accepted my chosen place
socket.on("meet:place:accepted", ({ from, place }) => {
  console.log("❤️ meet:place ACCEPTED", place);
  // close popup
  setPendingPlace(null);

  // keep map open
  setShowMap(true);
});

// partner rejected my chosen place
socket.on("meet:place:rejected", ({ from, place }) => {
  console.log("❌ meet:place REJECTED", place);
  // close popup
  setPendingPlace(null);

  // keep map open so they can pick again
  setShowMap(true);
});

// 🧭 Both users shared location → backend sends midpoint + places
socket.on("meet:suggest", ({ midpoint, smartMidpoint, places, canExpand }) => {
  console.log("💞 meet:suggest received");

  setMidpoint(midpoint || null);
  setSmartMidpoint(smartMidpoint || midpoint || null);

  const safePlaces = Array.isArray(places) ? places : [];
  setPlaces(safePlaces);

  setWaiting(false);
  setShowMap(true);
  setLoading(false);

  setCanExpand(!!canExpand);
  setRadiusMiles(2);

  // reset focus so map centers properly
  setFocusCenter(null);

  // no places? show no-places card
  if (!safePlaces.length && canExpand) {
    setShowNoPlacesCard(true);
    setSheetOpen(false);
  } else {
    setShowNoPlacesCard(false);
    setSheetOpen(safePlaces.length > 0);
  }
});

   return () => {
  socket.off("meet:request");
  socket.off("meet:accept");
  socket.off("meet:decline");
  socket.off("meet:place:selected");
  socket.off("meet:suggest");

  socket.off("meet:place:accepted");   // add
  socket.off("meet:place:rejected");   // add
};

  }, [socket, myLoc, fetchSuggestions]);

  const resetAll = () => {
    setPrompt(null);
    setLoading(false);
    setWaiting(false);
    setShowMap(false);
    setPlaces([]);
    setMidpoint(null);
    setSelected(null);
  };

  // 🔹 Get my location
  const getMyLocation = (cb) => {
  setLoading(true);
  if (!navigator.geolocation) {
    alert("Geolocation not supported");
    setLoading(false);
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
let loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };

// ⚠️ TEMP: simulate distance between two users for local testing
if (window.navigator.userAgent.includes("Edg")) {
  // If running in Microsoft Edge, offset 0.02° (~2 km)
  loc = { lat: loc.lat + 0.02, lng: loc.lng + 0.02 };
}

      // 🪶 Debug + Safety log
      console.log("📍 Got my location", loc);

      if (!loc.lat || !loc.lng || isNaN(loc.lat) || isNaN(loc.lng)) {
        console.warn("⚠️ Invalid coordinates detected:", loc);
        setLoading(false);
        return;
      }

      setMyLoc(loc);
      setLoading(false);

      // ✅ Ensure callback is executed only when valid coords exist
      if (typeof cb === "function") cb(loc);
    },
    (err) => {
      console.error("❌ Geolocation error:", err);
      alert("Please allow location access to continue.");
      setLoading(false);
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
};

    // 🔹 Initiate meet request
  const startMeet = () => {
    getMyLocation((loc) => {
      // We already have myLoc at this point
      setShowMap(true);        // show map immediately on initiator side
      setWaiting(true);        // still waiting for partner to share

      socket.emit("meet:request", {
        from: myId,
        to: peerId,
      });
    });
  };

// Auto-start when used as overlay
useEffect(() => {
  if (autoStart) {
    const t = setTimeout(() => {
      startMeet();
    }, 50);
    return () => clearTimeout(t);
  }
}, [autoStart]);

  // 🔹 Accept prompt (receiver shares location)
   const acceptMeet = () => {
    getMyLocation((loc) => {
      socket.emit("meet:accept", { from: myId, to: peerId, coords: loc });

      setPrompt(null);
      setShowMap(true);   // open map for receiver too
      setWaiting(true);   // short "waiting" until other coord arrives / effect runs
    });
  };


  // 🔹 Decline meet
  const declineMeet = () => {
    socket.emit("meet:decline", { from: myId, to: peerId });
    resetAll();
  };

   // 🔹 Choose a place
  const choosePlace = (p) => {
    socket.emit("meet:chosen", { from: myId, to: peerId, place: p });
    alert(`📍 You picked ${p.name}`);
    setSelected(p);

    const lat = p.coords?.lat ?? p.lat;
    const lng = p.coords?.lng ?? p.lng;
    if (typeof lat === "number" && typeof lng === "number") {
      setFocusCenter({ lat, lng });
    }
  };


  // User chooses to just see the exact midpoint, no more prompts
  const handleShowMiddleOnly = () => {
    setShowNoPlacesCard(false);
  };

  // User wants to expand search radius: 2 → 5 → 10 → 20 miles
  const handleExpandRadius = async () => {
    if (!myLoc || !peerLoc) {
      console.warn("Cannot expand radius without both locations");
      return;
    }

    let nextMiles = radiusMiles;
    if (radiusMiles < 5) nextMiles = 5;
    else if (radiusMiles < 10) nextMiles = 10;
    else if (radiusMiles < 20) nextMiles = 20;
    else {
      // already at max radius, nothing more to do
      setShowNoPlacesCard(false);
      return;
    }

    try {
      setLoading(true);
      const r = await fetch(`${API_BASE}/api/meet/suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          a: myLoc,
          b: peerLoc,
          radiusMiles: nextMiles,
        }),
      });
      const j = await r.json();
           const nextPlaces = Array.isArray(j.places) ? j.places : [];
      setPlaces(nextPlaces);
      setRadiusMiles(nextMiles);
      setCanExpand(!!j.canExpand);

      if (!nextPlaces.length && j.canExpand) {
        setShowNoPlacesCard(true);
        setSheetOpen(false);
      } else {
        setShowNoPlacesCard(false);
        setSheetOpen(nextPlaces.length > 0);
      }

      // We keep focusing on smart midpoint; user can choose place after
      setFocusCenter(null);

    } catch (err) {
      console.error("❌ expand radius failed", err);
    } finally {
      setLoading(false);
    }
  };

  const center = focusCenter || smartMidpoint || midpoint || myLoc || { lat: 0, lng: 0 };


  // 🗺️ Map display
  const MapView = () => (
    <div className="flex-1 relative h-[80vh]">
    {myLoc ? (
  <>
    {/* 🆕 Banner when partner picks a place */}
  {pendingPlace && (
  <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[9999] w-[90%] max-w-md">
    <div className="bg-white rounded-2xl shadow-2xl px-4 py-3 text-gray-800 border border-gray-200">
      <div className="font-semibold text-center text-sm mb-2">
        {pendingFrom?.firstName || "Partner"} suggested:
        <br />
        <span className="text-rose-500 font-bold text-base">
          {pendingPlace.name}
        </span>
      </div>

      <div className="flex items-center justify-center gap-4 mt-2">
        {/* Accept */}
        <button
          className="px-4 py-1.5 rounded-full bg-green-500 text-white text-sm font-medium shadow hover:bg-green-600"
          onClick={() => {
            socket.emit("meet:place:accepted", {
              from: myId,
              to: peerId,
              place: pendingPlace,
            });

            // Notify chat window
            socket.emit("meet:final-confirm", {
              from: myId,
              to: peerId,
              place: pendingPlace,
            });

            setPendingPlace(null);
          }}
        >
          Accept
        </button>

        {/* Reject */}
        <button
          className="px-4 py-1.5 rounded-full bg-red-500 text-white text-sm font-medium shadow hover:bg-red-600"
          onClick={() => {
            socket.emit("meet:place:rejected", {
              from: myId,
              to: peerId,
              place: pendingPlace,
            });
            setPendingPlace(null);
          }}
        >
          Reject
        </button>
      </div>
    </div>
  </div>
)}


    <MapContainer
      center={center || [12.9, 77.6]}
      zoom={13}
      style={{ height: "80vh", width: "100%" }}
    >
          <FlyTo center={center} />
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {/* ✅ Safely render markers only if coordinates exist */}
            {myLoc && typeof myLoc.lat === "number" && typeof myLoc.lng === "number" && (
              <Marker position={[myLoc.lat, myLoc.lng]}>
                <Popup>You</Popup>
              </Marker>
            )}

            {peerLoc && typeof peerLoc.lat === "number" && typeof peerLoc.lng === "number" && (
              <Marker position={[peerLoc.lat, peerLoc.lng]}>
                <Popup>{peer.firstName || "Partner"}</Popup>
              </Marker>
            )}

            {/* ⭐ Smart Midpoint (Best meetup zone) */}
            {smartMidpoint && typeof smartMidpoint.lat === "number" && typeof smartMidpoint.lng === "number" && (
              <Marker
                position={[smartMidpoint.lat, smartMidpoint.lng]}
                icon={smartMidIcon}
              >
                <Popup>
                  ⭐ <b>Best meetup zone</b>
                </Popup>
              </Marker>
            )}

            {/* 🧭 Exact Midpoint */}
            {midpoint && typeof midpoint.lat === "number" && typeof midpoint.lng === "number" && (
              <Marker
                position={[midpoint.lat, midpoint.lng]}
                icon={exactMidIcon}
              >
                <Popup>
                  🧭 <b>Exact midpoint</b>
                </Popup>
              </Marker>
            )}

            {/* 🎯 Soft pink radius circle around smart midpoint */}
            {smartMidpoint && radiusMiles && (
              <Circle
                center={[smartMidpoint.lat, smartMidpoint.lng]}
                radius={radiusMiles * 1609.34}
                pathOptions={{
                  color: "#ff2d55",
                  fillColor: "#ff2d55",
                  fillOpacity: 0.18,
                  weight: 1.5,
                }}
              />
            )}


            {Array.isArray(places) &&
              places.map((p, i) => (
                <Marker
                  key={p.id || i}
                  position={[
                    p.coords?.lat || p.lat,
                    p.coords?.lng || p.lng,
                  ]}
                  eventHandlers={{
                    click: () => {
                      setSelected(p);
                      console.log("📍 You selected place:", p.name);
                      socket.emit("meet:chosen", {
                        from: myId,
                        to: peerId,
                        place: p,
                      });
                    },
                  }}
                >
                  <Popup>
                    <b>{p.name}</b>
                    <br />
                    {p.category}
                    <br />
                    {p.address}
                    <br />
                    <button
                      className="mt-1 bg-rose-500 text-white px-3 py-1 rounded-lg"
                      onClick={() => choosePlace(p)}
                    >
                    📍 Meet here
                    </button>
                  </Popup>
                </Marker>
              ))}
                  </MapContainer>

{/* 📍 Bottom sheet with suggested places */}
    {Array.isArray(places) && places.length > 0 && (
      <motion.div
        initial={false}
        animate={{ y: sheetOpen ? 0 : 220 }}
        transition={{ type: "spring", stiffness: 260, damping: 32 }}
className="absolute left-0 right-0 bottom-0 z-[60]"
      >
        <div className="mx-3 mb-3 rounded-3xl bg-white/95 shadow-2xl border border-gray-100 overflow-hidden">
          {/* Drag handle + title bar */}
          <button
            type="button"
            onClick={() => setSheetOpen((v) => !v)}
            className="w-full px-4 pt-3 pb-2 flex flex-col items-center justify-center gap-1"
          >
            <div className="w-10 h-1.5 rounded-full bg-gray-300" />
            <div className="text-xs font-medium text-gray-600">
              {places.length} meetup spot{places.length > 1 ? "s" : ""} near the halfway point
            </div>
          </button>

          {/* List of places */}
          <div className="max-h-64 overflow-y-auto px-3 pb-3 space-y-3">
            {places.map((p, idx) => {
              const lat = p.coords?.lat ?? p.lat;
              const lng = p.coords?.lng ?? p.lng;
              const baseRef = smartMidpoint || midpoint || myLoc;
              const dist =
                baseRef && typeof lat === "number" && typeof lng === "number"
                  ? distanceMiles(baseRef.lat, baseRef.lng, lat, lng)
                  : null;
              const prettyDist =
                typeof dist === "number" ? `${dist.toFixed(1)} miles away` : "";

              const category =
                p.category ||
                p.tags?.amenity ||
                p.tags?.leisure ||
                "Place";

              return (
                <div
                  key={p.id || idx}
                  className="flex gap-3 p-2 rounded-2xl border border-gray-100 bg-white hover:bg-rose-50/40 transition-colors"
                >
                  {/* Left: avatar / placeholder */}
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-rose-400 to-amber-400 flex items-center justify-center text-white text-lg font-semibold shrink-0">
                    {(p.name && p.name[0]) || "🏠"}
                  </div>

                  {/* Middle: text info */}
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm text-gray-900 truncate">
                      {p.name || "Unknown place"}
                    </div>
                    <div className="text-xs text-gray-600 truncate">
                      {category}
                      {prettyDist && ` · ${prettyDist}`}
                    </div>
                    {p.address && (
                      <div className="text-[11px] text-gray-500 truncate mt-0.5">
                        {p.address}
                      </div>
                    )}
                  </div>

                  {/* Right: Meet button */}
                  <div className="flex items-center">
                    <button
                      type="button"
                      onClick={() => choosePlace(p)}
                      className="px-3 py-1.5 rounded-full bg-rose-500 text-white text-xs font-semibold hover:bg-rose-600"
                    >
                      📍 Meet here
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </motion.div>
    )}

          {/* 😕 No places found near midpoint → ask what to do */}
          {showNoPlacesCard && (
            <div className="absolute inset-0 z-40 flex items-center justify-center">
              <div className="bg-white rounded-2xl shadow-2xl p-5 w-[90%] max-w-sm text-center space-y-4">
                <div className="text-lg font-semibold">
                  No meetup spots found nearby
                </div>
                <p className="text-sm text-gray-600">
                  We couldn&apos;t find cafés, restaurants or parks close to your halfway
                  point. What would you like to do?
                </p>
                <div className="flex flex-col gap-3">
                  <button
                    type="button"
                    onClick={handleShowMiddleOnly}
                    className="w-full px-4 py-2 rounded-full border border-gray-200 text-gray-800 text-sm font-medium hover:bg-gray-50"
                  >
                    Show exact middle point
                  </button>
                  {canExpand && (
                    <button
                      type="button"
                      onClick={handleExpandRadius}
                      className="w-full px-4 py-2 rounded-full bg-rose-500 text-white text-sm font-semibold hover:bg-rose-600 disabled:opacity-70"
                      disabled={loading}
                    >
                      {loading
                        ? "Expanding search…"
                        : `Expand radius (${
                            radiusMiles < 5 ? "5" : radiusMiles < 10 ? "10" : "20"
                          } miles)`}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      ) : (

        <div className="grid place-items-center text-gray-500 h-full">
          Getting your location…
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* 🔘 Meet button (initiator) – only when used inline */}
    {!autoStart && !showMap && !prompt && (
      <button
        onClick={startMeet}
        className="inline-flex items-center gap-2 px-3 py-2 rounded-full text-xs font-medium bg-rose-50 text-rose-600 hover:bg-rose-100 border border-rose-100"
      >
        <span className="text-lg">📍</span>
        <span>Meet halfway</span>
      </button>
    )}


      {/* 💞 Prompt popup */}
      <AnimatePresence>
        {prompt && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          >
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: "spring", stiffness: 200, damping: 20 }}
              className="bg-gradient-to-br from-rose-500 via-pink-500 to-amber-400 rounded-3xl shadow-2xl w-full max-w-sm text-white overflow-hidden border border-white/20"
            >
              <div className="flex items-center justify-between p-4 bg-white/10 border-b border-white/20">
                <h2 className="font-semibold text-lg flex items-center gap-2">
                  <FaMapMarkerAlt className="text-yellow-200" />
                  Meet Request
                </h2>
                <button onClick={declineMeet} className="hover:bg-white/20 p-2 rounded-full">
                  <FaTimes />
                </button>
              </div>
              <div className="p-6 text-center space-y-4">
                <div className="text-2xl font-bold">💞 {prompt} wants to meet halfway!</div>
                <p className="text-white/90 text-sm">
                  Share your location to find a fair midpoint with suggested cafés or parks.
                </p>
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: 0.2, type: "spring", stiffness: 150 }}
                  className="flex justify-center mt-4"
                >
                  <FaHeart className="text-red-200 text-4xl animate-pulse drop-shadow-lg" />
                </motion.div>
                <div className="flex justify-center gap-3 mt-5">
                  <button
                    onClick={acceptMeet}
                    className="px-5 py-2 rounded-full bg-white text-rose-600 font-semibold hover:bg-rose-100 transition-all"
                  >
                    Share & Meet 💫
                  </button>
                  <button
                    onClick={declineMeet}
                    className="px-5 py-2 rounded-full bg-white/20 hover:bg-white/30 text-white font-medium transition-all"
                  >
                    Not Now
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 🗺️ Map after accepted */}
      {showMap && (
        <div className="fixed inset-0 bg-white z-40 flex flex-col">
          <div className="flex justify-between items-center p-3 border-b">
            <h2 className="font-semibold text-lg flex items-center gap-2">
              <FaMapMarkerAlt className="text-rose-500" /> Meet halfway
            </h2>
            <button
              onClick={() => {
                resetAll();
                onClose && onClose();
              }}
              className="p-2 hover:bg-gray-100 rounded-full"
            >
              <FaTimes />
            </button>
          </div>
          <MapView />
        </div>
      )}

      {/* ⏳ Waiting indicator */}
      {waiting && (
        <div className="fixed bottom-5 left-0 right-0 text-center z-50">
          <div className="inline-block bg-yellow-100 text-yellow-800 px-4 py-2 rounded-full shadow text-sm">
            Waiting for {peer?.firstName || "partner"} to share location…
          </div>
        </div>
      )}
    </>
  );
}
