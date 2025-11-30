//src/components/StoryBuilderGame.jsx

import React, { useEffect, useState, useCallback } from "react";

const GAME_KEY = "story";

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
  segments: [],
};

export default function StoryBuilderGame({
  open,
  onClose,
  partnerName,
  socket,
  roomId,
  myId,
  peerId,
}) {
  const [state, setState] = useState(baseState);
  const [input, setInput] = useState("");

  useEffect(() => {
    if (!open) return;
    setState(baseState);
    setInput("");
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

  const addSegment = (fromMe) => {
    const text = input.trim();
    if (!text) return;

    updateState((prev) => ({
      segments: [
        ...prev.segments,
        {
          id: Date.now(),
          from: fromMe ? "me" : "them",
          text,
        },
      ],
    }));
    setInput("");
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 px-3">
      <div className="w-full max-w-md bg-slate-950/95 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between bg-gradient-to-r from-purple-500/20 via-indigo-500/15 to-rose-500/20">
          <div>
            <div className="text-xs uppercase tracking-[0.18em] text-slate-400">
              RomBuzz Couples Game
            </div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-50">
                Story Builder
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
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-3 flex-1 overflow-y-auto space-y-2">
            {state.segments.length === 0 ? (
              <p className="text-xs text-slate-400">
                Start a story together. Each of you adds one line and watch it
                get chaotic in real time.
              </p>
            ) : (
              state.segments.map((seg) => (
                <div
                  key={seg.id}
                  className={`text-sm px-3 py-1.5 rounded-2xl inline-block ${
                    seg.from === "me"
                      ? "bg-rose-500/90 text-white self-end"
                      : "bg-slate-800 text-slate-50"
                  }`}
                >
                  {seg.text}
                </div>
              ))
            )}
          </div>

          <div className="flex items-center gap-2">
            <input
              className="flex-1 px-3 py-2 rounded-2xl bg-slate-900 border border-slate-700 text-sm text-slate-50 outline-none focus:ring-2 focus:ring-rose-500/60"
              placeholder="Add the next line..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addSegment(true);
              }}
            />
            <button
              onClick={() => addSegment(true)}
              className="px-3 py-2 rounded-2xl bg-rose-500 hover:bg-rose-600 text-white text-sm font-semibold"
            >
              ➜ Add
            </button>
          </div>
        </div>

        <div className="px-4 py-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <span>Every line you add appears instantly for both of you.</span>
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
