/**
 * Path: server/scripts/migrate-lowdb-to-mongodb.js
 * Purpose: Offline, rerunnable LowDB import; dry-run by default, never changes the source file.
 */
const fs = require("node:fs/promises");
const path = require("node:path");
const mongoose = require("mongoose");
const { hash } = require("./lowdb/validation");
const { planMigration, applyPlan } = require("./lowdb/planner");

function parseArgs(argv) {
  const args = { file: path.resolve(__dirname, "../db.json"), apply: false, validateOnly: false, namespace: "rombuzz-lowdb-v1" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--apply") args.apply = true;
    else if (arg === "--validate-only") args.validateOnly = true;
    else if (arg === "--dry-run") args.apply = false;
    else if (["--file", "--db", "--report", "--namespace"].includes(arg)) {
      const value = argv[++i];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      args[arg.slice(2)] = value;
    } else throw new Error(`Unknown argument ${arg}`);
  }
  if (args.apply && args.validateOnly) throw new Error("--apply and --validate-only cannot be combined");
  if (!args.validateOnly && (!args.db || !process.env.MIGRATION_MONGO_URI)) {
    throw new Error("Set MIGRATION_MONGO_URI and pass --db explicitly; use --validate-only for offline inspection");
  }
  if (args.report && path.resolve(args.file).toLowerCase() === path.resolve(args.report).toLowerCase()) throw new Error("Report must not overwrite the source file");
  return args;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  // Deliberately no dotenv or implicit production MONGO_URI lookup.
  const source = await fs.readFile(args.file);
  let data;
  try { data = JSON.parse(source.toString("utf8").replace(/^\uFEFF/, "")); }
  catch { throw new Error("Source file is not valid JSON"); }
  // Reserve the report before touching Mongo; an invalid/existing report path
  // must never cause an otherwise successful apply to fail afterwards.
  const reportHandle = args.report ? await fs.open(args.report, "wx", 0o600) : null;
  try {
    if (!args.validateOnly) await mongoose.connect(process.env.MIGRATION_MONGO_URI, {
      dbName: args.db, autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 10000,
    });
    const plan = await planMigration(data, { connected: !args.validateOnly, namespace: args.namespace });
    plan.report.sourceSha256 = hash(source.toString("utf8"));
    if (args.apply && plan.report.valid) {
      try { await applyPlan(plan); }
      catch { plan.report.valid = false; plan.report.issues.push({ reason: "Apply stopped; committed records have receipts. Inspect target, then rerun dry-run. No source records were deleted." }); }
    }
    const output = JSON.stringify(plan.report, null, 2);
    console.log(output);
    // Exclusive creation prevents accidentally overwriting a backup through an alias/symlink.
    if (reportHandle) await reportHandle.writeFile(output + "\n");
    return plan.report.valid ? 0 : 2;
  } finally {
    await reportHandle?.close();
    await mongoose.disconnect();
  }
}

if (require.main === module) main().then((code) => { process.exitCode = code; }).catch((err) => {
  // Never print connection errors/URIs or raw Mongo duplicate values.
  const safe = /^(Set MIGRATION|--|Missing value|Unknown argument|Source file|Report must)/.test(err.message);
  console.error(safe ? err.message : "Migration failed: check source path, permissions, and explicit database configuration. No source file was modified.");
  process.exitCode = 1;
});
module.exports = { main, parseArgs };
