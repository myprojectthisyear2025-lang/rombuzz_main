// src/components/WouldYouRatherGame.jsx
import React, { useState } from "react";

const QUESTIONS = [
  {
    a: "Spend a quiet evening talking with no phones.",
    b: "Go on a spontaneous walk somewhere new together.",
  },
  {
    a: "Plan every detail of a future trip together.",
    b: "Just pick a random city and figure it out when we get there.",
  },
  {
    a: "Hear me talk about my dreams and goals.",
    b: "Share your own dreams in detail while I just listen.",
  },
  {
    a: "Have a weekly ritual together (like movie night).",
    b: "Do unplanned, random mini-adventures whenever we can.",
  },
  {
    a: "Trade three of your favorite memories.",
    b: "Trade three things you’re looking forward to.",
  },
  {
    a: "Talk about your childhood for 15 minutes.",
    b: "Talk about your ideal future for 15 minutes.",
  },
  {
    a: "Receive a long thoughtful text from me.",
    b: "Have a short but really honest voice note from me.",
  },
  {
    a: "Look through old photos together and share the stories.",
    b: "Take a bunch of new photos together and create new moments.",
  },
];

function getRandomIndex(currentIndex) {
  let idx = Math.floor(Math.random() * QUESTIONS.length);
  if (idx === currentIndex && QUESTIONS.length > 1) {
    idx = (idx + 1) % QUESTIONS.length;
  }
  return idx;
}

export default function WouldYouRatherGame({ open, onClose, partnerName }) {
  const [index, setIndex] = useState(0);

  if (!open) return null;

  const q = QUESTIONS[index];

  const next = () => setIndex((prev) => getRandomIndex(prev));

  const displayName = partnerName || "your match";

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="bg-slate-900 text-white w-full max-w-md rounded-2xl p-6 border border-slate-700 mx-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold">🤔 Would You Rather</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-slate-800"
          >
            ✕
          </button>
        </div>
        <p className="text-xs text-slate-400 mb-4">
          Take turns answering and ask follow-up questions. It’s all about
          understanding each other better.
        </p>

        <div className="space-y-3">
          <button
            className="w-full text-left rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 px-4 py-3"
          >
            <span className="block text-[11px] uppercase text-slate-400 mb-1">
              Option A
            </span>
            <span className="text-sm">{q.a}</span>
          </button>

          <button
            className="w-full text-left rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 px-4 py-3"
          >
            <span className="block text-[11px] uppercase text-slate-400 mb-1">
              Option B
            </span>
            <span className="text-sm">{q.b}</span>
          </button>
        </div>

        <div className="mt-5 space-y-2">
          <button
            onClick={next}
            className="w-full py-2.5 rounded-xl bg-rose-500 hover:bg-rose-600 text-white text-sm font-medium"
          >
            Next question
          </button>
          <button
            onClick={onClose}
            className="w-full py-2 rounded-xl border border-slate-600 text-slate-300 hover:bg-slate-800 text-sm"
          >
            Close
          </button>
        </div>

        <p className="text-[10px] text-slate-500 mt-3 text-center">
          Tip: after each answer, ask {displayName} why they chose it.
        </p>
      </div>
    </div>
  );
}
