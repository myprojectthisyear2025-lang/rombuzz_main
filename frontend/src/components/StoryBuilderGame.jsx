// src/components/StoryBuilderGame.jsx
import React, { useState } from "react";

const PROMPTS = [
  "Two people who almost never talk end up on the same train seat every day.",
  "Someone receives a message from their future self with one short piece of advice.",
  "Two strangers keep crossing paths in the most unexpected places.",
  "A quiet weekend plan suddenly turns into an unplanned adventure.",
  "Someone moves to a new city and makes one surprising connection.",
  "A simple shared hobby accidentally brings two people much closer.",
  "Two people agree to try saying 'yes' to small opportunities for one week.",
  "Someone finds an old photo that changes how they see a familiar person.",
];

export default function StoryBuilderGame({ open, onClose, partnerName }) {
  const [index, setIndex] = useState(0);
  const [round, setRound] = useState(1);

  if (!open) return null;

  const base = PROMPTS[index];
  const displayName = partnerName || "your match";

  const nextPrompt = () => {
    setIndex((prev) => (prev + 1) % PROMPTS.length);
    setRound(1);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="bg-slate-900 text-white w-full max-w-md rounded-2xl p-6 border border-slate-700 mx-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold">📖 Story Builder</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-slate-800"
          >
            ✕
          </button>
        </div>
        <p className="text-xs text-slate-400 mb-4">
          Take turns adding one line to the story in chat. You and{" "}
          {displayName === "your match" ? "your match" : displayName} are
          co-authors.
        </p>

        <div className="rounded-xl bg-slate-800 border border-slate-700 p-4 space-y-3">
          <div>
            <div className="text-[11px] uppercase text-slate-400 mb-1">
              Story seed
            </div>
            <p className="text-sm text-slate-100">{base}</p>
          </div>
          <div>
            <div className="text-[11px] uppercase text-slate-400 mb-1">
              How to play
            </div>
            <ul className="text-xs text-slate-300 list-disc list-inside space-y-1">
              <li>One of you writes the first line in chat.</li>
              <li>The other continues with the next line.</li>
              <li>Keep going for 6–10 lines and see where it ends up.</li>
            </ul>
          </div>
        </div>

        <div className="mt-5 space-y-2">
          <button
            onClick={() => setRound((r) => r + 1)}
            className="w-full py-2.5 rounded-xl bg-rose-500 hover:bg-rose-600 text-white text-sm font-medium"
          >
            Mark next round ({round + 1})
          </button>
          <button
            onClick={nextPrompt}
            className="w-full py-2 rounded-xl border border-slate-600 text-slate-300 hover:bg-slate-800 text-sm"
          >
            New story seed
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
