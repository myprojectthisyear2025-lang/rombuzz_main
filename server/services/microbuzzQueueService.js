/**
 * ============================================================
 * 📁 File: services/microbuzzQueueService.js
 * 🎯 Purpose: Build a fast filtered incoming MicroBuzz queue.
 * ============================================================
 */
const Match =
  require("../models/Match");

const MicroBuzzBuzz =
  require("../models/MicroBuzzBuzz");

const MicroBuzzPresence =
  require("../models/MicroBuzzPresence");

const Relationship =
  require("../models/Relationship");

const User =
  require("../models/User");

const {
  getIgnoredIdsForCurrentSession,
} = require(
  "./microbuzzSessionService"
);

const FRESH_MS =
  5 * 60 * 1000;

const QUEUE_LIMIT = 10;

async function getIncomingBuzzQueue({
  userId,
  signSelfie,
}) {
  const cutoff =
    new Date(
      Date.now() -
        FRESH_MS
    );

  const pending =
    await MicroBuzzBuzz.find({
      toId: userId,

      time: {
        $gte: cutoff,
      },
    })
      .sort({
        time: 1,
      })
      .limit(30)
      .lean();

  if (!pending.length) {
    return [];
  }

  const fromIds = [
    ...new Set(
      pending.map(
        (row) =>
          String(row.fromId)
      )
    ),
  ];

  const [
    profiles,
    presences,
    matches,
    blocks,
    ignoredIds,
  ] =
    await Promise.all([
      User.find({
        id: {
          $in: fromIds,
        },

        visibility: {
          $ne:
            "pending_delete",
        },

        deleteStatus: {
          $ne:
            "pending_delete",
        },
      })
        .select(
          "id firstName lastName dob"
        )
        .lean(),

      MicroBuzzPresence.find({
        userId: {
          $in: fromIds,
        },

        updatedAt: {
          $gte: cutoff,
        },
      })
        .select(
          "userId selfieUrl"
        )
        .lean(),

      Match.find({
        status:
          "matched",

        users:
          userId,
      })
        .select("users")
        .lean(),

      Relationship.find({
        type: "block",

        $or: [
          {
            from: userId,
          },
          {
            to: userId,
          },
        ],
      })
        .select("from to")
        .lean(),

      getIgnoredIdsForCurrentSession(
        userId
      ),
    ]);

  const profileMap =
    new Map(
      profiles.map(
        (row) => [
          String(row.id),
          row,
        ]
      )
    );

  const presenceMap =
    new Map(
      presences.map(
        (row) => [
          String(row.userId),
          row,
        ]
      )
    );

  const ignoredSet =
    new Set(
      ignoredIds.map(String)
    );

  const blockedSet =
    new Set(
      blocks.map(
        (row) =>
          String(row.from) ===
          String(userId)
            ? String(row.to)
            : String(row.from)
      )
    );

  const matchedSet =
    new Set(
      matches
        .flatMap(
          (row) =>
            (row.users || [])
              .map(String)
        )
        .filter(
          (id) =>
            id !==
            String(userId)
        )
    );

  const queue = [];

  for (const row of pending) {
    const fromId =
      String(row.fromId);

    if (
      ignoredSet.has(fromId) ||
      blockedSet.has(fromId) ||
      matchedSet.has(fromId)
    ) {
      continue;
    }

    const profile =
      profileMap.get(fromId);

    const presence =
      presenceMap.get(fromId);

    if (
      !profile ||
      !presence
    ) {
      continue;
    }

    const firstName =
      profile.firstName ||
      "Someone";

    const lastName =
      profile.lastName || "";

    queue.push({
      fromId,
      firstName,
      lastName,

      name: [
        firstName,
        lastName,
      ]
        .filter(Boolean)
        .join(" "),

      dob:
        profile.dob || "",

      selfieUrl:
        await signSelfie(
          presence.selfieUrl
        ),

      message:
        `${firstName} wants to match with you!`,

      type:
        "microbuzz",
    });

    if (
      queue.length >=
      QUEUE_LIMIT
    ) {
      break;
    }
  }

  return queue;
}

module.exports = {
  getIncomingBuzzQueue,
  QUEUE_LIMIT,
};