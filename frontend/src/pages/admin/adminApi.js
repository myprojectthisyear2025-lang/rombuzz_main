/**
 * ============================================================
 * 📁 File: src/pages/admin/adminApi.js
 * 🛡️ Purpose: Small API helper for RomBuzz web admin reporting dashboard.
 *
 * Used by:
 *   - AdminReports.jsx
 *   - AdminReportDetail.jsx
 *
 * Notes:
 *   - Uses the existing RomBuzz API_BASE from src/config.js.
 *   - Uses the same logged-in token from localStorage/sessionStorage.
 *   - Does not touch user-facing app pages.
 * ============================================================
 */

import { API_BASE } from "../../config";

export function getAdminToken() {
  return localStorage.getItem("token") || sessionStorage.getItem("token") || "";
}

export function getStoredAdminUser() {
  try {
    const raw = localStorage.getItem("user") || sessionStorage.getItem("user");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function adminFetch(path, options = {}) {
  const token = getAdminToken();

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  });

  let data = null;

  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    const message =
      data?.message ||
      data?.error ||
      `Admin request failed with status ${res.status}`;

    const err = new Error(message);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

export function getReportLabel(report = {}) {
  const type = String(report.targetType || "unknown").replace(/_/g, " ");
  const reason = String(report.reason || "").trim();

  if (reason) return `${type} • ${reason}`;
  return type;
}

export function formatAdminDate(value) {
  if (!value) return "—";

  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";

    return date.toLocaleString([], {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}