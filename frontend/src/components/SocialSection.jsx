
//Rombuzz_main/frontend/src/components/SocialSection.jsx

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { FaHandshake, FaHeart, FaUserFriends } from "react-icons/fa";
import { IoClose } from "react-icons/io5";
import { useNavigate } from "react-router-dom";

//const API_BASE = "http://localhost:4000/api";
//const API_BASE = process.env.REACT_APP_API_BASE || "https://rombuzz-api.onrender.com/api";
import { API_BASE } from "../config";

// Add this helper function at the top (after imports)
const getToken = () =>
  localStorage.getItem("token") || sessionStorage.getItem("token") || "";

// =============== CONFIRM POPUP ===============
function ConfirmPopup({ visible, text, onConfirm, onCancel }) {
  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.8, opacity: 0 }}
        className="bg-white/20 backdrop-blur-xl border border-white/30 shadow-2xl p-6 rounded-2xl max-w-sm w-full text-center"
      >
        <div className="text-lg text-white font-semibold mb-4">{text}</div>

        <div className="flex gap-3 justify-center mt-2">
          <button
            onClick={onConfirm}
            className="px-4 py-2 rounded-full bg-rose-500 text-white hover:bg-rose-600 transition"
          >
            Yes
          </button>

          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-full bg-white/40 text-white hover:bg-white/60 transition"
          >
            Cancel
          </button>
        </div>
      </motion.div>
    </div>
  );
}

export default function SocialSection({ user }) {
  const token = getToken();
  const [stats, setStats] = useState({
    likedCount: 0,
    likedYouCount: 0,
    matchCount: 0,
  });
  const [list, setList] = useState([]);
  const [activeTab, setActiveTab] = useState(null);
  const [loading, setLoading] = useState(false);
  // --- NEW Confirm Popup State ---
const [confirmData, setConfirmData] = useState({
  visible: false,
  text: "",
  onConfirm: null,
});

  const navigate = useNavigate();

  // Fetch counters
  useEffect(() => {
    if (!token) return;
    fetch(`${API_BASE}/users/social-stats`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then(setStats)
      .catch(console.error);
  }, [token]);

  // Open list - FIXED DATA HANDLING
  const openList = async (type) => {
    setActiveTab(type);
    setLoading(true);
    
    try {
      let response;
      
      if (type === "matches") {
        // Use matches endpoint
        response = await fetch(`${API_BASE}/matches`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await response.json();
        console.log("Matches data:", data); // Debug log
        
        // Handle different response structures
        if (data.matches && Array.isArray(data.matches)) {
          setList(data.matches);
        } else if (Array.isArray(data)) {
          setList(data);
        } else {
          setList([]);
        }
      } else {
        // Use social endpoint for liked/likedYou
        response = await fetch(`${API_BASE}/social/${type}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await response.json();
        console.log(`${type} data:`, data); // Debug log
        
        // Handle different response structures
        if (data.users && Array.isArray(data.users)) {
          setList(data.users);
        } else if (Array.isArray(data)) {
          setList(data);
        } else {
          setList([]);
        }
      }
    } catch (error) {
      console.error(`Error loading ${type}:`, error);
      setList([]);
    } finally {
      setLoading(false);
    }
  };

  const closeList = () => {
    setActiveTab(null);
    setList([]);
  };

  // --- NEW: Accept / Reject / Remove handlers ---
const handleRespond = async (fromId, action) => {
  try {
    const res = await fetch(`${API_BASE}/likes/respond`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ fromId, action }),
    });
    const data = await res.json();

    if (data.success) {
      // Remove user from list without refresh
      setList((prev) => prev.filter((u) => u.id !== fromId));
      // Update counters
      setStats((s) => ({
        ...s,
        likedCount: activeTab === "liked" ? s.likedCount - 1 : s.likedCount,
        likedYouCount:
          activeTab === "likedYou" ? s.likedYouCount - 1 : s.likedYouCount,
        matchCount: data.matched ? s.matchCount + 1 : s.matchCount,
      }));
    }
  } catch (err) {
    console.error("respond error", err);
  }
};

const handleRemoveLike = async (targetId) => {
  // "Remove" = reject from our side (same cleanup)
  await handleRespond(targetId, "reject");
};

  // Card hover animation
  const cardHover = {
    rest: { scale: 1, y: 0, boxShadow: "0 0 0 rgba(0,0,0,0)" },
    hover: {
      scale: 1.05,
      y: -4,
      boxShadow: "0 6px 20px rgba(0,0,0,0.15)",
      transition: { duration: 0.25 },
    },
  };

  return (
    <div className="mt-8 bg-gradient-to-br from-white/70 via-white/60 to-pink-50 rounded-2xl p-6 shadow-sm border border-rose-100">
      <h2 className="text-xl font-semibold text-gray-800 mb-5 flex items-center gap-2">
        <FaUserFriends className="text-rose-500" />
        Social Connections
      </h2>

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-4">
        <motion.button
          variants={cardHover}
          initial="rest"
          whileHover="hover"
          onClick={() => openList("liked")}
          className="bg-white p-5 rounded-2xl text-center border border-gray-100 hover:border-rose-200 transition"
        >
          <FaHeart className="text-3xl text-rose-500 mx-auto mb-2" />
          <div className="text-2xl font-bold text-gray-800">{stats.likedCount}</div>
          <div className="text-sm text-gray-500">Liked</div>
        </motion.button>

        <motion.button
          variants={cardHover}
          initial="rest"
          whileHover="hover"
          onClick={() => openList("likedYou")}
          className="bg-white p-5 rounded-2xl text-center border border-gray-100 hover:border-pink-200 transition"
        >
          <FaHandshake className="text-3xl text-pink-500 mx-auto mb-2" />
          <div className="text-2xl font-bold text-gray-800">{stats.likedYouCount}</div>
          <div className="text-sm text-gray-500">Liked You</div>
        </motion.button>

        <motion.button
          variants={cardHover}
          initial="rest"
          whileHover="hover"
          onClick={() => openList("matches")}
          className="bg-white p-5 rounded-2xl text-center border border-gray-100 hover:border-rose-200 transition"
        >
          <FaUserFriends className="text-3xl text-rose-600 mx-auto mb-2" />
          <div className="text-2xl font-bold text-gray-800">{stats.matchCount}</div>
          <div className="text-sm text-gray-500">Matches</div>
        </motion.button>
      </div>

      {/* Modal */}
      <AnimatePresence>
        {activeTab && (
          <motion.div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              className="bg-white rounded-2xl w-full max-w-md p-6 shadow-2xl relative"
            >
              <button
                onClick={closeList}
                className="absolute top-3 right-3 p-2 hover:bg-gray-100 rounded-full transition"
              >
                <IoClose className="text-2xl text-gray-600" />
              </button>

              <h3 className="text-xl font-semibold mb-4 capitalize text-gray-800 flex items-center gap-2">
                {activeTab === "liked" && <>❤️ People You Liked</>}
                {activeTab === "likedYou" && <>💘 People Who Liked You</>}
                {activeTab === "matches" && <>💞 Your Matches</>}
              </h3>

              {loading && (
                <div className="text-center py-8 text-gray-500 text-sm">
                  Loading profiles...
                </div>
              )}

              {!loading && (
                <>
                  <div className="text-sm text-gray-500 mb-3">
                    Showing {list.length} {list.length === 1 ? 'user' : 'users'}
                  </div>
                  
                  {list.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 text-gray-500">
                      <img
                        src="https://cdn-icons-png.flaticon.com/512/6596/6596115.png"
                        alt="empty"
                        className="h-20 w-20 opacity-70 mb-3"
                      />
                      <p>No users found here yet.</p>
                    </div>
                  ) : (
                    <AnimatePresence>
                      <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-2">                      {list.map((u) => (
                      <motion.div
                        key={u.id}
                        layout
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 20 }}
                        className="p-3 border border-gray-100 rounded-xl hover:bg-gray-50 transition-all shadow-sm hover:shadow-md"
                      >

                            <div className="flex items-center gap-3">
                              <img
                                src={u.avatar || "https://via.placeholder.com/48?text=No+Photo"}
                                alt={u.firstName}
                                className="h-12 w-12 rounded-full object-cover border border-gray-200"
                              />
                              <div className="flex-1 min-w-0">
                                <div className="font-semibold text-gray-800 truncate">
                                  {u.firstName} {u.lastName}
                                </div>
                                <div className="text-sm text-gray-500 truncate">
                                  {u.bio || "No bio yet"}
                                </div>
                              </div>
                            </div>

                            {/* BUTTONS */}
                            {activeTab === "likedYou" && (
                              <div className="flex gap-2 mt-3 justify-end">
                                <button
                                  onClick={() => handleRespond(u.id, "accept")}
                                  className="px-3 py-1.5 rounded-full bg-green-500 text-white hover:opacity-90"
                                >
                                  Accept
                                </button>
                              <button
                            onClick={() =>
                              setConfirmData({
                                visible: true,
                                text: "Are you sure you want to reject this request?",
                                onConfirm: () => {
                                  setList((prev) => prev.filter((x) => x.id !== u.id)); // instant removal
                                  handleRespond(u.id, "reject");
                                  setConfirmData({ visible: false, text: "", onConfirm: null });
                                },
                              })
                            }
                            className="px-3 py-1.5 rounded-full bg-gray-300 text-gray-800 hover:bg-gray-400 transition"
                          >
                            Reject
                          </button>

                                <button
                                  onClick={() => navigate(`/view/${u.id}`)}
                                  className="px-3 py-1.5 rounded-full bg-gradient-to-r from-rose-500 to-pink-500 text-white"
                                >
                                  View
                                </button>
                              </div>
                            )}

                            {activeTab === "liked" && (
                              <div className="flex gap-2 mt-3 justify-end">
                                <button
                                  onClick={() => navigate(`/view/${u.id}`)}
                                  className="px-3 py-1.5 rounded-full bg-gradient-to-r from-rose-500 to-pink-500 text-white"
                                >
                                  View
                                </button>
                                <button
                            onClick={() =>
                              setConfirmData({
                                visible: true,
                                text: "Remove your like?",
                                onConfirm: () => {
                                  // instant UI removal
                                  setList((prev) => prev.filter((x) => x.id !== u.id));
                                  handleRemoveLike(u.id);
                                  setConfirmData({ visible: false, text: "", onConfirm: null });
                                },
                              })
                            }
                            className="px-3 py-1.5 rounded-full bg-gray-300 text-gray-800 hover:bg-gray-400 transition"
                          >
                            Remove
                          </button>

                              </div>
                            )}

                            {activeTab === "matches" && (
                              <div className="flex gap-2 mt-3 justify-end">
                                <button
                                  onClick={() => navigate(`/view/${u.id}`)}
                                  className="px-3 py-1.5 rounded-full bg-gradient-to-r from-rose-500 to-pink-500 text-white"
                                >
                                  View
                                </button>
                              </div>
                            )}
                              </motion.div>

                      ))}
                    </div>
                    </AnimatePresence>

                  )}
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmPopup
  visible={confirmData.visible}
  text={confirmData.text}
  onConfirm={confirmData.onConfirm}
  onCancel={() =>
    setConfirmData({ visible: false, text: "", onConfirm: null })
  }
/>

    </div>
  );
}