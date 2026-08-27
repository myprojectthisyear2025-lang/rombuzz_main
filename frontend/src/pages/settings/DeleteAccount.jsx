/**
 * ============================================================================
 * 📁 File: frontend/src/pages/settings/DeleteAccount.jsx
 * 🎯 Purpose: RomBuzz web account lifecycle controls.
 *
 * Responsibilities:
 * - Temporarily deactivate an authenticated account.
 * - Start the irreversible account-deletion lifecycle.
 * - Handle required BuzzCoin/virtual-balance forfeiture confirmation.
 * - Keep user-facing copy aligned with the backend's 7-day deletion hold.
 * - Clear browser authentication after deletion begins.
 * ============================================================================
 */

import { useEffect, useState } from "react";
import { API_BASE } from "../../config";

const token = () =>
  localStorage.getItem("token") ||
  sessionStorage.getItem("token") ||
  "";

const safeNumber = (value) => {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
};

const formatBC = (value) =>
  `${safeNumber(value).toLocaleString()} BC`;

const clearAuthAndRedirect = (path) => {
  localStorage.clear();
  sessionStorage.clear();
  window.location.href = path;
};

export default function DeleteAccount() {
  const [pending, setPending] = useState(false);

  const handleDeactivate = async () => {
    const t = token();

    if (!t) {
      return alert("Login required");
    }

    if (
      !window.confirm(
        "Are you sure you want to deactivate your account?"
      )
    ) {
      return;
    }

    try {
      const res = await fetch(
        `${API_BASE}/account/deactivate`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${t}`,
          },
        }
      );

      const data = await res.json();

      if (!res.ok) {
        throw new Error(
          data.error || "Failed to deactivate"
        );
      }

      alert(
        "Your account has been deactivated. You can reactivate it by logging in again."
      );

      clearAuthAndRedirect("/");
    } catch (err) {
      console.error("Deactivate error:", err);
      alert("Could not deactivate account.");
    }
  };

  const showForfeitConfirmation = (wallet = {}) => {
    const balanceBC = safeNumber(wallet.balanceBC);
    const pendingBC = safeNumber(wallet.pendingBC);
    const earnedBC = safeNumber(wallet.earnedBC);

    const totalBC = safeNumber(
      wallet.totalBC ||
        balanceBC +
          pendingBC +
          earnedBC
    );

    return window.confirm(
      [
        "You still have a BuzzCoin or virtual balance on this account.",
        "",
        `Spendable: ${formatBC(balanceBC)}`,
        `Pending: ${formatBC(pendingBC)}`,
        `Other balance: ${formatBC(earnedBC)}`,
        `Total: ${formatBC(totalBC)}`,
        "",
        "If you continue, this balance will be permanently forfeited and cannot be restored.",
        "",
        "Do you understand and want to permanently delete the account?",
      ].join("\n")
    );
  };

  const startDeletion = async (
    confirmForfeit = false
  ) => {
    const t = token();

    if (!t) {
      return alert("Login required");
    }

    setPending(true);

    try {
      const res = await fetch(
        `${API_BASE}/account/delete`,
        {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${t}`,
          },
          body: JSON.stringify(
            confirmForfeit
              ? { confirmForfeit: true }
              : {}
          ),
        }
      );

      const data = await res
        .json()
        .catch(() => ({}));

      const code = String(
        data.code || data.error || ""
      ).trim();

      if (
        res.status === 409 &&
        code ===
          "BUZZCOIN_FORFEIT_CONFIRMATION_REQUIRED"
      ) {
        setPending(false);

        if (
          showForfeitConfirmation(
            data.wallet || {}
          )
        ) {
          await startDeletion(true);
        }

        return;
      }

      if (!res.ok) {
        throw new Error(
          data.message ||
            data.error ||
            "Failed to delete account"
        );
      }

      const manualAppleRevocation =
        data?.cleanup?.apple
          ?.manualRevocationRequired === true;

      const message = manualAppleRevocation
        ? [
            "Deletion started. Your RomBuzz profile is no longer available to other users, and your email is now in the 7-day deletion hold while final cleanup completes.",
            "",
            "This account used an older Sign in with Apple authorization. Please also remove RomBuzz from Sign in with Apple in your Apple Account settings.",
            "",
            "This deletion cannot be cancelled or restored.",
          ].join("\n")
        : [
            "Deletion started. Your RomBuzz profile is no longer available to other users, and your email is now in the 7-day deletion hold while final cleanup completes.",
            "",
            "This deletion cannot be cancelled or restored.",
          ].join("\n");

      alert(message);

      clearAuthAndRedirect("/");
    } catch (err) {
      console.error(
        "Delete error:",
        err
      );

      alert(
        `Could not delete account: ${err.message}`
      );
    } finally {
      setPending(false);
    }
  };

  const handleDelete = async () => {
    if (pending) {
      return;
    }

    const confirmed = window.confirm(
      [
        "Permanently delete your RomBuzz account?",
        "",
        "Your profile will be removed from normal RomBuzz experiences when deletion begins.",
        "Your email will remain in a restricted 7-day deletion hold while final cleanup completes.",
        "The 7-day hold is not a recovery period.",
        "",
        "This action cannot be undone and the deleted account cannot be restored.",
      ].join("\n")
    );

    if (confirmed) {
      await startDeletion(false);
    }
  };

  useEffect(() => {
    const reactivateIfNeeded = async () => {
      const t = token();

      if (!t) {
        return;
      }

      try {
        const r = await fetch(
          `${API_BASE}/profile/full`,
          {
            headers: {
              Authorization: `Bearer ${t}`,
            },
          }
        );

        const j = await r.json();
        const user = j.user;

        if (
          user &&
          user.visibility === "deactivated"
        ) {
          await fetch(
            `${API_BASE}/users/me`,
            {
              method: "PUT",
              headers: {
                "Content-Type":
                  "application/json",
                Authorization: `Bearer ${t}`,
              },
              body: JSON.stringify({
                visibility: "active",
              }),
            }
          );

          console.log(
            "✅ Auto-reactivated account"
          );
        }
      } catch (err) {
        console.error(
          "Reactivate check failed:",
          err
        );
      }
    };

    reactivateIfNeeded();
  }, []);

  return (
    <div className="max-w-lg mx-auto mt-8 p-6 bg-white border rounded-2xl shadow">
      <h2 className="text-xl font-semibold mb-1">
        Manage Account
      </h2>

      <p className="text-sm text-gray-600 mb-6">
        You can temporarily deactivate your
        account or permanently start the
        irreversible RomBuzz account-deletion
        process.
      </p>

      <div className="p-4 border rounded-xl bg-gray-50 mb-4">
        <div className="font-medium mb-1">
          Deactivate Account
        </div>

        <p className="text-sm text-gray-600">
          Your profile won’t be visible in normal
          discovery. You can reactivate your account
          by logging in again.
        </p>

        <button
          onClick={handleDeactivate}
          disabled={pending}
          className="mt-3 px-4 py-2 rounded bg-yellow-100 hover:bg-yellow-200 text-yellow-800 font-medium disabled:opacity-60"
        >
          Deactivate
        </button>
      </div>

      <div className="p-4 border rounded-xl bg-red-50">
        <div className="font-medium text-red-700 mb-1">
          Permanently Delete Account
        </div>

        <p className="text-sm text-red-700 mb-2">
          Permanent deletion removes your profile
          from normal RomBuzz use and starts a 7-day
          deletion hold while final cleanup completes.
          The hold is not a recovery period, and the
          deleted account cannot be restored.
        </p>

        <p className="text-xs text-red-600 mb-3">
          Some limited records may be retained or
          pseudonymized when required for safety,
          fraud prevention, accounting, disputes, or
          legal obligations. See the public deletion
          page for details.
        </p>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleDelete}
            disabled={pending}
            className="px-4 py-2 rounded bg-red-600 hover:bg-red-700 text-white font-medium disabled:opacity-60"
          >
            {pending
              ? "Starting deletion…"
              : "Delete Account"}
          </button>

          <a
            href="/delete-account"
            target="_blank"
            rel="noreferrer"
            className="px-4 py-2 rounded border border-red-200 bg-white text-red-700 font-medium hover:bg-red-100"
          >
            Read deletion details
          </a>
        </div>
      </div>
    </div>
  );
}