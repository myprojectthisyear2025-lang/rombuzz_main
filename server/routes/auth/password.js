/**
 * ============================================================
 * 📁 File: routes/auth/password.js
 * 🧩 Purpose: Password recovery (Forgot → Verify → Reset)
 * 📧 Email provider: Resend (standardized)
 * ============================================================
 */

const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const { Resend } = require("resend");

// ✅ STANDARDIZED RESEND INSTANCE (USED EVERYWHERE)
const resend = new Resend(process.env.RESEND_API_KEY);

const User = require("../../models/User");
const PasswordReset = require("../../models/PasswordReset");

/* ============================================================
   🔐 POST /api/auth/forgot-password
   ------------------------------------------------------------
   Sends 6-digit reset code via Resend
============================================================ */
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: "Email is required" });

    const emailLower = String(email).trim().toLowerCase();

    // 🔒 Do NOT leak account existence
    const user = await User.findOne({ email: emailLower }).lean();
    if (!user) {
      return res.json({ success: true });
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min

    await PasswordReset.findOneAndUpdate(
      { email: emailLower },
      { code, expiresAt },
      { upsert: true, new: true }
    );

    // DEV fallback
    if (!process.env.RESEND_API_KEY) {
      console.log(`📧 [DEV] Password reset code for ${emailLower}: ${code}`);
      return res.json({ success: true, dev: true });
    }

    await resend.emails.send({
      from: process.env.RESEND_FROM || "no-reply@rombuzz.com",
      to: emailLower,
      subject: "RomBuzz Password Reset Code",
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; padding:24px; background:#f5f5f7;">
          <div style="max-width:420px; margin:0 auto; background:#fff; border-radius:20px; padding:32px 28px; box-shadow:0 8px 28px rgba(0,0,0,.10); text-align:center;">
            
            <img
              src="https://raw.githubusercontent.com/myprojectthisyear2025-lang/rombuzz_main/main/frontend/public/assets/logo.png"
              alt="RomBuzz"
              style="width:90px; margin-bottom:20px;"
            />

            <h2 style="font-size:22px; font-weight:600; margin-bottom:12px;">
              Reset Your Password
            </h2>

            <p style="color:#444; margin-bottom:22px;">
              Use the code below to reset your RomBuzz password.
            </p>

            <div style="background:#f2f2f7; border-radius:14px; padding:18px 0; margin-bottom:24px;">
              <p style="font-size:40px; font-weight:800; letter-spacing:10px; margin:0;">
                ${code}
              </p>
            </div>

            <p style="color:#555;">
              This code expires in <strong>10 minutes</strong>.
            </p>

            <p style="margin-top:18px; font-size:13px; color:#8a6d1f; background:#fffbe6; padding:12px; border-radius:12px;">
              ⚠️ Never share this code with anyone.
            </p>

            <p style="margin-top:18px; font-size:12px; color:#999;">
              RomBuzz © 2025
            </p>
          </div>
        </div>
      `,
    });

    res.json({ success: true });
  } catch (err) {
    console.error("❌ forgot-password error:", err);
    res.status(500).json({ error: "Failed to send reset code" });
  }
});

/* ============================================================
   ✅ POST /api/auth/verify-reset-code
============================================================ */
router.post("/verify-reset-code", async (req, res) => {
  try {
    const { email, code } = req.body || {};
    if (!email || !code)
      return res.status(400).json({ error: "Email and code required" });

    const emailLower = String(email).trim().toLowerCase();
    const reset = await PasswordReset.findOne({ email: emailLower });

    if (!reset)
      return res.status(400).json({ error: "Reset code not found or expired" });

    if (reset.expiresAt < Date.now()) {
      await PasswordReset.deleteOne({ email: emailLower });
      return res.status(400).json({ error: "Reset code expired" });
    }

    if (reset.code !== code)
      return res.status(400).json({ error: "Invalid reset code" });

    res.json({ success: true });
  } catch (err) {
    console.error("❌ verify-reset-code error:", err);
    res.status(500).json({ error: "Failed to verify reset code" });
  }
});

/* ============================================================
   🔁 POST /api/auth/reset-password
============================================================ */
router.post("/reset-password", async (req, res) => {
  try {
    const { email, code, password } = req.body || {};
    if (!email || !code || !password)
      return res.status(400).json({ error: "Email, code, and password required" });

    const emailLower = String(email).trim().toLowerCase();
    const reset = await PasswordReset.findOne({ email: emailLower });

    if (!reset)
      return res.status(400).json({ error: "No reset request found" });

    if (reset.expiresAt < Date.now()) {
      await PasswordReset.deleteOne({ email: emailLower });
      return res.status(400).json({ error: "Reset code expired" });
    }

    if (reset.code !== code)
      return res.status(400).json({ error: "Invalid reset code" });

    const user = await User.findOne({ email: emailLower });
    if (!user) return res.status(404).json({ error: "User not found" });

    user.passwordHash = await bcrypt.hash(password, 10);
    await user.save();

    await PasswordReset.deleteOne({ email: emailLower });
    res.json({ success: true });
  } catch (err) {
    console.error("❌ reset-password error:", err);
    res.status(500).json({ error: "Failed to reset password" });
  }
});

console.log("✅ Auth: Password routes initialized (Resend only)");
module.exports = router;
