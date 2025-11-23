/**
 * ================================================================
 * 📁 File: utils/helpers.js
 * 🧩 Purpose:
 *   Centralized reusable utility functions for the RomBuzz backend.
 *
 *   Includes:
 *   - User data sanitization
 *   - Block check (MongoDB: Relationship model)
 *   - Time + distance utilities
 *   - Chat room persistence (in-memory, no LowDB)
 *   - Match streak increment (MongoDB: MatchStreak model)
 *   - Notification dispatcher (MongoDB + Socket.io)
 *
 * ⚙️ Updated:
 *   - Removed all LowDB references
 *   - sendNotification → MongoDB Notification + Socket.IO only
 *   - isBlocked        → uses Relationship collection
 *   - incMatchStreakOut → uses MatchStreak collection
 *
 *   © 2025 RomBuzz (Neptrixx Technologies)
 * ================================================================
 */

const shortid = require("shortid");
const Notification = require("../models/Notification");
const MatchStreak = require("../models/MatchStreak");
const Relationship = require("../models/Relationship");

const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000; // 30 days in ms

/* ============================================================
   🔔 sendNotification(toId, data)
   ------------------------------------------------------------
   Mongo-only notification dispatcher + Socket.IO emit
============================================================ */
async function sendNotification(toId, data = {}) {
  try {
    if (!toId) {
      console.warn("sendNotification called without toId");
      return null;
    }

    const notif = {
      id: shortid.generate(),
      toId,
      fromId: data.fromId || "",
      type: data.type || "system",
      message: data.message || "",
      href: data.href || "",
      entity: data.entity || "",
      entityId: data.entityId || "",
      postId: data.postId || "",
      postOwnerId: data.postOwnerId || "",
      createdAt: Date.now(),
      read: false,
    };

    // 1️⃣ Store in MongoDB
    const mongoNotif = await Notification.create(notif);

    // 2️⃣ Real-time socket emit (this fixes Navbar unread issue)
    const io = global.io || null;
    const onlineUsers = global.onlineUsers || {};

    const socketId = onlineUsers[toId];
    if (io && socketId) {
      io.to(String(socketId)).emit(
        "notification",
        mongoNotif.toObject ? mongoNotif.toObject() : mongoNotif
      );
    }

    console.log(`🔔 Notification → ${toId}: ${notif.message}`);
    return mongoNotif;
  } catch (err) {
    console.error("❌ sendNotification error:", err);
    return null;
  }
}


/* ============================================================
   🧼 baseSanitizeUser(user)
============================================================ */
function baseSanitizeUser(user) {
  if (!user) return null;
  const {
    passwordHash,
    emailVerificationCode,
    pendingEmailChange,
    ...safe
  } = user;
  return {
    ...safe,
    profileComplete: user.profileComplete || false,
  };
}

/* ============================================================
   🚫 isBlocked(user1, user2)
   ------------------------------------------------------------
   Mongo-based block check using Relationship model.

   Supports both legacy signature (db, user1, user2) and
   new signature (user1, user2). The first param is ignored
   if it looks like a DB object.
============================================================ */
async function isBlocked(a, b, c) {
  let user1;
  let user2;

  // New usage: isBlocked("u1", "u2")
  if (typeof a === "string" && typeof b === "string") {
    user1 = a;
    user2 = b;
  } else {
    // Legacy usage: isBlocked(db, "u1", "u2")
    user1 = b;
    user2 = c;
  }

  if (!user1 || !user2) return false;

  try {
    const exists = await Relationship.exists({
      type: "block",
      $or: [
        { from: String(user1), to: String(user2) },
        { from: String(user2), to: String(user1) },
      ],
    });
    return !!exists;
  } catch (err) {
    console.error("⚠️ isBlocked Mongo error:", err);
    return false;
  }
}

/* ============================================================
   ⏱️ msToDays(ms)
============================================================ */
function msToDays(ms) {
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

/* ============================================================
   📏 distanceKm(loc1, loc2)
============================================================ */
function distanceKm(loc1, loc2) {
  if (!loc1 || !loc2) return 0;
  const R = 6371; // Earth radius in km
  const dLat = ((loc2.lat - loc1.lat) * Math.PI) / 180;
  const dLon = ((loc2.lng - loc1.lng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((loc1.lat * Math.PI) / 180) *
      Math.cos((loc2.lat * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/* ============================================================
   💬 getRoomDoc(db, roomId)
   ------------------------------------------------------------
   In-memory room message store (no LowDB).
   Keeps the signature (db, roomId) for compatibility,
   but ignores the first argument.
============================================================ */
const roomStore =
  (global && global._roomMessages) ||
  (global._roomMessages = new Map());

async function getRoomDoc(_dbIgnored, roomId) {
  const key = String(roomId);
  let doc = roomStore.get(key);
  if (!doc) {
    doc = { roomId: key, list: [] };
    roomStore.set(key, doc);
  }
  return doc;
}

/* ============================================================
   🔥 incMatchStreakOut(fromId, toId)
   ------------------------------------------------------------
   Mongo-based MatchStreak increment.
   - Uses MatchStreak collection
   - key = `${fromId}_${toId}`
   - Returns a simple object: { from, to, count, lastBuzz, createdAt }
============================================================ */
async function incMatchStreakOut(fromId, toId) {
  const from = String(fromId);
  const to = String(toId);
  const key = `${from}_${to}`;

  try {
    let streak = await MatchStreak.findOne({ key });

    if (!streak) {
      streak = await MatchStreak.create({
        id: shortid.generate(),
        key,
        from,
        to,
        count: 1,
        lastBuzz: new Date(),
      });
    } else {
      streak.count = Number(streak.count || 0) + 1;
      streak.lastBuzz = new Date();
      await streak.save();
    }

    return {
      from: streak.from,
      to: streak.to,
      count: Number(streak.count || 0),
      lastBuzz: streak.lastBuzz || null,
      createdAt: streak.createdAt || null,
    };
  } catch (err) {
    console.error("⚠️ incMatchStreakOut Mongo error:", err);
    return {
      from,
      to,
      count: 0,
      lastBuzz: null,
      createdAt: null,
    };
  }
}

// ============================================================
// 📦 Exports
// ============================================================
module.exports = {
  sendNotification,
  baseSanitizeUser,
  isBlocked,
  msToDays,
  distanceKm,
  getRoomDoc,
  incMatchStreakOut,
  THIRTY_DAYS,
};
