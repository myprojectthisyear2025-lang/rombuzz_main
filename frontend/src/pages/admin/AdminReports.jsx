/**
 * ============================================================
 * 📁 File: src/pages/admin/AdminReports.jsx
 * 🛡️ Purpose: RomBuzz admin report list + report stats dashboard.
 *
 * Route:
 *   - /admin/reports
 *
 * Used for:
 *   - Viewing all submitted reports
 *   - Filtering by status, priority, and target type
 *   - Opening report detail page
 *
 * Notes:
 *   - Admin access is enforced by backend using ADMIN_EMAIL.
 *   - This page stays separate from normal RomBuzz user pages.
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
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { adminFetch, formatAdminDate, getReportLabel } from "./adminApi";

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "open", label: "Open" },
  { value: "reviewing", label: "Reviewing" },
  { value: "reviewed", label: "Reviewed" },
  { value: "dismissed", label: "Dismissed" },
  { value: "actioned", label: "Actioned" },
  { value: "resolved", label: "Resolved" },
];

const PRIORITY_OPTIONS = [
  { value: "", label: "All priorities" },
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "normal", label: "Normal" },
  { value: "low", label: "Low" },
];

const TYPE_OPTIONS = [
  { value: "", label: "All target types" },
  { value: "profile", label: "Profile" },
  { value: "chat_conversation", label: "Chat conversation" },
  { value: "chat_message", label: "Chat message" },
  { value: "post", label: "Post" },
  { value: "reel", label: "Reel" },
  { value: "comment", label: "Comment" },
  { value: "reply", label: "Reply" },
  { value: "microbuzz", label: "MicroBuzz" },
  { value: "video_call", label: "Video call" },
  { value: "gift", label: "Gift" },
  { value: "buzzcoin", label: "BuzzCoin" },
  { value: "unknown", label: "Unknown" },
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
      : status === "dismissed"
      ? "bg-gray-100 text-gray-700 border-gray-200"
      : status === "actioned"
      ? "bg-emerald-100 text-emerald-700 border-emerald-200"
      : status === "resolved"
      ? "bg-blue-100 text-blue-700 border-blue-200"
      : "bg-slate-100 text-slate-700 border-slate-200";

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

export default function AdminReports() {
  const [reports, setReports] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [targetType, setTargetType] = useState("");

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set("all", "1");
    if (status) params.set("status", status);
    if (priority) params.set("priority", priority);
    if (targetType) params.set("targetType", targetType);
    return params.toString();
  }, [status, priority, targetType]);

  async function loadReports() {
    setLoading(true);
    setError("");

    try {
      const [reportsData, statsData] = await Promise.all([
        adminFetch(`/reports?${queryString}`),
        adminFetch("/reports/stats"),
      ]);

      setReports(Array.isArray(reportsData?.reports) ? reportsData.reports : []);
      setStats(statsData || null);
    } catch (err) {
      setError(err.message || "Failed to load reports.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadReports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryString]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-rose-50 via-pink-50 to-orange-50 px-3 py-6 md:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 rounded-3xl bg-white/90 border border-rose-100 shadow-xl p-6 md:p-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-5">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-rose-100 text-rose-700 px-4 py-2 text-sm font-bold">
                <ShieldAlert size={16} />
                RomBuzz Admin
              </div>
              <h1 className="mt-4 text-3xl md:text-5xl font-black text-gray-950">
                Reporting Dashboard
              </h1>
              <p className="mt-2 text-gray-600 max-w-2xl">
                Review user reports, check urgent cases, and take moderation
                action from one protected admin area.
              </p>
            </div>

            <button
              onClick={loadReports}
              className="rounded-2xl bg-gradient-to-r from-pink-500 to-rose-600 text-white px-5 py-3 font-black shadow-lg hover:scale-[1.02] transition"
            >
              Refresh Reports
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
            value={stats?.total || reports.length}
            tone="slate"
          />
          <StatCard
            icon={<Clock size={24} />}
            label="Open"
            value={stats?.open}
            tone="rose"
          />
          <StatCard
            icon={<AlertTriangle size={24} />}
            label="Urgent"
            value={stats?.urgent}
            tone="red"
          />
          <StatCard
            icon={<ShieldCheck size={24} />}
            label="Actioned"
            value={stats?.actioned}
            tone="green"
          />
          <StatCard
            icon={<XCircle size={24} />}
            label="Dismissed"
            value={stats?.dismissed}
            tone="orange"
          />
        </div>

        <div className="mb-5 rounded-3xl bg-white/90 border border-rose-100 shadow-lg p-4">
          <div className="flex items-center gap-2 mb-3 text-gray-800 font-black">
            <Filter size={18} />
            Filters
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
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

            <select
              value={targetType}
              onChange={(e) => setTargetType(e.target.value)}
              className="rounded-2xl border border-rose-100 bg-white px-4 py-3 font-semibold outline-none focus:ring-2 focus:ring-rose-300"
            >
              {TYPE_OPTIONS.map((item) => (
                <option key={item.value || "all-type"} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="rounded-3xl bg-white/95 border border-rose-100 shadow-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-rose-100 flex items-center justify-between">
            <h2 className="font-black text-gray-900">
              Reports {loading ? "" : `(${reports.length})`}
            </h2>
          </div>

          {loading ? (
            <div className="p-10 text-center text-gray-500 font-bold">
              Loading reports...
            </div>
          ) : reports.length === 0 ? (
            <div className="p-10 text-center">
              <CheckCircle2 className="mx-auto text-emerald-500" size={42} />
              <p className="mt-3 font-black text-gray-800">No reports found</p>
              <p className="text-sm text-gray-500">
                Try changing filters or refresh the dashboard.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-rose-50 text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-5 py-4">Report</th>
                    <th className="px-5 py-4">Reporter</th>
                    <th className="px-5 py-4">Target</th>
                    <th className="px-5 py-4">Status</th>
                    <th className="px-5 py-4">Priority</th>
                    <th className="px-5 py-4">Created</th>
                    <th className="px-5 py-4 text-right">Open</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-rose-50">
                  {reports.map((report) => (
                    <tr key={report.id} className="hover:bg-rose-50/60">
                      <td className="px-5 py-4 min-w-[260px]">
                        <p className="font-black text-gray-900">
                          {getReportLabel(report)}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                          ID: {report.id}
                        </p>
                      </td>

                      <td className="px-5 py-4">
                        <p className="font-bold text-gray-800">
                          {report.reporterUser?.firstName ||
                            report.fromUser?.firstName ||
                            "Unknown"}
                        </p>
                        <p className="text-xs text-gray-500">
                          {report.reporterId || report.from || "—"}
                        </p>
                      </td>

                      <td className="px-5 py-4">
                        <p className="font-bold text-gray-800">
                          {report.targetUser?.firstName || "Unknown"}
                        </p>
                        <p className="text-xs text-gray-500">
                          {report.reportedUserId ||
                            report.targetOwnerId ||
                            report.targetId ||
                            "—"}
                        </p>
                      </td>

                      <td className="px-5 py-4">
                        <StatusPill value={report.status} />
                      </td>

                      <td className="px-5 py-4">
                        <PriorityPill value={report.priority} />
                      </td>

                      <td className="px-5 py-4 text-sm text-gray-600">
                        {formatAdminDate(report.createdAt)}
                      </td>

                      <td className="px-5 py-4 text-right">
                        <Link
                          to={`/admin/reports/${report.id}`}
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