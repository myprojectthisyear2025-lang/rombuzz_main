/**
 * ============================================================
 * 📁 File: routes/buzzPosts.js
 * 💬 Purpose: Entry point for all BuzzPost and media interactions
 *             in the RomBuzz “Enhanced LetsBuzz” system.
 *
 * Description:
 *   This file aggregates modular route handlers from the
 *   `routes/buzzpost/` folder, keeping this main file lightweight.
 *
 * Folder structure:
 *   ├── buzz.create.js       → Create posts (Mongo)
 *   ├── buzz.feed.js         → Fetch posts feed (matches/public)
 *   ├── buzz.bookmarks.js    → Bookmarks + shares
 *   ├── buzz.edit.js         → Edit or delete posts
 *   ├── buzz.media.js        → Media privacy, comments, reactions
 *   ├── buzz.engagement.js   → Likes ❤️ + Emoji reactions 😍🔥😂
 *   └── (future modules)     → e.g., buzz.views.js, buzz.analytics.js
 *
 * Notes:
 *   - Keeps identical API endpoints as before (no frontend breakage)
 *   - Uses MongoDB for all persistent data, including feed visibility and matches.
 *   - All notifications use sendNotification() for consistency.
 *
 * Dependencies:
 *   - Express Router
 *   - Submodules under ./buzzpost/
 * ============================================================
 */

const express = require("express");
const router = express.Router();

/* ============================================================
   🧩 Modular Route Imports (from /routes/buzzpost/)
============================================================ */

// 1️⃣ Post creation
router.use(require("./buzzpost/buzz.create"));

// 2️⃣ Feed retrieval (matched, public, specific)
router.use(require("./buzzpost/buzz.feed"));

// 3️⃣ Bookmarks and post sharing
router.use(require("./buzzpost/buzz.bookmarks"));

// 4️⃣ Edit and delete posts
router.use(require("./buzzpost/buzz.edit"));

// 5️⃣ Media reactions, comments, privacy toggles
router.use(require("./buzzpost/buzz.media"));

// 5.1️⃣ Media gifting (gallery gifts)
router.use(require("./buzzpost/buzz.media.gifts"));

// ✅ 5.1.1️⃣ Post/Reel gifting (LetsBuzz feed gifts)
router.use(require("./buzzpost/buzz.post.gifts"));

// 5.2️⃣ Media insights + match-private threads (Insights Drawer backend)
router.use(require("./buzzpost/buzz.media.insights"));

// 6️⃣ Likes ❤️ and emoji reactions 😍🔥😂 (merged file)
router.use(require("./buzzpost/buzz.engagement"));


// 7️⃣ (Optional future) View counter, analytics, reports, etc.
// router.use(require("./buzzpost/buzz.views"));

/* ============================================================
   ✅ Export Combined Router
============================================================ */
module.exports = router;
