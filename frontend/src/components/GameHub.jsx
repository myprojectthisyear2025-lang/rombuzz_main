// src/components/GameHub.jsx
import React from "react";

export default function GameHub({ open, onClose, onSelect }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="bg-slate-900 text-white w-full max-w-md rounded-2xl p-5 border border-slate-700 mx-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Pick a game</h2>
          <button
            className="p-2 rounded-full hover:bg-slate-800"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <p className="text-xs text-slate-400 mb-3">
          All games are light, friendly and designed to help you two connect.
        </p>

        <div className="space-y-3 text-sm">
          <button
            onClick={() => onSelect("truthdare")}
            className="w-full bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl p-3 text-left"
          >
            <div className="font-semibold">🧁 Truth or Dare</div>
            <div className="text-slate-400">
              Answer thoughtful questions or do sweet, low-pressure dares.
            </div>
          </button>

          <button
            onClick={() => onSelect("flirtydice")}
            className="w-full bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl p-3 text-left"
          >
            <div className="font-semibold">🎲 Connection Dice</div>
            <div className="text-slate-400">
              Roll for gentle prompts that build comfort and chemistry.
            </div>
          </button>

          <button
            onClick={() => onSelect("wyr")}
            className="w-full bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl p-3 text-left"
          >
            <div className="font-semibold">🤔 Would You Rather</div>
            <div className="text-slate-400">
              Choose between cozy scenarios and learn each other’s taste.
            </div>
          </button>

          <button
            onClick={() => onSelect("bottle")}
            className="w-full bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl p-3 text-left"
          >
            <div className="font-semibold">🍾 Spin the Bottle (Chat)</div>
            <div className="text-slate-400">
              A virtual bottle that lands on simple conversation challenges.
            </div>
          </button>

          <button
            onClick={() => onSelect("story")}
            className="w-full bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl p-3 text-left"
          >
            <div className="font-semibold">📖 Story Builder</div>
            <div className="text-slate-400">
              Build a tiny story together, one line at a time.
            </div>
          </button>

          <button
            onClick={() => onSelect("memory")}
            className="w-full bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl p-3 text-left"
          >
            <div className="font-semibold">🧠 Memory Match</div>
            <div className="text-slate-400">
              Flip cards and see who has the sharper memory today.
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
