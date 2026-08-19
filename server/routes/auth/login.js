/**
 * ============================================================
 * 📁 File: server/routes/auth/login.js
 * 🎯 Purpose: Mount RomBuzz login and social-auth route modules.
 *
 * LOCATION:
 *   server/routes/auth/login.js
 *
 * USED BY:
 *   server/routes/auth.js
 *
 * ROUTES:
 *   /login, /google, /apple
 * ============================================================
 */

const express = require("express");
const router = express.Router();

router.use("/", require("./emailLogin"));
router.use("/", require("./google"));
router.use("/", require("./apple"));

console.log("✅ Auth: Email + Google + Apple routes initialized");

module.exports = router;