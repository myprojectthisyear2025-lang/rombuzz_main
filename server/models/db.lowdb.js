/**
 * ============================================================
 * 📁 File: models/db.lowdb.js
 * 🧩 Purpose: Initializes and manages the LowDB JSON database for RomBuzz.
 *
 * Features:
 *   - Sets up the main database file (`db.json`)
 *   - Ensures default structure for users, posts, matches, messages, etc.
 *   - Performs initial read/write and safe fallback initialization
 *   - Supports Windows-safe write guard (via writeGuard.js)
 *
 * Collections:
 *   users, posts, likes, matches, notifications, messages,
 *   blocks, reports, roomMessages, matchStreaks
 *
 * Dependencies:
 *   - lowdb + JSONFile adapter
 *   - writeGuard.js → Adds retry logic for EPERM/EBUSY file locking
 *
 * Notes:
 *   - Automatically runs on server start (index.js)
 *   - Logs “✅ LowDB initialized” when ready
 *   - Used across all route handlers for persistent storage
 * ============================================================
 */

// =======================
// 📦 DATABASE (LowDB)
// =======================

const { Low } = require("lowdb");
const { JSONFile } = require("lowdb/node");
const path = require("path");
const bcrypt = require("bcrypt");

// Path to db.json
const dbFile = path.join(__dirname, "../db.json");
const adapter = new JSONFile(dbFile);

// 🟩 FIX: Provide default data (required for LowDB v3, safe for v1/v2)
const defaultData = {
  users: [],
  posts: [],
  likes: [],
  matches: [],
  notifications: [],
  messages: [],
  blocks: [],
  reports: [],
  roomMessages: [],
  matchStreaks: {},
};

// 🟩 FIX: Pass defaults directly → fixes "missing default data" on Render
const db = new Low(adapter, defaultData);

// Initialize + migrate
(async () => {
  await db.read();

  // Ensure default structure (v1/v2 safety)
  db.data ||= defaultData;

  await db.write();

  // 🔐 Migrate any plain passwords to hashed
  try {
    let updated = 0;
    for (const u of db.data.users || []) {
      if (u.password && !u.passwordHash) {
        u.passwordHash = await bcrypt.hash(u.password, 10);
        delete u.password;
        updated++;
      }
    }

    if (updated > 0) {
      await db.write();
      console.log(`🔒 Migrated ${updated} legacy plain-text password(s)`);
    } else {
      console.log("✅ No legacy plaintext passwords");
    }
  } catch (err) {
    console.error("⚠️ Password migration error:", err);
  }

  console.log("✅ LowDB initialized:", dbFile);
})();

module.exports = db;