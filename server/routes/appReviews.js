/**
 * File: server/routes/appReviews.js
 * Purpose: Accept authenticated private app feedback and email it to RomBuzz Support.
 */
const express = require("express");
const fs = require("fs");
const path = require("path");
const { Resend } = require("resend");
const upload = require("../config/multer");
const authMiddleware = require("./auth-middleware");
const User = require("../models/User");

const router = express.Router();
const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;
const INBOX = "rombuzz2025@gmail.com";
const FROM = String(
  process.env.SUPPORT_FROM_EMAIL || "RomBuzz Support <support@rombuzz.com>",
).trim();
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "video/mp4",
  "video/quicktime",
  "video/3gpp",
]);

function clean(value, max) {
  return String(value || "").trim().slice(0, max);
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) =>
    ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    })[char],
  );
}

router.post("/", authMiddleware, upload.single("attachment"), async (req, res) => {
  try {
    const rating = Number(req.body?.rating);
    const comment = clean(req.body?.comment, 2500);

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res
        .status(400)
        .json({ error: "Choose a rating from one to five stars." });
    }

    if (comment.length < 5) {
      return res
        .status(400)
        .json({ error: "Please add at least 5 characters of detail." });
    }

    if (!resend) {
      return res.status(503).json({
        error: "Feedback email is not configured yet. Please try again later.",
      });
    }

    if (req.file && req.file.size > MAX_BYTES) {
      return res
        .status(413)
        .json({ error: "Attachment must be 10 MB or smaller." });
    }

    if (
      req.file &&
      !ALLOWED_TYPES.has(String(req.file.mimetype || "").toLowerCase())
    ) {
      return res.status(400).json({ error: "Attach a photo or video file." });
    }

    const user = await User.findOne({ id: req.user.id }).lean();
    const name =
      `${user?.firstName || ""} ${user?.lastName || ""}`.trim() ||
      "RomBuzz user";
    const email = clean(req.user.email || user?.email, 200) || "Not available";
    const safeComment = escapeHtml(comment);

    const attachment = req.file
      ? [
          {
            filename: path
              .basename(req.file.originalname || "feedback-media")
              .replace(/[^a-zA-Z0-9._ -]/g, "_")
              .slice(0, 100),
            content: fs.readFileSync(req.file.path).toString("base64"),
            contentType: req.file.mimetype,
          },
        ]
      : undefined;

    const result = await resend.emails.send({
      from: FROM,
      to: INBOX,
      replyTo: email === "Not available" ? undefined : email,
      subject: `[RomBuzz feedback] ${rating}/5 stars`,
      text: `Private RomBuzz app feedback
Rating: ${rating}/5
Name: ${name}
User ID: ${req.user.id}
Email: ${email}

${comment}`,
      html: `<h2>Private RomBuzz app feedback</h2>
<p><b>Rating:</b> ${rating}/5 stars</p>
<p><b>Name:</b> ${escapeHtml(name)}</p>
<p><b>User ID:</b> ${escapeHtml(req.user.id)}</p>
<p><b>Email:</b> ${escapeHtml(email)}</p>
<hr/>
<p style="white-space:pre-wrap">${safeComment}</p>`,
      ...(attachment ? { attachments: attachment } : {}),
    });

    if (result?.error) {
      throw new Error(result.error.message || "Email delivery failed.");
    }

    return res.status(201).json({
      success: true,
      message: "Your private feedback was sent to RomBuzz Support.",
    });
  } catch (error) {
    console.error("❌ App feedback email failed:", error);
    return res
      .status(500)
      .json({ error: "Your feedback could not be sent. Please try again." });
  } finally {
    if (req.file?.path) fs.promises.unlink(req.file.path).catch(() => {});
  }
});

module.exports = router;