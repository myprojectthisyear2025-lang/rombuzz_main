/**
 * ============================================================
 * 📁 File: server/routes/auth/authShared.js
 * 🎯 Purpose: Shared helpers for RomBuzz authentication routes.
 *
 * LOCATION:
 *   server/routes/auth/authShared.js
 *
 * USED BY:
 *   emailLogin.js, google.js, apple.js
 *
 * RESPONSIBILITIES:
 *   - Detect completed profiles.
 *   - Handle accounts pending permanent deletion.
 * ============================================================
 */

function sendPendingDeleteAuthResponse(res, user) {
  return res.status(423).json({
    status: "Account scheduled for deletion",
    error:
      "This account was deleted and cannot be used right now. You can create a fresh account with this email after the 7-day hold ends.",
    reusableAfter: user?.deleteAfter || null,
  });
}

function computeProfileComplete(user) {
  if (!user) return false;

  const required = [
    user.firstName,
    user.lastName,
    user.gender,
    user.dob,
    user.avatar,
  ];

  const hasPhotos =
    Array.isArray(user.photos) && user.photos.length > 0;

  const hasInterests =
    Array.isArray(user.interests) && user.interests.length > 0;

  return (
    required.every(Boolean) &&
    hasPhotos &&
    hasInterests &&
    Boolean(user.lookingFor)
  );
}

module.exports = {
  computeProfileComplete,
  sendPendingDeleteAuthResponse,
};