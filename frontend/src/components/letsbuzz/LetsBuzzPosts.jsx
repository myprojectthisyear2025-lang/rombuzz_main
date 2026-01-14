/**
 * ============================================================================
 * 📁 File: src/components/letsbuzz/LetsBuzzPosts.jsx
 * 🎯 Purpose: Web LetsBuzz → Posts tab (Mobile parity)
 *
 * Mobile parity logic:
 *  - Load posts from: GET `${API_BASE}/posts/matches`
 *  - Keep only image posts (exclude video)
 *  - Private comments: GET/POST/PATCH/DELETE `${API_BASE}/buzz/posts/:id/comments...`
 *  - Gifts:
 *      - Send:  POST `${API_BASE}/buzz/posts/:id/gifts` { giftKey, amount: 1 }
 *      - Summary/insights: GET `${API_BASE}/buzz/posts/:id/gifts/summary`
 *  - Share to author chat:
 *      - roomId = sort(meId, ownerId).join("_")
 *      - POST `${API_BASE}/chat/rooms/:roomId/message` { text, to: ownerId }
 * ============================================================================
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    FaCommentDots,
    FaGift,
    FaPaperPlane,
    FaSyncAlt,
    FaTimes,
    FaUser,
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

export default function LetsBuzzPosts() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [posts, setPosts] = useState([]);
  const [meId, setMeId] = useState("");

  // comments state
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [activePost, setActivePost] = useState(null);
  const [comments, setComments] = useState([]);
  const [commentText, setCommentText] = useState("");
  const [replyTo, setReplyTo] = useState(null);
  const [editing, setEditing] = useState(null);

  // gifts state
  const [giftPickerOpen, setGiftPickerOpen] = useState(false);
  const [giftInsightsOpen, setGiftInsightsOpen] = useState(false);
  const [giftSummary, setGiftSummary] = useState(null);

  // small per-post gift count cache (like mobile)
  const giftTotalByPostRef = useRef({});

  const fetchMeId = useCallback(async () => {
    try {
      const h = await authHeaders();
      const r = await fetch(`${API_BASE}/users/me`, { headers: h });
      const j = await r.json();
      const id = j?.user?.id || j?.id || j?.userId || "";
      if (id) setMeId(String(id));
    } catch {
      // fallback to cached user
      const me = getMeCached();
      if (me?.id) setMeId(String(me.id));
    }
  }, []);

  const loadPosts = useCallback(async () => {
    try {
      const h = await authHeaders();
      const r = await fetch(`${API_BASE}/posts/matches`, { headers: h });
      const j = await r.json();
      const list = Array.isArray(j?.posts)
        ? j.posts
        : Array.isArray(j)
        ? j
        : [];
      // keep only non-video posts for this tab (mobile parity)
      setPosts(list.filter((p) => (p.type || "image") !== "video"));
    } catch (e) {
      console.error("LetsBuzzPosts load error:", e);
      setPosts([]);
      alert("LetsBuzz: Failed to load posts.");
    }
  }, []);

  const loadGiftSummary = useCallback(async (postId) => {
    const h = await authHeaders();
    const r = await fetch(`${API_BASE}/buzz/posts/${postId}/gifts/summary`, {
      headers: h,
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j?.error || "gift_summary_failed");
    giftTotalByPostRef.current[postId] = Number(j?.total || 0);
    return j;
  }, []);

  const openComments = useCallback(async (post) => {
    try {
      setActivePost(post);
      setCommentsOpen(true);
      setReplyTo(null);
      setEditing(null);
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
    if (!activePost) return;
    const text = commentText.trim();
    if (!text) return;

    try {
      const h = await authHeaders();

      if (editing) {
        const r = await fetch(
          `${API_BASE}/buzz/posts/${activePost.id}/comments/${editing.id}`,
          { method: "PATCH", headers: h, body: JSON.stringify({ text }) }
        );
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error || "edit_failed");
        setEditing(null);
        setCommentText("");
      } else {
        const r = await fetch(`${API_BASE}/buzz/posts/${activePost.id}/comments`, {
          method: "POST",
          headers: h,
          body: JSON.stringify({ text, parentId: replyTo ? replyTo.id : null }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error || "comment_failed");
        setReplyTo(null);
        setCommentText("");
      }

      const rr = await fetch(`${API_BASE}/buzz/posts/${activePost.id}/comments`, {
        headers: h,
      });
      const jj = await rr.json();
      setComments(Array.isArray(jj?.comments) ? jj.comments : []);
    } catch (e) {
      console.error(e);
      alert("Comments: Failed to send.");
    }
  }, [activePost, commentText, replyTo, editing]);

  const deleteComment = useCallback(
    async (c) => {
      if (!activePost) return;
      try {
        const h = await authHeaders();
        const r = await fetch(
          `${API_BASE}/buzz/posts/${activePost.id}/comments/${c.id}`,
          { method: "DELETE", headers: h }
        );
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error || "delete_failed");

        const rr = await fetch(
          `${API_BASE}/buzz/posts/${activePost.id}/comments`,
          { headers: h }
        );
        const jj = await rr.json();
        setComments(Array.isArray(jj?.comments) ? jj.comments : []);
      } catch {
        alert("Comments: Failed to delete.");
      }
    },
    [activePost]
  );

  const openGiftPicker = useCallback((post) => {
    setActivePost(post);
    setGiftPickerOpen(true);
  }, []);

  const sendGift = useCallback(
    async (giftKey) => {
      if (!activePost) return;
      try {
        const h = await authHeaders();
        const r = await fetch(`${API_BASE}/buzz/posts/${activePost.id}/gifts`, {
          method: "POST",
          headers: h,
          body: JSON.stringify({ giftKey, amount: 1 }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error || "gift_failed");

        // refresh counts (mobile parity)
        try {
          await loadGiftSummary(activePost.id);
        } catch {}

        setGiftPickerOpen(false);
      } catch {
        alert("Gift: Failed to send gift.");
      }
    },
    [activePost, loadGiftSummary]
  );

  const openGiftInsights = useCallback(
    async (post) => {
      try {
        const summary = await loadGiftSummary(post.id);
        setGiftSummary(summary);
        setGiftInsightsOpen(true);
      } catch {
        alert("Gifts: Failed to load gifts.");
      }
    },
    [loadGiftSummary]
  );

  const shareToAuthor = useCallback(
    async (post) => {
      try {
        const ownerId = String(post.userId);
        if (!ownerId) return;

        const h = await authHeaders();
        const roomId = roomIdFor(meId, ownerId);

        const text = encodeRBZSharePost({
          type: "share_post",
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
    },
    [meId]
  );

  const boot = useCallback(async () => {
    setLoading(true);
    await fetchMeId();
    await loadPosts();
    setLoading(false);
  }, [fetchMeId, loadPosts]);

  useEffect(() => {
    boot();

    // realtime-ish refresh hooks (works with your current web event pattern)
    const onCommentNew = (e) => {
      const postId = String(e?.detail?.postId || e?.postId || "");
      if (commentsOpen && activePost?.id && String(activePost.id) === postId) {
        openComments(activePost);
      }
    };
    window.addEventListener("comment:new", onCommentNew);
    return () => window.removeEventListener("comment:new", onCommentNew);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadPosts();
    setRefreshing(false);
  };

  const giftCountFor = (postId) => {
    return Number(giftTotalByPostRef.current[postId] || 0);
  };

  const grouped = useMemo(() => {
    // group comments into roots + replies (simple parentId handling)
    const byParent = {};
    const roots = [];
    for (const c of comments || []) {
      const pid = c.parentId || null;
      if (pid) {
        byParent[pid] ||= [];
        byParent[pid].push(c);
      } else roots.push(c);
    }
    return { roots, byParent };
  }, [comments]);

  if (loading) {
    return (
      <div className="mt-6 flex items-center justify-center py-16">
        <div className="text-white/70 font-bold">Loading posts…</div>
      </div>
    );
  }

  return (
    <div className="mt-6">
      {/* Top actions */}
      <div className="flex items-center justify-between mb-4">
        <div className="text-white/90 font-extrabold tracking-tight">
          Matched Posts
        </div>
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-white font-bold transition disabled:opacity-50"
        >
          <FaSyncAlt className={refreshing ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {/* List */}
      {posts.length === 0 ? (
        <div className="border border-white/10 bg-white/5 rounded-2xl p-10 text-center text-white/70">
          <div className="text-5xl mb-3">🐝</div>
          <div className="font-extrabold text-white/90">No matched posts yet</div>
          <div className="text-sm mt-2 text-white/60">
            When your matches post, they&apos;ll appear here.
          </div>
        </div>
      ) : (
        <div className="grid gap-5">
          {posts.map((p) => {
            const u = p.user || {};
            const name =
              `${u.firstName || ""} ${u.lastName || ""}`.trim() || "User";
            const avatar = u.avatar || "https://via.placeholder.com/80?text=RBZ";
            const media = p.mediaUrl || "";

            return (
              <div
                key={p.id}
                className="border border-white/10 bg-white/5 rounded-2xl overflow-hidden"
              >
                {/* header */}
                <div className="p-4 flex items-center gap-3">
                  <button
                    onClick={() => (window.location.href = `/viewProfile/${p.userId}`)}
                    className="w-10 h-10 rounded-full overflow-hidden border border-white/10 bg-black/20"
                    title="View profile"
                  >
                    <img
                      src={avatar}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="text-white font-extrabold truncate">
                      {name}
                    </div>
                    <div className="text-white/50 text-xs font-bold">
                      Matched-only post
                    </div>
                  </div>

                  <button
                    onClick={() => shareToAuthor(p)}
                    className="px-3 py-2 rounded-xl bg-black/30 border border-white/10 hover:bg-black/40 text-white font-bold transition inline-flex items-center gap-2"
                    title="Share to author (chat)"
                  >
                    <FaPaperPlane />
                    <span className="hidden sm:inline">Share</span>
                  </button>
                </div>

                {/* media */}
                {media ? (
                  <div className="relative bg-black">
                    <img
                      src={media}
                      alt=""
                      className="w-full max-h-[560px] object-cover"
                      loading="lazy"
                    />
                    {/* gradient edge */}
                    <div
                      className="pointer-events-none absolute inset-x-0 bottom-0 h-24"
                      style={{
                        background: `linear-gradient(to top, rgba(0,0,0,0.65), transparent)`,
                      }}
                    />
                  </div>
                ) : null}

                {/* caption */}
                {p.text ? (
                  <div className="px-4 pt-3 text-white/90 font-semibold">
                    {p.text}
                  </div>
                ) : null}

                {/* actions */}
                <div className="px-4 py-4 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => openGiftPicker(p)}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl font-extrabold text-white border border-white/10 bg-white/5 hover:bg-white/10 transition"
                      title="Send gift"
                      style={{
                        boxShadow: `0 0 0 1px ${RBZ.c1}22 inset`,
                      }}
                    >
                      <FaGift />
                      Gift
                    </button>

                    <button
                      onClick={() => openComments(p)}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl font-extrabold text-white border border-white/10 bg-white/5 hover:bg-white/10 transition"
                      title="Private comments"
                    >
                      <FaCommentDots />
                      Comment
                    </button>
                  </div>

                  <button
                    onClick={() => openGiftInsights(p)}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl font-extrabold text-white border border-white/10 bg-black/30 hover:bg-black/40 transition"
                    title="Gift insights"
                  >
                    <span className="text-lg">🎁</span>
                    <span>{giftCountFor(p.id)}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Gift Picker Modal */}
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

            <div className="p-4 pt-0 text-white/60 text-xs font-semibold">
              Gifts are matched-only interactions.
            </div>
          </div>
        </div>
      )}

      {/* Gift Insights Modal */}
      {giftInsightsOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-2xl border border-white/10 bg-[#0b0b10] rounded-2xl overflow-hidden">
            <div
              className="p-4 flex items-center justify-between"
              style={{
                background: `linear-gradient(90deg, ${RBZ.c1}, ${RBZ.c2}, ${RBZ.c3}, ${RBZ.c4})`,
              }}
            >
              <div className="text-white font-black text-lg">Gift Insights</div>
              <button
                onClick={() => setGiftInsightsOpen(false)}
                className="text-white/90 hover:text-white"
              >
                <FaTimes />
              </button>
            </div>

            <div className="p-5">
              <div className="flex items-center justify-between">
                <div className="text-white font-extrabold">
                  Total gifts on this post
                </div>
                <div className="text-white text-xl font-black">
                  {Number(giftSummary?.total || 0)}
                </div>
              </div>

              {/* byGift */}
              <div className="mt-5 border border-white/10 bg-white/5 rounded-2xl p-4">
                <div className="text-white font-black mb-3">By gift</div>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(giftSummary?.byGift || {}).length ? (
                    Object.entries(giftSummary.byGift).map(([k, v]) => (
                      <div
                        key={k}
                        className="px-3 py-2 rounded-xl bg-black/30 border border-white/10 text-white font-extrabold"
                      >
                        {k}: {v}
                      </div>
                    ))
                  ) : (
                    <div className="text-white/60 font-semibold text-sm">
                      No gift breakdown yet.
                    </div>
                  )}
                </div>
              </div>

              {/* byUser (owner-only usually) */}
              <div className="mt-4 border border-white/10 bg-white/5 rounded-2xl p-4">
                <div className="text-white font-black mb-3">
                  Who sent gifts (owner-only)
                </div>

                {Array.isArray(giftSummary?.byUser) && giftSummary.byUser.length ? (
                  <div className="grid gap-3">
                    {giftSummary.byUser.map((u) => {
                      const usr = u?.user || {};
                      const nm =
                        `${usr.firstName || ""} ${usr.lastName || ""}`.trim() ||
                        "User";
                      const av =
                        usr.avatar || "https://via.placeholder.com/80?text=RBZ";

                      return (
                        <button
                          key={u.userId}
                          onClick={() =>
                            (window.location.href = `/viewProfile/${u.userId}`)
                          }
                          className="w-full text-left flex items-center gap-3 p-3 rounded-2xl border border-white/10 bg-black/30 hover:bg-black/40 transition"
                        >
                          <img
                            src={av}
                            alt=""
                            className="w-10 h-10 rounded-full object-cover border border-white/10"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-white font-extrabold truncate">
                              {nm}
                            </div>
                            <div className="text-white/60 text-xs font-semibold truncate">
                              {Object.entries(u.gifts || {})
                                .map(([k, v]) => `${k}:${v}`)
                                .join("  •  ")}
                            </div>
                          </div>
                          <div className="text-white font-black">{u.total}</div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-white/60 font-semibold text-sm flex items-center gap-2">
                    <FaUser />
                    Only the post owner can see who sent gifts.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Comments Sheet (Private) */}
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
              Visible only to you and the post author.
            </div>

            {/* list */}
            <div className="px-4 pb-3 max-h-[52vh] overflow-auto">
              {grouped.roots.length === 0 ? (
                <div className="text-white/60 font-semibold py-6 text-center">
                  No comments yet.
                </div>
              ) : (
                grouped.roots.map((c) => (
                  <CommentThread
                    key={c.id}
                    root={c}
                    byParent={grouped.byParent}
                    meId={meId}
                    onReply={(x) => {
                      setReplyTo(x);
                      setEditing(null);
                    }}
                    onEdit={(x) => {
                      setEditing(x);
                      setCommentText(x.text || "");
                      setReplyTo(null);
                    }}
                    onDelete={deleteComment}
                  />
                ))
              )}
            </div>

            {/* composer */}
            <div className="p-4 border-t border-white/10 bg-black/20">
              {(replyTo || editing) && (
                <div className="mb-2 text-xs text-white/70 font-bold">
                  {editing ? (
                    <>
                      Editing comment{" "}
                      <button
                        className="underline ml-2"
                        onClick={() => {
                          setEditing(null);
                          setCommentText("");
                        }}
                      >
                        cancel
                      </button>
                    </>
                  ) : (
                    <>
                      Replying{" "}
                      <button
                        className="underline ml-2"
                        onClick={() => setReplyTo(null)}
                      >
                        cancel
                      </button>
                    </>
                  )}
                </div>
              )}

              <div className="flex gap-2">
                <input
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder={
                    editing
                      ? "Edit your private comment…"
                      : replyTo
                      ? "Write a private reply…"
                      : "Write a private comment…"
                  }
                  className="flex-1 px-4 py-3 rounded-2xl bg-white/5 border border-white/10 text-white placeholder:text-white/40 font-semibold outline-none"
                />
                <button
                  onClick={sendComment}
                  className="px-5 py-3 rounded-2xl text-white font-black border border-white/10"
                  style={{
                    background: `linear-gradient(90deg, ${RBZ.c1}, ${RBZ.c2}, ${RBZ.c3}, ${RBZ.c4})`,
                  }}
                >
                  {editing ? "Save" : "Send"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CommentThread({ root, byParent, meId, onReply, onEdit, onDelete }) {
  const renderRow = (c, depth = 0) => {
    const a = c.author || {};
    const nm =
      `${a.firstName || ""} ${a.lastName || ""}`.trim() || "User";
    const av = a.avatar || "https://via.placeholder.com/80?text=RBZ";
    const isMine = String(c.userId) === String(meId);

    return (
      <div key={c.id} className={depth ? "ml-8" : ""}>
        <div className="flex gap-3 mb-3">
          <button
            onClick={() => (window.location.href = `/viewProfile/${c.userId}`)}
            className="w-9 h-9 rounded-full overflow-hidden border border-white/10 bg-black/20 shrink-0"
            title="View profile"
          >
            <img src={av} alt="" className="w-full h-full object-cover" />
          </button>

          <div className="flex-1 border border-white/10 bg-white/5 rounded-2xl p-3">
            <div className="flex items-start justify-between gap-2">
              <button
                onClick={() => (window.location.href = `/viewProfile/${c.userId}`)}
                className="text-white font-black text-sm hover:underline"
              >
                {nm}
              </button>

              <div className="flex items-center gap-2 text-xs font-black">
                <button
                  onClick={() => onReply(c)}
                  className="px-2 py-1 rounded-lg border border-white/10 bg-black/20 text-white/80 hover:text-white hover:bg-black/30 transition"
                >
                  Reply
                </button>
                {isMine && (
                  <>
                    <button
                      onClick={() => onEdit(c)}
                      className="px-2 py-1 rounded-lg border border-white/10 bg-black/20 text-white/80 hover:text-white hover:bg-black/30 transition"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => onDelete(c)}
                      className="px-2 py-1 rounded-lg border border-white/10 bg-black/20 text-white/80 hover:text-white hover:bg-black/30 transition"
                    >
                      Delete
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="text-white/90 font-semibold text-sm mt-1">
              {c.text}
            </div>
          </div>
        </div>

        {(byParent?.[c.id] || []).map((child) => renderRow(child, depth + 1))}
      </div>
    );
  };

  return renderRow(root, 0);
}
