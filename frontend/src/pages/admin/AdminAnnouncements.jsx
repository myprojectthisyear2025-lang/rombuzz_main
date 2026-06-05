/**
 * ============================================================
 * 📁 File: src/pages/admin/AdminAnnouncements.jsx
 * 📣 Purpose: RomBuzz admin announcement sender.
 *
 * Route:
 *   - /admin/announcements
 *
 * Used for:
 *   - Sending one official RomBuzz notification to all users
 *   - Creates mobile notification type: "rombuzz"
 *   - Does not touch reports/support pages
 * ============================================================
 */

import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  BellRing,
  CheckCircle2,
  Megaphone,
  RefreshCw,
  Send,
  ShieldCheck,
} from "lucide-react";
import { adminFetch } from "./adminApi";

const DEFAULT_HREF = "/notifications";
const MAX_MESSAGE_LENGTH = 500;

function ResultCard({ result }) {
  if (!result) return null;

  return (
    <div className="rounded-3xl border border-emerald-100 bg-emerald-50 p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="h-11 w-11 rounded-2xl bg-emerald-500 text-white flex items-center justify-center">
          <CheckCircle2 size={22} />
        </div>

        <div>
          <p className="font-black text-emerald-800">
            Announcement sent successfully
          </p>

          <p className="mt-1 text-sm text-emerald-700 font-semibold">
            Sent to {result.sent ?? 0} user{Number(result.sent || 0) === 1 ? "" : "s"}.
            {Number(result.failed || 0) > 0
              ? ` ${result.failed} failed.`
              : " No failures reported."}
          </p>

          <p className="mt-2 text-xs text-emerald-700/80 font-bold">
            Total users checked: {result.totalUsers ?? 0}
          </p>
        </div>
      </div>
    </div>
  );
}

export default function AdminAnnouncements() {
  const [message, setMessage] = useState("");
  const [href, setHref] = useState(DEFAULT_HREF);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const cleanMessage = useMemo(() => message.trim(), [message]);
  const remaining = MAX_MESSAGE_LENGTH - message.length;
  const canSend = cleanMessage.length > 0 && remaining >= 0 && !working;

  async function sendAnnouncement() {
    const confirmed = window.confirm(
      "Send this RomBuzz announcement notification to every user?"
    );

    if (!confirmed) return;

    setWorking(true);
    setError("");
    setResult(null);

    try {
      const data = await adminFetch("/admin/announcements/broadcast", {
        method: "POST",
        body: JSON.stringify({
          message: cleanMessage,
          href: href.trim() || DEFAULT_HREF,
        }),
      });

      setResult(data || null);
      setMessage("");
      setHref(DEFAULT_HREF);
    } catch (err) {
      setError(err.message || "Failed to send announcement.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-rose-50 via-pink-50 to-orange-50 px-3 py-6 md:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 rounded-3xl bg-white/90 border border-rose-100 shadow-xl p-6 md:p-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-5">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-rose-100 text-rose-700 px-4 py-2 text-sm font-bold">
                <Megaphone size={16} />
                RomBuzz Admin
              </div>

              <h1 className="mt-4 text-3xl md:text-5xl font-black text-gray-950">
                Announcements
              </h1>

              <p className="mt-2 text-gray-600 max-w-2xl">
                Send official RomBuzz announcements to every user as an in-app
                notification. These appear under the RomBuzz filter in the app.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <Link
                to="/admin/reports"
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white border border-rose-100 px-5 py-3 font-black text-rose-700 hover:bg-rose-50 transition"
              >
                <ArrowLeft size={18} />
                Reports
              </Link>

              <Link
                to="/admin/support"
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white border border-rose-100 px-5 py-3 font-black text-rose-700 hover:bg-rose-50 transition"
              >
                <ShieldCheck size={18} />
                Support
              </Link>
            </div>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-3xl bg-white/95 border border-rose-100 shadow-xl p-6 md:p-8">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-pink-500 to-rose-600 text-white flex items-center justify-center shadow-md">
                <BellRing size={22} />
              </div>

              <div>
                <h2 className="text-xl font-black text-gray-950">
                  Send RomBuzz Announcement
                </h2>
                <p className="text-sm text-gray-500 font-semibold">
                  This creates one notification for every user.
                </p>
              </div>
            </div>

            {error ? (
              <div className="mt-6 rounded-2xl border border-red-100 bg-red-50 p-4 text-red-700 font-bold flex gap-3">
                <AlertTriangle size={19} className="shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            ) : null}

            <div className="mt-6">
              <label className="text-xs uppercase tracking-wide text-gray-500 font-black">
                Announcement Message
              </label>

              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value.slice(0, 700))}
                rows={8}
                placeholder="Example: We just added a new RomBuzz feature. Open the app and check it out 💘"
                className="mt-2 w-full rounded-3xl border border-rose-100 bg-rose-50/40 px-5 py-4 text-gray-900 font-semibold outline-none focus:ring-4 focus:ring-rose-100 focus:border-rose-300 resize-none"
              />

              <div className="mt-2 flex items-center justify-between gap-3">
                <p className="text-xs text-gray-500 font-semibold">
                  Keep it short. Users will see this inside notifications.
                </p>

                <p
                  className={`text-xs font-black ${
                    remaining < 0 ? "text-red-600" : "text-gray-500"
                  }`}
                >
                  {remaining} left
                </p>
              </div>
            </div>

            <div className="mt-5">
              <label className="text-xs uppercase tracking-wide text-gray-500 font-black">
                Open Link
              </label>

              <input
                value={href}
                onChange={(e) => setHref(e.target.value)}
                placeholder="/notifications"
                className="mt-2 w-full rounded-2xl border border-rose-100 bg-white px-5 py-4 text-gray-900 font-bold outline-none focus:ring-4 focus:ring-rose-100 focus:border-rose-300"
              />

              <p className="mt-2 text-xs text-gray-500 font-semibold">
                Use /notifications unless you want the announcement to open a
                specific web/mobile route.
              </p>
            </div>

            <button
              onClick={sendAnnouncement}
              disabled={!canSend}
              className={`mt-7 inline-flex w-full items-center justify-center gap-3 rounded-2xl px-6 py-4 font-black shadow-lg transition ${
                canSend
                  ? "bg-gradient-to-r from-pink-600 to-rose-600 text-white hover:shadow-xl"
                  : "bg-gray-200 text-gray-500 cursor-not-allowed"
              }`}
            >
              {working ? <RefreshCw size={19} className="animate-spin" /> : <Send size={19} />}
              {working ? "Sending..." : "Send to All Users"}
            </button>
          </div>

          <div className="space-y-6">
            <div className="rounded-3xl bg-white/95 border border-rose-100 shadow-xl p-6">
              <h3 className="font-black text-gray-950">What users see</h3>

              <div className="mt-4 rounded-3xl border-l-4 border-rose-600 bg-rose-50 p-4 shadow-sm">
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center">
                    <Megaphone size={18} />
                  </div>

                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-500 font-black">
                      RomBuzz
                    </p>
                    <p className="mt-1 text-sm text-gray-900 font-bold whitespace-pre-wrap">
                      {cleanMessage || "Your announcement preview will appear here."}
                    </p>
                    <p className="mt-2 text-xs text-emerald-600 font-black">
                      Unread
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <ResultCard result={result} />

            <div className="rounded-3xl border border-amber-100 bg-amber-50 p-5">
              <div className="flex gap-3">
                <AlertTriangle className="shrink-0 text-amber-600" size={20} />
                <div>
                  <p className="font-black text-amber-800">Be careful</p>
                  <p className="mt-1 text-sm text-amber-700 font-semibold">
                    This sends to every user. Do not use it for testing unless
                    you are okay with all accounts receiving it.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}