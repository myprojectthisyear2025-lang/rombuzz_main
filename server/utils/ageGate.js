/**
 * ============================================================
 * 📁 File: server/utils/ageGate.js
 * 🎯 Purpose: Shared server-side DOB validation for RomBuzz 18+ access.
 *
 * Used by:
 *   - Auth registration completion
 *   - Profile DOB updates
 *
 * Responsibilities:
 *   - Accept only unambiguous YYYY-MM-DD dates
 *   - Reject impossible or future dates
 *   - Enforce the RomBuzz minimum age of 18
 *   - Return a normalized DOB without logging personal data
 * ============================================================
 */

const MINIMUM_ROMBUZZ_AGE = 18;

function ageGateError(code, message) {
  return Object.assign(
    new Error(message),
    {
      code,
      statusCode: 400,
    }
  );
}

function parseIsoDob(value) {
  const raw = String(
    value || ""
  ).trim();

  if (!raw) {
    throw ageGateError(
      "DOB_REQUIRED",
      "Date of birth is required."
    );
  }

  const match =
    /^(\d{4})-(\d{2})-(\d{2})$/.exec(
      raw
    );

  if (!match) {
    throw ageGateError(
      "DOB_INVALID",
      "Date of birth must use YYYY-MM-DD format."
    );
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const date = new Date(
    Date.UTC(
      year,
      month - 1,
      day
    )
  );

  const valid =
    date.getUTCFullYear() ===
      year &&
    date.getUTCMonth() ===
      month - 1 &&
    date.getUTCDate() ===
      day;

  if (!valid) {
    throw ageGateError(
      "DOB_INVALID",
      "Please enter a valid date of birth."
    );
  }

  return {
    raw,
    year,
    month,
    day,
    date,
  };
}

function calculateAge(
  {
    year,
    month,
    day,
  },
  now = new Date()
) {
  const currentYear =
    now.getUTCFullYear();

  const currentMonth =
    now.getUTCMonth() + 1;

  const currentDay =
    now.getUTCDate();

  let age =
    currentYear - year;

  if (
    currentMonth < month ||
    (
      currentMonth === month &&
      currentDay < day
    )
  ) {
    age -= 1;
  }

  return age;
}

function requireAdultDob(
  value,
  options = {}
) {
  const minimumAge = Number(
    options.minimumAge ??
      MINIMUM_ROMBUZZ_AGE
  );

  const parsed =
    parseIsoDob(value);

  const now =
    options.now instanceof Date
      ? options.now
      : new Date();

  if (
    parsed.date.getTime() >
    now.getTime()
  ) {
    throw ageGateError(
      "DOB_FUTURE",
      "Date of birth cannot be in the future."
    );
  }

  const age =
    calculateAge(
      parsed,
      now
    );

  if (
    !Number.isFinite(age) ||
    age < minimumAge
  ) {
    throw ageGateError(
      "UNDERAGE_NOT_ALLOWED",
      `You must be at least ${minimumAge} years old to use RomBuzz.`
    );
  }

  return {
    dob: parsed.raw,
    age,
  };
}

module.exports = {
  MINIMUM_ROMBUZZ_AGE,
  calculateAge,
  parseIsoDob,
  requireAdultDob,
};