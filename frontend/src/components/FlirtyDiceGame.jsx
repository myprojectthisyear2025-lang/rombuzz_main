// src/components/FlirtyDiceGame.jsx
import React, { useState } from "react";

/**
 * ============================================================
 * 🎲 FlirtyDiceGame (RomBuzz mini-game)
 *
 * - Dice-based prompt game for couples / matches
 * - Roll 2 dice → get a combined index → receive a prompt
 * - PG-13 and safe for App Store / Play Store
 * - Users can add custom prompts (stored in localStorage)
 *
 * Props:
 *  - open: boolean
 *  - onClose: () => void
 *  - partnerName?: string
 * ============================================================
 */

const DEFAULT_PROMPTS = [
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

// Load custom prompts safely
function loadCustomPrompts() {
  try {
    const raw = localStorage.getItem("RBZ:dicegame:customPrompts");
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default function FlirtyDiceGame({ open, onClose, partnerName }) {
  const [dice, setDice] = useState({ a: null, b: null });
  const [prompt, setPrompt] = useState("");
  const [customPrompts, setCustomPrompts] = useState(loadCustomPrompts());
  const [newPrompt, setNewPrompt] = useState("");

  if (!open) return null;

  const displayName = partnerName || "your match";

  const saveCustom = (list) => {
    setCustomPrompts(list);
    try {
      localStorage.setItem("RBZ:dicegame:customPrompts", JSON.stringify(list));
    } catch {}
  };

  const allPrompts = [...DEFAULT_PROMPTS, ...customPrompts];

  const doRoll = () => {
    const a = 1 + Math.floor(Math.random() * 6);
    const b = 1 + Math.floor(Math.random() * 6);

    const index = (a + b - 2) % allPrompts.length;

    let text = allPrompts[index];

    // Personalize
    if (displayName !== "your match") {
      text = text.replace(/\bme\b/gi, displayName);
    }

    setDice({ a, b });
    setPrompt(text);
  };

  const handleAddPrompt = () => {
    const trimmed = newPrompt.trim();
    if (!trimmed) return;

    const next = [...customPrompts, trimmed];
    saveCustom(next);
    setNewPrompt("");
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="bg-slate-900 text-white w-full max-w-md rounded-2xl p-6 border border-slate-700 mx-4 max-h-[92vh] flex flex-col">

        {/* Header */}
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
          Roll the dice for a meaningful or flirty moment with {displayName}.
        </p>

        {/* Dice Display */}
        <div className="mt-6 flex items-center justify-center gap-4 text-3xl">
          <div className="h-12 w-12 rounded-xl bg-slate-800 border border-slate-700 grid place-items-center">
            {dice.a ?? "–"}
          </div>
          <div className="h-12 w-12 rounded-xl bg-slate-800 border border-slate-700 grid place-items-center">
            {dice.b ?? "–"}
          </div>
        </div>

        {/* Prompt */}
        <div className="mt-6 min-h-[80px] text-center flex items-center justify-center px-2">
          {prompt ? (
            <p className="text-base leading-relaxed text-slate-200">
              {prompt}
            </p>
          ) : (
            <p className="text-slate-400 text-sm">Tap “Roll Dice” to begin.</p>
          )}
        </div>

        {/* Custom Prompt Editor */}
        <div className="mt-4 p-3 rounded-xl bg-slate-900/60 border border-slate-700">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-slate-400">
              ✨ Add your own prompts
            </span>
            <span className="text-[11px] text-slate-500">
              {customPrompts.length} saved
            </span>
          </div>

          <textarea
            rows={2}
            className="w-full text-xs rounded-xl bg-slate-900 border border-slate-700 px-3 py-2 text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-rose-500/70"
            placeholder="Write a custom prompt…"
            value={newPrompt}
            onChange={(e) => setNewPrompt(e.target.value)}
          />

          <div className="mt-2 flex justify-end">
            <button
              onClick={handleAddPrompt}
              className="px-3 py-1.5 rounded-full bg-rose-500 hover:bg-rose-600 text-white text-xs font-medium shadow"
            >
              ➕ Add Prompt
            </button>
          </div>
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
