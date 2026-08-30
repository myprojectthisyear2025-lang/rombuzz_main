/**
 * ============================================================
 * 📁 File: server/config/appVersionPolicy.js
 * 🎯 Purpose: Read and validate RomBuzz mobile update policy.
 *
 * Usage:
 *   Used by the public read-only app-version route.
 *   Invalid or missing configuration always fails open.
 * ============================================================
 */

const ALLOWED_PLATFORMS = new Set(["android", "ios"]);
const ALLOWED_CHANNELS = new Set(["development", "preview", "production"]);

const DEFAULT_OPTIONAL_MESSAGE =
  "A newer version of RomBuzz is available.";

const DEFAULT_REQUIRED_MESSAGE =
  "This version of RomBuzz is no longer supported. Update RomBuzz to continue.";

function normalizeValue(value) {
  return String(value || "").trim();
}

function isValidVersion(value) {
  return /^\d+\.\d+\.\d+$/.test(normalizeValue(value));
}

function compareVersions(left, right) {
  const a = normalizeValue(left).split(".").map(Number);
  const b = normalizeValue(right).split(".").map(Number);

  for (let i = 0; i < 3; i += 1) {
    if (a[i] > b[i]) return 1;
    if (a[i] < b[i]) return -1;
  }

  return 0;
}

function isValidStoreUrl(platform, value) {
  try {
    const url = new URL(normalizeValue(value));

    if (url.protocol !== "https:") {
      return false;
    }

    if (platform === "android") {
      return url.hostname === "play.google.com";
    }

    return url.hostname === "apps.apple.com";
  } catch {
    return false;
  }
}

function envPrefix(platform, channel) {
  return `ROMBUZZ_UPDATE_${channel.toUpperCase()}_${platform.toUpperCase()}`;
}

function disabledPolicy(platform, channel) {
  return {
    schemaVersion: 1,
    enabled: false,
    platform,
    channel,
  };
}

function getAppVersionPolicy(platformValue, channelValue) {
  const platform = normalizeValue(platformValue).toLowerCase();
  const channel = normalizeValue(channelValue).toLowerCase();

  if (
    !ALLOWED_PLATFORMS.has(platform) ||
    !ALLOWED_CHANNELS.has(channel)
  ) {
    return null;
  }

  const prefix = envPrefix(platform, channel);

  const enabled =
    normalizeValue(
      process.env[`${prefix}_ENABLED`]
    ).toLowerCase() === "true";

  if (!enabled) {
    return disabledPolicy(platform, channel);
  }

  const latestVersion = normalizeValue(
    process.env[`${prefix}_LATEST_VERSION`]
  );

  const minimumSupportedVersion = normalizeValue(
    process.env[`${prefix}_MINIMUM_VERSION`]
  );

  const storeUrl = normalizeValue(
    process.env[`${prefix}_STORE_URL`]
  );

  const valid =
    isValidVersion(latestVersion) &&
    isValidVersion(minimumSupportedVersion) &&
    compareVersions(
      minimumSupportedVersion,
      latestVersion
    ) <= 0 &&
    isValidStoreUrl(platform, storeUrl);

  if (!valid) {
    console.warn(
      `[app-version] Invalid ${channel}/${platform} update policy; enforcement disabled.`
    );

    return disabledPolicy(platform, channel);
  }

  return {
    schemaVersion: 1,
    enabled: true,
    platform,
    channel,
    latestVersion,
    minimumSupportedVersion,
    storeUrl,

    optionalMessage:
      normalizeValue(
        process.env[`${prefix}_OPTIONAL_MESSAGE`]
      ) || DEFAULT_OPTIONAL_MESSAGE,

    requiredMessage:
      normalizeValue(
        process.env[`${prefix}_REQUIRED_MESSAGE`]
      ) || DEFAULT_REQUIRED_MESSAGE,
  };
}

module.exports = {
  getAppVersionPolicy,
};