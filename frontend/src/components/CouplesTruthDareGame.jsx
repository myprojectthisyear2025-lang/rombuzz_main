// src/components/CouplesTruthDareGame.jsx
import React, { useState } from "react";

/**
 * ============================================================
 * 🎮 CouplesTruthDareGame (RomBuzz mini-game)
 *
 * - Drop-in modal component for couples / matches
 * - Truth / Dare style tasks
 * - Three intensity levels: "Cute", "Deep", "Bold"
 * - PG-13, no explicit content
 * - No backend required, pure frontend
 *
 * Props:
 *  - open: boolean           → controls visibility
 *  - onClose: () => void     → close handler
 *  - partnerName?: string    → optional, used inside prompts
 *
 * Usage (example):
 *  const [gameOpen, setGameOpen] = useState(false);
 *  <button onClick={() => setGameOpen(true)}>Open game</button>
 *  <CouplesTruthDareGame
 *    open={gameOpen}
 *    onClose={() => setGameOpen(false)}
 *    partnerName={partner.displayName}
 *  />
 * ============================================================
 */

const TASKS = {
  cute: {
    truth: [
      "What was your very first impression of me?",
      "What’s one tiny thing I do that you secretly love?",
      "If you had to describe our vibe in three words, what would they be?",
      "What’s a small memory with me that always makes you smile?",
      "What’s one thing you’re too shy to ask me, but want to?",
      "What song reminds you of me and why?",
      "What kind of date with me would feel like a perfect lazy Sunday?",
      "If you could replay one moment with me, which one would it be?",
      "What’s a tiny habit I have that you find cute?",
      "What kind of small gesture from me makes your day better?",
      "What’s a simple moment with me that you keep thinking about?",
      "What’s one thing you hope never changes between us?",
      "What is your favorite way for us to stay in touch?",
      "What song feels like our vibe and why?",
      "What is one thing you notice about me that most people probably miss?",
    ],
    dare: [
      "Send me a voice note saying something genuinely sweet.",
      "Change my contact name to something cute for the next 24 hours.",
      "Describe your idea of a perfect cozy night with me in one message.",
      "Tell me three things you appreciate about me right now.",
      "Send me a selfie that matches your current mood thinking about me.",
      "Write me a one-paragraph ‘mini love letter’ in chat.",
      "Share a song with me that you think I’ll love and tell me why.",
      "Tell me one thing you want us to experience together this year.",
      "Send me three genuine compliments in separate messages.",
      "Share a song and tell me why you picked it for us.",
      "Describe your ideal cozy day with me from morning to night.",
      "Send me a selfie that matches your current mood.",
      "Tell me one thing you appreciate about yourself today.",
      "Share a small goal you want us to achieve together.",
      "Describe a moment from your week that you wish I was there for.",
      "Write a short ‘thank you’ message to me as if today was a special day.",
    ],
  },
  deep: {
    truth: [
      "What kind of support feels the most meaningful to you?",
      "What’s something you’re working on improving about yourself?",
      "What does ‘feeling safe with someone’ mean to you?",
      "What is one value you really want to protect in any relationship?",
      "What’s a small fear you rarely talk about?",
      "What kind of future moment with me are you quietly hoping for?",
      "What makes you feel listened to and understood?",
      "What’s one lesson from your past that you want to bring into this connection?",
    ],
    dare: [
      "Describe how you’d like us to handle misunderstandings or conflict.",
      "Share one honest boundary you’d like me to know and respect.",
      "Tell me about a person who inspired your idea of a healthy relationship.",
      "Share one thing you genuinely admire about how I handle life.",
      "Describe, in detail, a future day with me that feels peaceful and grounded.",
      "Tell me one honest expectation you have from people close to you.",
      "Write a short message about how you want us to treat each other going forward.",
      "Share one thing you’re proud of yourself for recently.",
    ],
  },
  bold: {
    truth: [
      "What’s the most flirty thing you’ve wanted to say to me but didn’t?",
      "When do you find me the most attractive?",
      "What kind of date with me would definitely give you butterflies?",
      "What’s a bold move you’ve imagined making with me?",
      "What’s your favorite way for someone to flirt with you?",
      "What’s one ‘slightly dangerous’ thought you’ve had about us?",
      "If tonight had to end with a memorable moment, what would you want it to be?",
      "What’s one thing you really want to explore with me as we grow closer?",
    ],
    dare: [
      "Send me one message that’s more flirty than you’re usually comfortable with.",
      "Describe, in detail, a date with me that would make you blush—but keep it PG-13.",
      "Tell me one fantasy date idea with me that you’ve never told anyone.",
      "Send me three short texts that would totally catch my attention if I was distracted.",
      "Admit one thing about me that turns your brain into ‘crush mode’.",
      "Tell me what kind of kiss fits our vibe—without actually saying the word ‘kiss’.",
      "Describe how you’d hold me if we were watching a movie together.",
      "Tell me one thing you’d do on a spontaneous late-night adventure with me.",
    ],
  },
};

const LEVELS = [
  { key: "cute", label: "Cute", icon: "🧁" },
  { key: "deep", label: "Deep", icon: "🌙" },
  { key: "bold", label: "Bold", icon: "🔥" },
];

function getRandomItem(arr) {
  if (!arr || arr.length === 0) return null;
  const index = Math.floor(Math.random() * arr.length);
  return arr[index];
}

export default function CouplesTruthDareGame({ open, onClose, partnerName }) {
  const [level, setLevel] = useState("cute"); // "cute" | "deep" | "bold"
  const [lastType, setLastType] = useState("truth"); // "truth" | "dare"
  const [currentText, setCurrentText] = useState("");
  const [currentType, setCurrentType] = useState("truth");

  if (!open) return null;

  const displayName = partnerName || "your match";

  const personalize = (raw) => {
    if (!raw) return "";
    // If we don't know the name, keep generic text
    if (displayName === "your match") return raw;

    let t = raw;
    // Replace phrases first
    t = t.replace(/with me/gi, `with ${displayName}`);
    t = t.replace(/\b(your match|your partner)\b/gi, displayName);
    // Then fallback 'me' → name (keeps it PG-13, just more personal)
    t = t.replace(/\bme\b/gi, displayName);
    return t;
  };

  const drawCard = (type) => {
    const safeType = type === "dare" ? "dare" : "truth";
    const pool = TASKS[level]?.[safeType];
    const text = getRandomItem(pool);

    if (!text) {
      setCurrentText(
        "No cards left for this mode. Try switching level or type."
      );
      setCurrentType(safeType);
      setLastType(safeType);
      return;
    }

    const personalized = personalize(text);

    setCurrentText(personalized);
    setCurrentType(safeType);
    setLastType(safeType);
  };

  const drawRandom = () => {
    const type = Math.random() < 0.5 ? "truth" : "dare";
    drawCard(type);
  };

  const levelLabel =
    level === "bold" ? "Bold" : level === "deep" ? "Deep" : "Cute";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-slate-900 text-slate-50 shadow-xl border border-slate-700 mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
          <div>
            <h2 className="text-lg font-semibold">Truth or Dare</h2>
            <p className="text-xs text-slate-400">
              For you and{" "}
              {displayName === "your match" ? "your match" : displayName}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-slate-800 transition"
          >
            <span className="text-sm">✕</span>
          </button>
        </div>

        {/* Level selector */}
        <div className="px-4 pt-3 flex gap-2">
          {LEVELS.map(({ key, label, icon }) => (
            <button
              key={key}
              onClick={() => setLevel(key)}
              className={`flex-1 px-3 py-2 text-xs rounded-full border transition ${
                level === key
                  ? key === "bold"
                    ? "bg-rose-500/20 border-rose-400 text-rose-200"
                    : key === "deep"
                    ? "bg-indigo-500/20 border-indigo-400 text-indigo-200"
                    : "bg-pink-500/20 border-pink-400 text-pink-200"
                  : "bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-800/70"
              }`}
            >
              {icon} {label}
            </button>
          ))}
        </div>

        {/* Type selector */}
        <div className="px-4 pt-3 flex gap-2">
          <button
            onClick={() => drawCard("truth")}
            className={`flex-1 px-3 py-2 text-sm rounded-full border transition ${
              lastType === "truth"
                ? "bg-sky-500/20 border-sky-400 text-sky-200"
                : "bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-800/70"
            }`}
          >
            💬 Truth
          </button>
          <button
            onClick={() => drawCard("dare")}
            className={`flex-1 px-3 py-2 text-sm rounded-full border transition ${
              lastType === "dare"
                ? "bg-amber-500/20 border-amber-400 text-amber-200"
                : "bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-800/70"
            }`}
          >
            🎲 Dare
          </button>
          <button
            onClick={drawRandom}
            className="flex-1 px-3 py-2 text-xs rounded-full border border-violet-400 bg-violet-500/20 text-violet-100 hover:bg-violet-500/30 transition"
          >
            🔀 Random
          </button>
        </div>

        {/* Card */}
        <div className="px-4 py-4 flex-1 overflow-y-auto">
          <div className="rounded-2xl bg-slate-800/80 border border-slate-700 p-4 min-h-[130px] flex flex-col justify-between">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs uppercase tracking-wide text-slate-400">
                {currentType === "dare" ? "Dare" : "Truth"} • {levelLabel}
              </span>
            </div>
            <p className="text-sm leading-relaxed text-slate-100">
              {currentText
                ? currentText
                : "Tap Truth, Dare, or Random to draw your first card."}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 pb-4 flex items-center justify-between gap-2 border-t border-slate-800">
          <button
            onClick={onClose}
            className="flex-1 px-3 py-2 text-xs rounded-full border border-slate-600 text-slate-300 hover:bg-slate-800 transition"
          >
            Close
          </button>
          <button
            onClick={() => drawCard(lastType)}
            className="flex-1 px-3 py-2 text-xs rounded-full bg-pink-500 hover:bg-pink-600 text-white font-medium shadow-sm transition"
          >
            Next {lastType === "dare" ? "Dare" : "Truth"}
          </button>
        </div>
      </div>
    </div>
  );
}
