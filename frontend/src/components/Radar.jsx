// src/components/Radar.jsx
import React, { useEffect } from "react";

export default function Radar({
  you,
  users,
  orbits,
  nowMs,
  onBuzz,
  onPreviewStart,
  onPreviewEnd,
}) {
  const [viewportWidth, setViewportWidth] = React.useState(window.innerWidth);

  // Track users currently shown on radar (including fading-out ones)
  const [visibleUsers, setVisibleUsers] = React.useState([]);

  // Merge incoming users with existing visibleUsers (for fade-out)
  useEffect(() => {
    setVisibleUsers((prevVisible) => {
      const incoming = Array.isArray(users) ? users : [];
      const incomingIds = new Set(incoming.map((u) => u.id));

      // Start with fresh incoming users
      const newList = [...incoming];

      // Keep old users (marked as fadeOut) if they disappeared
      prevVisible.forEach((oldU) => {
        if (!incomingIds.has(oldU.id)) {
          newList.push({ ...oldU, _fadeOut: true });
        }
      });

      return newList;
    });
  }, [users]);

  const longPressTimeoutRef = React.useRef(null);
  const pressStartRef = React.useRef(0);
  const previewActiveRef = React.useRef(false);

  const fakeDotsRef = React.useRef([]);

  /* ============================
        Resize → responsive radar
  ============================ */
  useEffect(() => {
    const update = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const size = Math.min(480, viewportWidth * (viewportWidth < 640 ? 0.78 : 0.9));
  const center = size / 2;

  const ringCount = 4;
  const maxRadius = size / 2 - 20;

  const userCount = (visibleUsers || []).length;

  /* ============================
        Auto avatar sizing
  ============================ */
  let avatarSize = 68;
  if (userCount <= 4) avatarSize = 78;
  else if (userCount <= 8) avatarSize = 68;
  else if (userCount <= 12) avatarSize = 60;
  else avatarSize = 52;

  const halfAvatar = avatarSize / 2;

  /* ============================
        Fake blinking dots
  ============================ */
  if (fakeDotsRef.current.length === 0 && size > 0) {
    const dotCount = 10;
    const arr = [];
    for (let i = 0; i < dotCount; i++) {
      const r = Math.random() * maxRadius * 0.95;
      const angle = Math.random() * Math.PI * 2;

      const x = center + r * Math.cos(angle);
      const y = center + r * Math.sin(angle);

      arr.push({
        x,
        y,
        size: 3 + Math.random() * 3,
        delay: Math.random() * 2,
        duration: 1.2 + Math.random() * 1.8,
      });
    }
    fakeDotsRef.current = arr;
  }

  /* ============================
        Static avatar positions
  ============================ */
  const items = (visibleUsers || []).map((u, idx) => {
    const seed =
      orbits[u.id] || {
        angle0: Math.random() * Math.PI * 2,
        radiusFactor: 0.7,
      };

    const radius = Math.max(60, maxRadius * seed.radiusFactor);
    const angle = seed.angle0 + idx * 0.9;

    const x = center + radius * Math.cos(angle);
    const y = center + radius * Math.sin(angle);

    return { ...u, x, y };
  });

  /* ============================
        Long-press logic
  ============================ */
  const clearLongPressTimer = () => {
    if (longPressTimeoutRef.current) {
      clearTimeout(longPressTimeoutRef.current);
      longPressTimeoutRef.current = null;
    }
  };

  const handlePointerDown = (u, e) => {
    e.preventDefault();
    pressStartRef.current = Date.now();
    previewActiveRef.current = false;
    clearLongPressTimer();

    longPressTimeoutRef.current = setTimeout(() => {
      previewActiveRef.current = true;
      onPreviewStart && onPreviewStart(u);
    }, 700);
  };

  const handlePointerUp = (u, e) => {
    e.preventDefault();
    const elapsed = Date.now() - pressStartRef.current;
    clearLongPressTimer();

    // If preview is active, release = close preview
    if (previewActiveRef.current) {
      previewActiveRef.current = false;
      onPreviewEnd && onPreviewEnd();
      return;
    }

    // Quick tap → Buzz
    if (elapsed < 500 && onBuzz) {
      onBuzz(u.id);
    }
  };

  const handlePointerLeave = () => {
    clearLongPressTimer();
    if (previewActiveRef.current) {
      previewActiveRef.current = false;
      onPreviewEnd && onPreviewEnd();
    }
  };

  // Desktop: right-click → preview
  const handleContextMenu = (u, e) => {
    e.preventDefault();
    clearLongPressTimer();
    previewActiveRef.current = true;
    onPreviewStart && onPreviewStart(u);
  };

  /* ============================
        Fade-out cleanup
  ============================ */
  useEffect(() => {
    if (!visibleUsers.some((u) => u._fadeOut)) return;

    const timer = setTimeout(() => {
      setVisibleUsers((curr) => curr.filter((u) => !u._fadeOut));
    }, 420); // slightly > 0.4s animation

    return () => clearTimeout(timer);
  }, [visibleUsers]);

  /* ============================
        Render Radar
  ============================ */
  return (
    <div className="w-full flex justify-center overflow-hidden">
      <div
        className="relative mx-auto radar-container"
        style={{ width: size, height: size }}
      >
        {/* Glow */}
        <div className="absolute inset-0 rounded-full bg-gradient-to-r from-purple-500/30 to-pink-500/30 blur-xl animate-pulse" />

        {/* Main Radar */}
        <div
          className="rounded-full shadow-2xl overflow-hidden relative border-2 border-white/10"
          style={{
            width: size,
            height: size,
            background: `
              radial-gradient(
                circle at center,
                rgba(168, 85, 247, 0.15) 0%,
                rgba(126, 34, 206, 0.25) 40%,
                rgba(236, 72, 153, 0.35) 100%
              )`,
          }}
        >
          {/* Rings */}
          {[...Array(ringCount)].map((_, i) => {
            const r = ((i + 1) / ringCount) * maxRadius * 2;
            return (
              <div
                key={i}
                className="absolute rounded-full border border-purple-400/40 shadow-inner"
                style={{
                  width: r,
                  height: r,
                  top: center - r / 2,
                  left: center - r / 2,
                }}
              />
            );
          })}

          {/* Crosshairs */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-full h-px bg-purple-400/30" />
          </div>
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="h-full w-px bg-purple-400/30" />
          </div>

          {/* Sweep line */}
          <div
            className="absolute"
            style={{
              width: size,
              height: size,
              top: 0,
              left: 0,
              background: `
                conic-gradient(
                  from 0deg,
                  transparent 0deg,
                  rgba(236, 72, 153, 0.6) 15deg,
                  rgba(168, 85, 247, 0.8) 30deg,
                  transparent 60deg
                )`,
              animation: "radar-sweep 3s linear infinite",
              mixBlendMode: "screen",
            }}
          />

          {/* Blinking dots */}
          {fakeDotsRef.current.map((dot, i) => (
            <div
              key={`dot-${i}`}
              className="absolute rounded-full bg-white/70 opacity-0 tiny-blink"
              style={{
                width: dot.size,
                height: dot.size,
                top: dot.y - dot.size / 2,
                left: dot.x - dot.size / 2,
                animationDelay: `${dot.delay}s`,
                animationDuration: `${dot.duration}s`,
              }}
            />
          ))}

          {/* YOU */}
          <div
            className="absolute rounded-2xl border-4 border-pink-400 shadow-2xl cursor-pointer"
            style={{
              width: 80,
              height: 80,
              top: center - 40,
              left: center - 40,
              backgroundColor: "#fff",
              overflow: "hidden",
            }}
          >
            {you ? (
              <img src={you} alt="You" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-purple-400 to-pink-400 flex items-center justify-center">
                <span className="text-white text-2xl">👤</span>
              </div>
            )}
          </div>

          {/* USERS */}
          {items.map((u) => (
            <div
              key={u.id}
              onMouseDown={(e) => handlePointerDown(u, e)}
              onMouseUp={(e) => handlePointerUp(u, e)}
              onMouseLeave={handlePointerLeave}
              onTouchStart={(e) => handlePointerDown(u, e)}
              onTouchEnd={(e) => handlePointerUp(u, e)}
              onTouchCancel={handlePointerLeave}
              onContextMenu={(e) => handleContextMenu(u, e)}
              className={`absolute rounded-2xl border-3 border-purple-400 cursor-pointer shadow-2xl group avatar-fade ${
                u._fadeOut ? "avatar-fadeout" : ""
              }`}
              style={{
                width: avatarSize,
                height: avatarSize,
                top: u.y - halfAvatar,
                left: u.x - halfAvatar,
                overflow: "hidden",
                backgroundColor: "#fff",
              }}
            >
              <img
                src={u.selfieUrl || "https://via.placeholder.com/68?text=User"}
                alt={u.name || "Nearby"}
                className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
              />

              {u.distanceMeters && (
                <div className="absolute -bottom-2 -right-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white text-xs font-bold px-2 py-1 rounded-full shadow-lg">
                  {Math.round(u.distanceMeters)}m
                </div>
              )}
            </div>
          ))}

          {/* Center pulse */}
          <div
            className="absolute rounded-full bg-green-400 shadow-lg"
            style={{
              width: 12,
              height: 12,
              top: center - 6,
              left: center - 6,
              animation: "pulse 2s infinite",
            }}
          />
        </div>

        {/* Styling */}
        <style>{`
          @media (max-width: 640px) {
            .radar-container { transform: scale(0.88); }
          }

          @keyframes radar-sweep {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }

          @keyframes pulse {
            0% { box-shadow: 0 0 0 0 rgba(74,222,128,0.7); }
            70% { box-shadow: 0 0 0 10px rgba(74,222,128,0); }
            100% { box-shadow: 0 0 0 0 rgba(74,222,128,0); }
          }

          /* Improved tiny blink – soft fade instead of harsh flicker */
          @keyframes tiny-blink {
            0%   { opacity: 0; transform: scale(0.6); }
            25%  { opacity: 0.9; transform: scale(1); }
            60%  { opacity: 0.9; transform: scale(1); }
            100% { opacity: 0; transform: scale(0.6); }
          }
          .tiny-blink {
            animation-name: tiny-blink;
            animation-iteration-count: infinite;
            animation-timing-function: ease-in-out;
          }

          /* Fade IN for avatars */
          @keyframes avatar-fade {
            0% { opacity: 0; transform: scale(0.9); }
            40% { opacity: 1; transform: scale(1); }
            100% { opacity: 1; transform: scale(1); }
          }
          .avatar-fade { animation: avatar-fade .45s ease-out; }

          /* Fade OUT animation */
          @keyframes avatar-fadeout {
            0% { opacity: 1; transform: scale(1); }
            100% { opacity: 0; transform: scale(0.85); }
          }
          .avatar-fadeout {
            animation: avatar-fadeout 0.4s ease-out forwards;
          }
        `}</style>
      </div>
    </div>
  );
}
