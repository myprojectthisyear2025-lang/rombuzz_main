/**
 * ============================================================
 * 📁 File: services/microbuzzSessionService.js
 * 🎯 Purpose: Resolve active MicroBuzz sessions and session ignores.
 * ============================================================
 */
const crypto = require("crypto");

const MicroBuzzPresence =
  require("../models/MicroBuzzPresence");

const MicroBuzzSessionIgnore =
  require("../models/MicroBuzzSessionIgnore");

const SESSION_FRESH_MS =
  5 * 60 * 1000;

function createSessionId() {
  return crypto.randomUUID();
}

function isFreshPresence(
  presence
) {
  if (!presence?.updatedAt) {
    return false;
  }

  return (
    Date.now() -
      new Date(
        presence.updatedAt
      ).getTime() <
    SESSION_FRESH_MS
  );
}

function resolveSessionId(
  existingPresence
) {
  if (
    isFreshPresence(
      existingPresence
    ) &&
    existingPresence?.sessionId
  ) {
    return existingPresence.sessionId;
  }

  return createSessionId();
}

async function getActiveSessionId(
  userId
) {
  const cutoff =
    new Date(
      Date.now() -
        SESSION_FRESH_MS
    );

  const presence =
    await MicroBuzzPresence.findOne({
      userId,
      updatedAt: {
        $gte: cutoff,
      },
    })
      .select("sessionId")
      .lean();

  return presence?.sessionId || "";
}

async function ignoreForCurrentSession(
  byId,
  fromId
) {
  const sessionId =
    await getActiveSessionId(
      byId
    );

  if (!sessionId) {
    return false;
  }

  await MicroBuzzSessionIgnore
    .findOneAndUpdate(
      {
        byId,
        fromId,
        sessionId,
      },
      {
        byId,
        fromId,
        sessionId,

        createdAt:
          new Date(),

        expiresAt:
          new Date(
            Date.now() +
              24 *
                60 *
                60 *
                1000
          ),
      },
      {
        upsert: true,
        setDefaultsOnInsert: true,
      }
    );

  return true;
}

async function isIgnoredForCurrentSession(
  byId,
  fromId
) {
  const sessionId =
    await getActiveSessionId(
      byId
    );

  if (!sessionId) {
    return false;
  }

  return Boolean(
    await MicroBuzzSessionIgnore.exists({
      byId,
      fromId,
      sessionId,
    })
  );
}

async function getIgnoredIdsForCurrentSession(
  byId
) {
  const sessionId =
    await getActiveSessionId(
      byId
    );

  if (!sessionId) {
    return [];
  }

  const rows =
    await MicroBuzzSessionIgnore.find({
      byId,
      sessionId,
    })
      .select("fromId")
      .lean();

  return rows.map(
    (row) =>
      String(row.fromId)
  );
}

async function clearSessionIgnores(
  byId,
  sessionId
) {
  if (!sessionId) {
    return;
  }

  await MicroBuzzSessionIgnore
    .deleteMany({
      byId,
      sessionId,
    });
}

module.exports = {
  clearSessionIgnores,
  getActiveSessionId,
  getIgnoredIdsForCurrentSession,
  ignoreForCurrentSession,
  isIgnoredForCurrentSession,
  resolveSessionId,
};