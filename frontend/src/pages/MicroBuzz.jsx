import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

//const socket = io("http://localhost:4000");
//const API_BASE = "http://localhost:4000/api";
//const API_BASE = process.env.REACT_APP_API_BASE || "https://rombuzz-api.onrender.com/api";
import { API_BASE } from "../config";
import Radar from "../components/Radar";
import { ensureSocketAuth } from "../socket";

// Use the shared authenticated socket used across the app
const socket = ensureSocketAuth();

export default function MicroBuzz({ user }) {
  const navigate = useNavigate();

  // -------- Helpers
  const token = () =>
    localStorage.getItem("token") || sessionStorage.getItem("token");

  // ✅ Buzz someone (like/match)
  const handleBuzz = async (targetId) => {
  console.log("⚡ handleBuzz triggered →", targetId);
  try {
    const res = await fetch(`${API_BASE}/microbuzz/buzz`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token()}`,
      },
      body: JSON.stringify({ toId: targetId }),
    });


      const data = await res.json();

     if (data.matched) {
  window.dispatchEvent(new CustomEvent("match:celebrate", {
    detail: { otherUserId: targetId }
  }));
}
 else if (data.alreadyLiked) {
        alert("You already buzzed this person before ⚡");
      } else {
        alert("You buzzed them! Waiting for them to buzz back 👋");
      }
    } catch (err) {
      console.error("❌ Buzz failed:", err);
      alert("Something went wrong while buzzing.");
    }
  };

  // ---------- UI States ----------
  const [isActive, setIsActive] = useState(false);
  const [status, setStatus] = useState(
    "Super-fast way to find a date. Click on Activate Microbuzz, take a quick selfie, and we'll show nearby people who did the same. If you both tap Connect, it's an instant match."
  );
  const [error, setError] = useState("");
  const [debug, setDebug] = useState("");
  const [buzzRequest, setBuzzRequest] = useState(null);
// ---------- Tips Carousel ----------
const tips = [
  "Long press any avatar to peek their selfie",
  "People around you will appear here",
  "Stay a little, someone may pop up",
  "Blinking tiny dots = filtered out users",
  "You're only shown to people you match with",
  "MicroBuzz shows people of your preferences",
  "You can extend your search by changing your preferences",
  "If you both Buzz each other → instant match. No swiping, no waiting ⚡"
];

const [tipIndex, setTipIndex] = useState(0);

useEffect(() => {
  const interval = setInterval(() => {
    setTipIndex((prev) => (prev + 1) % tips.length);
  }, 3500);
  return () => clearInterval(interval);
}, []);

  // ---------- Media & Geolocation ----------
  const videoRef = useRef(null);
  const streamRef = useRef(null);
   const [selfieUrl, setSelfieUrl] = useState("");
  const [coords, setCoords] = useState(null);

  // 🔍 Enlarged-preview target for long-press / right-click
  const [previewUser, setPreviewUser] = useState(null);

  // ---------- Nearby Scanning ----------
  const [nearby, setNearby] = useState([]);
  const scanTimerRef = useRef(null);
  const isScanningRef = useRef(false);
  const backoffRef = useRef(2000);

  // ---------- Animation ----------
  const rafRef = useRef(null);
  const [now, setNow] = useState(0);
  const orbitsRef = useRef({});
  const abortRef = useRef(null);

  // =====================================================
  // 🔌 SOCKET.IO SETUP
  // =====================================================

  useEffect(() => {
    const currentUser = JSON.parse(localStorage.getItem("user") || "{}");
    if (!currentUser?.id) {
      console.warn("⚠️ No user.id found for socket register");
      return;
    }

    // Wait until connected before registering
   if (socket.connected) {
  socket.emit("user:register", currentUser.id);
  console.log("🟣 Socket already connected → user:register", currentUser.id);
} else {
  socket.on("connect", () => {
    socket.emit("user:register", currentUser.id);
    console.log("🟣 Socket connected & user:register:", currentUser.id);
  });
}
    return () => {
      socket.off("connect");
    };
  }, []);
// Allow scrolling on MicroBuzz
useEffect(() => {
  document.body.style.overflow = "";
  return () => {
    document.body.style.overflow = "";
  };
}, []);



  // Listen for buzz requests, matches, and rejections
  useEffect(() => {
  // 💌 When someone buzzes YOU
socket.on("buzz_request", (data) => {
  console.log("📨 Received buzz_request:", data);

  // Force a visible test popup even if selfieUrl is missing
  if (!data || !data.fromId) {
    console.warn("⚠️ Invalid buzz_request payload:", data);
    return;
  }

  // Fallbacks so the popup always renders
  if (!data.selfieUrl) data.selfieUrl = "https://via.placeholder.com/100";
  // Normalize name (priority: firstName → name → fallback)
  const safeName =
    data.firstName ||
    data.name ||
    (data.fromUser && (data.fromUser.firstName || data.fromUser.name)) ||
    "Someone nearby";

  data.name = safeName;
  // Confirm in console that it's being rendered
  console.log("✅ Showing buzz popup for:", data.name, data.selfieUrl);

  setBuzzRequest(data);
});


   socket.on("match", (data) => {
  console.log("🎉 Match event:", data);

  const { otherUserId, otherName, roomId } = data;

  // 1️⃣ Trigger celebration overlay (unchanged)
  window.dispatchEvent(new CustomEvent("match:celebrate", { detail: data }));

  // 2️⃣ Immediately show small in-app toast with actions
  setTimeout(() => {
    showMatchActions({
      otherId: otherUserId,
      otherName: otherName || "Someone",
      roomId
    });
  }, 1200); // Delay so it shows right after celebration

  // 3️⃣ Close buzz popup
  setBuzzRequest(null);
});



    // 🚫 When your buzz is rejected
    socket.on("buzz_rejected", (data) => {
      console.log("❌ Buzz rejected:", data);
      alert("❌ Your buzz was rejected.");
    });
  // 💚 When the other user accepts your buzz (pre-match state)
socket.on("buzz_accept", (data) => {
  console.log("💚 Received buzz_accept:", data);
});

    return () => {
  socket.off("buzz_request");
  socket.off("match");
  socket.off("buzz_rejected");
    socket.off("buzz_accept");   
  };
}, [navigate]);

  // =====================================================
  // 🔧 CAMERA + SCANNING (unchanged from your last version)
  // =====================================================

  function cleanupCamera() {
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    const video = videoRef.current;
    if (video) {
      video.srcObject = null;
      try {
        video.pause();
      } catch {}
    }
  }

  async function getLocation() {
    return new Promise((resolve, reject) => {
      if (!("geolocation" in navigator)) {
        reject(new Error("Geolocation not supported"));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          resolve({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          });
        },
        (err) => reject(err),
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });
  }

  // -------- Camera
  async function startMicroBuzz() {
    try {
      setError("");
      setDebug("");
      setStatus("Requesting camera…");

      // Hint to OS/browser: allow any front camera if available
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "user" },
          width: { ideal: 720 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      // Attach locally
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute("playsInline", "true");
        videoRef.current.muted = true;
        await videoRef.current.play();
      }

      setStatus("Take a quick selfie to appear on the radar…");
    } catch (err) {
      console.error(err);
      setError(
        "Camera permission denied or not available. You can try another browser/device."
      );
      setStatus("Please allow camera access and try again.");
    }
  }

  async function takeSelfieAndActivate() {
    try {
      setError("");
      setStatus("Capturing selfie…");

      // 1) Grab a frame
      const video = videoRef.current;
      if (!video || !video.videoWidth) {
        throw new Error("Selfie failed. Video not ready.");
      }
      const side = Math.min(video.videoWidth, video.videoHeight);
      const cv = document.createElement("canvas");
      cv.width = 320;
      cv.height = 320;
      const ctx = cv.getContext("2d");
      const sx = (video.videoWidth - side) / 2;
      const sy = (video.videoHeight - side) / 2;
      ctx.drawImage(video, sx, sy, side, side, 0, 0, cv.width, cv.height);

      const blob = await new Promise((res) => cv.toBlob(res, "image/jpeg", 0.85));
      if (!blob) throw new Error("Selfie failed. Try again.");

      // 2) Upload selfie
      setStatus("Uploading selfie…");
      const fd = new FormData();
      fd.append("selfie", blob, "selfie.jpg");

      abortRef.current?.abort();
      abortRef.current = new AbortController();

      const upRes = await fetch(`${API_BASE}/microbuzz/selfie`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token()}` },
        body: fd,
        signal: abortRef.current.signal,
      });
      const upData = await safeJson(upRes);
      if (!upRes.ok)
        throw new Error(upData?.error || `Upload failed (HTTP ${upRes.status})`);

      const url = upData.url;
      if (!url) throw new Error("No URL returned from selfie upload.");
      setSelfieUrl(url);

      // 3) Stop camera immediately
      cleanupCamera();

      // 4) Get location & activate
      setStatus("Getting your location…");
      const pos = await getLocation();
      setCoords(pos);

      setStatus("Activating MicroBuzz…");
      await activatePresence(pos, url);

      // 5) Start scanning + animation
      setStatus("Scanning nearby…");
      setIsActive(true);
      await scanNearby(pos);
      startScanInterval();
      startRafAnimation();
    } catch (err) {
      console.error(err);
      cleanupCamera();
      setError(err?.message || "Selfie failed. Try again.");
      setStatus("Selfie failed. Try again.");
    }
  }

  async function activatePresence(pos, selfie) {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const res = await fetch(`${API_BASE}/microbuzz/activate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token()}`,
      },
body: JSON.stringify({
  lat: pos.lat,
  lng: pos.lng,
  selfieUrl: selfie,

  // NEW → preferences
  gender: user?.gender,
  lookingFor: user?.lookingFor,
  interestedIn: user?.interestedIn || [],
  minAge: user?.preferences?.minAge || 18,
  maxAge: user?.preferences?.maxAge || 99,
}),
      signal: abortRef.current.signal,
    });
    const data = await safeJson(res);
    if (!res.ok) {
      throw new Error(data?.error || "Activate failed");
    }
  }

  // -------- Scanning
   function startScanInterval() {
    stopScanInterval();
    scanTimerRef.current = setInterval(async () => {
      if (isScanningRef.current) return;
      isScanningRef.current = true;
      try {
        const pos = coords || (await getLocation());
        setCoords(pos);
        // Re-activate to bump lastActive so you stay visible
        if (selfieUrl) await activatePresence(pos, selfieUrl);
        await scanNearby(pos);
        backoffRef.current = 2000; // keep base at 2s on success
      } catch (e) {
        console.warn("scan loop:", e);
        backoffRef.current = Math.min(
          20000,
          (backoffRef.current || 2000) + 3000
        );
      } finally {
        isScanningRef.current = false;
      }
    }, 2000); // actual interval: 2s
  }


  function stopScanInterval() {
    if (scanTimerRef.current) {
      clearInterval(scanTimerRef.current);
      scanTimerRef.current = null;
    }
  }

  async function scanNearby(pos) {
    try {
      setStatus("Scanning nearby users…");
      setError("");

      const url = new URL(`${API_BASE}/microbuzz/nearby`);
    url.searchParams.set("lat", String(pos.lat));
url.searchParams.set("lng", String(pos.lng));
url.searchParams.set("radius", "0.75");

// NEW → send user preferences
url.searchParams.set("gender", user?.gender || "");
url.searchParams.set("lookingFor", user?.lookingFor || "");
url.searchParams.set("interestedIn", JSON.stringify(user?.interestedIn || []));
url.searchParams.set("minAge", user?.preferences?.minAge || 18);
url.searchParams.set("maxAge", user?.preferences?.maxAge || 99);

      abortRef.current?.abort();
      abortRef.current = new AbortController();

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token()}` },
        signal: abortRef.current.signal,
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);

      const list = Array.isArray(data.users) ? data.users : [];
      setNearby(list);
      setStatus(
        list.length > 0
          ? "Nearby users found! Tap a photo to Buzz."
          : "No one nearby right now. Try again later."
      );

      // Seed/refresh orbit props for users
      list.forEach((u) => {
        if (!orbitsRef.current[u.id]) {
          const rf = clamp(u.distanceMeters ? u.distanceMeters / 800 : 0.4, 0.15, 0.95);
          orbitsRef.current[u.id] = {
            angle0: Math.random() * Math.PI * 2,
            speed: 0.3 + Math.random() * 0.7, // radians/sec
            radiusFactor: rf,
          };
        }
      });
      // prune orbits for users that disappeared
      Object.keys(orbitsRef.current).forEach((id) => {
        if (!list.find((u) => u.id === id)) {
          delete orbitsRef.current[id];
        }
      });
    } catch (err) {
      console.error(err);
      setError(err?.message || "Scan failed");
      setStatus("Scan error. Retrying soon…");
    }
  }

  // -------- Animation (requestAnimationFrame)
  function startRafAnimation() {
    stopRafAnimation();
    const origin = performance.now();
    const loop = (t) => {
      setNow(t - origin); // ms
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }

  function stopRafAnimation() {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }

  // -------- Stop flow
  async function stopMicroBuzz() {
    try {
      setStatus("Stopping…");
      setError("");
      cleanupCamera();
      stopScanInterval();
      stopRafAnimation();
      setNearby([]);
      setIsActive(false);

      abortRef.current?.abort();
      abortRef.current = new AbortController();
      await fetch(`${API_BASE}/microbuzz/deactivate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token()}` },
        signal: abortRef.current.signal,
      });
      setStatus("MicroBuzz is off. Turn it on to start discovering.");
    } catch (err) {
      console.error(err);
      setError(err?.message || "Failed to stop");
    }
  }
  // ===============================
// 🔔 Small match action popup UI
// ===============================
const [matchActions, setMatchActions] = useState(null);

function showMatchActions({ otherId, otherName, roomId }) {
  setMatchActions({
    otherId,
    otherName,
    roomId
  });
}


  // Safely decode JSON or return null
  async function safeJson(res) {
    try {
      return await res.json();
    } catch {
      return null;
    }
  }
  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

// Respond to a Buzz popup ❤️ or ❌
// NOTE: We rely on the "match" socket event to trigger the celebration overlay.
// This avoids double-firing match:celebrate for the accepter.
async function respondToBuzz(accepted) {
  if (!buzzRequest) return;

  try {
    const targetId = buzzRequest.fromId;

    if (accepted) {
      // Only send confirm:true – backend will create the match
      // and emit "match" to BOTH users via Socket.IO.
      const res = await fetch(`${API_BASE}/microbuzz/buzz`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token()}`,
        },
        body: JSON.stringify({ toId: targetId, confirm: true }),
      });

      // We don't need to do anything with the response here.
      // The celebration + redirect is driven entirely by the "match"
      // socket event listener above.
      await res.json().catch(() => null);

      setBuzzRequest(null);
      return;
    }

    // ❌ Rejected
    socket.emit("buzz_rejected", { toId: targetId });
  } catch (err) {
    console.error("❌ respondToBuzz error:", err);
  } finally {
    setBuzzRequest(null);
  }
}




  // Cleanup on unmount + pause scanning when tab hidden
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        stopScanInterval();
      } else if (isActive) {
        startScanInterval();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      cleanupCamera();
      stopScanInterval();
      stopRafAnimation();
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);

  // -------- Render
  return (
<div
  className="bg-gradient-to-br from-purple-900 via-indigo-900 to-pink-800 p-4 flex items-center justify-center relative overflow-visible"
  style={{ minHeight: "100dvh" }}
>

      {/* Animated Background Elements */}
<div
  className="absolute inset-0 overflow-hidden"
  style={{
    // Disable heavy blur & glow only on mobile for stability
    WebkitBackdropFilter: window.innerWidth < 640 ? "none" : undefined,
    backdropFilter: window.innerWidth < 640 ? "none" : undefined,
  }}
>
<div className="absolute -top-40 -left-40 w-80 h-80 bg-purple-500/20 rounded-full blur-xl sm:blur-3xl animate-pulse"></div>
        <div className="absolute -bottom-40 -right-40 w-80 h-80 bg-pink-500/20 rounded-full blur-3xl animate-pulse delay-1000"></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl animate-pulse delay-500"></div>
      </div>

      <div className="relative bg-white/10 backdrop-blur-lg border border-white/20 shadow-2xl rounded-3xl p-6 sm:p-8 w-full max-w-4xl z-10">
        {/* Premium Glow Effect */}
        <div className="absolute -inset-1 bg-gradient-to-r from-purple-600 to-pink-600 rounded-3xl blur opacity-30 group-hover:opacity-100 transition duration-1000 group-hover:duration-200 animate-pulse"></div>
        
        <div className="relative">
          {/* Header */}
          <div className="flex items-center justify-between gap-3 mb-6">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-pink-500 rounded-2xl flex items-center justify-center shadow-lg">
                  <span className="text-2xl">📡</span>
                </div>
                <div className="absolute -top-1 -right-1 w-4 h-4 bg-green-400 rounded-full border-2 border-white animate-pulse"></div>
              </div>
              <div>
                <h1 className="text-3xl sm:text-4xl font-black bg-gradient-to-r from-white to-purple-200 bg-clip-text text-transparent">
                  MicroBuzz
                </h1>
                <p className="text-purple-200/80 text-sm font-medium">Real-time match finder</p>
              </div>
            </div>
            <span className="bg-gradient-to-r from-yellow-400 to-orange-500 text-black text-xs font-bold px-3 py-2 rounded-full shadow-lg animate-pulse">
              PREMIUM SOON
            </span>
          </div>

          {/* Status Card */}
          <div className="bg-black/30 border border-white/10 rounded-2xl p-4 mb-6 backdrop-blur-sm">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-3 h-3 bg-green-400 rounded-full mt-1.5 animate-pulse"></div>
              <p className="text-white/90 text-sm leading-relaxed">{status}</p>
            </div>
            {error && (
              <div className="mt-3 p-3 bg-red-500/20 border border-red-500/30 rounded-xl">
                <div className="flex items-center gap-2 text-red-200 text-sm">
                  <span>⚠️</span>
                  <span>{error}</span>
                </div>
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="flex flex-wrap items-center gap-3 mb-8">
            {!isActive ? (
              <>
                <button
                  onClick={startMicroBuzz}
                  className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white px-6 py-3 rounded-xl font-semibold shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 flex items-center gap-2"
                >
                  <span>🚀</span>
                 Activate Microbuzz
                </button>
                {!!streamRef.current && (
                  <button
                    onClick={takeSelfieAndActivate}
                    className="bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white px-6 py-3 rounded-xl font-semibold shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 flex items-center gap-2"
                  >
                    <span>📸</span>
                    Take Selfie & Start
                  </button>
                )}
              </>
            ) : (
              <>
                <button
                  onClick={stopMicroBuzz}
                  className="bg-gradient-to-r from-gray-600 to-gray-700 hover:from-gray-700 hover:to-gray-800 text-white px-6 py-3 rounded-xl font-semibold shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 flex items-center gap-2"
                >
                  <span>⏹️</span>
                  Stop MicroBuzz
                </button>
                <button
                  onClick={() => coords && scanNearby(coords)}
                  className="bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white px-6 py-3 rounded-xl font-semibold shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 flex items-center gap-2"
                >
                  <span>🔄</span>
                  Refresh Scan
                </button>
              </>
            )}
          </div>

          {/* Camera preview (only when awaiting selfie) */}
          {!isActive && streamRef.current && (
            <div className="mb-8">
              <div className="rounded-2xl overflow-hidden border-2 border-white/20 shadow-2xl max-w-sm mx-auto transform hover:scale-105 transition-transform duration-300">
                <video
                  ref={videoRef}
                  className="w-full h-auto bg-black"
                  playsInline
                  muted
                />
              </div>
              <p className="text-white/60 text-xs text-center mt-3">
                Click Activate Microbuzz, Position your face and click "📸 Take Selfie & Start".<br />
                Your camera will turn off after the selfie is taken.
              </p>
            </div>
          )}

                  {/* Radar + inline selfie preview */}
              {/* Preference Selector */}

              {isActive && selfieUrl && (
                  <>
                    {/* Tips Carousel */}
                    <div className="w-full text-center mb-4">
                      <p className="animate-fade-in text-white/80 text-sm font-medium bg-white/10 px-4 py-2 inline-block rounded-xl border border-white/20 shadow-lg">
                        {tips[tipIndex]}
                      </p>
                    </div>

                    <Radar
                      you={selfieUrl}
                      users={nearby}
                      orbits={orbitsRef.current}
                      nowMs={now}
                      onBuzz={handleBuzz}
                      onPreviewStart={(u) => setPreviewUser(u)}
                      onPreviewEnd={() => setPreviewUser(null)}
                    />
                  </>
                )}

              {/* Long-press / hold preview overlay (same screen) */}
              {previewUser && (
                <div className="absolute inset-0 flex items-center justify-center z-30 pointer-events-none">
                  <div className="pointer-events-auto bg-black/40 rounded-full p-1 backdrop-blur-sm">
                    <div className="relative w-56 h-56 sm:w-64 sm:h-64 rounded-3xl overflow-hidden border-4 border-pink-400 shadow-[0_20px_60px_rgba(0,0,0,0.65)] animate-soft-pop">
                      <img
                        src={
                          previewUser.selfieUrl ||
                          "https://via.placeholder.com/300?text=Nearby"
                        }
                        alt="MicroBuzz preview"
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute bottom-3 left-3 text-[11px] sm:text-xs bg-black/50 text-white px-3 py-1.5 rounded-full flex items-center gap-2">
                        <span>👀 Live preview</span>
                        {typeof previewUser.distanceMeters === "number" && (
                          <span className="text-white/70">
                            · {Math.round(previewUser.distanceMeters)} m
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          
    
          {/* Debug (optional) */}
          {debug && (
            <pre className="text-[11px] text-white/50 bg-black/30 border border-white/10 rounded-xl p-3 mt-4 overflow-x-auto backdrop-blur-sm">
              {debug}
            </pre>
          )}

          {!isActive && (
            <div className="text-center text-white/50 text-sm mt-6">
              <div className="bg-white/5 rounded-2xl p-4 border border-white/10">
                <p className="font-semibold text-white/70 mb-2">💡 Pro Tip</p>
                <p>MicroBuzz works best in cafés, libraries, campuses, clubs, and bars where people are open to meeting new friends.</p>
              </div>
            </div>
          )}
        </div>
  
      {/* Buzz Request Popup */}
      {buzzRequest && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 backdrop-blur-xl">
          <div className="relative bg-gradient-to-br from-purple-900 to-pink-800 border border-white/20 rounded-3xl shadow-2xl p-8 w-96 max-w-[90vw] animate-pop-in">
            {/* Glow effect */}
            <div className="absolute -inset-1 bg-gradient-to-r from-purple-600 to-pink-600 rounded-3xl blur opacity-30"></div>
            
            <div className="relative">
              <div className="text-center">
                {/* Avatar with pulse animation */}
                <div className="relative inline-block">
                  <img
                    src={buzzRequest.selfieUrl || "https://via.placeholder.com/100"}
                    alt={buzzRequest.name || "Buzz request"}
                    className="w-24 h-24 rounded-2xl object-cover border-4 border-white/20 shadow-2xl mx-auto"
                  />
                  <div className="absolute inset-0 rounded-2xl border-2 border-pink-400 animate-ping opacity-60"></div>
                </div>
                
               <h3 className="text-2xl font-black text-white mt-6 mb-2">
                💌 {buzzRequest.name || "Someone nearby"} wants to buzz you
              </h3>



                {buzzRequest.distanceMeters && (
                  <p className="text-white/60 text-sm mb-6">
                    {Math.round(buzzRequest.distanceMeters)} meters away • Ready to connect
                  </p>
                )}

               <p className="text-white/70 text-sm mb-8 leading-relaxed">
                  Accept to connect instantly, or dismiss to pass.
                </p>


                {/* Action Buttons */}
                <div className="flex justify-center gap-4">
                  <button
                    onClick={() => respondToBuzz(true)}
                    className="bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white px-8 py-4 rounded-2xl font-bold shadow-2xl transform hover:scale-110 transition-all duration-200 flex items-center gap-3 flex-1 justify-center"
                  >
                    <span className="text-xl">❤️</span>
                    Accept
                  </button>
                  <button
                    onClick={() => respondToBuzz(false)}
                    className="bg-gradient-to-r from-gray-600 to-gray-700 hover:from-gray-700 hover:to-gray-800 text-white px-8 py-4 rounded-2xl font-bold shadow-2xl transform hover:scale-110 transition-all duration-200 flex items-center gap-3 flex-1 justify-center"
                  >
                    <span className="text-xl">✖️</span>
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    

        {/* Custom Animations */}
      <style>{`
        @keyframes fade-in {
          from { opacity: 0; transform: scale(0.95) translateY(10px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes pop-in {
          0% { opacity: 0; transform: scale(0.8) translateY(20px); }
          70% { opacity: 1; transform: scale(1.05) translateY(-5px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
        .animate-fade-in { animation: fade-in 0.3s ease-out; }
        .animate-pop-in { animation: pop-in 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275); }

        /* Soft pop for long-press selfie preview */
        @keyframes soft-pop {
          0% { opacity: 0; transform: scale(0.85) translateY(10px); }
          50% { opacity: 1; transform: scale(1.03) translateY(0); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
        .animate-soft-pop {
          animation: soft-pop 0.28s ease-out;
        }
          /* Fade animation for rotating tips */
              @keyframes tip-fade {
                0% { opacity: 0; transform: translateY(4px); }
                10% { opacity: 1; transform: translateY(0); }
                90% { opacity: 1; transform: translateY(0); }
                100% { opacity: 0; transform: translateY(-4px); }
              }
              .animate-fade-in {
                animation: tip-fade 0.5s ease-out;
              }
      
      `}</style>
 {matchActions && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md">
    <div className="bg-gradient-to-br from-purple-800 to-pink-700 p-8 rounded-3xl border border-white/20 shadow-2xl w-96 max-w-[90vw] text-center animate-pop-in relative">

      <div className="absolute -inset-1 bg-gradient-to-r from-purple-500 to-pink-500 blur opacity-30 rounded-3xl"></div>

      <div className="relative">
        <h2 className="text-3xl font-black text-white mb-4">
          🎉 It's a Match!
        </h2>
        <p className="text-white/80 text-lg mb-8">
          You and <span className="font-bold text-white">{matchActions.otherName}</span> matched with each other!
        </p>

        <div className="flex flex-col gap-4">

          <button
            onClick={() => {
              setMatchActions(null);
              navigate(`/viewProfile/${matchActions.otherId}`);
            }}
            className="bg-white/10 border border-white/20 text-white py-3 px-6 rounded-2xl text-lg font-semibold shadow-lg hover:bg-white/20 transition"
          >
             View Profile
          </button>

          <button
            onClick={() => {
              setMatchActions(null);
              navigate(`/chat/${matchActions.roomId}`);
            }}
            className="bg-gradient-to-r from-green-500 to-emerald-500 text-white py-3 px-6 rounded-2xl text-lg font-bold shadow-xl hover:opacity-90 transition"
          >
             Chat Now
          </button>

        </div>
      </div>
    </div>
  </div>
)}

    </div>
  );
}
