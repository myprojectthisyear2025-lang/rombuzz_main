/**
 * ============================================================
 * 📁 File: server/routes/auth/registerFullHelpers.js
 * 🎯 Purpose: Shared helpers for completing RomBuzz signup.
 *
 * LOCATION:
 *   server/routes/auth/registerFullHelpers.js
 *
 * USED BY:
 *   server/routes/auth/registerFull.js
 *   server/routes/auth/registerFullPersistence.js
 *
 * RESPONSIBILITIES:
 *   - Sanitize signup photo URLs.
 *   - Merge signup photos into existing media.
 *   - Preserve pending-deletion signup response behavior.
 *   - Validate trusted Apple signup proof.
 * ============================================================
 */

const shortid = require("shortid");

const {
  verifyAppleSignupTicket,
} = require("./appleSignupTicket");

const {
  verifySignupVerificationTicket,
} = require("./signupVerificationTicket");

function sendPendingDeleteSignupResponse(
  res,
  user
) {
  return res.status(423).json({
    status: "",
    error:
      "This email is on a 7-day deletion hold. You can create a fresh account with this email after the hold ends.",
    reusableAfter:
      user?.deletion?.purgeAfter || null,
  });
}

function sanitizeSignupPhotos(photos = []) {
  const list =
    Array.isArray(photos) ? photos : [];

  const seenUrls = new Set();
  const cleanPhotos = [];

  for (const photo of list) {
    const url =
      String(photo || "").trim();

    if (!url || seenUrls.has(url)) {
      continue;
    }

    seenUrls.add(url);
    cleanPhotos.push(url);
  }

  return cleanPhotos;
}

function mergeSignupPhotosIntoMedia(
  existingMedia = [],
  photos = []
) {
  const mediaList =
    Array.isArray(existingMedia)
      ? [...existingMedia]
      : [];

  const photoUrls =
    sanitizeSignupPhotos(photos);

  const seenUrls = new Set(
    mediaList
      .map((item) =>
        String(item?.url || "").trim()
      )
      .filter(Boolean)
  );

  for (const photo of photoUrls) {
    const url =
      String(photo || "").trim();

    if (!url || seenUrls.has(url)) {
      continue;
    }

    mediaList.push({
      id: shortid.generate(),
      url,
      type: "image",
      caption:
        "kind:photo scope:public intent:letsbuzz",
      privacy: "public",
      createdAt: Date.now(),
      comments: [],
      reactions: {},
    });

    seenUrls.add(url);
  }

  return mediaList;
}

function signupProofError(message) {
  return Object.assign(
    new Error(message),
    { statusCode: 401 }
  );
}

function getTrustedSignupIdentity(
  body,
  emailLower
) {
  const provider =
    String(body?.authProvider || "")
      .trim()
      .toLowerCase();

  if (
    !["email", "google", "apple"].includes(
      provider
    )
  ) {
    throw signupProofError(
      "Verified signup proof is required."
    );
  }

  if (provider === "apple") {
    const ticket =
      String(
        body?.appleSignupTicket || ""
      ).trim();

    if (!ticket) {
      throw signupProofError(
        "Apple signup verification is required."
      );
    }

    const verified =
      verifyAppleSignupTicket(ticket);

    if (verified.email !== emailLower) {
      throw signupProofError(
        "Apple signup email does not match the verified Apple account."
      );
    }

    return {
      provider,
      appleId: verified.appleId,
      googleId: "",
    };
  }

  const ticket =
    String(
      body?.signupVerificationTicket || ""
    ).trim();

  if (!ticket) {
    throw signupProofError(
      provider === "google"
        ? "Google signup verification is required."
        : "Email signup verification is required."
    );
  }

  const verified =
    verifySignupVerificationTicket(
      ticket
    );

  if (verified.provider !== provider) {
    throw signupProofError(
      "Signup verification provider does not match the requested signup method."
    );
  }

  if (verified.email !== emailLower) {
    throw signupProofError(
      "Signup email does not match the verified account."
    );
  }

  return {
    provider,
    appleId: "",
    googleId:
      provider === "google"
        ? verified.providerId
        : "",
  };
}

function getTrustedAppleId(
  body,
  emailLower
) {
  const provider =
    String(body?.authProvider || "")
      .trim()
      .toLowerCase();

  if (provider !== "apple") {
    return "";
  }

  return getTrustedSignupIdentity(
    body,
    emailLower
  ).appleId;
}

module.exports = {
  getTrustedSignupIdentity,
  getTrustedAppleId,
  sanitizeSignupPhotos,
  mergeSignupPhotosIntoMedia,
  sendPendingDeleteSignupResponse,
};