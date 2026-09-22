/**
 * Path: server/scripts/check-syntax.js
 * Purpose: Check every backend JavaScript source without loading credentials or databases.
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
let count = 0;
function check(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || ["node_modules", "uploads"].includes(entry.name)) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) check(file);
    else if (entry.name.endsWith(".js")) {
      const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
      if (result.status !== 0) { console.error(result.stderr); process.exitCode = 1; }
      count++;
    }
  }
}
check(root);
console.log(`Checked ${count} JavaScript files.`);
