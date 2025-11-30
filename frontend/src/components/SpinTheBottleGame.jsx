// src/components/SpinTheBottleGame.jsx
import React, { useState } from "react";

const CHALLENGES = [
  "Ask them any question you’ve been curious about but never asked.",
  "Share one thing you admire about how they handle life.",
  "Tell them about a moment when you felt genuinely understood by someone.",
  "Ask them what kind of support feels most helpful when they’re stressed.",
  "Share a memory from your life that changed how you see relationships.",
  "Tell them what kind of friend or partner you are trying to be.",
  "Ask them what makes them feel appreciated.",
  "Share a small dream you have for your future.",
  "Ask them what helps them feel calm after a long day.",
  "Share something you’re grateful for today.",
];

function randomIndex(prevIndex) {
  let idx = Math.floor(Math.random() * CHALLENGES.length);
  if (idx === prevIndex && CHALLENGES.length > 1) {
    idx = (idx + 1) % CHALLENGES.length;
  }
  return idx;
}

export default function SpinTheBottleGame({ open, onClose, partnerName }) {
  const [spinning, setSpinning] = useState(false);
  const [angle, setAngle] = useState(0);
  const [index, setIndex] = useState(0);

  if (!open) return null;

  const displayName = partnerName || "your match";

  const spin = () => {
    if (spinning) return;
    setSpinning(true);

    const newAngle = angle + 360 * 3 + Math.floor(Math.random() * 360);
    setAngle(newAngle);

    setTimeout(() => {
      setSpinning(false);
      setIndex((prev) => randomIndex(prev));
    }, 1200);
  };

  const challenge = CHALLENGES[index].replace(
    /them\b/gi,
    displayName === "your match" ? "them" : displayName
  );

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="bg-slate-900 text-white w-full max-w-md rounded-2xl p-6 border border-slate-700 mx-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold">🍾 Spin the Bottle (Chat)</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-slate-800"
          >
            ✕
          </button>
        </div>
        <p className="text-xs text-slate-400 mb-4">
          Take turns tapping the bottle. Whoever “spins” answers or does the
          challenge in chat.
        </p>

        <div className="flex flex-col items-center gap-4 mt-2">
          {/* Bottle */}
          <div className="h-28 w-28 rounded-full bg-slate-800 border border-slate-700 grid place-items-center">
            <div
              className="h-20 w-6 bg-emerald-500 rounded-full origin-bottom shadow-lg"
              style={{
                transform: `rotate(${angle}deg)`,
                transition: spinning ? "transform 1.1s ease-out" : "none",
              }}
            />
          </div>

          {/* Challenge text */}
          <div className="min-h-[70px] text-center flex items-center justify-center px-2">
            <p className="text-sm text-slate-100">{challenge}</p>
          </div>

          {/* Buttons */}
          <button
            onClick={spin}
            className="w-full py-2.5 rounded-xl bg-rose-500 hover:bg-rose-600 text-white text-sm font-medium"
          >
            {spinning ? "Spinning…" : "Spin bottle"}
          </button>
          <button
            onClick={onClose}
            className="w-full py-2 rounded-xl border border-slate-600 text-slate-300 hover:bg-slate-800 text-sm"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
