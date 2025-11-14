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
    process.exit(1);
  }

  try {
    mongoose.set("strictQuery", false);

    await mongoose.connect(uri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log("🍃 MongoDB connected successfully");
  } catch (err) {
    console.error("❌ MongoDB connection failed", err);
    process.exit(1);
  }
}

module.exports = { initMongo };
