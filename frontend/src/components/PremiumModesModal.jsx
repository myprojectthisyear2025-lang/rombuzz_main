// src/components/PremiumModesModal.jsx
import React, { useState, useEffect } from "react";
import { FaTimes, FaCrown, FaBolt, FaStar } from "react-icons/fa";

/**
 * PremiumModesModal
 *
 * Props:
 *  - open: boolean
 *  - onClose: () => void
 *  - premiumTier: "free" | "plus" | "elite"
 *  - onSelectMode: (modeKey: string, meta: { tier: "plus" | "elite" }) => void
 *  - onUpgrade: () => void   // we'll just route to /upgrade from parent
 */

const PLUS_MODES = [
  {
    key: "cute",
    tier: "plus",
    emoji: "🧁",
    title: "Cute & Soft",
    desc: "Sweet, comforting energy. Soft-hearted connections.",
  },
  {
    key: "flirty",
    tier: "plus",
    emoji: "😏",
    title: "Flirty",
    desc: "Playful, cheeky mood. Lots of banter.",
  },
  {
    key: "mystery",
    tier: "plus",
    emoji: "🕶️",
    title: "Mystery",
    desc: "Deep, curious, low-key intriguing people.",
  },
  {
    key: "chill",
    tier: "plus",
    emoji: "🌙",
    title: "Chill",
    desc: "Cozy, peaceful vibe. No drama.",
  },
  {
    key: "timepass",
    tier: "plus",
    emoji: "🫧",
    title: "Timepass",
    desc: "Low-pressure chat. Just talking, no rush.",
  },
  {
    key: "serious",
    tier: "plus",
    emoji: "❤️",
    title: "Long-term",
    desc: "People who are here for something serious.",
  },
  {
    key: "friends",
    tier: "plus",
    emoji: "🧑‍🤝‍🧑",
    title: "Friendship",
    desc: "New people to hang out & vibe with.",
  },
  {
    key: "gymbuddy",
    tier: "plus",
    emoji: "💪",
    title: "GymBuddy",
    desc: "Fitness partners and active lifestyles.",
  },
];

const ELITE_MODES = [
  {
    key: "ons",
    tier: "elite",
    emoji: "🔥",
    title: "One-night vibe",
    desc: "Mutual short-term chemistry. Adults only (18+).",
  },
  {
    key: "threesome",
    tier: "elite",
    emoji: "🎭",
    title: "Threesome / Group date",
    desc: "Open-minded adults exploring together.",
  },
  {
    key: "onlyfans",
    tier: "elite",
    emoji: "💸",
    title: "OnlyFans-friendly",
    desc: "Connect with creators and fans.",
  },
  {
    key: "kink",
    tier: "elite",
    emoji: "🎀",
    title: "Kink-friendly",
    desc: "Specific desires, talked about safely & clearly.",
  },
  {
    key: "latenight",
    tier: "elite",
    emoji: "🌃",
    title: "Late-night mode",
    desc: "After dark vibes only. Extra spicy.",
  },
  {
    key: "secret",
    tier: "elite",
    emoji: "👻",
    title: "Secret / Incognito",
    desc: "Browse quietly with low visibility.",
  },
];

export default function PremiumModesModal({
  open,
  onClose,
  premiumTier = "free",
  onSelectMode,
  onUpgrade,
}) {
  const [activeTab, setActiveTab] = useState("plus"); // "plus" | "elite"
  const [selectedKey, setSelectedKey] = useState(null);
  const [showConfetti, setShowConfetti] = useState(false);

  useEffect(() => {
    if (open) {
      setActiveTab("plus");
      setShowConfetti(false);
    }
  }, [open]);

  useEffect(() => {
    if (!showConfetti) return;
    const t = setTimeout(() => setShowConfetti(false), 1000);
    return () => clearTimeout(t);
  }, [showConfetti]);

  if (!open) return null;

  const handleCardClick = (mode) => {
    const { key } = mode;

    // TEMP PAYMENT CHECK:
    // later you can wire this to real payment/verification state.
    const hasPaid = premiumTier !== "free";

    if (!hasPaid) {
      // No payment → send user to Upgrade page
      if (onUpgrade) {
        onUpgrade();
      } else {
        window.location.href = "/upgrade";
      }
      return;
    }

    // Paid:
    setSelectedKey(key);
    setShowConfetti(true);

    // Notify parent (Discover) to apply filter + save + broadcast
    onSelectMode?.(key, { tier: mode.tier });
  };

const modesToShow =
  activeTab === "plus"
    ? PLUS_MODES
    : ELITE_MODES;

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 backdrop-blur-sm">
      {/* Sheet container */}
      <div className="relative w-full max-w-2xl bg-white rounded-t-3xl md:rounded-3xl shadow-2xl overflow-hidden animate-[slideUp_0.25s_ease-out] max-h-[90vh] flex flex-col">
        {/* Confetti overlay (simple, lightweight) */}
        {showConfetti && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="relative w-full h-full">
              <span className="absolute left-1/4 top-1/4 text-2xl md:text-3xl animate-bounce">
                ✨
              </span>
              <span className="absolute right-1/4 top-1/3 text-2xl md:text-3xl animate-bounce">
                💖
              </span>
              <span className="absolute left-1/3 bottom-1/4 text-2xl md:text-3xl animate-bounce">
                🎉
              </span>
              <span className="absolute right-1/5 bottom-1/5 text-2xl md:text-3xl animate-bounce">
                🌟
              </span>
            </div>
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-rose-500 uppercase tracking-wide">
              <FaCrown className="text-yellow-400" />
              Premium Modes
            </div>
            <h2 className="text-lg font-bold text-gray-900">
              Tune your Discover vibe
            </h2>
            <p className="text-xs text-gray-500">
              Pick a mode and we’ll try to prioritize people who match that
              energy.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-gray-100 text-gray-500"
          >
            <FaTimes />
          </button>
        </div>

        {/* Tabs */}
        <div className="px-5 pt-3 pb-2 flex items-center gap-2">
          <button
            onClick={() => setActiveTab("plus")}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold transition ${
              activeTab === "plus"
                ? "bg-gradient-to-r from-pink-500 to-rose-500 text-white shadow"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            <FaStar className="text-yellow-300" />
            RomBuzz+
          </button>
          <button
            onClick={() => setActiveTab("elite")}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold transition ${
              activeTab === "elite"
                ? "bg-gradient-to-r from-purple-500 to-violet-600 text-white shadow"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            <FaBolt className="text-amber-300" />
            RomBuzz Elite
          </button>

          <div className="ml-auto text-[11px] text-gray-500 hidden md:block">
            {premiumTier !== "free"
              ? "Premium active. All modes available."
              : "You’re on Free. Selecting a mode will open Upgrade."}
          </div>
        </div>

        {/* Scrollable body */}
        <div className="px-5 pb-4 pt-1 overflow-y-auto">
          {/* 2 square tiles per row */}
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:gap-5">
            {modesToShow.map((mode) => {
              const isSelected = selectedKey === mode.key;
              return (
                <button
                  key={`${activeTab}-${mode.key}`}
                  onClick={() => handleCardClick(mode)}
                  className={`relative aspect-square rounded-2xl p-4 shadow-sm border overflow-hidden
                    transition-transform transition-shadow duration-200
                    hover:-translate-y-1 hover:shadow-xl hover:scale-[1.03]
                    active:scale-95
                    ${
                      activeTab === "elite" || mode.tier === "elite"
                        ? "bg-gradient-to-br from-violet-50 via-purple-50 to-rose-50"
                        : "bg-gradient-to-br from-rose-50 via-pink-50 to-amber-50"
                    }
                    ${
                      isSelected
                        ? "ring-2 ring-rose-500 border-rose-400"
                        : "border-white/60"
                    }`}
                >
                  {/* Subtle glow layer */}
                  <div className="pointer-events-none absolute inset-0 opacity-40 bg-gradient-to-br from-white/40 to-transparent" />

                  {/* Content inside square */}
                  <div className="relative flex h-full flex-col items-center justify-center text-center">
                    {/* Emoji bubble */}
                    <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-white/70 shadow-sm">
                      <span className="text-2xl md:text-3xl">{mode.emoji}</span>
                    </div>

                    {/* Title + tier */}
                    <div className="mt-1 flex items-center justify-center gap-2">
                      <h3 className="text-sm font-semibold text-gray-900">
                        {mode.title}
                      </h3>
                      {mode.tier === "elite" && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-600 text-white shadow-sm">
                          Elite
                        </span>
                      )}
                      {mode.tier === "plus" && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500 text-white shadow-sm">
                          Plus
                        </span>
                      )}
                    </div>

                    {/* Description */}
                    <p className="mt-2 px-1 text-[11px] text-gray-600 leading-snug max-w-[11rem] mx-auto">
                      {mode.desc}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Tiny note */}
          <p className="mt-3 text-[10px] text-gray-500 text-center">
            Modes don’t hard-filter people. They gently nudge who you discover
            first based on vibe.
          </p>
        </div>

        {/* Bottom actions (for free users) */}
        {premiumTier === "free" && (
          <div className="border-t px-5 py-3 bg-gray-50 text-center text-[11px] text-gray-600">
            <span className="font-semibold text-rose-500">Tip:</span> Upgrade on
            the{" "}
            <span className="font-semibold underline cursor-pointer">
              Upgrade
            </span>{" "}
            page later to unlock all modes permanently.
          </div>
        )}
      </div>
    </div>
  );
}
