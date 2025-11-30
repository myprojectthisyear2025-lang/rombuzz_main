// src/components/FlirtyDiceGame.jsx
import React, { useEffect, useState } from "react";

const BASE_PROMPTS = [
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
  const [userPrompts, setUserPrompts] = useState([]);
  const [newPrompt, setNewPrompt] = useState("");

  if (!open) return null;

  const displayName = partnerName || "your match";

  const personalize = (raw) => {
    if (!raw) return "";
    if (displayName === "your match") return raw;
    // simple: replace "me" → partner name when it makes sense
    return raw.replace(/\bme\b/gi, displayName);
  };

  const getAllPrompts = () => [...BASE_PROMPTS, ...userPrompts];

  // 🔁 Apply roll update from socket
  const applyRoll = ({ a, b, index }) => {
    const all = getAllPrompts();
    if (!all.length) {
      setDice({ a, b });
      setPrompt("No prompts available yet.");
      return;
    }
    const base = all[index % all.length] ?? all[0];
    setDice({ a, b });
    setPrompt(personalize(base));
  };

  // 🔁 Apply add-prompt update from socket
  const applyAddPrompt = ({ text }) => {
    const clean = String(text || "").trim();
    if (!clean) return;
    setUserPrompts((prev) => [...prev, clean]);
  };

  // 🔌 Socket listeners
  useEffect(() => {
    if (!socket || !roomId) return;

    const handler = (payload) => {
      if (!payload || payload.roomId !== roomId) return;

      if (payload.kind === "roll") {
        applyRoll(payload);
      } else if (payload.kind === "add") {
        applyAddPrompt(payload);
      }
    };

    socket.on("game:flirtydice:sync", handler);
    return () => {
      socket.off("game:flirtydice:sync", handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, roomId, displayName]);

  // 🎲 Roll (local action → synced)
  const doRoll = () => {
    const a = rollDice();
    const b = rollDice();
    const all = getAllPrompts();
    const index = all.length ? (a + b - 2) % all.length : 0;

    const payload = {
      roomId,
      from: myId,
      to: peerId,
      kind: "roll",
      a,
      b,
      index,
    };

    if (socket && roomId) {
      socket.emit("game:flirtydice:sync", payload);
    } else {
      applyRoll(payload);
    }
  };

  // ➕ Add new prompt
  const addPrompt = () => {
    const text = newPrompt.trim();
    if (!text) return;

    const payload = {
      roomId,
      from: myId,
      to: peerId,
      kind: "add",
      text,
    };

    if (socket && roomId) {
      socket.emit("game:flirtydice:sync", payload);
    } else {
      applyAddPrompt(payload);
    }
    setNewPrompt("");
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="bg-slate-900 text-white w-full max-w-md rounded-2xl p-6 border border-slate-700 mx-4 max-h-[90vh] flex flex-col">
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

        {/* Add-your-own prompt */}
        <div className="mt-4 rounded-2xl bg-slate-800/70 border border-slate-700 p-3 text-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-300">
              Add your own prompt (synced)
            </span>
          </div>
          <textarea
            rows={2}
            className="w-full rounded-xl bg-slate-900/70 border border-slate-600 px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-rose-400 resize-none"
            placeholder={`Type a custom prompt for you and ${displayName}…`}
            value={newPrompt}
            onChange={(e) => setNewPrompt(e.target.value)}
          />
          <div className="mt-2 flex justify-end">
            <button
              onClick={addPrompt}
              className="px-3 py-1 text-xs rounded-full bg-rose-500 hover:bg-rose-600 text-white"
            >
              ➕ Add prompt
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
