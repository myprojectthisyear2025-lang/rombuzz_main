// src/components/FlirtyDiceGame.jsx
import React, { useEffect, useState } from "react";

const BUILTIN_PROMPTS = [
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

const CUSTOM_KEY = "RBZ:flirtydice:prompts";

function rollDie() {
  return 1 + Math.floor(Math.random() * 6);
}

function safeLoadCustom() {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function safeSaveCustom(arr) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(arr));
  } catch {}
}

export default function FlirtyDiceGame({
  open,
  onClose,
  partnerName,
  socket,
  roomId,
  myId,
  peerId,
}) {
  const [dice, setDice] = useState({ a: null, b: null });
  const [prompt, setPrompt] = useState("");
  const [customPrompts, setCustomPrompts] = useState(() => safeLoadCustom());
  const [newPrompt, setNewPrompt] = useState("");

  if (!open) return null;

  const displayName = partnerName || "your match";

  const personalize = (raw) => {
    if (!raw) return "";
    if (displayName === "your match") return raw;
    // Only lightly personalize 'me' references
    return raw.replace(/me\b/gi, displayName);
  };

  const allPrompts = [...BUILTIN_PROMPTS, ...customPrompts];

  const applyState = (state) => {
    if (!state) return;
    setDice({ a: state.a ?? null, b: state.b ?? null });
    setPrompt(state.prompt || "");
  };

  const broadcastState = (state) => {
    applyState(state);
    if (socket && roomId) {
      socket.emit("rbz:game:dice:state", { roomId, state: { ...state, from: myId, at: Date.now() } });
    }
  };

  const doRoll = () => {
    if (!allPrompts.length) {
      broadcastState({
        a: null,
        b: null,
        prompt: "No prompts available. Add one below to get started.",
      });
      return;
    }

    const a = rollDie();
    const b = rollDie();
    // map dice sum to prompt index
    const index = (a + b - 2) % allPrompts.length;
    const raw = allPrompts[index];
    const text = personalize(raw);

    broadcastState({ a, b, prompt: text });
  };

  // Listen for partner's dice results
  useEffect(() => {
    if (!socket || !roomId) return;

    const handler = ({ roomId: rid, state }) => {
      if (!state) return;
      if (rid && rid !== roomId) return;
      applyState(state);
    };

    socket.on("rbz:game:dice:state", handler);
    return () => {
      socket.off("rbz:game:dice:state", handler);
    };
  }, [socket, roomId]);

  const addPrompt = () => {
    const text = newPrompt.trim();
    if (!text) return;
    setCustomPrompts((prev) => {
      const next = [...prev, text];
      safeSaveCustom(next);
      return next;
    });
    setNewPrompt("");
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="bg-slate-900 text-white w-full max-w-md rounded-2xl p-6 border border-slate-700 mx-4 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">🎲 Connection Dice</h2>
            <p className="text-xs text-slate-400 mt-1">
              Roll for a shared prompt for you and {displayName}.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-slate-800"
          >
            ✕
          </button>
        </div>

        {/* Dice display */}
        <div className="mt-6 flex flex-col items-center gap-4">
          <div className="flex items-center justify-center gap-4 text-3xl">
            <div className="h-12 w-12 rounded-xl bg-slate-800 border border-slate-700 grid place-items-center">
              {dice.a ?? "–"}
            </div>
            <div className="h-12 w-12 rounded-xl bg-slate-800 border border-slate-700 grid place-items-center">
              {dice.b ?? "–"}
            </div>
          </div>
          {socket && roomId && (
            <div className="text-[10px] text-slate-500">
              Dice + prompt are synced for both of you.
            </div>
          )}
        </div>

        {/* Prompt */}
        <div className="mt-6 min-h-[80px] text-center flex items-center justify-center px-2">
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

        {/* Add custom prompt */}
        <div className="mt-4 rounded-2xl bg-slate-800/70 border border-slate-700 p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-300">
              Add your own prompt
            </span>
            <span className="text-[10px] text-slate-500">
              Saved on this device
            </span>
          </div>
          <div className="flex gap-2">
            <input
              className="flex-1 text-xs bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-rose-500"
              placeholder="Write a new flirty / deep prompt…"
              value={newPrompt}
              onChange={(e) => setNewPrompt(e.target.value)}
            />
            <button
              onClick={addPrompt}
              className="px-3 py-2 text-xs rounded-xl bg-rose-500 hover:bg-rose-600 text-white font-medium"
            >
              Add
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
