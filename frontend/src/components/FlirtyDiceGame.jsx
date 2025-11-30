// src/components/FlirtyDiceGame.jsx
import React, { useState } from "react";

const PROMPTS = [
  "Share one thing about today that you wish we had experienced together.",
  "Tell me about a time you felt genuinely proud of yourself.",
  "Describe a small tradition you’d like us to start.",
  "Tell me something you’re quietly excited about in your life.",
  "Share a memory that still makes you smile every time.",
  "Describe your ideal slow, calm evening with me.",
  "Tell me one thing you’re learning about yourself lately.",
  "Share a quote or line that inspires you and explain why.",
  "Describe a place you’d love us to visit someday and what we’d do there.",
  "Tell me one way you’d like us to grow together.",
  "Share one thing you appreciate about the way I treat you.",
  "Tell me about a song that feels like the soundtrack to your life right now.",
   "Send your partner a flirty voice note.",
  "Describe your favorite physical feature of theirs.",
  "Tell them your hidden romantic desire.",
  "Send them a selfie looking cute right now.",
  "Describe how you'd hug them if you were together.",
  "Tell them something you've been too shy to say.",
  "Send them one compliment that will make their heart jump.",
  "Describe your dream date with them in one paragraph.",
  "Tell them one thing you want the two of you to do together soon.",
  "Send a short message that would instantly make them blush.",
];

function rollDice() {
  return 1 + Math.floor(Math.random() * 6);
}

export default function FlirtyDiceGame({ open, onClose, partnerName }) {
  const [dice, setDice] = useState({ a: null, b: null });
  const [prompt, setPrompt] = useState("");

  if (!open) return null;

  const displayName = partnerName || "your match";

  const doRoll = () => {
    const a = rollDice();
    const b = rollDice();
    const index = (a + b - 2) % PROMPTS.length;
    setDice({ a, b });
    setPrompt(PROMPTS[index].replace(/me\b/gi, displayName === "your match" ? "me" : displayName));
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="bg-slate-900 text-white w-full max-w-md rounded-2xl p-6 border border-slate-700 mx-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">🎲 Connection Dice</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-slate-800"
          >
            ✕
          </button>
        </div>

        <p className="text-sm text-slate-400 mt-2">
          Roll the dice to get a gentle prompt for you and {displayName}.
        </p>

        {/* Dice display */}
        <div className="mt-6 flex items-center justify-center gap-4 text-3xl">
          <div className="h-12 w-12 rounded-xl bg-slate-800 border border-slate-700 grid place-items-center">
            {dice.a ?? "–"}
          </div>
          <div className="h-12 w-12 rounded-xl bg-slate-800 border border-slate-700 grid place-items-center">
            {dice.b ?? "–"}
          </div>
        </div>

        {/* Prompt */}
        <div className="mt-6 min-h-[80px] text-center flex items-center justify-center">
          {prompt ? (
            <p className="text-base leading-relaxed text-slate-200">
              {prompt}
            </p>
          ) : (
            <p className="text-slate-400 text-sm">
              Tap “Roll Dice” to start.
            </p>
          )}
        </div>

        {/* Buttons */}
        <div className="mt-6 space-y-2">
          <button
            onClick={doRoll}
            className="w-full py-3 rounded-xl bg-rose-500 hover:bg-rose-600 text-white font-medium shadow"
          >
            🎲 Roll Dice
          </button>
          <button
            onClick={onClose}
            className="w-full py-2 rounded-xl border border-slate-600 text-slate-300 hover:bg-slate-800"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
