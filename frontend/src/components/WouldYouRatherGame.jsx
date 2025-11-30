import React, { useEffect, useState, useCallback } from "react";

const GAME_KEY = "wyr";

const QUESTIONS = [
  [
    "Would you rather have a cozy night in with movies and snacks",
    "or a spontaneous night drive with loud music?",
  ],
  [
    "Would you rather receive a heartfelt love letter",
    "or a surprise date planned just for you?",
  ],
  [
    "Would you rather travel the world together",
    "or build your dream home together?",
  ],
  [
    "Would you rather cuddle in silence",
    "or talk for hours about everything?",
  ],
  [
    "Would you rather have one perfect, unforgettable date",
    "or many small, cute moments every day?",
  ],
  [
    "Would you rather know all of their secrets",
    "or keep a little mystery forever?",
  ],
];

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
  index: 0,
};

export default function WouldYouRatherGame({
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
    setState(baseState);
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

  const nextQuestion = () => {
    updateState((prev) => ({
      index: (prev.index + 1) % QUESTIONS.length,
    }));
  };

  if (!open) return null;

  const [a, b] = QUESTIONS[state.index];

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 px-3">
      <div className="w-full max-w-md bg-slate-950/95 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between bg-gradient-to-r from-amber-500/20 via-rose-500/15 to-indigo-500/20">
          <div>
            <div className="text-xs uppercase tracking-[0.18em] text-slate-400">
              RomBuzz Couples Game
            </div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-50">
                Would You Rather
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

        <div className="px-4 py-5 flex-1 flex flex-col gap-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-4 space-y-3">
            <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
              Question {state.index + 1} / {QUESTIONS.length}
            </div>
            <button className="w-full text-left px-3 py-2.5 rounded-2xl bg-slate-950 border border-slate-700 hover:border-amber-400 text-sm text-slate-50">
              {a}?
            </button>
            <button className="w-full text-left px-3 py-2.5 rounded-2xl bg-slate-950 border border-slate-700 hover:border-rose-400 text-sm text-slate-50">
              {b}?
            </button>
          </div>

          <button
            onClick={nextQuestion}
            className="w-full py-2.5 rounded-2xl bg-rose-500 hover:bg-rose-600 text-white font-semibold text-sm shadow-lg shadow-rose-500/30"
          >
            ➜ Next question
          </button>

          <p className="text-xs text-slate-400">
            You both see the same question. Count down 3-2-1 and answer at the
            same time.
          </p>
        </div>

        <div className="px-4 py-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <span>Perfect for late-night “what if” chats.</span>
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
