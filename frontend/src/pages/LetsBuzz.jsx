/**
 * ============================================================================
 * 📁 File: src/pages/LetsBuzz.jsx
 * 🎯 Purpose: Web LetsBuzz (Mobile parity) — 2 tabs: Posts + Reels
 *
 * Mobile parity:
 *  - Posts tab: GET  `${API_BASE}/posts/matches` (images only)
 *  - Reels tab: GET  `${API_BASE}/feed` (filter type === "video", privacy public/matches)
 *  - Comments: GET/POST/PATCH/DELETE `${API_BASE}/buzz/posts/:id/comments...`
 *  - Gifts: POST `${API_BASE}/buzz/posts/:id/gifts`
 *  - Gift Insights: GET `${API_BASE}/buzz/posts/:id/gifts/summary`
 *  - Share to author (chat): POST `${API_BASE}/chat/rooms/:roomId/message`
 * ============================================================================
 */

import { useMemo, useState } from "react";
import { FaFireAlt, FaImages, FaPlay } from "react-icons/fa";
import LetsBuzzPosts from "../components/letsbuzz/LetsBuzzPosts";
import LetsBuzzReels from "../components/letsbuzz/LetsBuzzReels";

const RBZ = {
  c1: "#b1123c",
  c2: "#d8345f",
  c3: "#e9486a",
  c4: "#b5179e",
};

export default function LetsBuzz() {
  const [tab, setTab] = useState("posts"); // "posts" | "reels"

  const TabBar = useMemo(() => {
    return (
      <div className="sticky top-0 z-30 bg-black/60 backdrop-blur-xl border-b border-white/10">
        <div className="max-w-5xl mx-auto px-4 pt-5 pb-4">
          {/* Header */}
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="text-white text-2xl font-black tracking-tight">
                Let&apos;sBuzz
              </div>
              <div className="text-white/70 text-sm font-semibold">
                Matched feed only
              </div>
            </div>

            <div className="hidden sm:flex items-center gap-2 text-white/70 text-xs font-bold">
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{
                  background: `linear-gradient(90deg, ${RBZ.c1}, ${RBZ.c2}, ${RBZ.c3}, ${RBZ.c4})`,
                }}
              />
              
            </div>
          </div>

          {/* Tabs */}
          <div className="mt-4 p-[3px] rounded-2xl border border-white/10">
            <div
              className="rounded-2xl p-1 flex gap-1"
              style={{
                background: `linear-gradient(90deg, ${RBZ.c1}, ${RBZ.c2}, ${RBZ.c3}, ${RBZ.c4})`,
              }}
            >
              <button
                onClick={() => setTab("posts")}
                className={`flex-1 rounded-xl py-2.5 font-extrabold tracking-tight flex items-center justify-center gap-2 transition ${
                  tab === "posts"
                    ? "bg-black/35 text-white border border-white/10"
                    : "text-white/90 hover:bg-black/20"
                }`}
              >
                <FaImages /> Posts
              </button>

              <button
                onClick={() => setTab("reels")}
                className={`flex-1 rounded-xl py-2.5 font-extrabold tracking-tight flex items-center justify-center gap-2 transition ${
                  tab === "reels"
                    ? "bg-black/35 text-white border border-white/10"
                    : "text-white/90 hover:bg-black/20"
                }`}
              >
                <FaPlay /> Reels
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }, [tab]);

  return (
    <div className="min-h-screen bg-[#07070b]">
      {/* subtle gradient glow */}
      <div
        className="pointer-events-none fixed inset-0 opacity-40"
        style={{
          background: `radial-gradient(800px 300px at 20% 0%, ${RBZ.c2}33, transparent),
                       radial-gradient(700px 260px at 80% 10%, ${RBZ.c4}33, transparent),
                       radial-gradient(600px 240px at 50% 100%, ${RBZ.c1}22, transparent)`,
        }}
      />
      {TabBar}

      <div className="relative max-w-5xl mx-auto px-4 pb-16">
        {tab === "posts" ? <LetsBuzzPosts /> : <LetsBuzzReels />}

        {/* tiny footer vibe */}
        <div className="mt-10 flex items-center justify-center gap-2 text-white/40 text-xs font-bold">
          <FaFireAlt />
          <span>RomBuzz • LetsBuzz</span>
        </div>
      </div>
    </div>
  );
}
