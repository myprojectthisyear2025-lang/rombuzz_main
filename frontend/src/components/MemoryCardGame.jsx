// src/components/MemoryCardGame.jsx
import React, { useEffect, useState } from "react";

const PAIRS = ["🌙", "🌲", "🎧", "📚", "☕", "🎈"];

function shuffledDeck() {
  const deck = [...PAIRS, ...PAIRS].map((value, index) => ({
    id: index,
    value,
    matched: false,
  }));
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export default function MemoryCardGame({ open, onClose, partnerName }) {
  const [cards, setCards] = useState(shuffledDeck);
  const [flipped, setFlipped] = useState([]); // [id, id]
  const [lock, setLock] = useState(false);
  const [moves, setMoves] = useState(0);

  useEffect(() => {
    if (flipped.length === 2) {
      setLock(true);
      const [id1, id2] = flipped;
      const c1 = cards.find((c) => c.id === id1);
      const c2 = cards.find((c) => c.id === id2);
      if (c1 && c2 && c1.value === c2.value) {
        setTimeout(() => {
          setCards((prev) =>
            prev.map((c) =>
              c.id === id1 || c.id === id2 ? { ...c, matched: true } : c
            )
          );
          setFlipped([]);
          setLock(false);
        }, 400);
      } else {
        setTimeout(() => {
          setFlipped([]);
          setLock(false);
        }, 700);
      }
      setMoves((m) => m + 1);
    }
  }, [flipped, cards]);

  if (!open) return null;

  const reset = () => {
    setCards(shuffledDeck());
    setFlipped([]);
    setMoves(0);
    setLock(false);
  };

  const handleFlip = (id) => {
    if (lock) return;
    if (flipped.includes(id)) return;
    const card = cards.find((c) => c.id === id);
    if (!card || card.matched) return;
    if (flipped.length === 2) return;
    setFlipped((prev) => [...prev, id]);
  };

  const allMatched = cards.every((c) => c.matched);
  const displayName = partnerName || "your match";

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="bg-slate-900 text-white w-full max-w-md rounded-2xl p-6 border border-slate-700 mx-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold">🧠 Memory Match</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-slate-800"
          >
            ✕
          </button>
        </div>
        <p className="text-xs text-slate-400 mb-4">
          Take turns choosing cards. See who finds more pairs: you or{" "}
          {displayName === "your match" ? "your match" : displayName}.
        </p>

        {/* Grid */}
        <div className="grid grid-cols-4 gap-2 mb-4">
          {cards.map((card) => {
            const isOpen =
              card.matched || flipped.includes(card.id);
            return (
              <button
                key={card.id}
                onClick={() => handleFlip(card.id)}
                className={`h-14 rounded-xl border text-2xl flex items-center justify-center transition 
                  ${
                    card.matched
                      ? "bg-emerald-500/20 border-emerald-400 text-emerald-200"
                      : isOpen
                      ? "bg-slate-700 border-slate-500"
                      : "bg-slate-800 border-slate-700"
                  }`}
              >
                {isOpen ? card.value : "?"}
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between text-xs text-slate-400 mb-3">
          <span>Moves: {moves}</span>
          {allMatched && <span>All pairs found 🎉</span>}
        </div>

        <div className="space-y-2">
          <button
            onClick={reset}
            className="w-full py-2.5 rounded-xl bg-rose-500 hover:bg-rose-600 text-white text-sm font-medium"
          >
            Restart game
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
