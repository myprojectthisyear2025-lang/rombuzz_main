// src/components/MemoryCardGame.jsx
import React, { useEffect, useState, useCallback } from "react";

const GAME_KEY = "memory";

const ICONS = ["💋", "❤️", "🔥", "🎧", "🍷", "🌙"];

function shuffle(array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function createDeck() {
  const cards = ICONS.flatMap((icon, idx) => [
    { id: `${idx}-a`, value: icon },
    { id: `${idx}-b`, value: icon },
  ]);
  return shuffle(cards).map((c) => ({
    ...c,
    open: false,
    matched: false,
  }));
}

function useGameChannel({ socket, roomId, myId, open, onRemote }) {
  const [partnerHere, setPartnerHere] = useState(false);

  useEffect(() => {
    if (!open) {
      setPartnerHere(false);
      return;
    }
    if (!socket || !roomId) return;

    const joinPayload = { roomId, game: GAME_KEY };

    try {
      socket.emit("game:join", joinPayload);
    } catch {}

    const handlePresence = (packet) => {
      if (!packet) return;
      const { roomId: rid, game, type, userId } = packet;
      if (rid !== roomId || game !== GAME_KEY || !userId) return;
      if (String(userId) === String(myId)) return;
      if (type === "join") setPartnerHere(true);
      if (type === "leave") setPartnerHere(false);
    };

    const handleUpdate = (packet) => {
      if (!packet) return;
      const { roomId: rid, game, from } = packet;
      if (rid !== roomId || game !== GAME_KEY) return;
      if (from && String(from) === String(myId)) return;
      onRemote?.(packet);
    };

    socket.on("game:presence", handlePresence);
    socket.on("game:update", handleUpdate);

    return () => {
      try {
        socket.emit("game:leave", joinPayload);
      } catch {}
      socket.off("game:presence", handlePresence);
      socket.off("game:update", handleUpdate);
      setPartnerHere(false);
    };
  }, [socket, roomId, myId, open, onRemote]);

  return partnerHere;
}

const baseState = {
  cards: createDeck(),
  openIds: [],
  moves: 0,
};

export default function MemoryCardGame({
  open,
  onClose,
  partnerName,
  socket,
  roomId,
  myId,
  peerId,
}) {
  const [state, setState] = useState(baseState);

  useEffect(() => {
    if (!open) return;
    setState({
      cards: createDeck(),
      openIds: [],
      moves: 0,
    });
  }, [open]);

  const applyRemote = useCallback((packet) => {
    if (packet.type === "SYNC" && packet.payload) {
      setState(packet.payload);
    }
  }, []);

  const partnerHere = useGameChannel({
    socket,
    roomId,
    myId,
    open,
    onRemote: applyRemote,
  });

  const updateState = (updater) => {
    setState((prev) => {
      const next =
        typeof updater === "function" ? updater(prev) : { ...prev, ...updater };
      if (socket && roomId) {
        socket.emit("game:action", {
          roomId,
          game: GAME_KEY,
          type: "SYNC",
          payload: next,
        });
      }
      return next;
    });
  };

  const prettyName =
    partnerName || (peerId ? "your partner" : "your match");

  const handleClickCard = (id) => {
    updateState((prev) => {
      const { cards, openIds, moves } = prev;

      if (openIds.length === 2) return prev;

      const idx = cards.findIndex((c) => c.id === id);
      if (idx === -1) return prev;
      if (cards[idx].open || cards[idx].matched) return prev;

      const newCards = cards.map((c, i) =>
        i === idx ? { ...c, open: true } : c
      );
      const newOpenIds = [...openIds, id];

      let newMoves = moves;
      let finalCards = newCards;
      let finalOpen = newOpenIds;

      if (newOpenIds.length === 2) {
        newMoves = moves + 1;
        const [idA, idB] = newOpenIds;
        const cardA = newCards.find((c) => c.id === idA);
        const cardB = newCards.find((c) => c.id === idB);

        if (cardA && cardB && cardA.value === cardB.value) {
          finalCards = newCards.map((c) =>
            c.id === idA || c.id === idB ? { ...c, matched: true } : c
          );
          finalOpen = [];
        } else {
          // we leave them open in state for now; UI will handle "flip back" UX
          finalOpen = newOpenIds;
        }
      }

      return {
        cards: finalCards,
        openIds: finalOpen,
        moves: newMoves,
      };
    });

    // local-only small delay to auto-close mismatched pair visually;
    // both ends stay in sync because we just synced full state above.
    setTimeout(() => {
      setState((prev) => {
        if (prev.openIds.length !== 2) return prev;
        const closedCards = prev.cards.map((c) =>
          c.matched ? c : { ...c, open: false }
        );
        const next = { ...prev, cards: closedCards, openIds: [] };
        if (socket && roomId) {
          socket.emit("game:action", {
            roomId,
            game: GAME_KEY,
            type: "SYNC",
            payload: next,
          });
        }
        return next;
      });
    }, 900);
  };

  const allMatched = state.cards.every((c) => c.matched);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 px-3">
      <div className="w-full max-w-md bg-slate-950/95 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between bg-gradient-to-r from-cyan-500/20 via-indigo-500/15 to-rose-500/20">
          <div>
            <div className="text-xs uppercase tracking-[0.18em] text-slate-400">
              RomBuzz Couples Game
            </div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-50">
                Memory Match
              </span>
              <span className="text-xs text-slate-400">
                with {prettyName}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {partnerHere && (
              <span className="text-[10px] px-2 py-1 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/40">
                ● Partner joined
              </span>
            )}
            <button
              onClick={onClose}
              className="h-8 w-8 rounded-full bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-200 text-sm"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="px-4 py-4 flex-1 flex flex-col gap-3">
          <div className="grid grid-cols-4 gap-2">
            {state.cards.map((card) => {
              const isOpen =
                card.open || card.matched || state.openIds.includes(card.id);
              return (
                <button
                  key={card.id}
                  onClick={() => handleClickCard(card.id)}
                  disabled={card.matched}
                  className={`h-12 rounded-xl border text-lg flex items-center justify-center transition-transform duration-150 ${
                    card.matched
                      ? "bg-emerald-600 border-emerald-400 text-white scale-95"
                      : isOpen
                      ? "bg-slate-800 border-slate-500 text-slate-50"
                      : "bg-slate-900 border-slate-700 text-slate-500 hover:bg-slate-800"
                  }`}
                >
                  {isOpen ? card.value : "?"}
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Moves: {state.moves}</span>
            {allMatched && <span>All pairs found 🎉</span>}
          </div>
        </div>

        <div className="px-4 py-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400 gap-2">
          <button
            onClick={() =>
              updateState({
                cards: createDeck(),
                openIds: [],
                moves: 0,
              })
            }
            className="px-3 py-1.5 rounded-xl border border-slate-600 text-slate-200 hover:bg-slate-800 text-xs"
          >
            Restart game
          </button>
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-xl border border-slate-600 text-slate-200 hover:bg-slate-800 text-xs"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
