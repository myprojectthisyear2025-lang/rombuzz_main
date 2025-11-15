/**
 * ============================================================
 * 📁 File: config/sendgrid.js
 * 📧 Purpose: Initialize SendGrid client for sending emails
 *
 * Features:
 *   - Sets API key from environment variables
 *   - Provides safe fallback in dev when no API key is present
 *   - Prevents crashes like "sgMail.send is not a function"
 *
 * Environment Variables:
 *   SENDGRID_API_KEY
 *   FROM_EMAIL
 * ============================================================
 */

const sgMail = require("@sendgrid/mail");

// If API key exists → real SendGrid
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
  console.log("📧 SendGrid initialized");
} else {
  // Safe fallback to prevent crashes
  console.warn("⚠️ No SENDGRID_API_KEY — using mock email sender");

  sgMail.send = async (message) => {
    console.log("📧 [DEV MOCK] Email would be sent:", message);
    return { success: true, dev: true };
  };
}

module.exports = sgMail;
