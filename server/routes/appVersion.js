/**
 * ============================================================
 * 📁 File: server/routes/appVersion.js
 * 🎯 Purpose: Serve RomBuzz mobile version/update policy.
 *
 * Mounted at:
 *   GET /api/app-version?platform=android|ios&channel=...
 *
 * This endpoint is public and read-only. It exposes no secrets
 * and provides no way for clients to modify update policy.
 * ============================================================
 */

const express = require("express");
const {
  getAppVersionPolicy,
} = require("../config/appVersionPolicy");

const router = express.Router();

router.get("/", (req, res) => {
  const policy = getAppVersionPolicy(
    req.query?.platform,
    req.query?.channel
  );

  res.set("Cache-Control", "no-store");

  if (!policy) {
    return res.status(400).json({
      error: "Valid platform and channel are required",
    });
  }

  return res.status(200).json(policy);
});

module.exports = router;