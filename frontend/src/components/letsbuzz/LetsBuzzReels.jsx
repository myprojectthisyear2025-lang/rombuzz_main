/**
 * ============================================================================
 * 📁 File: src/components/letsbuzz/LetsBuzzReels.jsx
 * 🎯 Purpose: Web LetsBuzz → Reels tab (Mobile parity)
 *
 * Mobile parity logic:
 *  - Load reels from unified feed: GET `${API_BASE}/feed`
 *  - Filter: type === "video" AND privacy in ["public","matches"]
 *  - Tap to pause/play + paused timer overlay
 *  - Mute toggle
 *  - Private comments (same endpoints as posts)
 *  - Gift picker (same as posts)
 *  - Share-to-author via chat room message
 * ============================================================================
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    FaCommentDots,
    FaGift,
    FaPaperPlane,
    FaPlay,
    FaTimes,
    FaVolumeMute,
    FaVolumeUp,
} from "react-icons/fa";
import { API_BASE } from "../../config";

const RBZ = {
  c1: "#b1123c",
  c2: "#d8345f",
  c3: "#e9486a",
  c4: "#b5179e",
};

const GIFT_OPTIONS = [
  { key: "rose", label: "Rose", emoji: "🌹" },
  { key: "heart", label: "Heart", emoji: "💖" },
  { key: "teddy", label: "Teddy", emoji: "🧸" },
  { key: "ring", label: "Ring", emoji: "💍" },
  { key: "crown", label: "Crown", emoji: "👑" },
  { key: "sparkle", label: "Sparkle", emoji: "✨" },
];

function roomIdFor(a, b) {
  return [String(a), String(b)].sort().join("_");
}
function encodeRBZSharePost(payload) {
  return `::RBZ::${JSON.stringify(payload)}`;
}
function getToken() {
  return localStorage.getItem("token") || sessionStorage.getItem("token") || "";
}
function getMeCached() {
  return JSON.parse(
    localStorage.getItem("user") || sessionStorage.getItem("user") || "{}"
  );
}
async function authHeaders() {
  const token = getToken();
  return {
    "Content-Type": "application/json",
    Authorization: token ? `Bearer ${token}` : "",
  };
}

export default function LetsBuzzReels() {
  const [loading, setLoading] = useState(true);
  const [reels, setReels] = useState([]);
  const [meId, setMeId] = useState("");

  const [activeIndex, setActiveIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [pausedAt, setPausedAt] = useState(null);
  const [muted, setMuted] = useState(false);

  // comments modal
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [activeReel, setActiveReel] = useState(null);
  const [comments, setComments] = useState([]);
  const [commentText, setCommentText] = useState("");

  // gifts
  const [giftPickerOpen, setGiftPickerOpen] = useState(false);

  const containerRef = useRef(null);
  const observerRef = useRef(null);

  const fetchMeId = useCallback(async () => {
    try {
      const h = await authHeaders();
      const r = await fetch(`${API_BASE}/users/me`, { headers: h });
      const j = await r.json();
      const id = j?.user?.id || j?.id || j?.userId || "";
      if (id) setMeId(String(id));
    } catch {
      const me = getMeCached();
      if (me?.id) setMeId(String(me.id));
    }
  }, []);

  const loadReels = useCallback(async () => {
    try {
      const h = await authHeaders();

      // mobile parity: unified feed
      const r = await fetch(`${API_BASE}/feed`, { headers: h });
      const j = await r.json();
      const list = Array.isArray(j?.posts) ? j.posts : [];

      setReels(
        list.filter((p) => {
          const type = String(p?.type || "").toLowerCase();
          const privacy = String(p?.privacy || "").toLowerCase();
          return type === "video" && (privacy === "public" || privacy === "matches");
        })
      );
    } catch (e) {
      console.error("LetsBuzzReels load error:", e);
      setReels([]);
      alert("LetsBuzz: Failed to load reels.");
    }
  }, []);

  const boot = useCallback(async () => {
    setLoading(true);
    await fetchMeId();
    await loadReels();
    setLoading(false);
  }, [fetchMeId, loadReels]);

  useEffect(() => {
    boot();

    const onCommentNew = (e) => {
      const postId = String(e?.detail?.postId || e?.postId || "");
      if (commentsOpen && activeReel?.id && String(activeReel.id) === postId) {
        openComments(activeReel);
      }
    };
    window.addEventListener("comment:new", onCommentNew);
    return () => window.removeEventListener("comment:new", onCommentNew);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // IntersectionObserver to track active reel + autoplay
  useEffect(() => {
    if (!containerRef.current) return;
    if (observerRef.current) observerRef.current.disconnect();

    const cards = containerRef.current.querySelectorAll("[data-reel-card]");
    if (!cards?.length) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        const best = entries
          .filter((x) => x.isIntersecting)
          .sort((a, b) => (b.intersectionRatio || 0) - (a.intersectionRatio || 0))[0];

        if (!best) return;

        const idx = Number(best.target.getAttribute("data-index") || 0);
        setActiveIndex(idx);

        // pause all others
        cards.forEach((el) => {
          const v = el.querySelector("video");
          if (!v) return;
          const elIdx = Number(el.getAttribute("data-index") || -1);
          if (elIdx === idx) {
            if (!paused) v.play().catch(() => {});
          } else {
            v.pause();
          }
        });
      },
      { threshold: [0.25, 0.5, 0.75, 0.9] }
    );

    cards.forEach((el) => observerRef.current.observe(el));
    return () => observerRef.current?.disconnect();
  }, [reels, paused]);

  const togglePlay = useCallback(() => {
    setPaused((p) => {
      const next = !p;
      if (next) setPausedAt(Date.now());
      else setPausedAt(null);

      // control current video instantly
      const card = containerRef.current?.querySelector(
        `[data-reel-card][data-index="${activeIndex}"]`
      );
      const v = card?.querySelector("video");
      if (v) {
        if (next) v.pause();
        else v.play().catch(() => {});
      }
      return next;
    });
  }, [activeIndex]);

  const openComments = useCallback(async (post) => {
    try {
      setActiveReel(post);
      setCommentsOpen(true);
      setCommentText("");

      const h = await authHeaders();
      const r = await fetch(`${API_BASE}/buzz/posts/${post.id}/comments`, {
        headers: h,
      });
      const j = await r.json();
      setComments(Array.isArray(j?.comments) ? j.comments : []);
    } catch {
      alert("Comments: Failed to load comments.");
    }
  }, []);

  const sendComment = useCallback(async () => {
    if (!activeReel) return;
    const text = commentText.trim();
    if (!text) return;

    try {
      const h = await authHeaders();
      const r = await fetch(`${API_BASE}/buzz/posts/${activeReel.id}/comments`, {
        method: "POST",
        headers: h,
        body: JSON.stringify({ text, parentId: null }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "comment_failed");

      const rr = await fetch(`${API_BASE}/buzz/posts/${activeReel.id}/comments`, {
        headers: h,
      });
      const jj = await rr.json();
      setComments(Array.isArray(jj?.comments) ? jj.comments : []);
      setCommentText("");
    } catch (e) {
      console.error(e);
      alert("Comments: Failed to send comment.");
    }
  }, [activeReel, commentText]);

  const openGiftPicker = useCallback((post) => {
    setActiveReel(post);
    setGiftPickerOpen(true);
  }, []);

  const sendGift = useCallback(async (giftKey) => {
    if (!activeReel) return;
    try {
      const h = await authHeaders();
      const r = await fetch(`${API_BASE}/buzz/posts/${activeReel.id}/gifts`, {
        method: "POST",
        headers: h,
        body: JSON.stringify({ giftKey, amount: 1 }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "gift_failed");
      setGiftPickerOpen(false);
    } catch {
      alert("Gift: Failed to send gift.");
    }
  }, [activeReel]);

  const shareToAuthor = useCallback(async (post) => {
    try {
      const ownerId = String(post.userId);
      if (!ownerId) return;

      const h = await authHeaders();
      const roomId = roomIdFor(meId, ownerId);

      const text = encodeRBZSharePost({
        type: "share_reel",
        postId: post.id,
        ownerId,
        mediaUrl: post.mediaUrl || "",
      });

      const r = await fetch(`${API_BASE}/chat/rooms/${roomId}/message`, {
        method: "POST",
        headers: h,
        body: JSON.stringify({ text, to: ownerId }),
      });

      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.error || "share_failed");
      }

      alert("Shared: Sent to author in chat ✅");
      window.location.href = `/chat/${ownerId}`;
    } catch (e) {
      console.error(e);
      alert("Share: Could not share to chat.");
    }
  }, [meId]);

  const pausedSeconds = useMemo(() => {
    if (!pausedAt) return 0;
    return Math.max(0, Math.floor((Date.now() - pausedAt) / 1000));
  }, [pausedAt]);

  if (loading) {
    return (
      <div className="mt-6 flex items-center justify-center py-16">
        <div className="text-white/70 font-bold">Loading reels…</div>
      </div>
    );
  }

  if (!reels.length) {
    return (
      <div className="mt-6 border border-white/10 bg-white/5 rounded-2xl p-10 text-center text-white/70">
        <div className="text-5xl mb-3">🎬</div>
        <div className="font-extrabold text-white/90">No matched reels yet</div>
        <div className="text-sm mt-2 text-white/60">
          You’ll see your matches’ reels here.
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6">
      {/* Fullscreen-ish reel container */}
      <div
        ref={containerRef}
        className="relative w-full h-[calc(100vh-190px)] overflow-y-scroll snap-y snap-mandatory rounded-2xl border border-white/10 bg-black"
        style={{ scrollbarWidth: "none" }}
      >
        <style>{`
          .no-scrollbar::-webkit-scrollbar { display: none; }
        `}</style>

        {reels.map((item, index) => {
          const u = item.user || {};
          const name = `${u.firstName || ""} ${u.lastName || ""}`.trim() || "User";
          const avatar = u.avatar || "https://via.placeholder.com/80?text=RBZ";
          const isActive = index === activeIndex;

          return (
            <div
              key={item.id}
              data-reel-card
              data-index={index}
              className="snap-start relative w-full h-[calc(100vh-190px)] flex items-center justify-center bg-black no-scrollbar"
            >
              {/* Tap layer */}
              <button
                onClick={togglePlay}
                className="absolute inset-0 z-10"
                title="Tap to pause/play"
              />

              {/* Video */}
              <video
                className="w-full h-full object-cover"
                src={item.mediaUrl || ""}
                autoPlay={isActive}
                muted={muted}
                playsInline
                loop
                onLoadedData={(e) => {
                  // if active & not paused, attempt play
                  if (isActive && !paused) {
                    e.currentTarget.play().catch(() => {});
                  }
                }}
              />

              {/* Left top user */}
              <button
                onClick={() => (window.location.href = `/viewProfile/${item.userId}`)}
                className="absolute top-4 left-4 z-20 flex items-center gap-3 bg-black/40 border border-white/10 rounded-full px-3 py-2 hover:bg-black/55 transition"
                title="View profile"
              >
                <img
                  src={avatar}
                  alt=""
                  className="w-9 h-9 rounded-full object-cover border border-white/10"
                />
                <div className="text-white font-extrabold text-sm">{name}</div>
              </button>

              {/* Right stack */}
              <div className="absolute right-4 bottom-20 z-20 flex flex-col items-center gap-3">
                <button
                  onClick={() => openGiftPicker(item)}
                  className="w-12 h-12 rounded-full bg-black/40 border border-white/10 hover:bg-black/60 text-white flex items-center justify-center transition"
                  title="Gift"
                >
                  <FaGift />
                </button>

                <button
                  onClick={() => openComments(item)}
                  className="w-12 h-12 rounded-full bg-black/40 border border-white/10 hover:bg-black/60 text-white flex items-center justify-center transition"
                  title="Comment"
                >
                  <FaCommentDots />
                </button>

                <button
                  onClick={() => shareToAuthor(item)}
                  className="w-12 h-12 rounded-full bg-black/40 border border-white/10 hover:bg-black/60 text-white flex items-center justify-center transition"
                  title="Share to author"
                >
                  <FaPaperPlane />
                </button>

                <button
                  onClick={() => setMuted((m) => !m)}
                  className="w-12 h-12 rounded-full bg-black/40 border border-white/10 hover:bg-black/60 text-white flex items-center justify-center transition"
                  title={muted ? "Unmute" : "Mute"}
                >
                  {muted ? <FaVolumeMute /> : <FaVolumeUp />}
                </button>
              </div>

              {/* Paused overlay */}
              {paused && (
                <div className="absolute inset-0 z-20 flex items-center justify-center">
                  <div
                    className="px-4 py-2 rounded-full border border-white/10 text-white font-black flex items-center gap-2"
                    style={{
                      background: `linear-gradient(90deg, ${RBZ.c1}, ${RBZ.c2}, ${RBZ.c3}, ${RBZ.c4})`,
                    }}
                  >
                    <FaPlay />
                    Paused • {pausedSeconds}s
                  </div>
                </div>
              )}

              {/* Caption */}
              {item.text?.trim() ? (
                <div className="absolute left-4 right-20 bottom-5 z-20">
                  <div className="bg-black/45 border border-white/10 rounded-2xl px-4 py-3">
                    <div className="text-white font-semibold text-sm line-clamp-2">
                      {item.text.trim()}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* Gift Picker */}
      {giftPickerOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md border border-white/10 bg-[#0b0b10] rounded-2xl overflow-hidden">
            <div
              className="p-4 flex items-center justify-between"
              style={{
                background: `linear-gradient(90deg, ${RBZ.c1}, ${RBZ.c2}, ${RBZ.c3}, ${RBZ.c4})`,
              }}
            >
              <div className="text-white font-black text-lg">Send a gift</div>
              <button
                onClick={() => setGiftPickerOpen(false)}
                className="text-white/90 hover:text-white"
              >
                <FaTimes />
              </button>
            </div>

            <div className="p-4 grid grid-cols-3 gap-3">
              {GIFT_OPTIONS.map((g) => (
                <button
                  key={g.key}
                  onClick={() => sendGift(g.key)}
                  className="border border-white/10 bg-white/5 hover:bg-white/10 rounded-2xl p-4 transition text-left"
                >
                  <div className="text-3xl">{g.emoji}</div>
                  <div className="text-white font-extrabold mt-2">{g.label}</div>
                  <div className="text-white/60 text-xs font-bold mt-1">
                    Tap to send
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Comments */}
      {commentsOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end justify-center">
          <div className="w-full max-w-2xl rounded-t-3xl border border-white/10 bg-[#0b0b10] overflow-hidden">
            <div
              className="p-4 flex items-center justify-between"
              style={{
                background: `linear-gradient(90deg, ${RBZ.c1}, ${RBZ.c2}, ${RBZ.c3}, ${RBZ.c4})`,
              }}
            >
              <div className="text-white font-black text-lg">
                Private Comments
              </div>
              <button
                onClick={() => setCommentsOpen(false)}
                className="text-white/90 hover:text-white"
              >
                <FaTimes />
              </button>
            </div>

            <div className="p-4 text-white/70 text-sm font-semibold">
              Visible only to you and the reel author.
            </div>

            <div className="px-4 pb-3 max-h-[52vh] overflow-auto">
              {comments.length === 0 ? (
                <div className="text-white/60 font-semibold py-6 text-center">
                  No comments yet.
                </div>
              ) : (
                <div className="grid gap-3">
                  {comments.map((c) => {
                    const a = c.author || {};
                    const nm =
                      `${a.firstName || ""} ${a.lastName || ""}`.trim() || "User";
                    const av = a.avatar || "https://via.placeholder.com/80?text=RBZ";
                    return (
                      <div key={c.id} className="flex gap-3">
                        <img
                          src={av}
                          alt=""
                          className="w-9 h-9 rounded-full object-cover border border-white/10"
                        />
                        <div className="flex-1 border border-white/10 bg-white/5 rounded-2xl p-3">
                          <div className="text-white font-black text-sm">{nm}</div>
                          <div className="text-white/90 font-semibold text-sm mt-1">
                            {c.text}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="p-4 border-t border-white/10 bg-black/20">
              <div className="flex gap-2">
                <input
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder="Write a private comment…"
                  className="flex-1 px-4 py-3 rounded-2xl bg-white/5 border border-white/10 text-white placeholder:text-white/40 font-semibold outline-none"
                />
                <button
                  onClick={sendComment}
                  className="px-5 py-3 rounded-2xl text-white font-black border border-white/10"
                  style={{
                    background: `linear-gradient(90deg, ${RBZ.c1}, ${RBZ.c2}, ${RBZ.c3}, ${RBZ.c4})`,
                  }}
                >
                  Send
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
