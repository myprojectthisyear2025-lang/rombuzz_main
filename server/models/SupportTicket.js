/**
 * ============================================================
 * 📁 File: models/SupportTicket.js
 * 🧩 Purpose: Stores Cupid Support tickets created by RomBuzz users.
 *
 * Used by:
 *   - POST /api/cupid-support/tickets
 *   - GET  /api/cupid-support/admin/tickets
 *   - GET  /api/cupid-support/admin/tickets/:ticketId
 *   - PATCH /api/cupid-support/admin/tickets/:ticketId
 *
 * Notes:
 *   - Users create tickets when Cupid cannot answer.
 *   - Admin can view these later on rombuzz.com/admin/support.
 * ============================================================
 */

const mongoose = require("mongoose");

const supportTicketSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true },

    userId: { type: String, default: "", index: true },
    userEmail: { type: String, default: "", index: true },
    userName: { type: String, default: "" },

    subject: { type: String, required: true },
    message: { type: String, required: true },

    screen: { type: String, default: "" },
    source: { type: String, default: "cupid_support" },

    status: {
      type: String,
      enum: ["open", "reviewing", "resolved", "closed"],
      default: "open",
      index: true,
    },

    priority: {
      type: String,
      enum: ["low", "normal", "high", "urgent"],
      default: "normal",
      index: true,
    },

    adminNotes: { type: String, default: "" },
    lastAdminActionBy: { type: String, default: "" },
    lastAdminActionAt: { type: Date, default: null },

    emailSent: { type: Boolean, default: false },
    emailError: { type: String, default: "" },

    createdAt: { type: Date, default: Date.now, index: true },
    updatedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    minimize: true,
  }
);

module.exports =
  mongoose.models.SupportTicket ||
  mongoose.model("SupportTicket", supportTicketSchema);