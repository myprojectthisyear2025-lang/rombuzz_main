// src/components/PremiumModesModal.jsx
import React, { useState, useEffect } from "react";
import { FaTimes, FaCrown, FaBolt, FaStar, FaLock } from "react-icons/fa";

/**
 * PremiumModesModal
 *
 * Props:
 *  - open: boolean
 *  - onClose: () => void
 *  - premiumTier: "free" | "plus" | "elite"
 *  - onSelectMode: (modeKey: string, meta: { tier: "plus" | "elite" }) => void
 *  - onUpgrade: (tier: "plus" | "elite") => void
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

  useEffect(() => {
    if (open) {
      setActiveTab("plus");
    }
  }, [open]);

  if (!open) return null;

  const handleCardClick = (mode) => {
    const { tier, key } = mode;

    // If user does not have required tier → ask to upgrade
    if (tier === "elite" && premiumTier !== "elite") {
      onUpgrade?.("elite");
      return;
    }
    if (tier === "plus" && premiumTier === "free") {
      onUpgrade?.("plus");
      return;
    }

    // Otherwise, apply mode
    onSelectMode?.(key, { tier });
  };

  const isModeLocked = (mode) => {
    if (mode.tier === "elite") {
      return premiumTier !== "elite";
    }
    if (mode.tier === "plus") {
      return premiumTier === "free";
    }
    return false;
  };

  const modesToShow =
    activeTab === "plus"
      ? PLUS_MODES
      : [...PLUS_MODES.map((m) => ({ ...m, tier: "elite" })), ...ELITE_MODES];

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 backdrop-blur-sm">
      {/* Sheet container */}
      <div className="w-full max-w-2xl bg-white rounded-t-3xl md:rounded-3xl shadow-2xl overflow-hidden animate-[slideUp_0.25s_ease-out] max-h-[90vh] flex flex-col">
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
            {premiumTier === "elite"
              ? "You’re on Elite. All modes unlocked."
              : premiumTier === "plus"
              ? "You’re on RomBuzz+. Elite modes locked."
              : "You’re on Free. Try modes, then upgrade."}
          </div>
        </div>

        {/* Scrollable body */}
        <div className="px-5 pb-4 pt-1 overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {modesToShow.map((mode) => {
              const locked = isModeLocked(mode);
              return (
                <button
                  key={`${activeTab}-${mode.key}`}
                  onClick={() => handleCardClick(mode)}
                  className={`relative text-left rounded-2xl p-4 shadow-sm border transition transform hover:-translate-y-0.5 hover:shadow-xl overflow-hidden ${
                    activeTab === "elite" || mode.tier === "elite"
                      ? "bg-gradient-to-br from-violet-50 via-purple-50 to-rose-50"
                      : "bg-gradient-to-br from-rose-50 via-pink-50 to-amber-50"
                  }`}
                >
                  {/* Glow layer */}
                  <div className="pointer-events-none absolute inset-0 opacity-30 bg-gradient-to-br from-white/40 to-transparent" />

                  <div className="relative flex items-start gap-3">
                    <div className="text-2xl">{mode.emoji}</div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-gray-900">
                          {mode.title}
                        </h3>
                        {mode.tier === "elite" && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-600 text-white">
                            Elite
                          </span>
                        )}
                        {mode.tier === "plus" && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500 text-white">
                            Plus
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-gray-600 leading-snug">
                        {mode.desc}
                      </p>
                    </div>
                  </div>

                  {locked && (
                    <div className="absolute inset-0 bg-white/70 backdrop-blur-sm flex flex-col items-center justify-center text-center px-4">
                      <FaLock className="mb-1 text-gray-500" />
                      <p className="text-[11px] text-gray-700 font-medium">
                        {mode.tier === "elite"
                          ? "Unlock with RomBuzz Elite"
                          : "Unlock with RomBuzz+"}
                      </p>
                      <p className="text-[10px] text-gray-500">
                        Tap to see upgrade options.
                      </p>
                    </div>
                  )}
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
            <span className="font-semibold text-rose-500">Tip:</span> Upgrade to{" "}
            <button
              onClick={() => onUpgrade?.("plus")}
              className="underline font-semibold"
            >
              RomBuzz+
            </button>{" "}
            or{" "}
            <button
              onClick={() => onUpgrade?.("elite")}
              className="underline font-semibold"
            >
              Elite
            </button>{" "}
            later to unlock all modes permanently.
          </div>
        )}
      </div>
    </div>
  );
}
