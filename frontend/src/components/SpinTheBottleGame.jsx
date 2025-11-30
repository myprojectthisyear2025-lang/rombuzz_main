import React, { useEffect, useState, useCallback } from "react";

const GAME_KEY = "bottle";

const ACTIONS = [
  "Describe in detail your perfect kiss with {{name}}.",
  "Share a secret you’ve never told {{name}}.",
  "Let {{name}} ask you any question (you must answer honestly).",
  "Tell {{name}} the first thing that attracted you to them.",
  "Describe how you’d plan a surprise date for {{name}}.",
  "Share your favorite memory together so far.",
  "Compliment {{name}} in the most dramatic way possible.",
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
  angle: 0,
  action: "",
};

export default function SpinTheBottleGame({
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

  const spin = () => {
    const angle = 360 * 3 + Math.floor(Math.random() * 360);
    const raw =
      ACTIONS[Math.floor(Math.random() * ACTIONS.length)];
    const action = raw.replace(/{{name}}/g, prettyName);

    updateState({ angle, action });
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 px-3">
      <div className="w-full max-w-md bg-slate-950/95 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between bg-gradient-to-r from-emerald-500/20 via-blue-500/15 to-rose-500/20">
          <div>
            <div className="text-xs uppercase tracking-[0.18em] text-slate-400">
              RomBuzz Couples Game
            </div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-50">
                Spin the Bottle
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

        <div className="px-4 py-4 flex-1 flex flex-col gap-4 items-center">
          <div className="mt-2 h-40 w-40 rounded-full border-4 border-rose-500/60 bg-slate-900 flex items-center justify-center shadow-xl shadow-rose-500/25">
            <div
              className="relative h-24 w-24 rounded-full bg-gradient-to-br from-rose-500 to-amber-400 flex items-center justify-center"
              style={{
                transform: `rotate(${state.angle}deg)`,
                transition: "transform 1s cubic-bezier(0.3, 1.2, 0.2, 1)",
              }}
            >
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 h-4 w-4 bg-white rounded-full shadow-md" />
              <span className="text-xl text-white">🍷</span>
            </div>
          </div>

          <button
            onClick={spin}
            className="w-full py-2.5 rounded-2xl bg-rose-500 hover:bg-rose-600 text-white font-semibold text-sm shadow-lg shadow-rose-500/30"
          >
            🔄 Spin the bottle
          </button>

          <div className="w-full bg-slate-900 border border-slate-700 rounded-2xl p-3 text-sm text-slate-50 min-h-[80px]">
            {state.action ? (
              state.action
            ) : (
              <span className="text-slate-400">
                Tap <strong>Spin the bottle</strong> and follow what it says
                together.
              </span>
            )}
          </div>
        </div>

        <div className="px-4 py-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <span>The spin + dare are synced for both of you.</span>
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
