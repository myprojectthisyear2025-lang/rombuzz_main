/**
 * ============================================================
 * 📁 File: routes/posts.js
 * 🧩 Purpose: Handles user posts for the LetsBuzz feed (status, images, reels).
 *
 * Endpoints:
 *   POST /api/posts            → Create a new post
 *   GET  /api/posts/me         → Get logged-in user’s posts
 *   GET  /api/posts/matches    → Get posts from matched users
 *   GET  /api/reels            → Get only video/reel posts from matches
 *
 * Features:
 *   - Supports text, image, and video post types
 *   - Fetches posts from matches with visibility="matches"
 *   - Automatically detects media type from file extension
 *   - Provides separate reels feed filtered for videos
 *
 * Dependencies:
 *   - db.lowdb.js        → LowDB JSON database
 *   - auth-middleware.js → Validates JWT session
 *   - shortid            → For post IDs
 *   - utils/helpers.js   → baseSanitizeUser()
 *
 * Notes:
 *   - Used by LetsBuzz.jsx, MyBuzz.jsx, and Reels.jsx
 *   - Returns sanitized user data with each post
 * ============================================================
 */

const express = require("express");
const router = express.Router();
const shortid = require("shortid");
const { db } = require("../models/db.lowdb");
const authMiddleware = require("./auth-middleware");
const {
  ensureFeatureAllowed,
  sendFeatureRestrictionError,
} = require("../utils/moderation");
const { baseSanitizeUser } = require("../utils/helpers");
const { getSignedMediaUrl, isR2Key } = require("../utils/r2Media");
const PostModel = require("../models/PostModel"); // Mongo posts
const User = require("../models/User");           // Mongo users (for user card on each post)

function normalizeMediaString(value = "") {
  return String(value || "").trim();
}

async function signR2Value(value, expiresInSeconds = 3600) {
  const raw = normalizeMediaString(value);
  if (!raw) return "";
  if (!isR2Key(raw)) return raw;

  return getSignedMediaUrl(raw, expiresInSeconds);
}

async function signPostForResponse(post = {}, expiresInSeconds = 7200) {
  const raw =
    typeof post?.toObject === "function"
      ? post.toObject({ flattenMaps: true })
      : { ...(post || {}) };

  return {
    ...raw,
    mediaUrl: await signR2Value(raw.mediaUrl, expiresInSeconds),
    r2Key: isR2Key(raw.mediaUrl) ? raw.mediaUrl : raw.r2Key || "",
  };
}

async function signUserForPost(user = {}) {
  const safe = baseSanitizeUser(user || {});
  safe.avatar = await signR2Value(safe.avatar, 21600);
  return safe;
}

async function enforcePostingAllowed(req, res) {
  try {
    await ensureFeatureAllowed(req.user.id, "posting");
    return true;
  } catch (err) {
    sendFeatureRestrictionError(res, err);
    return false;
  }
}

// =======================
// ✅ Create a new post (MongoDB)
// =======================
router.post("/", authMiddleware, async (req, res) => {
  try {
    if (!(await enforcePostingAllowed(req, res))) return;

    const { text, mediaUrl, type } = req.body || {};

    // 🧩 Determine post type dynamically
    const decideType = () => {
      if (type) return type;
      if (!mediaUrl) return "text";
      const lower = mediaUrl.toLowerCase();
      if (
        /\.(mp4|mov|webm|ogg)$/.test(lower) ||
        mediaUrl.includes("/video/upload/")
      )
        return "video";
      return "image";
    };

    // 🔨 Build new post document
    const newPost = {
      id: shortid.generate(),
      userId: req.user.id,
      text: (text || "").trim(),
      mediaUrl: mediaUrl || "",
      type: decideType(),
      privacy: "matches", // same as old visibility
      reactions: {},
      comments: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isActive: true,
    };

    // 🗄️ Save to MongoDB
  const created = await PostModel.create(newPost);

console.log(`🪶 New post created by ${req.user.id}: ${created.id}`);

// 🔴 REALTIME: notify matched users (posts + reels)
try {
  const io = global.io;
  const onlineUsers = global.onlineUsers || {};

  await db.read();
  const myId = req.user.id;

  const matches = (db.data.matches || [])
    .filter(m => Array.isArray(m.users) && m.users.includes(myId))
    .flatMap(m => m.users)
    .filter(id => id !== myId);

 const signedCreated = await signPostForResponse(created, 7200);

matches.forEach(uid => {
    const socketId = onlineUsers[uid];
    if (socketId) {
      io.to(String(socketId)).emit("buzz:post:new", {
        post: signedCreated,
        fromId: myId,
      });
    }
  });
} catch (e) {
  console.log("⚠️ buzz realtime emit failed", e);
}

res.json({ post: await signPostForResponse(created, 7200) });

  } catch (err) {
    console.error("❌ Mongo create /posts error:", err);
    res.status(500).json({ error: "Failed to create post" });
  }
});


// =======================
// ✅ Get own posts (MongoDB)
// =======================

router.get("/me", authMiddleware, async (req, res) => {
  try {
    // Find all posts authored by current user
    const posts = await PostModel.find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .lean();

    if (!posts || posts.length === 0) {
      return res.json({ posts: [] }); // No posts yet
    }

    const signedPosts = await Promise.all(
      posts.map((post) => signPostForResponse(post, 7200))
    );

    res.json({ posts: signedPosts });
  } catch (err) {
    console.error("❌ Mongo fetch /posts/me error:", err);
    res.status(500).json({ error: "Failed to load user posts" });
  }
});


// =======================
// ✅ Get posts from matched users (MongoDB)
// =======================
router.get("/matches", authMiddleware, async (req, res) => {
  try {
    // 1) Still read matches from LowDB for now
    await db.read();
    const myId = req.user.id;

    const myMatches = (db.data.matches || [])
      .filter(m => Array.isArray(m.users) && m.users.includes(myId))
      .map(m => m.users.find(id => id !== myId))
      .filter(Boolean);

    if (myMatches.length === 0) {
      return res.json({ posts: [] });
    }

    // 2) Fetch posts for those matched users from Mongo
    const mongoPosts = await PostModel.find({
      userId: { $in: myMatches },
      privacy: "matches",
      isActive: true,
    })
      .sort({ createdAt: -1 })
      .lean();

    if (!mongoPosts.length) {
      return res.json({ posts: [] });
    }

     // 3) Pull user cards for each owner from Mongo (sanitized)
    const owners = await User.find({ id: { $in: myMatches } }).lean();
    const ownersMap = new Map(
      await Promise.all(
        owners.map(async (u) => [u.id, await signUserForPost(u)])
      )
    );

    // 4) Attach sanitized user to each post (match previous shape)
    const posts = await Promise.all(
      mongoPosts.map(async (p) => ({
        ...(await signPostForResponse(p, 7200)),
        user: ownersMap.get(p.userId) || { id: p.userId, firstName: "", lastName: "", avatar: "" },
      }))
    );

    return res.json({ posts });
  } catch (err) {
    console.error("❌ Mongo fetch /posts/matches error:", err);
    res.status(500).json({ error: "Failed to load matched posts" });
  }
});


// =======================
// ✅ Get only video/reel posts from matched users (MongoDB)
// =======================
router.get("/reels", authMiddleware, async (req, res) => {
  try {
    // 1️⃣ Read match relationships (still from LowDB for now)
    await db.read();
    const myId = req.user.id;

    const myMatches = (db.data.matches || [])
      .filter(m => Array.isArray(m.users) && m.users.includes(myId))
      .map(m => m.users.find(id => id !== myId))
      .filter(Boolean);

    if (myMatches.length === 0) {
      return res.json({ posts: [] });
    }

    // 2️⃣ Query Mongo for all "reel" or "video" type posts
    const reels = await PostModel.find({
      userId: { $in: myMatches },
      type: { $in: ["reel", "video"] },
      isActive: true,
    })
      .sort({ createdAt: -1 })
      .lean();

    if (!reels.length) {
      return res.json({ posts: [] });
    }

       // 3️⃣ Get user details from Mongo for display
    const owners = await User.find({ id: { $in: myMatches } }).lean();
    const ownersMap = new Map(
      await Promise.all(
        owners.map(async (u) => [u.id, await signUserForPost(u)])
      )
    );

    // 4️⃣ Merge posts with owner info
    const posts = await Promise.all(
      reels.map(async (p) => ({
        ...(await signPostForResponse(p, 7200)),
        user: ownersMap.get(p.userId) || { id: p.userId, firstName: "", lastName: "", avatar: "" },
      }))
    );

       return res.json({ posts });
  } catch (err) {
    console.error("❌ Mongo fetch /posts/reels error:", err);
    res.status(500).json({ error: "Failed to load reels feed" });
  }
});


/* ============================================================
   ❤️ POST REACTIONS (LIKE / UNLIKE)
   Route: POST /api/posts/:postId/react
   Purpose: Allows a user to like or unlike a post.
   Notes:
     - Uses PostModel (MongoDB)
     - Stores reactions in a map-like object: { userId: true }
     - Fully backward compatible with old structure
============================================================ */

router.post("/:postId/react", authMiddleware, async (req, res) => {
  try {
    const { postId } = req.params;
    const myId = req.user.id;

    // 1️⃣ Find post in Mongo
    const post = await PostModel.findOne({ id: postId });
    if (!post) return res.status(404).json({ error: "Post not found" });

    // 2️⃣ Initialize reactions if missing
    if (!post.reactions) post.reactions = {};

    // 3️⃣ Toggle like
    const alreadyLiked = !!post.reactions[myId];
    if (alreadyLiked) {
      delete post.reactions[myId]; // unlike
    } else {
      post.reactions[myId] = true; // like
    }

    post.updatedAt = Date.now();
    await post.save();

    // 4️⃣ Return updated reaction info
      const likesCount = Object.keys(post.reactions).length;
    return res.json({
      success: true,
      liked: !alreadyLiked,
      likesCount,
    });
  } catch (err) {
    console.error("❌ Mongo /posts/:postId/react error:", err);
    res.status(500).json({ error: "Failed to toggle like" });
  }
});


/* ============================================================
   💬 COMMENTS: FETCH, EDIT, DELETE (MongoDB)
   Routes:
     GET    /api/posts/:postId/comments
     PATCH  /api/posts/:postId/comments/:commentId
     DELETE /api/posts/:postId/comments/:commentId
   ============================================================ */

// ✅ Fetch all comments for a post (with author info)
router.get("/:postId/comments", authMiddleware, async (req, res) => {
  try {
    const { postId } = req.params;
    const post = await PostModel.findOne({ id: postId }).lean();
    if (!post) return res.status(404).json({ error: "Post not found" });

    // Fetch unique author IDs
    const userIds = [...new Set(post.comments.map(c => c.userId))];
    const authors = await User.find({ id: { $in: userIds } }).lean();
    const authorMap = new Map(authors.map(u => [u.id, u]));

    // Attach author data
    const comments = post.comments.map(c => ({
      ...c,
      author: authorMap.get(c.userId)
        ? {
            id: authorMap.get(c.userId).id,
            firstName: authorMap.get(c.userId).firstName,
            lastName: authorMap.get(c.userId).lastName,
            avatar: authorMap.get(c.userId).avatar,
          }
        : { id: c.userId, firstName: "Unknown", lastName: "", avatar: "" },
    }));

    res.json({ comments });
  } catch (err) {
    console.error("❌ Mongo GET /posts/:postId/comments error:", err);
    res.status(500).json({ error: "Failed to fetch comments" });
  }
});

// ✅ Edit own comment
router.patch("/:postId/comments/:commentId", authMiddleware, async (req, res) => {
  try {
    if (!(await enforcePostingAllowed(req, res))) return;

    const { postId, commentId } = req.params;
    const { text } = req.body || {};
    const myId = req.user.id;

    if (!text?.trim()) return res.status(400).json({ error: "Text required" });

    const post = await PostModel.findOne({ id: postId });
    if (!post) return res.status(404).json({ error: "Post not found" });

    const comment = post.comments.find(c => c.id === commentId);
    if (!comment) return res.status(404).json({ error: "Comment not found" });
    if (comment.userId !== myId)
      return res.status(403).json({ error: "Not your comment" });

    comment.text = text.trim();
    comment.updatedAt = Date.now();

    await post.save();
    res.json({ success: true, comment });
  } catch (err) {
    console.error("❌ Mongo PATCH /posts/:postId/comments/:commentId error:", err);
    res.status(500).json({ error: "Failed to edit comment" });
  }
});

// ✅ Delete own comment
router.delete("/:postId/comments/:commentId", authMiddleware, async (req, res) => {
  try {
    const { postId, commentId } = req.params;
    const myId = req.user.id;

    const post = await PostModel.findOne({ id: postId });
    if (!post) return res.status(404).json({ error: "Post not found" });

    const before = post.comments.length;
    post.comments = post.comments.filter(
      c => !(c.id === commentId && c.userId === myId)
    );

    const changed = before !== post.comments.length;
    if (changed) await post.save();

    res.json({ success: changed });
  } catch (err) {
    console.error("❌ Mongo DELETE /posts/:postId/comments/:commentId error:", err);
    res.status(500).json({ error: "Failed to delete comment" });
  }
});


/* ============================================================
   💖 COMMENT REACTIONS (HEART + EMOJI)
   Routes:
     POST /api/posts/:postId/comments/:commentId/heart
     POST /api/posts/:postId/comments/:commentId/react-emoji
   ============================================================ */

router.post("/:postId/comments/:commentId/heart", authMiddleware, async (req, res) => {
  try {
    const { postId, commentId } = req.params;
    const myId = req.user.id;

    const post = await PostModel.findOne({ id: postId });
    if (!post) return res.status(404).json({ error: "Post not found" });

    const comment = post.comments.find(c => c.id === commentId);
    if (!comment) return res.status(404).json({ error: "Comment not found" });

    if (!comment.reactions) comment.reactions = {};

    const alreadyLiked = comment.reactions[myId] === "❤️";
    if (alreadyLiked) {
      delete comment.reactions[myId];
    } else {
      comment.reactions[myId] = "❤️";
    }

    comment.updatedAt = Date.now();
    await post.save();

    const counts = {};
    Object.values(comment.reactions).forEach(emoji => {
      counts[emoji] = (counts[emoji] || 0) + 1;
    });

    return res.json({
      success: true,
      liked: !alreadyLiked,
      count: counts["❤️"] || 0,
    });
  } catch (err) {
    console.error("❌ Mongo POST /comments/:id/heart error:", err);
    res.status(500).json({ error: "Failed to toggle heart" });
  }
});

router.post("/:postId/comments/:commentId/react-emoji", authMiddleware, async (req, res) => {
  try {
    const { postId, commentId } = req.params;
    const { emoji = "❤️" } = req.body || {};
    const myId = req.user.id;

    const post = await PostModel.findOne({ id: postId });
    if (!post) return res.status(404).json({ error: "Post not found" });

    const comment = post.comments.find(c => c.id === commentId);
    if (!comment) return res.status(404).json({ error: "Comment not found" });

    if (!comment.reactions) comment.reactions = {};
    comment.reactions[myId] = emoji;
    comment.updatedAt = Date.now();

    await post.save();

    const counts = {};
    Object.values(comment.reactions).forEach(e => {
      counts[e] = (counts[e] || 0) + 1;
    });

    const reactors = Object.entries(comment.reactions).map(([uid, e]) => ({
      userId: uid,
      emoji: e,
    }));

    return res.json({
      success: true,
      counts,
      reactors,
      liked: true,
    });
  } catch (err) {
    console.error("❌ Mongo POST /comments/:id/react-emoji error:", err);
    res.status(500).json({ error: "Failed to react with emoji" });
  }
});

module.exports = router;

