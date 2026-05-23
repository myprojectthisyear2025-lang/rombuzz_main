/**
 * ============================================================
 * 📁 File: routes/cupidSupport.js
 * 🧩 Purpose: Cupid Support chat + support ticket backend.
 *
 * Endpoints:
 *   POST  /api/cupid-support/tickets
 *   GET   /api/cupid-support/admin/tickets
 *   GET   /api/cupid-support/admin/tickets/:ticketId
 *   PATCH /api/cupid-support/admin/tickets/:ticketId
 *
 * Notes:
 *   - Ticket creation is user-protected.
 *   - Admin endpoints require ADMIN_EMAIL match.
 *   - Emails are sent through Resend if RESEND_API_KEY exists.
 * ============================================================
 */

const express = require("express");
const shortid = require("shortid");
const { Resend } = require("resend");

const authMiddleware = require("./auth-middleware");
const User = require("../models/User");
const SupportTicket = require("../models/SupportTicket");

const router = express.Router();

const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || "").trim();
const RESEND_API_KEY = String(process.env.RESEND_API_KEY || "").trim();
const SUPPORT_FROM_EMAIL =
  String(process.env.SUPPORT_FROM_EMAIL || "").trim() ||
  "RomBuzz Support <support@rombuzz.com>";

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

function cleanText(value, max = 1000) {
  return String(value || "").trim().slice(0, max);
}

function normalizeTicketStatus(value) {
  const raw = String(value || "").trim().toLowerCase();

  if (
    raw === "open" ||
    raw === "reviewing" ||
    raw === "resolved" ||
    raw === "closed"
  ) {
    return raw;
  }

  return "";
}

function getTicketPriority(subject = "", message = "") {
  const text = `${subject} ${message}`.toLowerCase();

  if (
    text.includes("danger") ||
    text.includes("threat") ||
    text.includes("blackmail") ||
    text.includes("extortion") ||
    text.includes("underage") ||
    text.includes("minor") ||
    text.includes("suicide") ||
    text.includes("self harm") ||
    text.includes("stalking")
  ) {
    return "urgent";
  }

  if (
    text.includes("payment") ||
    text.includes("buzzcoin") ||
    text.includes("gift") ||
    text.includes("scam") ||
    text.includes("harassment") ||
    text.includes("video call") ||
    text.includes("account locked") ||
    text.includes("banned") ||
    text.includes("suspended")
  ) {
    return "high";
  }

  return "normal";
}

async function requireCupidSupportAdmin(req, res) {
  const currentUser = await User.findOne({ id: req.user.id }).lean();

  if (!currentUser) {
    res.status(404).json({ error: "User not found" });
    return null;
  }

  const isAdmin =
    ADMIN_EMAIL &&
    String(currentUser.email || "").toLowerCase() ===
      String(ADMIN_EMAIL || "").toLowerCase();

  if (!isAdmin) {
    res.status(403).json({ error: "Admin access required" });
    return null;
  }

  return currentUser;
}

async function sendSupportTicketEmail(ticket) {
  if (!resend) {
    return {
      sent: false,
      error: "RESEND_API_KEY is missing. Ticket saved but email was not sent.",
    };
  }

  if (!ADMIN_EMAIL) {
    return {
      sent: false,
      error: "ADMIN_EMAIL is missing. Ticket saved but email was not sent.",
    };
  }

  try {
    const subject = `[RomBuzz Support] ${ticket.subject}`;

    const html = `
      <div style="font-family: Arial, sans-serif; line-height: 1.5;">
        <h2>New RomBuzz Cupid Support Ticket</h2>

        <p><strong>Ticket ID:</strong> ${ticket.id}</p>
        <p><strong>Status:</strong> ${ticket.status}</p>
        <p><strong>Priority:</strong> ${ticket.priority}</p>

        <hr />

        <p><strong>User:</strong> ${ticket.userName || "Unknown"}</p>
        <p><strong>User ID:</strong> ${ticket.userId || "Unknown"}</p>
        <p><strong>User Email:</strong> ${ticket.userEmail || "Unknown"}</p>
        <p><strong>Screen:</strong> ${ticket.screen || "Unknown"}</p>

        <hr />

        <p><strong>Subject:</strong></p>
        <p>${ticket.subject}</p>

        <p><strong>Message:</strong></p>
        <p style="white-space: pre-wrap;">${ticket.message}</p>

        <hr />

        <p>
          Open admin support page:
          <a href="https://rombuzz.com/admin/support">rombuzz.com/admin/support</a>
        </p>

        <p>
          You can manually reply to the user at:
          <a href="mailto:${ticket.userEmail}">${ticket.userEmail}</a>
        </p>
      </div>
    `;

    await resend.emails.send({
      from: SUPPORT_FROM_EMAIL,
      to: ADMIN_EMAIL,
      replyTo: ticket.userEmail || undefined,
      subject,
      html,
    });

    return { sent: true, error: "" };
  } catch (err) {
    console.error("❌ Cupid support email failed:", err);
    return {
      sent: false,
      error: err?.message || "Failed to send support email",
    };
  }
}

/**
 * POST /api/cupid-support/tickets
 * User creates a support ticket when Cupid cannot answer.
 */
router.post("/tickets", authMiddleware, async (req, res) => {
  try {
    const subject = cleanText(req.body?.subject, 180);
    const message = cleanText(req.body?.message, 2500);
    const screen = cleanText(req.body?.screen, 120);

    if (!subject || !message) {
      return res.status(400).json({
        error: "subject and message are required",
      });
    }

    const currentUser = await User.findOne({ id: req.user.id }).lean();

    const userName = currentUser
      ? `${currentUser.firstName || ""} ${currentUser.lastName || ""}`.trim()
      : "";

    const ticket = await SupportTicket.create({
      id: shortid.generate(),

      userId: req.user.id,
      userEmail: req.user.email || currentUser?.email || "",
      userName,

      subject,
      message,
      screen,
      source: "cupid_support",

      status: "open",
      priority: getTicketPriority(subject, message),

      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const emailResult = await sendSupportTicketEmail(ticket);

    if (emailResult.sent || emailResult.error) {
      ticket.emailSent = emailResult.sent;
      ticket.emailError = emailResult.error || "";
      ticket.updatedAt = new Date();
      await ticket.save();
    }

    return res.status(201).json({
      success: true,
      message: emailResult.sent
        ? "Your support ticket has been sent to RomBuzz admin."
        : "Your support ticket was saved. RomBuzz admin will review it.",
      ticket: {
        id: ticket.id,
        subject: ticket.subject,
        message: ticket.message,
        screen: ticket.screen,
        status: ticket.status,
        priority: ticket.priority,
        emailSent: ticket.emailSent,
        createdAt: ticket.createdAt,
      },
    });
  } catch (err) {
    console.error("❌ POST /cupid-support/tickets error:", err);
    res.status(500).json({ error: "Failed to create support ticket" });
  }
});

/**
 * GET /api/cupid-support/admin/tickets
 * Admin-only list for rombuzz.com/admin/support.
 */
router.get("/admin/tickets", authMiddleware, async (req, res) => {
  try {
    const admin = await requireCupidSupportAdmin(req, res);
    if (!admin) return;

    const query = {};

    const status = normalizeTicketStatus(req.query?.status);
    if (status) query.status = status;

    if (req.query?.priority) {
      const priority = cleanText(req.query.priority, 30).toLowerCase();
      if (["low", "normal", "high", "urgent"].includes(priority)) {
        query.priority = priority;
      }
    }

    const tickets = await SupportTicket.find(query)
      .sort({ createdAt: -1 })
      .limit(300)
      .lean();

    return res.json({
      admin: true,
      count: tickets.length,
      tickets,
    });
  } catch (err) {
    console.error("❌ GET /cupid-support/admin/tickets error:", err);
    res.status(500).json({ error: "Failed to load support tickets" });
  }
});

/**
 * GET /api/cupid-support/admin/tickets/:ticketId
 * Admin-only single ticket detail.
 */
router.get("/admin/tickets/:ticketId", authMiddleware, async (req, res) => {
  try {
    const admin = await requireCupidSupportAdmin(req, res);
    if (!admin) return;

    const ticketId = cleanText(req.params.ticketId, 160);

    const ticket = await SupportTicket.findOne({ id: ticketId }).lean();

    if (!ticket) {
      return res.status(404).json({ error: "Support ticket not found" });
    }

    return res.json({
      admin: true,
      ticket,
    });
  } catch (err) {
    console.error("❌ GET /cupid-support/admin/tickets/:ticketId error:", err);
    res.status(500).json({ error: "Failed to load support ticket" });
  }
});

/**
 * PATCH /api/cupid-support/admin/tickets/:ticketId
 * Admin-only update status/notes.
 */
router.patch("/admin/tickets/:ticketId", authMiddleware, async (req, res) => {
  try {
    const admin = await requireCupidSupportAdmin(req, res);
    if (!admin) return;

    const ticketId = cleanText(req.params.ticketId, 160);
    const status = normalizeTicketStatus(req.body?.status);
    const adminNotes = cleanText(req.body?.adminNotes, 2500);

    if (!status && !adminNotes) {
      return res.status(400).json({
        error: "status or adminNotes is required",
      });
    }

    const updates = {
      updatedAt: new Date(),
      lastAdminActionBy: admin.id,
      lastAdminActionAt: new Date(),
    };

    if (status) updates.status = status;
    if (adminNotes) updates.adminNotes = adminNotes;

    const ticket = await SupportTicket.findOneAndUpdate(
      { id: ticketId },
      { $set: updates },
      { new: true }
    ).lean();

    if (!ticket) {
      return res.status(404).json({ error: "Support ticket not found" });
    }

    return res.json({
      success: true,
      ticket,
    });
  } catch (err) {
    console.error("❌ PATCH /cupid-support/admin/tickets/:ticketId error:", err);
    res.status(500).json({ error: "Failed to update support ticket" });
  }
});

module.exports = router;