/**
 * ============================================================
 * 📁 File: src/pages/admin/AdminSupport.jsx
 * 💘 Purpose: RomBuzz admin Cupid Support ticket dashboard.
 *
 * Route:
 *   - /admin/support
 *
 * Used for:
 *   - Viewing all Cupid Support tickets
 *   - Filtering by status and priority
 *   - Opening support ticket detail page
 *
 * Notes:
 *   - Admin access is enforced by backend using ADMIN_EMAIL.
 *   - Uses the same adminFetch helper as the reports dashboard.
 * ============================================================
 */

import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock,
  Eye,
  Filter,
  HeartHandshake,
  Mail,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { adminFetch, formatAdminDate } from "./adminApi";

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "open", label: "Open" },
  { value: "reviewing", label: "Reviewing" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
];

const PRIORITY_OPTIONS = [
  { value: "", label: "All priorities" },
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "normal", label: "Normal" },
  { value: "low", label: "Low" },
];

function StatCard({ icon, label, value, tone = "rose" }) {
  const toneClass =
    tone === "red"
      ? "from-red-500 to-rose-600"
      : tone === "orange"
      ? "from-orange-400 to-amber-500"
      : tone === "green"
      ? "from-emerald-500 to-teal-600"
      : tone === "slate"
      ? "from-slate-700 to-slate-900"
      : tone === "blue"
      ? "from-blue-500 to-indigo-600"
      : "from-pink-500 to-rose-600";

  return (
    <div className="rounded-3xl bg-white/90 p-5 shadow-lg border border-rose-100">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-500 font-bold">
            {label}
          </p>
          <p className="mt-2 text-3xl font-black text-gray-900">{value ?? 0}</p>
        </div>

        <div
          className={`h-12 w-12 rounded-2xl bg-gradient-to-br ${toneClass} text-white flex items-center justify-center shadow-md`}
        >
          {icon}
        </div>
      </div>
    </div>
  );
}

function StatusPill({ value }) {
  const status = String(value || "open").toLowerCase();

  const cls =
    status === "open"
      ? "bg-rose-100 text-rose-700 border-rose-200"
      : status === "reviewing"
      ? "bg-amber-100 text-amber-700 border-amber-200"
      : status === "resolved"
      ? "bg-emerald-100 text-emerald-700 border-emerald-200"
      : status === "closed"
      ? "bg-slate-100 text-slate-700 border-slate-200"
      : "bg-gray-100 text-gray-700 border-gray-200";

  return (
    <span className={`px-3 py-1 rounded-full border text-xs font-bold ${cls}`}>
      {status}
    </span>
  );
}

function PriorityPill({ value }) {
  const priority = String(value || "normal").toLowerCase();

  const cls =
    priority === "urgent"
      ? "bg-red-600 text-white"
      : priority === "high"
      ? "bg-orange-500 text-white"
      : priority === "low"
      ? "bg-slate-200 text-slate-700"
      : "bg-pink-100 text-pink-700";

  return (
    <span className={`px-3 py-1 rounded-full text-xs font-black ${cls}`}>
      {priority}
    </span>
  );
}

function getTicketCounts(tickets = []) {
  return tickets.reduce(
    (acc, ticket) => {
      const status = String(ticket.status || "open").toLowerCase();
      const priority = String(ticket.priority || "normal").toLowerCase();

      acc.total += 1;

      if (status === "open") acc.open += 1;
      if (status === "reviewing") acc.reviewing += 1;
      if (status === "resolved") acc.resolved += 1;
      if (status === "closed") acc.closed += 1;
      if (priority === "urgent") acc.urgent += 1;
      if (priority === "high") acc.high += 1;

      return acc;
    },
    {
      total: 0,
      open: 0,
      reviewing: 0,
      resolved: 0,
      closed: 0,
      urgent: 0,
      high: 0,
    }
  );
}

function getUserDisplayName(ticket = {}) {
  const name = String(ticket.userName || "").trim();
  if (name) return name;

  const email = String(ticket.userEmail || "").trim();
  if (email) return email;

  return "Unknown user";
}

export default function AdminSupport() {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");

  const queryString = useMemo(() => {
    const params = new URLSearchParams();

    if (status) params.set("status", status);
    if (priority) params.set("priority", priority);

    return params.toString();
  }, [status, priority]);

  const counts = useMemo(() => getTicketCounts(tickets), [tickets]);

  async function loadTickets() {
    setLoading(true);
    setError("");

    try {
      const path = queryString
        ? `/cupid-support/admin/tickets?${queryString}`
        : "/cupid-support/admin/tickets";

      const data = await adminFetch(path);

      setTickets(Array.isArray(data?.tickets) ? data.tickets : []);
    } catch (err) {
      setError(err.message || "Failed to load Cupid Support tickets.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTickets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryString]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-rose-50 via-pink-50 to-orange-50 px-3 py-6 md:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 rounded-3xl bg-white/90 border border-rose-100 shadow-xl p-6 md:p-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-5">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-rose-100 text-rose-700 px-4 py-2 text-sm font-bold">
                <HeartHandshake size={16} />
                RomBuzz Admin
              </div>

              <h1 className="mt-4 text-3xl md:text-5xl font-black text-gray-950">
                Cupid Support
              </h1>

              <p className="mt-2 text-gray-600 max-w-2xl">
                Review Cupid support tickets, check user issues, and manually
                reply to users by email from one protected admin area.
              </p>
            </div>

            <button
              onClick={loadTickets}
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-pink-500 to-rose-600 text-white px-5 py-3 font-black shadow-lg hover:scale-[1.02] disabled:opacity-60 transition"
            >
              <RefreshCw size={18} className={loading ? "animate-spin" : ""} />
              Refresh Tickets
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 text-red-700 p-4 font-semibold">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
          <StatCard
            icon={<BarChart3 size={24} />}
            label="Total"
            value={counts.total}
            tone="slate"
          />
          <StatCard
            icon={<Clock size={24} />}
            label="Open"
            value={counts.open}
            tone="rose"
          />
          <StatCard
            icon={<AlertTriangle size={24} />}
            label="Urgent"
            value={counts.urgent}
            tone="red"
          />
          <StatCard
            icon={<ShieldCheck size={24} />}
            label="Resolved"
            value={counts.resolved}
            tone="green"
          />
          <StatCard
            icon={<XCircle size={24} />}
            label="Closed"
            value={counts.closed}
            tone="orange"
          />
        </div>

        <div className="mb-5 rounded-3xl bg-white/90 border border-rose-100 shadow-lg p-4">
          <div className="flex items-center gap-2 mb-3 text-gray-800 font-black">
            <Filter size={18} />
            Filters
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="rounded-2xl border border-rose-100 bg-white px-4 py-3 font-semibold outline-none focus:ring-2 focus:ring-rose-300"
            >
              {STATUS_OPTIONS.map((item) => (
                <option key={item.value || "all-status"} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>

            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="rounded-2xl border border-rose-100 bg-white px-4 py-3 font-semibold outline-none focus:ring-2 focus:ring-rose-300"
            >
              {PRIORITY_OPTIONS.map((item) => (
                <option key={item.value || "all-priority"} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="rounded-3xl bg-white/95 border border-rose-100 shadow-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-rose-100 flex items-center justify-between">
            <h2 className="font-black text-gray-900">
              Support Tickets {loading ? "" : `(${tickets.length})`}
            </h2>
          </div>

          {loading ? (
            <div className="p-10 text-center text-gray-500 font-bold">
              Loading Cupid Support tickets...
            </div>
          ) : tickets.length === 0 ? (
            <div className="p-10 text-center">
              <CheckCircle2 className="mx-auto text-emerald-500" size={42} />
              <p className="mt-3 font-black text-gray-800">
                No support tickets found
              </p>
              <p className="text-sm text-gray-500">
                Try changing filters or refresh the dashboard.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-rose-50 text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-5 py-4">Ticket</th>
                    <th className="px-5 py-4">User</th>
                    <th className="px-5 py-4">Screen</th>
                    <th className="px-5 py-4">Status</th>
                    <th className="px-5 py-4">Priority</th>
                    <th className="px-5 py-4">Created</th>
                    <th className="px-5 py-4 text-right">Open</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-rose-50">
                  {tickets.map((ticket) => (
                    <tr key={ticket.id} className="hover:bg-rose-50/60">
                      <td className="px-5 py-4 min-w-[300px]">
                        <p className="font-black text-gray-900">
                          {ticket.subject || "Untitled support ticket"}
                        </p>

                        <p className="text-xs text-gray-500 mt-1 line-clamp-2 max-w-xl">
                          {ticket.message || "No message provided."}
                        </p>

                        <p className="text-xs text-gray-400 mt-1">
                          ID: {ticket.id}
                        </p>
                      </td>

                      <td className="px-5 py-4 min-w-[220px]">
                        <p className="font-bold text-gray-800">
                          {getUserDisplayName(ticket)}
                        </p>

                        <p className="text-xs text-gray-500">
                          {ticket.userId || "—"}
                        </p>

                        {ticket.userEmail && (
                          <a
                            href={`mailto:${ticket.userEmail}`}
                            className="mt-1 inline-flex items-center gap-1 text-xs font-bold text-rose-600 hover:text-rose-700"
                          >
                            <Mail size={12} />
                            {ticket.userEmail}
                          </a>
                        )}
                      </td>

                      <td className="px-5 py-4 text-sm text-gray-700 font-semibold">
                        {ticket.screen || "—"}
                      </td>

                      <td className="px-5 py-4">
                        <StatusPill value={ticket.status} />
                      </td>

                      <td className="px-5 py-4">
                        <PriorityPill value={ticket.priority} />
                      </td>

                      <td className="px-5 py-4 text-sm text-gray-600">
                        {formatAdminDate(ticket.createdAt)}
                      </td>

                      <td className="px-5 py-4 text-right">
                        <Link
                          to={`/admin/support/${ticket.id}`}
                          className="inline-flex items-center justify-center gap-2 rounded-xl bg-gray-950 text-white px-4 py-2 font-bold hover:bg-rose-600 transition"
                        >
                          <Eye size={16} />
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}