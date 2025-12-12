/**
 * ============================================================
 * 📁 File: routes/auth/otp.js
 * 🧩 Purpose: OTP send + verification (MongoDB only)
 *
 * Endpoints:
 *   POST /api/auth/send-code      → Send OTP to email
 *   POST /api/auth/register       → Verify OTP + create account
 *
 * Features:
 *   - Stores OTP + expiry directly in MongoDB
 *   - Auto-creates new user records when needed
 *   - Supports both signup + login flows
 *   - Fully safe for production (no LowDB)
 *
 * Dependencies:
 *   - models/User.js
 *   - config/sendgrid.js
 *   - utils/jwt.js (token generation)
 *   - utils/helpers.js (sanitize)
 * ============================================================
 */

const express = require("express");
const router = express.Router();
const { Resend } = require("resend");
const resend = new Resend(process.env.RESEND_API_KEY);
const bcrypt = require("bcrypt");
const shortid = require("shortid");
const User = require("../../models/User");
const { signToken } = require("../../utils/jwt");
const { JWT_SECRET, TOKEN_EXPIRES_IN } = require("../../config/env");
const { baseSanitizeUser } = require("../../utils/helpers");

/* ============================================================
   📩 SEND VERIFICATION CODE
============================================================ */
router.post("/send-code", async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: "Email required" });

    const emailLower = String(email).trim().toLowerCase();
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    // 1️⃣ Upsert user record with OTP
    let user = await User.findOne({ email: emailLower });

    if (!user) {
      user = await User.create({
        id: shortid.generate(),
        email: emailLower,
        verificationCode: code,
        codeExpiresAt: expiresAt,
        createdAt: new Date(),
      });
      console.log(`📧 Created new Mongo user + stored OTP for ${emailLower}`);
    } else {
      user.verificationCode = code;
      user.codeExpiresAt = expiresAt;
      await user.save();
      console.log(`📧 Updated existing Mongo user OTP for ${emailLower}`);
    }

    // 2️⃣ Send via Resend (or dev-log)
if (!process.env.RESEND_API_KEY) {
  console.log(`📧 [DEV] OTP for ${emailLower}: ${code}`);
  return res.json({ success: true, dev: true });
}

await resend.emails.send({
  from: process.env.RESEND_FROM || "no-reply@rombuzz.com",
  to: emailLower,
  subject: "Your RomBuzz Verification Code",
  html: `
    <div style="
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; 
      padding: 24px;
      background-color: #f5f5f7;
      color: #111;
    ">

      <div style="
        max-width: 420px;
        margin: 0 auto;
        background: #ffffff;
        border-radius: 20px;
        padding: 32px 28px;
        box-shadow: 0 8px 28px rgba(0,0,0,0.10);
        text-align: center;
      ">

        <img 
          src="https://raw.githubusercontent.com/myprojectthisyear2025-lang/rombuzz_main/main/frontend/public/assets/logo.png"
          alt="RomBuzz Logo"
          style="width: 90px; margin: 0 auto 20px auto; display: block;"
        />

        <h2 style="
          font-size: 22px;
          font-weight: 600;
          margin-bottom: 12px;
          color: #000;
        ">
          Your Verification Code
        </h2>

        <p style="color:#444; margin-bottom: 24px;">
          Use this code to verify your identity and continue.
        </p>

        <div style="
          background: #f2f2f7;
          border-radius: 14px;
          padding: 18px 0;
          margin-bottom: 26px;
        ">
          <p style="
            font-size: 40px;
            font-weight: 800;
            letter-spacing: 10px;
            margin: 0;
            color: #000;
          ">
            <strong>${code}</strong>
          </p>
        </div>

        <p style="color:#555; margin-bottom: 16px;">
          This code expires in <strong>10 minutes</strong>.
        </p>

        <p style="
          background:#fffbe6;
          padding: 12px;
          border-radius: 12px;
          color:#8a6d1f;
          font-size: 14px;
          line-height: 1.5;
          margin-bottom: 22px;
        ">
          ⚠️ <strong>Security Notice</strong>: Never share your verification code with
          anyone. If you didn’t request this code,
          someone might be trying to access your account. Change your password immediately to protect your account.
        </p>

        <p style="color:#999; font-size: 12px; margin-top: 10px;">
          RomBuzz © 2025 • All rights reserved.
        </p>

      </div>

    </div>
  `
});




    res.json({ success: true });
  } catch (err) {
    console.error("❌ send-code error:", err);
    res.status(500).json({ error: "Failed to send OTP" });
  }
});

/* ============================================================
   📝 VERIFY CODE + REGISTER USER
============================================================ */
router.post("/register", async (req, res) => {
  try {
    const { email, code, firstName, lastName, password } = req.body || {};
    if (!email || !code)
      return res.status(400).json({ error: "Email and code required" });

    const emailLower = String(email).trim().toLowerCase();
    let user = await User.findOne({ email: emailLower });

    if (!user)
      return res.status(404).json({ error: "No OTP request found" });

    // ❌ Validate OTP
if (String(user.verificationCode).trim() !== String(code).trim())
      return res.status(400).json({ error: "Invalid verification code" });

    if (user.codeExpiresAt && user.codeExpiresAt < new Date())
      return res.status(400).json({ error: "Verification code expired" });

    // 1️⃣ Set password (optional)
    if (password) {
      user.passwordHash = await bcrypt.hash(password, 10);
    }

    // 2️⃣ Apply name fields if provided
    if (firstName) user.firstName = firstName;
    if (lastName) user.lastName = lastName;

    // 3️⃣ Finalize account
    user.isVerified = true;
    user.verificationCode = null;
    user.codeExpiresAt = null;
    user.createdAt = user.createdAt || new Date();
    await user.save();

    // 4️⃣ Sign JWT
    const token = signToken(
      { id: user.id, email: user.email },
      JWT_SECRET,
      TOKEN_EXPIRES_IN
    );

    res.json({ token, user: baseSanitizeUser(user) });
  } catch (err) {
    console.error("❌ register error:", err);
    res.status(500).json({ error: "Server error verifying code" });
  }
});

console.log("✅ Auth: OTP routes initialized (Mongo-only)");
module.exports = router;
