/**
 * ============================================================
 * 📁 File: server/routes/auth/emailLogin.js
 * 🎯 Purpose: Handle RomBuzz email/password login.
 *
 * LOCATION:
 *   server/routes/auth/emailLogin.js
 *
 * USED BY:
 *   server/routes/auth/login.js
 * ============================================================
 */

const express = require("express");
const bcrypt = require("bcrypt");
const router = express.Router();

const { signToken } = require("../../utils/jwt");
const { JWT_SECRET, TOKEN_EXPIRES_IN } = require("../../config/env");
const { baseSanitizeUser } = require("../../utils/helpers");
const User = require("../../models/User");
const {
  isPendingDeleteUser,
} = require("../../services/accountDeletionService");

const {
  computeProfileComplete,
  sendPendingDeleteAuthResponse,
} = require("./authShared");

router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({
      error: "Email & password required",
    });
  }

  const emailLower = String(email).trim().toLowerCase();
  const user = await User.findOne({ email: emailLower }).lean();

  if (!user) {
    return res.status(401).json({
      status: "no_account",
      error: "No account found. Please sign up first.",
    });
  }

  if (isPendingDeleteUser(user)) {
    return sendPendingDeleteAuthResponse(res, user);
  }

  const isProfileComplete = computeProfileComplete(user);

  if (user.profileComplete !== isProfileComplete) {
    await User.updateOne(
      { id: user.id },
      { profileComplete: isProfileComplete }
    );
  }

  let match = false;

  try {
    if (user.passwordHash) {
      match = await bcrypt.compare(password, user.passwordHash);
    }
  } catch (err) {
    console.error("bcrypt compare error:", err);
  }

  if (!match) {
    return res.status(401).json({
      error: "Invalid credentials",
    });
  }

  const token = signToken(
    { id: user.id, email: user.email },
    JWT_SECRET,
    TOKEN_EXPIRES_IN
  );

  return res.json({
    token,
    user: baseSanitizeUser(user),
  });
});

module.exports = router;