/**
 * ============================================================
 * 📁 File: src/pages/admin/AdminReportDetail.jsx
 * 🛡️ Purpose: RomBuzz admin report detail + moderation actions page.
 *
 * Route:
 *   - /admin/reports/:reportId
 *
 * Used for:
 *   - Reviewing one report
 *   - Seeing reporter / reported user
 *   - Reading evidence snapshot
 *   - Dismissing or actioning reports
 *   - Warning, suspending, banning, or restricting reported users
 * ============================================================
 */

import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Ban,
  CheckCircle2,
  Clock,
  Gift,
  MessageCircleOff,
  RadioTower,
  Shield,
  ShieldAlert,
  Sparkles,
  UserX,
  VideoOff,
} from "lucide-react";
import { adminFetch, formatAdminDate } from "./adminApi";

const STATUS_ACTIONS = [
  { label: "Mark Reviewing", status: "reviewing" },
  { label: "Mark Reviewed", status: "reviewed" },
  { label: "Dismiss", status: "dismissed" },
  { label: "Resolve", status: "resolved" },
];

const USER_ACTIONS = [
  { label: "Warn User", action: "warn", icon: <ShieldAlert size={16} /> },
  { label: "Suspend 7 Days", action: "suspend_account", suspensionDays: 7, icon: <Clock size={16} /> },
  { label: "Ban Account", action: "ban_account", icon: <Ban size={16} /> },
  { label: "Disable Chat", action: "disable_chat", icon: <MessageCircleOff size={16} /> },
  { label: "Disable Video Call", action: "disable_video_call", icon: <VideoOff size={16} /> },
  { label: "Disable Gifts", action: "disable_gifts", icon: <Gift size={16} /> },
  { label: "Disable Posting", action: "disable_posting", icon: <UserX size={16} /> },
  { label: "Disable MicroBuzz", action: "disable_microbuzz", icon: <RadioTower size={16} /> },
  { label: "Disable Discover", action: "disable_discover", icon: <Sparkles size={16} /> },
];

const RESTORE_ACTIONS = [
  { label: "Unsuspend", action: "unsuspend_account" },
  { label: "Unban", action: "unban_account" },
  { label: "Enable Chat", action: "enable_chat" },
  { label: "Enable Video Call", action: "enable_video_call" },
  { label: "Enable Gifts", action: "enable_gifts" },
  { label: "Enable Posting", action: "enable_posting" },
  { label: "Enable MicroBuzz", action: "enable_microbuzz" },
  { label: "Enable Discover", action: "enable_discover" },
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
      <p className="mt-1 text-gray-900 font-semibold break-words">
        {value || "—"}
      </p>
    </div>
  );
}

function PrettyJson({ data }) {
  const json = useMemo(() => {
    try {
      return JSON.stringify(data || {}, null, 2);
    } catch {
      return "{}";
    }
  }, [data]);

  return (
    <pre className="max-h-[360px] overflow-auto rounded-2xl bg-gray-950 text-rose-50 p-4 text-xs leading-relaxed">
      {json}
    </pre>
  );
}

function UserMiniCard({ title, user, fallbackId }) {
  return (
    <div className="rounded-2xl bg-rose-50/70 border border-rose-100 p-4">
      <p className="text-xs uppercase tracking-wide text-rose-500 font-black">
        {title}
      </p>
      <div className="mt-3 flex items-center gap-3">
        {user?.avatar ? (
          <img
            src={user.avatar}
            alt=""
            className="h-12 w-12 rounded-2xl object-cover border border-white shadow"
          />
        ) : (
          <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-pink-500 to-rose-600 text-white flex items-center justify-center font-black">
            {(user?.firstName || "?").slice(0, 1)}
          </div>
        )}

        <div>
          <p className="font-black text-gray-900">
            {[user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
              "Unknown User"}
          </p>
          <p className="text-xs text-gray-500">{user?.id || fallbackId || "—"}</p>
        </div>
      </div>
    </div>
  );
}

export default function AdminReportDetail() {
  const { reportId } = useParams();

  const [report, setReport] = useState(null);
  const [targetHistory, setTargetHistory] = useState(null);
  const [adminNotes, setAdminNotes] = useState("");
  const [actionReason, setActionReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function loadDetail() {
    setLoading(true);
    setError("");
    setSuccess("");

    try {
      const data = await adminFetch(`/reports/${reportId}`);
      const loadedReport = data?.report || null;
      setReport(loadedReport);
      setAdminNotes(loadedReport?.adminNotes || "");
      setActionReason(loadedReport?.adminNotes || loadedReport?.reason || "");

      const targetUserId =
        loadedReport?.reportedUserId ||
        loadedReport?.targetOwnerId ||
        loadedReport?.targetId;

      if (targetUserId) {
        try {
          const history = await adminFetch(`/reports/user/${targetUserId}/history`);
          setTargetHistory(history || null);
        } catch {
          setTargetHistory(null);
        }
      }
    } catch (err) {
      setError(err.message || "Failed to load report.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId]);

  async function updateModeration(status) {
    setWorking(true);
    setError("");
    setSuccess("");

    try {
      const data = await adminFetch(`/reports/${reportId}/moderate`, {
        method: "PATCH",
        body: JSON.stringify({
          status,
          adminNotes,
        }),
      });

      setReport(data?.report || report);
      setSuccess(`Report marked as ${status}.`);
    } catch (err) {
      setError(err.message || "Failed to update report.");
    } finally {
      setWorking(false);
    }
  }

  async function applyUserAction(actionConfig) {
    const confirmed = window.confirm(
      `Apply "${actionConfig.label}" to this reported user?`
    );

    if (!confirmed) return;

    setWorking(true);
    setError("");
    setSuccess("");

    try {
      const data = await adminFetch(`/reports/${reportId}/user-action`, {
        method: "PATCH",
        body: JSON.stringify({
          action: actionConfig.action,
          suspensionDays: actionConfig.suspensionDays,
          reason: actionReason || adminNotes || report?.reason || "Admin safety review",
          adminNotes: adminNotes || actionReason || report?.reason || "",
        }),
      });

      setReport(data?.report || report);
      setSuccess(`Action applied: ${actionConfig.label}.`);
      await loadDetail();
    } catch (err) {
      setError(err.message || "Failed to apply user action.");
    } finally {
      setWorking(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-rose-50 flex items-center justify-center text-rose-600 font-black">
        Loading report...
      </div>
    );
  }

  if (error && !report) {
    return (
      <div className="min-h-screen bg-rose-50 px-4 py-10">
        <div className="mx-auto max-w-3xl rounded-3xl bg-white p-8 shadow-xl border border-red-100">
          <Link to="/admin/reports" className="inline-flex items-center gap-2 text-rose-600 font-black">
            <ArrowLeft size={18} />
            Back to Reports
          </Link>
          <p className="mt-6 text-red-600 font-bold">{error}</p>
        </div>
      </div>
    );
  }

  const targetUserId =
    report?.reportedUserId || report?.targetOwnerId || report?.targetId || "";

  return (
    <div className="min-h-screen bg-gradient-to-br from-rose-50 via-pink-50 to-orange-50 px-3 py-6 md:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-5">
          <Link
            to="/admin/reports"
            className="inline-flex items-center gap-2 rounded-2xl bg-white text-rose-600 px-4 py-2 font-black shadow border border-rose-100 hover:bg-rose-50"
          >
            <ArrowLeft size={18} />
            Back to Reports
          </Link>
        </div>

        <div className="rounded-3xl bg-white/95 border border-rose-100 shadow-xl p-6 md:p-8 mb-6">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-5">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-rose-100 text-rose-700 px-4 py-2 text-sm font-black">
                <Shield size={16} />
                Report Detail
              </div>
              <h1 className="mt-4 text-3xl md:text-5xl font-black text-gray-950">
                {String(report?.targetType || "unknown").replace(/_/g, " ")}
              </h1>
              <p className="mt-2 text-gray-600 max-w-2xl">
                Review evidence, update report status, and apply user restrictions.
              </p>
            </div>

            <div className="rounded-2xl bg-gray-950 text-white px-5 py-4">
              <p className="text-xs uppercase tracking-wide text-rose-200 font-black">
                Current Status
              </p>
              <p className="text-2xl font-black">{report?.status || "open"}</p>
              <p className="text-xs text-gray-300 mt-1">
                Priority: {report?.priority || "normal"}
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
            <InfoCard title="Report Information">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Report ID" value={report?.id} />
                <Field label="Created" value={formatAdminDate(report?.createdAt)} />
                <Field label="Reason" value={report?.reason} />
                <Field label="Details" value={report?.details} />
                <Field label="Target Type" value={report?.targetType} />
                <Field label="Target ID" value={report?.targetId} />
                <Field label="Source" value={report?.source} />
                <Field label="Action Taken" value={report?.actionTaken} />
              </div>
            </InfoCard>

            <InfoCard title="People">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <UserMiniCard
                  title="Reporter"
                  user={report?.reporterUser || report?.fromUser}
                  fallbackId={report?.reporterId || report?.from}
                />
                <UserMiniCard
                  title="Reported User"
                  user={report?.targetUser}
                  fallbackId={targetUserId}
                />
              </div>
            </InfoCard>

            <InfoCard title="Evidence Snapshot">
              <PrettyJson data={report?.evidenceSnapshot || {}} />
            </InfoCard>

            <InfoCard title="Reported User History">
              {!targetHistory ? (
                <p className="text-gray-500 font-semibold">
                  No history loaded.
                </p>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  <div className="rounded-2xl bg-rose-50 p-4">
                    <p className="text-xs font-black text-gray-500">Received</p>
                    <p className="text-2xl font-black">
                      {targetHistory.summary?.receivedCount || 0}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-amber-50 p-4">
                    <p className="text-xs font-black text-gray-500">Open</p>
                    <p className="text-2xl font-black">
                      {targetHistory.summary?.openReceivedCount || 0}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-red-50 p-4">
                    <p className="text-xs font-black text-gray-500">Urgent</p>
                    <p className="text-2xl font-black">
                      {targetHistory.summary?.urgentReceivedCount || 0}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-emerald-50 p-4">
                    <p className="text-xs font-black text-gray-500">Actioned</p>
                    <p className="text-2xl font-black">
                      {targetHistory.summary?.actionedReceivedCount || 0}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-slate-100 p-4">
                    <p className="text-xs font-black text-gray-500">Dismissed</p>
                    <p className="text-2xl font-black">
                      {targetHistory.summary?.dismissedReceivedCount || 0}
                    </p>
                  </div>
                </div>
              )}
            </InfoCard>
          </div>

          <div className="space-y-5">
            <InfoCard title="Admin Notes">
              <textarea
                value={adminNotes}
                onChange={(e) => setAdminNotes(e.target.value)}
                rows={5}
                placeholder="Write moderation notes..."
                className="w-full rounded-2xl border border-rose-100 bg-white p-4 outline-none focus:ring-2 focus:ring-rose-300 font-semibold"
              />

              <div className="mt-4 grid grid-cols-1 gap-2">
                {STATUS_ACTIONS.map((item) => (
                  <button
                    key={item.status}
                    disabled={working}
                    onClick={() => updateModeration(item.status)}
                    className="rounded-2xl bg-gray-950 text-white px-4 py-3 font-black hover:bg-rose-600 disabled:opacity-50 transition"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </InfoCard>

            <InfoCard title="Action Reason">
              <textarea
                value={actionReason}
                onChange={(e) => setActionReason(e.target.value)}
                rows={4}
                placeholder="Reason sent into moderation record..."
                className="w-full rounded-2xl border border-rose-100 bg-white p-4 outline-none focus:ring-2 focus:ring-rose-300 font-semibold"
              />
            </InfoCard>

            <InfoCard title="Apply User Action">
              <div className="grid grid-cols-1 gap-2">
                {USER_ACTIONS.map((item) => (
                  <button
                    key={item.action}
                    disabled={working}
                    onClick={() => applyUserAction(item)}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-pink-500 to-rose-600 text-white px-4 py-3 font-black shadow hover:scale-[1.01] disabled:opacity-50 transition"
                  >
                    {item.icon}
                    {item.label}
                  </button>
                ))}
              </div>
            </InfoCard>

            <InfoCard title="Restore Access">
              <div className="grid grid-cols-1 gap-2">
                {RESTORE_ACTIONS.map((item) => (
                  <button
                    key={item.action}
                    disabled={working}
                    onClick={() => applyUserAction(item)}
                    className="rounded-2xl bg-white border border-emerald-200 text-emerald-700 px-4 py-3 font-black hover:bg-emerald-50 disabled:opacity-50 transition"
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              <p className="mt-4 text-xs text-gray-500">
                Restore buttons are admin-only actions and still get logged into
                the report record.
              </p>
            </InfoCard>
          </div>
        </div>
      </div>
    </div>
  );
}