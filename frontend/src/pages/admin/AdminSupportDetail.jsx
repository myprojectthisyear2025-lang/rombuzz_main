/**
 * ============================================================
 * 📁 File: src/pages/admin/AdminSupportDetail.jsx
 * 💘 Purpose: RomBuzz admin Cupid Support ticket detail page.
 *
 * Route:
 *   - /admin/support/:ticketId
 *
 * Used for:
 *   - Reviewing one Cupid Support ticket
 *   - Seeing user contact information
 *   - Updating ticket status
 *   - Saving admin notes after manually replying by email
 * ============================================================
 */

import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  HeartHandshake,
  Mail,
  MessageSquareText,
  Send,
  Shield,
  XCircle,
} from "lucide-react";
import { adminFetch, formatAdminDate } from "./adminApi";

const STATUS_ACTIONS = [
  { label: "Mark Reviewing", status: "reviewing", icon: <Clock size={16} /> },
  { label: "Mark Resolved", status: "resolved", icon: <CheckCircle2 size={16} /> },
  { label: "Close Ticket", status: "closed", icon: <XCircle size={16} /> },
];

function InfoCard({ title, children }) {
  return (
    <div className="rounded-3xl bg-white/95 border border-rose-100 shadow-lg p-5">
      <h3 className="font-black text-gray-900 mb-4">{title}</h3>
      {children}
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div className="py-2">
      <p className="text-xs uppercase tracking-wide text-gray-500 font-black">
        {label}
      </p>

      <p className="mt-1 text-gray-900 font-semibold break-words whitespace-pre-wrap">
        {value || "—"}
      </p>
    </div>
  );
}

function StatusBadge({ status }) {
  const value = String(status || "open").toLowerCase();

  const cls =
    value === "open"
      ? "bg-rose-100 text-rose-700 border-rose-200"
      : value === "reviewing"
      ? "bg-amber-100 text-amber-700 border-amber-200"
      : value === "resolved"
      ? "bg-emerald-100 text-emerald-700 border-emerald-200"
      : value === "closed"
      ? "bg-slate-100 text-slate-700 border-slate-200"
      : "bg-gray-100 text-gray-700 border-gray-200";

  return (
    <span className={`inline-flex px-3 py-1 rounded-full border text-xs font-black ${cls}`}>
      {value}
    </span>
  );
}

function PriorityBadge({ priority }) {
  const value = String(priority || "normal").toLowerCase();

  const cls =
    value === "urgent"
      ? "bg-red-600 text-white"
      : value === "high"
      ? "bg-orange-500 text-white"
      : value === "low"
      ? "bg-slate-200 text-slate-700"
      : "bg-pink-100 text-pink-700";

  return (
    <span className={`inline-flex px-3 py-1 rounded-full text-xs font-black ${cls}`}>
      {value}
    </span>
  );
}

function UserContactCard({ ticket }) {
  const userName = String(ticket?.userName || "").trim() || "Unknown user";
  const userEmail = String(ticket?.userEmail || "").trim();

  return (
    <div className="rounded-2xl bg-rose-50/70 border border-rose-100 p-4">
      <p className="text-xs uppercase tracking-wide text-rose-500 font-black">
        User Contact
      </p>

      <div className="mt-3 flex items-center gap-3">
        <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-pink-500 to-rose-600 text-white flex items-center justify-center font-black">
          {userName.slice(0, 1).toUpperCase() || "?"}
        </div>

        <div className="min-w-0">
          <p className="font-black text-gray-900 truncate">{userName}</p>
          <p className="text-xs text-gray-500 break-all">
            {ticket?.userId || "—"}
          </p>
        </div>
      </div>

      {userEmail ? (
        <a
          href={`mailto:${userEmail}?subject=${encodeURIComponent(
            `RomBuzz Support: ${ticket?.subject || "Your support ticket"}`
          )}`}
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gray-950 text-white px-4 py-3 font-black hover:bg-rose-600 transition"
        >
          <Mail size={17} />
          Reply by Email
        </a>
      ) : (
        <div className="mt-4 rounded-2xl bg-white border border-rose-100 p-3 text-sm text-gray-500 font-semibold">
          No user email is attached to this ticket.
        </div>
      )}
    </div>
  );
}

export default function AdminSupportDetail() {
  const { ticketId } = useParams();

  const [ticket, setTicket] = useState(null);
  const [adminNotes, setAdminNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function loadTicket() {
    setLoading(true);
    setError("");
    setSuccess("");

    try {
      const data = await adminFetch(`/cupid-support/admin/tickets/${ticketId}`);
      const loadedTicket = data?.ticket || null;

      setTicket(loadedTicket);
      setAdminNotes(loadedTicket?.adminNotes || "");
    } catch (err) {
      setError(err.message || "Failed to load support ticket.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTicket();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId]);

  async function updateTicket(status) {
    setWorking(true);
    setError("");
    setSuccess("");

    try {
      const data = await adminFetch(`/cupid-support/admin/tickets/${ticketId}`, {
        method: "PATCH",
        body: JSON.stringify({
          status,
          adminNotes,
        }),
      });

      setTicket(data?.ticket || ticket);
      setAdminNotes(data?.ticket?.adminNotes || adminNotes);
      setSuccess(status ? `Ticket marked as ${status}.` : "Ticket updated.");
    } catch (err) {
      setError(err.message || "Failed to update support ticket.");
    } finally {
      setWorking(false);
    }
  }

  async function saveNotesOnly() {
    setWorking(true);
    setError("");
    setSuccess("");

    try {
      const data = await adminFetch(`/cupid-support/admin/tickets/${ticketId}`, {
        method: "PATCH",
        body: JSON.stringify({
          adminNotes,
        }),
      });

      setTicket(data?.ticket || ticket);
      setSuccess("Admin notes saved.");
    } catch (err) {
      setError(err.message || "Failed to save admin notes.");
    } finally {
      setWorking(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-rose-50 flex items-center justify-center text-rose-600 font-black">
        Loading support ticket...
      </div>
    );
  }

  if (error && !ticket) {
    return (
      <div className="min-h-screen bg-rose-50 px-4 py-10">
        <div className="mx-auto max-w-3xl rounded-3xl bg-white p-8 shadow-xl border border-red-100">
          <Link
            to="/admin/support"
            className="inline-flex items-center gap-2 text-rose-600 font-black"
          >
            <ArrowLeft size={18} />
            Back to Support
          </Link>

          <p className="mt-6 text-red-600 font-bold">{error}</p>
        </div>
      </div>
    );
  }

  const userEmail = String(ticket?.userEmail || "").trim();

  return (
    <div className="min-h-screen bg-gradient-to-br from-rose-50 via-pink-50 to-orange-50 px-3 py-6 md:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-5">
          <Link
            to="/admin/support"
            className="inline-flex items-center gap-2 rounded-2xl bg-white text-rose-600 px-4 py-2 font-black shadow border border-rose-100 hover:bg-rose-50"
          >
            <ArrowLeft size={18} />
            Back to Support
          </Link>
        </div>

        <div className="rounded-3xl bg-white/95 border border-rose-100 shadow-xl p-6 md:p-8 mb-6">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-5">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-rose-100 text-rose-700 px-4 py-2 text-sm font-black">
                <HeartHandshake size={16} />
                Cupid Support Ticket
              </div>

              <h1 className="mt-4 text-3xl md:text-5xl font-black text-gray-950">
                {ticket?.subject || "Support Ticket"}
              </h1>

              <p className="mt-2 text-gray-600 max-w-2xl">
                Review the user issue, manually reply by email, and update the
                ticket status after you handle it.
              </p>
            </div>

            <div className="rounded-2xl bg-gray-950 text-white px-5 py-4 min-w-[220px]">
              <p className="text-xs uppercase tracking-wide text-rose-200 font-black">
                Current Status
              </p>

              <p className="text-2xl font-black">{ticket?.status || "open"}</p>

              <p className="text-xs text-gray-300 mt-1">
                Priority: {ticket?.priority || "normal"}
              </p>
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 text-red-700 p-4 font-semibold">
            {error}
          </div>
        )}

        {success && (
          <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 text-emerald-700 p-4 font-semibold">
            {success}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 space-y-5">
            <InfoCard title="Ticket Information">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Ticket ID" value={ticket?.id} />
                <Field label="Created" value={formatAdminDate(ticket?.createdAt)} />
                <Field label="Updated" value={formatAdminDate(ticket?.updatedAt)} />
                <Field label="Screen" value={ticket?.screen} />
                <Field label="Source" value={ticket?.source} />
                <Field label="Email Sent" value={ticket?.emailSent ? "Yes" : "No"} />

                <div className="py-2">
                  <p className="text-xs uppercase tracking-wide text-gray-500 font-black">
                    Status
                  </p>
                  <div className="mt-2">
                    <StatusBadge status={ticket?.status} />
                  </div>
                </div>

                <div className="py-2">
                  <p className="text-xs uppercase tracking-wide text-gray-500 font-black">
                    Priority
                  </p>
                  <div className="mt-2">
                    <PriorityBadge priority={ticket?.priority} />
                  </div>
                </div>
              </div>

              {ticket?.emailError && (
                <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                  <p className="text-xs uppercase tracking-wide text-amber-700 font-black">
                    Email Warning
                  </p>
                  <p className="mt-1 text-amber-800 font-semibold">
                    {ticket.emailError}
                  </p>
                </div>
              )}
            </InfoCard>

            <InfoCard title="User Message">
              <div className="rounded-2xl bg-rose-50/70 border border-rose-100 p-5">
                <div className="flex items-center gap-2 text-rose-600 font-black mb-3">
                  <MessageSquareText size={18} />
                  Message
                </div>

                <p className="text-gray-900 font-semibold whitespace-pre-wrap leading-relaxed">
                  {ticket?.message || "No message provided."}
                </p>
              </div>
            </InfoCard>

            <InfoCard title="Manual Reply">
              {userEmail ? (
                <div className="rounded-2xl bg-white border border-rose-100 p-5">
                  <p className="text-gray-700 font-semibold">
                    Click below to open your email app and reply manually to:
                  </p>

                  <p className="mt-2 font-black text-gray-950 break-all">
                    {userEmail}
                  </p>

                  <a
                    href={`mailto:${userEmail}?subject=${encodeURIComponent(
                      `RomBuzz Support: ${ticket?.subject || "Your support ticket"}`
                    )}`}
                    className="mt-4 inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-pink-500 to-rose-600 text-white px-5 py-3 font-black shadow hover:scale-[1.01] transition"
                  >
                    <Send size={17} />
                    Reply to User
                  </a>
                </div>
              ) : (
                <p className="text-gray-500 font-semibold">
                  This ticket does not have a user email attached.
                </p>
              )}
            </InfoCard>
          </div>

          <div className="space-y-5">
            <InfoCard title="User">
              <UserContactCard ticket={ticket} />
            </InfoCard>

            <InfoCard title="Admin Notes">
              <textarea
                value={adminNotes}
                onChange={(e) => setAdminNotes(e.target.value)}
                rows={7}
                placeholder="Write notes after manually replying by email..."
                className="w-full rounded-2xl border border-rose-100 bg-white p-4 outline-none focus:ring-2 focus:ring-rose-300 font-semibold"
              />

              <button
                disabled={working}
                onClick={saveNotesOnly}
                className="mt-4 w-full rounded-2xl bg-gray-950 text-white px-4 py-3 font-black hover:bg-rose-600 disabled:opacity-50 transition"
              >
                Save Notes
              </button>
            </InfoCard>

            <InfoCard title="Update Status">
              <div className="grid grid-cols-1 gap-2">
                {STATUS_ACTIONS.map((item) => (
                  <button
                    key={item.status}
                    disabled={working}
                    onClick={() => updateTicket(item.status)}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-pink-500 to-rose-600 text-white px-4 py-3 font-black shadow hover:scale-[1.01] disabled:opacity-50 transition"
                  >
                    {item.icon}
                    {item.label}
                  </button>
                ))}

                <button
                  disabled={working}
                  onClick={() => updateTicket("open")}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white border border-rose-200 text-rose-700 px-4 py-3 font-black hover:bg-rose-50 disabled:opacity-50 transition"
                >
                  <Shield size={16} />
                  Reopen Ticket
                </button>
              </div>

              <p className="mt-4 text-xs text-gray-500">
                After you reply manually by email, mark the ticket as resolved
                or closed so it stays organized.
              </p>
            </InfoCard>
          </div>
        </div>
      </div>
    </div>
  );
}