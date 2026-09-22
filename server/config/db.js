/**
 * ============================================================
 * 📁 File: config/db.js
 * 🍃 Purpose: REAL MongoDB connection loader for RomBuzz backend
 *
 * - Connects to MongoDB Atlas using Mongoose
 * - Validates MONGO_URI
 * - Exports an async init() function
 * - Logs clean startup messages for Render
 *
 * Used In:
 *   index.js → const { initMongo } = require("./config/db");
 *              await initMongo();
 * ============================================================
 */

const mongoose = require("mongoose");

async function initMongo() {
  const uri = process.env.MONGO_URI;

  if (!uri) {
    console.error("❌ FATAL: MONGO_URI missing in environment.");
    throw new Error("MONGO_URI is required");
  }

  try {
    mongoose.set("strictQuery", false);

    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 10000,
    });

    console.log("🍃 MongoDB connected successfully");
  } catch (err) {
    console.error("MongoDB connection failed; check configured URI and network access.");
    throw new Error("MongoDB unavailable");
  }
}

module.exports = { initMongo };
