/**
 * ============================================================
 * 📁 File: routes/auth/password.js
 * 🧩 Purpose: Password recovery (Forgot → Verify → Reset)
 * ============================================================
 */

const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const sgMail = require("../../config/sendgrid");

const User = require("../../models/User");
const PasswordReset = require("../../models/PasswordReset");

/* ============================================================
   🔐 POST /api/auth/forgot-password
   ------------------------------------------------------------
   Sends a 6-digit reset code (always returns success)
============================================================ */
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: "Email is required" });

    const emailLower = String(email).trim().toLowerCase();

    // 🔒 DO NOT leak whether user exists
    const user = await User.findOne({ email: emailLower }).lean();
    if (!user) {
      return res.json({ success: true });
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 mins

    await PasswordReset.findOneAndUpdate(
      { email: emailLower },
      { code, expiresAt },
      { upsert: true, new: true }
    );

    // DEV fallback
    if (!process.env.SENDGRID_API_KEY) {
      console.log(`📧 [DEV] Reset code for ${emailLower}: ${code}`);
      return res.json({ success: true, dev: true });
    }

    await sgMail.send({
      to: emailLower,
      from: process.env.FROM_EMAIL || "myprojectthisyear2025@gmail.com",
      subject: "RomBuzz Password Reset Code",
      text: `Your RomBuzz reset code is ${code}. It expires in 10 minutes.`,
      html: `<p>Your RomBuzz reset code is <strong>${code}</strong>. It expires in 10 minutes.</p>`,
    });

    console.log("📧 Sent password reset code to", emailLower);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ forgot-password error:", err);
    res.status(500).json({ error: "Failed to send reset code" });
  }
});

/* ============================================================
   ✅ POST /api/auth/verify-reset-code
   ------------------------------------------------------------
   Verifies reset code ONLY (no password change)
============================================================ */
router.post("/verify-reset-code", async (req, res) => {
  try {
    const { email, code } = req.body || {};
    if (!email || !code) {
      return res.status(400).json({ error: "Email and code are required" });
    }

    const emailLower = String(email).trim().toLowerCase();

    const reset = await PasswordReset.findOne({ email: emailLower });
    if (!reset) {
      return res.status(400).json({ error: "Reset code not found or expired" });
    }

    if (reset.expiresAt < Date.now()) {
      await PasswordReset.deleteOne({ email: emailLower });
      return res.status(400).json({ error: "Reset code expired" });
    }

    if (reset.code !== code) {
      return res.status(400).json({ error: "Invalid reset code" });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("❌ verify-reset-code error:", err);
    res.status(500).json({ error: "Failed to verify reset code" });
  }
});

/* ============================================================
   🔁 POST /api/auth/reset-password
   ------------------------------------------------------------
   Verifies code AGAIN and updates password
============================================================ */
router.post("/reset-password", async (req, res) => {
  try {
    const { email, code, password } = req.body || {};
    if (!email || !code || !password) {
      return res
        .status(400)
        .json({ error: "Email, code, and password required" });
    }

    const emailLower = String(email).trim().toLowerCase();

    const reset = await PasswordReset.findOne({ email: emailLower });
    if (!reset) {
      return res.status(400).json({ error: "No reset request found" });
    }

    if (reset.expiresAt < Date.now()) {
      await PasswordReset.deleteOne({ email: emailLower });
      return res.status(400).json({ error: "Reset code expired" });
    }

    if (reset.code !== code) {
      return res.status(400).json({ error: "Invalid reset code" });
    }

    const user = await User.findOne({ email: emailLower });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    user.passwordHash = await bcrypt.hash(password, 10);
    await user.save();

    await PasswordReset.deleteOne({ email: emailLower });

    res.json({ success: true, message: "Password reset successful" });
  } catch (err) {
    console.error("❌ reset-password error:", err);
    res.status(500).json({ error: "Failed to reset password" });
  }
});

console.log("✅ Auth: Password routes initialized");
module.exports = router;
