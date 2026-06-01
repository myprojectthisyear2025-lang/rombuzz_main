/**
 * ============================================================
 * 📁 File: routes/account.js
 * 🧩 Purpose: Manage account lifecycle and verification actions.
 *
 * Endpoints:
 *   PATCH  /api/account/deactivate           → Soft deactivate current user
 *   DELETE /api/account/delete               → Permanently delete account
 *   POST   /api/account/request-email-change → Send verification code to new email
 *   POST   /api/account/confirm-email-change → Confirm code & update email
 *
 * 🧠 Features:
 *   - Deactivate or permanently delete accounts
 *   - Cleanly removes all associated data (posts, matches, likes, etc.)
 *   - 2-step secure email change with SendGrid (or dev console)
 *   - Authenticated via JWT (authMiddleware)
 *     
 *     Notes:
 *   - Used by Settings.jsx → “Deactivate” and “Delete Account” actions
 *   - Emits console logs for permanent deletions
 *   - Safe for both Render and local environments
 * ⚙️ Dependencies:
 *   - db.lowdb.js          → Persistent user data
 *   - auth-middleware.js   → JWT token validation
 *   - resend          → Email dispatch
 *   - utils/helpers.js     → baseSanitizeUser()
 *
 * ============================================================
 */

const express = require("express");
const router = express.Router();
const db = require("../models/db.lowdb");
const { Resend } = require("resend");
const authMiddleware = require("./auth-middleware");
const { baseSanitizeUser } = require("../utils/helpers");

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

/* ============================================================
   🔒 PATCH /api/account/deactivate  (MongoDB version)
   ------------------------------------------------------------
   Soft-deactivates the current user account by toggling visibility.
============================================================ */
const User = require("../models/User"); // 🧩 add near the top if missing

router.patch("/deactivate", authMiddleware, async (req, res) => {
  try {
    const updatedUser = await User.findOneAndUpdate(
      { id: req.user.id },
      {
        $set: {
          visibility: "deactivated",
          deactivatedAt: Date.now(),
        },
      },
      { new: true }
    ).lean();

    if (!updatedUser)
      return res.status(404).json({ error: "User not found" });

    res.json({
      success: true,
      message: "Account deactivated",
      user: baseSanitizeUser(updatedUser),
    });
  } catch (err) {
    console.error("❌ Error deactivating account:", err);
    res.status(500).json({ error: "Failed to deactivate account" });
  }
});


/* ============================================================
   🗑️ DELETE /api/account/delete (MongoDB version)
   ------------------------------------------------------------
   Permanently deletes a user's account and all related data.
============================================================ */
const PostModel = require("../models/PostModel");
const Notification = require("../models/Notification");
const Match = require("../models/Match");
const ChatRoom = require("../models/ChatRoom");
const Relationship = require("../models/Relationship");

router.delete("/delete", authMiddleware, async (req, res) => {
  try {
    const uid = req.user?.id;
    if (!uid)
      return res.status(401).json({ error: "Unauthorized: missing user ID" });

    const user = await User.findOne({ id: uid });
    if (!user) return res.status(404).json({ error: "User not found" });

    const emailLower = (user.email || "").trim().toLowerCase();

    // Remove all user-linked entities
    await Promise.all([
      User.deleteOne({ id: uid }),
      PostModel.deleteMany({ userId: uid }),
      Notification.deleteMany({ $or: [{ toId: uid }, { fromId: uid }] }),
      Match.deleteMany({
        $or: [{ user1: uid }, { user2: uid }, { users: uid }],
      }),
      ChatRoom.deleteMany({ participants: uid }),
      Relationship.deleteMany({ $or: [{ from: uid }, { to: uid }] }),
    ]);

    console.log(`🗑️ Account deleted permanently for ${emailLower}`);

    return res.json({
      success: true,
      message: "Account deleted permanently — you can now sign up again.",
    });
  } catch (err) {
    console.error("❌ Error deleting account:", err);
    res.status(500).json({
      error: "Server error deleting account",
      details: err.message,
    });
  }
});


/* ============================================================
   📬 POST /api/account/request-email-change  (MongoDB version)
   ------------------------------------------------------------
   Step 1: Send verification code to new email (10 min expiry)
============================================================ */

router.post("/request-email-change", authMiddleware, async (req, res) => {
  try {
    const { newEmail } = req.body || {};
    if (!newEmail) return res.status(400).json({ error: "newEmail is required" });

    const emailLower = newEmail.toLowerCase();

    // 🚫 Prevent duplicate email usage
    const exists = await User.exists({ email: emailLower });
    if (exists) return res.status(409).json({ error: "Email already in use" });

    const user = await User.findOne({ id: req.user.id });
    if (!user) return res.status(404).json({ error: "User not found" });

      // 🔢 Generate 6-digit verification code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = Date.now() + 10 * 60 * 1000; // 10 minutes

    user.pendingEmailChange = { email: emailLower, code, expires };
    await user.save();

    // ✉️ Send via Resend or log in dev
    if (!resend) {
      console.log(`📧 [DEV] Email-change code for ${emailLower}: ${code}`);
      return res.json({ success: true, dev: true });
    }

    await resend.emails.send({
      to: emailLower,
      from: process.env.FROM_EMAIL || "RomBuzz <onboarding@resend.dev>",
      subject: "Confirm your new email",
      text: `Your verification code is ${code}. It expires in 10 minutes.`,
      html: `<p>Your verification code is <strong>${code}</strong>. It expires in 10 minutes.</p>`,
    });

    res.json({ success: true });
  } catch (err) {
    console.error("❌ request-email-change error:", err);
    res.status(500).json({ error: "Failed to send verification email" });
  }
});


/* ============================================================
   ✅ POST /api/account/confirm-email-change (MongoDB version)
   ------------------------------------------------------------
   Step 2: Confirm the code and update the user’s email.
============================================================ */


router.post("/confirm-email-change", authMiddleware, async (req, res) => {
  try {
    const { code } = req.body || {};
    if (!code) return res.status(400).json({ error: "code required" });

    // 1️⃣ Find user
    const user = await User.findOne({ id: req.user.id });
    if (!user) return res.status(404).json({ error: "User not found" });

    const pending = user.pendingEmailChange;
    if (!pending)
      return res.status(400).json({ error: "No email change pending" });

    // 2️⃣ Expiration check
    if (pending.expires < Date.now()) {
      user.pendingEmailChange = null;
      await user.save();
      return res.status(400).json({ error: "Verification code expired" });
    }

    // 3️⃣ Invalid code check
    if (pending.code !== code)
      return res.status(400).json({ error: "Invalid code" });

    // 4️⃣ Apply new email
    user.email = pending.email;
    user.pendingEmailChange = null;
    await user.save();

    console.log(`📧 Email updated successfully for user ${user.id}`);

    res.json({ success: true, email: user.email });
  } catch (err) {
    console.error("❌ confirm-email-change (Mongo) error:", err);
    res.status(500).json({ error: "Failed to confirm email change" });
  }
});


module.exports = router;








