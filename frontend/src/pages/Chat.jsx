// frontend/src/pages/Chat.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { FaSearch } from "react-icons/fa";
import { getSocket } from "../socket";
import { motion, AnimatePresence } from "framer-motion";

//const API_BASE = "http://localhost:4000";
//const API_BASE = process.env.REACT_APP_API_BASE || "https://rombuzz-api.onrender.com/api";
import { API_BASE } from "../config";

const UNREAD_MAP_KEY = "RBZ:unread:map";
const UNREAD_TOTAL_KEY = "RBZ:unread:total";

const CHAT_MUTE_KEY = "RBZ:chat:mute";
const CHAT_ALERT_KEY = "RBZ:chat:alert";
const CHAT_TONE_KEY = "RBZ:chat:ringtone";


/* ---------------------------
   Local helpers / global keys
----------------------------*/
const getLS = (k, f) => {
  try {
    const v = localStorage.getItem(k);
    return v ? JSON.parse(v) : f;
  } catch {
    return f;
  }
};
const setLS = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
};
const GK = {
  ringtoneAudio: "RBZ:GLOBAL:ringtone:audio",
  ringtoneVideo: "RBZ:GLOBAL:ringtone:video",
  msgSound: "RBZ:GLOBAL:msgSound",
  vibrate: "RBZ:GLOBAL:vibrate",
  showNavBadge: "RBZ:GLOBAL:showNavBadge",
  density: "RBZ:GLOBAL:ui:density",
  fontScale: "RBZ:GLOBAL:ui:fontScale",
  highContrast: "RBZ:GLOBAL:ui:highContrast",
  reduceMotion: "RBZ:GLOBAL:ui:reduceMotion",
  typing: "RBZ:GLOBAL:privacy:typing",
  receipts: "RBZ:GLOBAL:privacy:readReceipts",
  hidePreview: "RBZ:GLOBAL:privacy:hideNotifPreview",
  linkPreviews: "RBZ:GLOBAL:media:linkPreviews",
  autoDownload: "RBZ:GLOBAL:media:autoDownload",
  outputDevice: "RBZ:GLOBAL:audio:deviceId",
  ringVolume: "RBZ:GLOBAL:audio:ringVolume",
  blockUnknown: "RBZ:GLOBAL:calls:blockUnknown",
  dnd: "RBZ:GLOBAL:calls:dnd",
};
const DING = "data:audio/mp3;base64,//uQZAAAAAAAAAAAAAAAAAAAA";
const fileToDataUrl = (file) =>
  new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = rej;
    fr.readAsDataURL(file);
  });

const makeRoomId = (a, b) => {
  const A = String(a),
    B = String(b);
  return A < B ? `${A}_${B}` : `${B}_${A}`;
};

const generateId = () => {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
};

// 🔁 MOVE CHAT TO TOP (Messenger-style) + persist ordering per user
const reorderMatches = (list, peerId) => {
  if (!Array.isArray(list) || !list.length) return list;

  const target = String(peerId);
  const idx = list.findIndex(
    (m) => String(m.id || m._id) === target
  );
  if (idx === -1) return list;

  const copy = [...list];
  const [item] = copy.splice(idx, 1);
  item._lastActive = Date.now();
  copy.unshift(item);

  // 🧠 Persist the new order in localStorage per user
  try {
    const rawUser =
      localStorage.getItem("user") || sessionStorage.getItem("user");
    const u = rawUser ? JSON.parse(rawUser) : null;
    const uid = u?.id || u?._id;
    if (uid) {
      const key = `RBZ:chat:order:${uid}`;
      const orderIds = copy.map((m) => String(m.id || m._id));
      localStorage.setItem(key, JSON.stringify(orderIds));
    }
  } catch {
    // fail silently – never break chat
  }

  return copy;
};

// 🧩 Apply stored ordering (Messenger-style) if available
const applyStoredOrder = (list, currentUserId) => {
  if (!Array.isArray(list) || !list.length || !currentUserId) return list;

  let saved = [];
  try {
    const raw = localStorage.getItem(`RBZ:chat:order:${currentUserId}`);
    saved = raw ? JSON.parse(raw) : [];
  } catch {
    saved = [];
  }
  if (!Array.isArray(saved) || !saved.length) return list;

  const indexMap = new Map(
    saved.map((id, idx) => [String(id), idx])
  );

  const withIdx = list.map((m) => {
    const id = String(m.id || m._id);
    const idx = indexMap.has(id)
      ? indexMap.get(id)
      : Number.POSITIVE_INFINITY;
    return { ...m, _orderIdx: idx };
  });

  // Sort by saved order first; fall back to most recent message time
  withIdx.sort((a, b) => {
    if (a._orderIdx !== b._orderIdx) {
      return a._orderIdx - b._orderIdx;
    }
    return (b._sortTime || 0) - (a._sortTime || 0);
  });

  return withIdx.map(({ _orderIdx, ...rest }) => rest);
};


export default function Chat() {
  const navigate = useNavigate();

  const { userId: paramId } = useParams();
  const location = useLocation();
  const queryId = new URLSearchParams(location.search).get("u");
  const openToId = paramId || queryId || null;

  const user = useMemo(() => {
    try {
      return (
        JSON.parse(localStorage.getItem("user")) ||
        JSON.parse(sessionStorage.getItem("user"))
      );
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (!user) navigate("/login");
  }, [user, navigate]);

  // Stop page scroll
  useEffect(() => {
    const elHtml = document.documentElement;
    const elBody = document.body;
    const prevHtml = elHtml.style.overflow;
    const prevBody = elBody.style.overflow;
    elHtml.style.overflow = "hidden";
    elBody.style.overflow = "hidden";
    return () => {
      elHtml.style.overflow = prevHtml;
      elBody.style.overflow = prevBody;
    };
  }, []);

  const socketRef = useRef(null);
  const [onlineMap, setOnlineMap] = useState({});

  const [matches, setMatches] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [activeMatch, setActiveMatch] = useState(null);

  const [showHamburger, setShowHamburger] = useState(false);
  const [gset, setGset] = useState(() => ({
    ringtoneAudio: getLS(GK.ringtoneAudio, ""),
    ringtoneVideo: getLS(GK.ringtoneVideo, ""),
    msgSound: getLS(GK.msgSound, true),
    vibrate: getLS(GK.vibrate, true),
    showNavBadge: getLS(GK.showNavBadge, true),
    density: getLS(GK.density, "cozy"),
    fontScale: getLS(GK.fontScale, 100),
    highContrast: getLS(GK.highContrast, false),
    reduceMotion: getLS(GK.reduceMotion, false),
    typing: getLS(GK.typing, true),
    receipts: getLS(GK.receipts, true),
    hidePreview: getLS(GK.hidePreview, false),
    linkPreviews: getLS(GK.linkPreviews, true),
    autoDownload: getLS(GK.autoDownload, "wifi"),
    outputDevice: getLS(GK.outputDevice, ""),
    ringVolume: getLS(GK.ringVolume, 0.8),
    blockUnknown: getLS(GK.blockUnknown, false),
    dnd: getLS(GK.dnd, false),
  }));

    // Restore unread map from storage (set by Navbar while user is off the chat page)
  const [unread, setUnread] = useState(() => getLS(UNREAD_MAP_KEY, {}));

  // per-chat settings
  const [mutedPeers, setMutedPeers] = useState(() => getLS(CHAT_MUTE_KEY, {}));
  const [alertPeers, setAlertPeers] = useState(() => getLS(CHAT_ALERT_KEY, {}));
  const [tonePeers, setTonePeers] = useState(() => getLS(CHAT_TONE_KEY, {}));

  // context menu / long-press
  const [menuPeer, setMenuPeer] = useState(null);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const [showSheet, setShowSheet] = useState(false);
  const menuRef = useRef(null);
  const longPressTimerRef = useRef(null);
  const longPressFiredRef = useRef(false);

  // When the user opens the Chat page, treat everything as read immediately.

  // When the user opens the Chat page, treat everything as read immediately.
  // This clears the navbar Chat badge and wipes the per-peer unread map.
  useEffect(() => {
    const empty = {};
    setUnread(empty);
    setLS(UNREAD_MAP_KEY, empty);
    localStorage.setItem(UNREAD_TOTAL_KEY, "0");

    window.dispatchEvent(
      new CustomEvent("rbz:unread", { detail: { total: 0 } })
    );
  }, []); // run once when /chat mounts


   // load matches (use correct backend route + flexible parsing)
  useEffect(() => {
    if (!user) return;
    const token =
      localStorage.getItem("token") || sessionStorage.getItem("token");

    fetch(`${API_BASE}/matches`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        let list = Array.isArray(data)
          ? data
          : Array.isArray(data?.matches)
          ? data.matches
          : [];

        // 🆕 Sort by most recent message (Facebook Messenger style)
        list = list
          .map((m) => {
            const ts =
              m.lastMessageTime ||
              m.lastMessage?.time ||
              m.lastMessage?.createdAt ||
              m.updatedAt ||
              m.createdAt ||
              0;
            return { ...m, _sortTime: new Date(ts).getTime() || 0 };
          })
          .sort((a, b) => b._sortTime - a._sortTime);

        // 🧠 Apply any stored per-user ordering (Messenger-style)
        const currentUserId = String(user?.id || user?._id || "");
        list = applyStoredOrder(list, currentUserId);

        setMatches(list);
        setFiltered(list);
        // 🔥 Fetch online/offline snapshot for ALL matches on load
          Promise.all(
            list.map((m) => {
              const id = m.id || m._id;
              return fetch(`${API_BASE}/presence/${id}`)
                .then((r) => r.json())
                .then((d) => ({ id, online: !!d.online }))
                .catch(() => ({ id, online: false }));
            })
          ).then((states) => {
            setOnlineMap((prev) => {
              const out = { ...prev };
              states.forEach((s) => {
                out[s.id] = s.online;
              });
              return out;
            });
          });

      })
      .catch(() => {
        setMatches([]);
        setFiltered([]);
      });
  }, [user]);



 // ✅ if a target is specified in the URL, auto-select that match (string-safe)
useEffect(() => {
  if (!openToId || !Array.isArray(matches) || !matches.length) return;
  const want = matches.find(
    (m) => String(m.id || m._id) === String(openToId)
  );
  if (want) {
    setActiveMatch(want);
  }
}, [openToId, matches]);

  // connect socket + presence + unread-on-message (ignore our own outbound)
  useEffect(() => {
    if (!user) return;

    const s = getSocket();
    socketRef.current = s;

    const myId = String(user.id || user._id);

    const onConnect = () => {
      try {
        s.emit("register", myId);
      } catch {}
    };
    s.on("connect", onConnect);

        const onOnline = ({ userId }) => {
      setOnlineMap((m) => ({ ...m, [userId]: true }));

      const idStr = String(userId);
      const hasAlert = !!alertPeers[idStr];
      const isMuted = !!mutedPeers[idStr];

      if (hasAlert && !isMuted && !gset.dnd) {
        try {
          const toneId = tonePeers[idStr];
          let src = DING; // default RomBuzz ding

          // If you later store a custom URL for this peer, we’ll use it:
          if (toneId && typeof toneId === "string") {
            src = toneId;
          }

          const a = new Audio(src);
          a.volume = Number(gset.ringVolume ?? 0.8);
          a.play().catch(() => {});
        } catch {}
      }
    };

    const onOffline = ({ userId }) =>
      setOnlineMap((m) => {
        const n = { ...m };
        delete n[userId];
        return n;
      });

      const handleIncoming = (raw) => {
      if (!raw) return;

      const toId =
        raw.to ||
        raw.toId ||
        raw.receiverId ||
        raw.recipientId ||
        raw.recipient?._id ||
        raw.recipientId?._id;

      const fromId =
        raw.from ||
        raw.fromId ||
        raw.senderId ||
        raw.userId ||
        raw.authorId ||
        raw.sender?._id;

      if (fromId && String(fromId) === myId) return;

      let viaRoomPeer = null;
      if (raw.roomId && typeof raw.roomId === "string") {
        const parts = raw.roomId.split("_").map(String);
        if (parts.includes(myId)) {
          viaRoomPeer = parts.find((p) => p !== myId) || null;
        }
      }
      if (!viaRoomPeer && Array.isArray(raw.participants)) {
        const others = raw.participants.map(String).filter((p) => p !== myId);
        if (others.length === 1) viaRoomPeer = others[0];
      }

      const addressedToMe =
        (toId && String(toId) === myId) ||
        (raw.roomId && viaRoomPeer) ||
        (Array.isArray(raw.participants) &&
          raw.participants.map(String).includes(myId));
      if (!addressedToMe) return;

      const sender = String(fromId || viaRoomPeer || "");
      if (!sender) return;

      const openId = activeMatch
        ? String(activeMatch.id || activeMatch._id)
        : null;

      // 🔁 Always move this peer to the top of the sidebar
      setMatches((prev) => reorderMatches(prev, sender));
      setFiltered((prev) => reorderMatches(prev, sender));

      // If this is the chat currently open, do NOT create unread count
      if (openId && openId === sender) return;

      setUnread((prev) => {
        const next = { ...prev, [sender]: (prev[sender] || 0) + 1 };
        setLS(UNREAD_MAP_KEY, next);

        // Sound/vibrate UX
        if (gset.msgSound && !gset.dnd) {
          try {
            const a = new Audio(DING);
            a.play().catch(() => {});
          } catch {}
        }
        if (gset.vibrate && navigator.vibrate && !gset.dnd) {
          navigator.vibrate([50]);
        }

        // Broadcast aggregate
        const total = Object.values(next).reduce((a, b) => a + b, 0);
        localStorage.setItem(UNREAD_TOTAL_KEY, String(total));
        if (gset.showNavBadge) {
          window.dispatchEvent(
            new CustomEvent("rbz:unread", { detail: { total } })
          );
        }

        return next;
      });

      // 🔥 Keep notifying Navbar for global chat badge
      const directMessagePayload = {
        id: raw.id || generateId(),
        roomId: raw.roomId || makeRoomId(myId, sender),
        from: sender,
        to: myId,
        time: raw.time || new Date().toISOString(),
        preview: (raw.text || "").slice(0, 80),
        type: raw.type || "text",
      };

      s.emit("direct:message", directMessagePayload);
    };


    s.on("presence:online", onOnline);
    s.on("presence:offline", onOffline);

    s.on("message", handleIncoming);
    s.on("chat:message", handleIncoming);
    s.on("room:message", handleIncoming);
    s.on("newMessage", handleIncoming);
    s.on("direct:message", handleIncoming);

    return () => {
      s.off("connect", onConnect);
      s.off("presence:online", onOnline);
      s.off("presence:offline", onOffline);
      s.off("message", handleIncoming);
      s.off("chat:message", handleIncoming);
      s.off("room:message", handleIncoming);
      s.off("newMessage", handleIncoming);
      s.off("direct:message", handleIncoming);
      // NOTE: do NOT s.disconnect() — shared singleton
    };
}, [
  user,
  activeMatch,
  gset.msgSound,
  gset.vibrate,
  gset.dnd,
  gset.showNavBadge,
  mutedPeers,
  alertPeers,
  tonePeers,
]);

// 🔁 When we send a message from ChatWindow, bump that peer to the top
useEffect(() => {
  const onActivity = (e) => {
    const peerId = e?.detail?.peerId;
    if (!peerId) return;

    setMatches((prev) => reorderMatches(prev, peerId));
    setFiltered((prev) => reorderMatches(prev, peerId));
  };

  window.addEventListener("chat:activity", onActivity);
  return () => window.removeEventListener("chat:activity", onActivity);
}, []);
  // close context menu / sheet when clicking outside
  useEffect(() => {
    const handleDown = (e) => {
      if (!menuPeer) return;
      if (menuRef.current && menuRef.current.contains(e.target)) return;
      setMenuPeer(null);
      setShowSheet(false);
    };

    document.addEventListener("mousedown", handleDown);
    document.addEventListener("touchstart", handleDown);
    return () => {
      document.removeEventListener("mousedown", handleDown);
      document.removeEventListener("touchstart", handleDown);
    };
  }, [menuPeer]);


  // Join all match rooms so room broadcasts reach the sidebar
  useEffect(() => {
    const s = socketRef.current;
    if (!s || !user || !matches?.length) return;
    const myId = user.id || user._id;
    const roomIds = matches.map((m) => makeRoomId(myId, m.id || m._id));
    roomIds.forEach((rid) => s.emit("joinRoom", rid));
    return () => roomIds.forEach((rid) => s.emit("leaveRoom", rid));
  }, [matches, user]);

  // Clear unread for the thread we open — and broadcast the new total (Navbar updates)
  useEffect(() => {
    if (!activeMatch) return;
    const id = activeMatch.id || activeMatch._id;
    setUnread((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];

      setLS(UNREAD_MAP_KEY, next);
      const total = Object.values(next).reduce((a, b) => a + b, 0);
      localStorage.setItem(UNREAD_TOTAL_KEY, String(total));
      window.dispatchEvent(new CustomEvent("rbz:unread", { detail: { total } }));

      return next;
    });
  }, [activeMatch]);

  const onSearch = (q) => {
    const query = q.toLowerCase();
    if (!query) return setFiltered(matches);
    setFiltered(
      matches.filter((m) =>
        `${m.firstName || ""} ${m.lastName || ""}`.toLowerCase().includes(query)
      )
    );
  };

  const openProfile = (matchUser) => {
    if (!matchUser) return;
    const id = matchUser.id || matchUser._id;
    const currentId = user?.id || user?._id;
    if (id === currentId) {
      navigate("/profile");
    } else {
      navigate(`/view/${id}`);
    }
  };
  const closeMenu = () => {
    setMenuPeer(null);
    setShowSheet(false);
  };

  const toggleMutePeer = (id) => {
    if (!id) return;
    const key = String(id);
    setMutedPeers((prev) => {
      const next = { ...prev };
      if (next[key]) delete next[key];
      else next[key] = true;
      setLS(CHAT_MUTE_KEY, next);
      return next;
    });
  };

  const toggleReadPeer = (id) => {
    if (!id) return;
    const key = String(id);
    setUnread((prev) => {
      const next = { ...prev };
      if (next[key]) {
        // mark as READ
        delete next[key];
      } else {
        // mark as UNREAD (one badge)
        next[key] = 1;
      }
      setLS(UNREAD_MAP_KEY, next);
      const total = Object.values(next).reduce((a, b) => a + b, 0);
      localStorage.setItem(UNREAD_TOTAL_KEY, String(total));
      window.dispatchEvent(new CustomEvent("rbz:unread", { detail: { total } }));
      return next;
    });
  };

  const deleteChatForPeer = (peer) => {
    if (!peer) return;
    const id = peer.id || peer._id;
    const name =
      [peer.firstName, peer.lastName].filter(Boolean).join(" ") || "this user";

    if (
      !window.confirm(
        `Delete chat with ${name}? This will remove it from your chat list.`
      )
    )
      return;

    // Remove from sidebar lists
    setMatches((prev) => prev.filter((m) => (m.id || m._id) !== id));
    setFiltered((prev) => prev.filter((m) => (m.id || m._id) !== id));

    // Clear unread for that peer
    setUnread((prev) => {
      const next = { ...prev };
      delete next[id];
      setLS(UNREAD_MAP_KEY, next);
      const total = Object.values(next).reduce((a, b) => a + b, 0);
      localStorage.setItem(UNREAD_TOTAL_KEY, String(total));
      window.dispatchEvent(new CustomEvent("rbz:unread", { detail: { total } }));
      return next;
    });

    // Remove from stored ordering
    try {
      const rawUser =
        localStorage.getItem("user") || sessionStorage.getItem("user");
      const u = rawUser ? JSON.parse(rawUser) : null;
      const uid = u?.id || u?._id;
      if (uid) {
        const keyOrder = `RBZ:chat:order:${uid}`;
        const raw = localStorage.getItem(keyOrder);
        if (raw) {
          const arr = JSON.parse(raw).filter(
            (x) => String(x) !== String(id)
          );
          localStorage.setItem(keyOrder, JSON.stringify(arr));
        }
      }
    } catch {}
  };

  const blockPeer = (peer) => {
    if (!peer) return;
    const name =
      [peer.firstName, peer.lastName].filter(Boolean).join(" ") || "this user";
    if (
      !window.confirm(
        `Block ${name}? You will stop receiving messages from them. You can manage blocks from their profile.`
      )
    )
      return;

    // For now, just jump to their profile where your existing block UI lives.
    openProfile(peer);
  };

  const toggleAlertToneForPeer = async (peer) => {
    if (!peer) return;
    const id = peer.id || peer._id;
    const key = String(id);
    const hasAlert = !!alertPeers[key];

    if (hasAlert) {
      // remove alert + custom tone
      setAlertPeers((prev) => {
        const next = { ...prev };
        delete next[key];
        setLS(CHAT_ALERT_KEY, next);
        return next;
      });
      setTonePeers((prev) => {
        const next = { ...prev };
        delete next[key];
        setLS(CHAT_TONE_KEY, next);
        return next;
      });
      return;
    }

    // enable: ask for optional custom URL
    const url = window.prompt(
      "Optional: enter a custom ringtone URL (mp3) for this person.\nLeave blank to use the default RomBuzz tone."
    );

    setAlertPeers((prev) => {
      const next = { ...prev, [key]: true };
      setLS(CHAT_ALERT_KEY, next);
      return next;
    });

    if (url && url.trim()) {
      setTonePeers((prev) => {
        const next = { ...prev, [key]: url.trim() };
        setLS(CHAT_TONE_KEY, next);
        return next;
      });
    }
  };

  const handleTouchStart = (match) => {
    longPressFiredRef.current = false;
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = setTimeout(() => {
      longPressFiredRef.current = true;
      setMenuPeer(match);
      setShowSheet(true);
    }, 600); // ~Messenger feel
  };

  const handleTouchEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const currentPeerId = menuPeer ? String(menuPeer.id || menuPeer._id) : null;
  const currentMuted = currentPeerId ? !!mutedPeers[currentPeerId] : false;
  const currentAlert = currentPeerId ? !!alertPeers[currentPeerId] : false;
  const currentUnread = currentPeerId && unread[currentPeerId] > 0;

  const densityPad =
    gset.density === "compact" ? "p-2" : gset.density === "comfy" ? "p-4" : "p-3";

  const rootBg = gset.highContrast
    ? "bg-white"
    : "bg-gradient-to-br from-rose-50 to-rose-100";

     // detect viewport for mobile vs desktop
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);
  // Fix mobile viewport height (100vh issue on iOS/Android)
  useEffect(() => {
    const updateVh = () => {
      document.documentElement.style.setProperty(
        "--vh",
        `${window.innerHeight * 0.01}px`
      );
    };
    updateVh();
    window.addEventListener("resize", updateVh);
    return () => window.removeEventListener("resize", updateVh);
  }, []);

  return (
   <div
      className={`fixed top-16 left-0 w-full overflow-hidden ${rootBg}`}
      style={{
        height: "calc(var(--vh, 1vh) * 100 - 64px)",
        fontSize: `${Number(gset.fontScale) || 100}%`,
        margin: 0,
        padding: 0,
      }}
    >

      {/* ==============================
          📱 MOBILE LAYOUT
      ============================== */}
      {isMobile ? (
        <>
          <AnimatePresence initial={false} mode="wait">
  {!activeMatch ? (
    <motion.div
      key="list"
      initial={{ x: 0, opacity: 1 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: "-100%", opacity: 0 }}
      transition={{ duration: 0.35, ease: "easeInOut" }}
      className="flex flex-col h-full bg-white"
    >
      <div className={`border-b flex items-center gap-2 ${densityPad}`}>
        <button
          className="p-2 rounded-lg hover:bg-rose-50"
          onClick={() => setShowHamburger(true)}
          title="Chat settings"
        >
          ☰
        </button>

        <FaSearch className="text-gray-500 shrink-0" />
        <input
          className="flex-1 outline-none text-sm"
          placeholder="Search matches"
          onChange={(e) => onSearch(e.target.value)}
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        {filtered.map((m) => {
          const id = m.id || m._id;
          const name =
            [m.firstName, m.lastName].filter(Boolean).join(" ") || "Unknown";
          const online = !!onlineMap[id];
          const count = unread[id] || 0;

          return (
         <div
  key={id}
  onClick={() => {
    // if long-press fired, do NOT open chat
    if (longPressFiredRef.current) {
      longPressFiredRef.current = false;
      return;
    }

    // 🔥 Clear unread for this peer immediately
    try {
      let map = JSON.parse(localStorage.getItem("RBZ:unread:map") || "{}");
      map[id] = 0;
      localStorage.setItem("RBZ:unread:map", JSON.stringify(map));

      const total = Object.values(map).reduce((a, b) => a + b, 0);
      localStorage.setItem("RBZ:unread:total", String(total));

      window.dispatchEvent(
        new CustomEvent("rbz:unread", { detail: { total } })
      );
    } catch {}

    setActiveMatch(m);
  }}
  onTouchStart={() => handleTouchStart(m)}
  onTouchEnd={handleTouchEnd}
  onTouchMove={handleTouchEnd}
  className="flex items-center gap-3 p-3 border-b hover:bg-rose-50 cursor-pointer"
>

              <img
                src={m.avatar || "https://i.pravatar.cc/80"}
                alt=""
                className="h-10 w-10 rounded-full object-cover border"
              />

              <div className="flex-1 min-w-0">
                <div
                  className="font-semibold truncate text-blue-600 hover:underline"
                  onClick={(e) => {
                    e.stopPropagation(); // 🔥 prevents opening chat
                    openProfile(m);      // 🔥 open profile instead
                  }}
                >
                  {name}
                </div>
                <div className="text-xs text-gray-500 flex items-center gap-1">
                  <span
                    className={`text-lg ${
                      online ? "text-green-500" : "text-gray-300"
                    }`}
                  >
                    ●
                  </span>
                  {online ? "Active now" : "Offline"}
                </div>
              </div>
              {count > 0 && (
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-red-500 text-white shrink-0">
                  {count > 99 ? "99+" : count}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </motion.div>
  ) : (
   <motion.div
      key="chat"
      initial={{ x: "100%", opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: "100%", opacity: 0 }}
      transition={{ duration: 0.20, ease: "easeInOut" }}
      className="h-[calc(100%-0px)] overflow-hidden"
    >

      <ChatWindowLazy
        socket={socketRef.current || getSocket()}
        me={user}
        peer={activeMatch}
        onClose={() => setActiveMatch(null)}
      />
    </motion.div>
  )}
</AnimatePresence>

        </>
      ) : (
        /* ==============================
           💻 DESKTOP SPLIT VIEW
        ============================== */
        <div className="flex h-full">
          {/* Sidebar (left) */}
          <aside className="w-80 min-w-72 max-w-80 border-r bg-white/90 backdrop-blur-md flex flex-col">
            <div className={`border-b flex items-center gap-2 ${densityPad}`}>
              <button
                className="p-2 rounded-lg hover:bg-rose-50"
                onClick={() => setShowHamburger(true)}
                title="Chat settings"
              >
                ☰
              </button>

              <FaSearch className="text-gray-500 shrink-0" />
              <input
                className="flex-1 outline-none text-sm"
                placeholder="Search matches"
                onChange={(e) => onSearch(e.target.value)}
              />
            </div>

            <div className="overflow-y-auto min-h-0">
              {filtered.map((m) => {
                const id = m.id || m._id;
                const name =
                  [m.firstName, m.lastName].filter(Boolean).join(" ") ||
                  "Unknown";
                const online = !!onlineMap[id];
                const isActive =
                  activeMatch && (activeMatch.id || activeMatch._id) === id;
                const count = unread[id] || 0;

                return (
                  <div
                    key={id}
                    onClick={() => setActiveMatch(m)}
                    className={`flex items-center gap-3 p-3 hover:bg-rose-50 cursor-pointer ${
                      isActive ? "bg-rose-50" : ""
                    }`}
                  >
                    <img
                      src={m.avatar || "https://i.pravatar.cc/80"}
                      alt=""
                      className="h-10 w-10 rounded-full object-cover border"
                    />
                   <div className="flex-1 min-w-0">
                  <div
                    className="font-semibold truncate text-blue-600 hover:underline"
                    onClick={(e) => {
                      e.stopPropagation(); // do NOT open chat
                      openProfile(m);      // open profile instead
                    }}
                  >
                    {name}
                  </div>
                  <div className="text-xs text-gray-500 flex items-center gap-1">
                    <span
                      className={`text-lg ${
                        online ? "text-green-500" : "text-gray-300"
                      }`}
                    >
                      ●
                    </span>
                    {online ? "Active now" : "Offline"}
                  </div>
                </div>

                                       {count > 0 && (
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-red-500 text-white shrink-0">
                        {count > 99 ? "99+" : count}
                      </span>
                    )}

                    <button
                      className="ml-1 p-1 rounded-full hover:bg-rose-100 text-gray-500 shrink-0"
                      onClick={(e) => {
                        e.stopPropagation(); // do NOT open chat
                        setMenuPeer(m);
                        setShowSheet(false);
                        setMenuPos({ x: e.clientX, y: e.clientY });
                      }}
                    >
                      ⋮
                    </button>

                  </div>
                );
              })}
            </div>
          </aside>

          {/* Chat window (right) */}
          <main className="flex-1 min-w-0 h-full flex flex-col">
            {activeMatch ? (
              <ChatWindowLazy
                socket={socketRef.current || getSocket()}
                me={user}
                peer={activeMatch}
                onClose={() => setActiveMatch(null)}
              />
            ) : (
              <div className="h-full grid place-items-center text-gray-500 text-sm md:text-base">
                Select a match to start chatting
              </div>
            )}
          </main>
        </div>
      )}

      {/* Drawer */}
      {showHamburger && (
        <div
          className="fixed inset-0 z-50"
          onClick={() => setShowHamburger(false)}
        >
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="absolute top-0 left-0 h-full w-[360px] bg-white shadow-xl p-4 overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold text-lg">Chat Settings</div>
              <button
                className="p-2 rounded hover:bg-gray-100"
                onClick={() => setShowHamburger(false)}
              >
                ✕
              </button>
            </div>

            {/* (settings UI left as-is) */}
            {/* Appearance */}
            <section className="space-y-3 py-3 border-b">
              <div className="font-medium">Appearance</div>
              <div className="grid grid-cols-3 gap-2">
                {["comfy", "cozy", "compact"].map((mode) => (
                  <button
                    key={mode}
                    onClick={() => {
                      setLS(GK.density, mode);
                      setGset((s) => ({ ...s, density: mode }));
                    }}
                    className={`px-3 py-2 rounded-lg border ${
                      gset.density === mode
                        ? "bg-rose-500 text-white border-rose-500"
                        : "hover:bg-gray-50"
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
              <label className="text-sm">Font size: {gset.fontScale}%</label>
              <input
                type="range"
                min="90"
                max="120"
                value={gset.fontScale}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setLS(GK.fontScale, v);
                  setGset((s) => ({ ...s, fontScale: v }));
                }}
              />
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={!!gset.highContrast}
                  onChange={(e) => {
                    setLS(GK.highContrast, e.target.checked);
                    setGset((s) => ({ ...s, highContrast: e.target.checked }));
                  }}
                />
                High contrast
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={!!gset.reduceMotion}
                  onChange={(e) => {
                    setLS(GK.reduceMotion, e.target.checked);
                    setGset((s) => ({ ...s, reduceMotion: e.target.checked }));
                  }}
                />
                Reduce motion
              </label>
            </section>

            {/* Notifications */}
            <section className="space-y-3 py-3 border-b">
              <div className="font-medium">Notifications</div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={!!gset.msgSound}
                  onChange={(e) => {
                    setLS(GK.msgSound, e.target.checked);
                    setGset((s) => ({ ...s, msgSound: e.target.checked }));
                  }}
                />
                New-message sound
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={!!gset.vibrate}
                  onChange={(e) => {
                    setLS(GK.vibrate, e.target.checked);
                    setGset((s) => ({ ...s, vibrate: e.target.checked }));
                  }}
                />
                Vibrate on message
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={!!gset.showNavBadge}
                  onChange={(e) => {
                    setLS(GK.showNavBadge, e.target.checked);
                    setGset((s) => ({ ...s, showNavBadge: e.target.checked }));
                  }}
                />
                Show unread badge in navbar
              </label>
              <button
                className="px-3 py-1 rounded border text-sm"
                onClick={async () => {
                  try {
                    if (Notification.permission !== "granted") {
                      await Notification.requestPermission();
                    }
                    new Notification("Rombuzz", {
                      body: "Notifications are enabled ✅",
                    });
                  } catch {}
                }}
              >
                Test desktop notification
              </button>
            </section>

            {/* Privacy */}
            <section className="space-y-3 py-3 border-b">
              <div className="font-medium">Privacy</div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={!!gset.typing}
                  onChange={(e) => {
                    setLS(GK.typing, e.target.checked);
                    setGset((s) => ({ ...s, typing: e.target.checked }));
                  }}
                />
                Show "typing..." to others
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={!!gset.receipts}
                  onChange={(e) => {
                    setLS(GK.receipts, e.target.checked);
                    setGset((s) => ({ ...s, receipts: e.target.checked }));
                  }}
                />
                Send read receipts
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={!!gset.hidePreview}
                  onChange={(e) => {
                    setLS(GK.hidePreview, e.target.checked);
                    setGset((s) => ({ ...s, hidePreview: e.target.checked }));
                  }}
                />
                Hide message preview in notifications
              </label>
            </section>

            {/* Media */}
            <section className="space-y-3 py-3 border-b">
              <div className="font-medium">Media</div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={!!gset.linkPreviews}
                  onChange={(e) => {
                    setLS(GK.linkPreviews, e.target.checked);
                    setGset((s) => ({ ...s, linkPreviews: e.target.checked }));
                  }}
                />
                Link previews
              </label>
              <div className="text-sm">
                Auto-download:{" "}
                <select
                  value={gset.autoDownload}
                  onChange={(e) => {
                    setLS(GK.autoDownload, e.target.value);
                    setGset((s) => ({ ...s, autoDownload: e.target.value }));
                  }}
                  className="border rounded px-2 py-1"
                >
                  <option value="wifi">Wi-Fi only</option>
                  <option value="always">Always</option>
                  <option value="never">Never</option>
                </select>
              </div>
            </section>

            {/* Calls */}
            <section className="space-y-3 py-3 border-b">
              <div className="font-medium">Calls</div>
              <div className="text-sm">Default voice ringtone</div>
              <input
                type="file"
                accept="audio/*"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  if (f.size > 1.5 * 1024 * 1024)
                    return alert("Pick a file ≤1.5MB");
                  const data = await fileToDataUrl(f);
                  setLS(GK.ringtoneAudio, data);
                  setGset((s) => ({ ...s, ringtoneAudio: data }));
                }}
              />
              <div className="text-sm">Default video ringtone</div>
              <input
                type="file"
                accept="audio/*"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  if (f.size > 1.5 * 1024 * 1024)
                    return alert("Pick a file ≤1.5MB");
                  const data = await fileToDataUrl(f);
                  setLS(GK.ringtoneVideo, data);
                  setGset((s) => ({ ...s, ringtoneVideo: data }));
                }}
              />
              <div className="text-sm">
                Ring volume: {(gset.ringVolume * 100) | 0}%
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={gset.ringVolume}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setLS(GK.ringVolume, v);
                  setGset((s) => ({ ...s, ringVolume: v }));
                }}
              />
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={!!gset.dnd}
                  onChange={(e) => {
                    setLS(GK.dnd, e.target.checked);
                    setGset((s) => ({ ...s, dnd: e.target.checked }));
                  }}
                />
                Do Not Disturb (auto-reject calls)
              </label>
            </section>

            {/* Advanced */}
            <section className="space-y-3 py-3">
              <div className="font-medium">Advanced</div>
              <button
                className="px-3 py-1 rounded border text-sm"
                onClick={() => {
                  if (!window.confirm("Clear custom ringtones?")) return;
                  [GK.ringtoneAudio, GK.ringtoneVideo].forEach((k) =>
                    localStorage.removeItem(k)
                  );
                  setGset((s) => ({
                    ...s,
                    ringtoneAudio: "",
                    ringtoneVideo: "",
                  }));
                }}
              >
                Clear custom ringtones
              </button>
            </section>
          </div>
        </div>
      )}
            {/* == MOBILE BOTTOM SHEET (long-press) == */}
      {isMobile && menuPeer && (
        <div
          className="fixed inset-0 z-50 flex items-end bg-black/40"
          onClick={closeMenu}
        >
          <div
            ref={menuRef}
            onClick={(e) => e.stopPropagation()}
            className="w-full bg-white rounded-t-2xl p-4 space-y-2 shadow-lg"
          >
            <div className="text-sm font-semibold text-gray-700 pb-1 border-b">
              Chat options
            </div>

            <button
              className="w-full text-left text-sm py-2"
              onClick={() => {
                toggleMutePeer(currentPeerId);
                closeMenu();
              }}
            >
              {currentMuted ? "Unmute" : "Mute"} conversation
            </button>

            <button
              className="w-full text-left text-sm py-2"
              onClick={() => {
                toggleReadPeer(currentPeerId);
                closeMenu();
              }}
            >
              {currentUnread ? "Mark as read" : "Mark as unread"}
            </button>

            <button
              className="w-full text-left text-sm py-2"
              onClick={() => {
                toggleAlertToneForPeer(menuPeer);
                closeMenu();
              }}
            >
              {currentAlert ? "Remove alert tone" : "Add alert tone"}
            </button>

            <button
              className="w-full text-left text-sm py-2 text-amber-600"
              onClick={() => {
                blockPeer(menuPeer);
                closeMenu();
              }}
            >
              Block
            </button>

            <button
              className="w-full text-left text-sm py-2 text-red-600"
              onClick={() => {
                deleteChatForPeer(menuPeer);
                closeMenu();
              }}
            >
              Delete chat
            </button>
          </div>
        </div>
      )}

      {/* == DESKTOP POPOVER (⋮) == */}
      {!isMobile && menuPeer && (
        <div className="fixed inset-0 z-40" onClick={closeMenu}>
          <div
            ref={menuRef}
            onClick={(e) => e.stopPropagation()}
            className="absolute bg-white shadow-lg rounded-lg py-2 text-sm"
            style={{
              top: Math.max(8, menuPos.y - 10),
              left: Math.max(8, menuPos.x - 160),
              minWidth: "180px",
            }}
          >
            <button
              className="w-full text-left px-3 py-1.5 hover:bg-rose-50"
              onClick={() => {
                toggleMutePeer(currentPeerId);
                closeMenu();
              }}
            >
              {currentMuted ? "Unmute" : "Mute"} conversation
            </button>
            <button
              className="w-full text-left px-3 py-1.5 hover:bg-rose-50"
              onClick={() => {
                toggleReadPeer(currentPeerId);
                closeMenu();
              }}
            >
              {currentUnread ? "Mark as read" : "Mark as unread"}
            </button>
            <button
              className="w-full text-left px-3 py-1.5 hover:bg-rose-50"
              onClick={() => {
                toggleAlertToneForPeer(menuPeer);
                closeMenu();
              }}
            >
              {currentAlert ? "Remove alert tone" : "Add alert tone"}
            </button>
            <button
              className="w-full text-left px-3 py-1.5 hover:bg-rose-50 text-amber-600"
              onClick={() => {
                blockPeer(menuPeer);
                closeMenu();
              }}
            >
              Block
            </button>
            <button
              className="w-full text-left px-3 py-1.5 hover:bg-rose-50 text-red-600"
              onClick={() => {
                deleteChatForPeer(menuPeer);
                closeMenu();
              }}
            >
              Delete chat
            </button>
          </div>
        </div>
      )}

    </div>
  );
}

function ChatWindowLazy(props) {
  const [Comp, setComp] = useState(null);
  useEffect(() => {
    import("./ChatWindow.jsx").then((m) => setComp(() => m.default));
  }, []);
  if (!Comp) return null;
  return <Comp {...props} />;
}