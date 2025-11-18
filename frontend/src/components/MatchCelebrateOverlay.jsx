// frontend/src/components/MatchCelebrateOverlay.jsx

/**
 * ============================================================
 * 📁 File: components/MatchCelebrateOverlay.jsx
 * 💖 Purpose: Global "It's a Match" celebration overlay for RomBuzz
 *
 * Listens to:
 *   window.dispatchEvent(new CustomEvent("match:celebrate", {
 *     detail: { otherUserId }
 *   }))
 *
 * Behavior:
 *   - Shows a full-screen RomBuzz-style celebration (better than Tinder 😏)
 *   - Pulls current user from localStorage for context
 *   - Optionally fetches the match's public profile (avatar + name)
 *   - After a short animation, auto-redirects to /chat/:otherUserId
 *   - Also gives a "Chat now" button so user can skip wait
 *
 * Mobile & Desktop:
 *   - Uses Tailwind utility classes with responsive-safe layout
 *   - Fixed overlay, centered card, works on small screens too
 * ============================================================
 */

import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { API_BASE } from "../config";

function getStoredUser() {
  try {
    const stored =
      localStorage.getItem("user") || sessionStorage.getItem("user");
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

export default function MatchCelebrateOverlay() {
  const navigate = useNavigate();

  const [visible, setVisible] = useState(false);
  const [otherUserId, setOtherUserId] = useState(null);
  const [myUser, setMyUser] = useState(null);
  const [matchUser, setMatchUser] = useState(null);
  const [matchSelfie, setMatchSelfie] = useState(null);
  const [loadingProfile, setLoadingProfile] = useState(false);

  // 🚀 Listen to global "match:celebrate" events from socket.js
  useEffect(() => {
    const handler = (ev) => {
      const detail = ev.detail || {};
      if (!detail.otherUserId) return;

      setOtherUserId(String(detail.otherUserId));
setMatchSelfie(detail.selfieUrl || null); // ← NEW
setMyUser(getStoredUser());
setVisible(true);

    };

       window.addEventListener("match:celebrate", handler);
    return () => window.removeEventListener("match:celebrate", handler);
  }, []);


// 🔐 Freeze background scroll while overlay is visible
useEffect(() => {
  if (visible) {
    document.body.style.overflow = "hidden";
  } else {
    document.body.style.overflow = "";
  }

  return () => {
    document.body.style.overflow = "";
  };
}, [visible]);



  // 👤 Try to fetch the other user's public profile for avatar + name
  useEffect(() => {
    if (!visible || !otherUserId) return;

    let cancelled = false;
    (async () => {
      try {
        setLoadingProfile(true);
        const token =
          localStorage.getItem("token") || sessionStorage.getItem("token");

        // This route matches your existing public profile API:
        // routes/publicProfile.js → GET /api/public/profile/:id
        const res = await fetch(
          `${API_BASE}/public/profile/${encodeURIComponent(otherUserId)}`,
          {
            headers: token
              ? { Authorization: `Bearer ${token}` }
              : undefined,
          }
        );

        if (!res.ok) throw new Error("Profile fetch failed");
        const data = await res.json();
        if (!cancelled) {
          setMatchUser(data || null);
        }
      } catch (e) {
        console.warn("MatchCelebrateOverlay: profile fetch failed", e);
        if (!cancelled) setMatchUser(null);
      } finally {
        if (!cancelled) setLoadingProfile(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [visible, otherUserId]);

  // 🔁 Auto-redirect to chat after a short celebration
  useEffect(() => {
    if (!visible || !otherUserId) return;
    const timer = setTimeout(() => {
      goToChat();
    }, 7000); // ~7s then auto-open chat

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, otherUserId]);

  const closeOverlay = () => {
    setVisible(false);
  };

  const goToChat = () => {
    if (!otherUserId) return;
    setVisible(false);
    // Keep it in sync with your App.jsx routes: /chat/:userId
    navigate(`/chat/${otherUserId}`);
  };

  if (!visible) return null;
// Always show "You" on the left
const myName = "You";

// Try to show real name only for the OTHER person
const matchName =
  (matchUser && matchUser.firstName) ||
  "your match";



  const matchAvatar =
  matchUser?.avatar ||
  matchUser?.profilePhoto ||
  matchSelfie || // ← fallback to selfie
  "https://i.pravatar.cc/200?img=67";


  const myAvatar =
    myUser?.avatar ||
    myUser?.profilePhoto ||
    "https://i.pravatar.cc/200?img=21";

  return (
<div
  className="fixed inset-0 z-[9999] flex items-center justify-center px-4"
  style={{ height: "100dvh" }}
>
      {/* Dimmed background */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={closeOverlay}
      />

      {/* Floating hearts / confetti layer */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {Array.from({ length: 20 }).map((_, i) => (
          <span
            key={i}
            className="absolute text-rose-200 opacity-80 animate-rbz-heart"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${10 + Math.random() * 80}%`,
              fontSize: `${18 + Math.random() * 18}px`,
              animationDelay: `${Math.random() * 2}s`,
            }}
          >
            ❤️
          </span>
        ))}
      </div>

      {/* Main card */}
      <div className="relative max-w-md w-full bg-gradient-to-br from-rose-500 via-fuchsia-500 to-amber-400 rounded-3xl shadow-2xl border border-rose-200/40 text-white p-6 md:p-8 animate-rbz-pop">
        {/* Close button */}
        <button
          onClick={closeOverlay}
          className="absolute top-3 right-3 h-8 w-8 rounded-full bg-black/30 hover:bg-black/40 flex items-center justify-center text-sm"
          aria-label="Close"
        >
          ✕
        </button>

        <div className="flex flex-col items-center text-center gap-4">
          <div className="text-xs uppercase tracking-[0.25em] text-rose-100/80">
            rombuzz match
          </div>
          <h2 className="text-3xl md:text-4xl font-extrabold drop-shadow-sm">
            It&apos;s a Match! 💫
          </h2>
      <p className="text-sm md:text-base text-rose-50/90 max-w-xs">
        You &amp; {matchName} are a match!<br />
        Profiles are open - start chatting before the spark cools down.
      </p>

          {/* Avatar row */}
          <div className="mt-3 mb-4 flex items-center justify-center gap-6">
            <div className="relative">
              <img
                src={myAvatar}
                alt="You"
                className="h-20 w-20 md:h-24 md:w-24 rounded-full border-4 border-white/80 object-cover shadow-xl"
              />
              <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 text-[11px] bg-black/40 px-2 py-0.5 rounded-full">
                You
              </span>
            </div>

            <div className="text-4xl md:text-5xl animate-pulse drop-shadow-lg">
              💞
            </div>

            <div className="relative">
              <img
                src={matchAvatar}
                alt="Match"
                className="h-20 w-20 md:h-24 md:w-24 rounded-full border-4 border-white/80 object-cover shadow-xl"
              />
              <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 text-[11px] bg-black/40 px-2 py-0.5 rounded-full">
                {loadingProfile ? "Loading…" : "Your match"}
              </span>
            </div>
          </div>

          {/* Hint text */}
          <div className="text-xs md:text-sm text-rose-50/90">
            We’ll drop you both straight into a private chat.
          </div>

          {/* CTA buttons */}
          <div className="mt-2 flex flex-col sm:flex-row gap-3 w-full">
            <button
              onClick={goToChat}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-full bg-white text-rose-600 px-4 py-2.5 text-sm md:text-base font-semibold shadow-lg hover:bg-rose-50 transition"
            >
              <span>Start chatting</span>
              <span>💬</span>
            </button>
            <button
              onClick={closeOverlay}
              className="flex-1 inline-flex items-center justify-center rounded-full border border-white/40 bg-black/10 px-4 py-2.5 text-sm md:text-base hover:bg-black/20 transition"
            >
              Stay on this screen
            </button>
          </div>

          <div className="mt-1 text-[11px] text-rose-100/80">
            Tip: You can always find them later in Chat &nbsp;→&nbsp; Matches.
          </div>
        </div>

        {/* Local styles for animations */}
        <style>{`
            @keyframes rbz-pop {
            from { opacity: 0; }
            to { opacity: 1; }
            }

            .animate-rbz-pop {
            animation: rbz-pop 0.4s ease-out;
            will-change: opacity;
            }


          @keyframes rbz-heart {
            0% { transform: translateY(0) scale(0.9); opacity: 0; }
            20% { opacity: 1; }
            100% { transform: translateY(-120px) scale(1.1); opacity: 0; }
          }
          .animate-rbz-heart {
            animation: rbz-heart 3.4s linear infinite;
          }
        `}</style>
      </div>
    </div>
  );
}
