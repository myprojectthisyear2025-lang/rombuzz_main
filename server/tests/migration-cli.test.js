/**
 * Path: server/tests/migration-cli.test.js
 * Purpose: Verify the offline CLI preserves its source and reports rejected data without secrets.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { legacyFixture } = require("./fixtures");
const run = promisify(execFile);
test("CLI validation leaves source bytes intact and never logs credentials", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rombuzz-import-test-"));
  const file = path.join(dir, "db.json");
  const reportFile = path.join(dir, "report.json");
  const data = legacyFixture();
  data.users[0].password = "synthetic-password-never-log";
  const source = JSON.stringify(data, null, 2);
  await fs.writeFile(file, source);
  const { stdout, stderr } = await run(process.execPath, [path.resolve(__dirname, "../scripts/migrate-lowdb-to-mongodb.js"), "--validate-only", "--file", file, "--report", reportFile], { windowsHide: true });
  const report = JSON.parse(stdout);
  assert.equal(report.valid, true, JSON.stringify(report.issues));
  assert.equal(report.totals.migrated, 0);
  assert.equal(stdout.includes(data.users[0].password), false);
  assert.equal(stderr.includes(data.users[0].password), false);
  assert.equal(await fs.readFile(file, "utf8"), source);
  assert.equal(JSON.parse(await fs.readFile(reportFile, "utf8")).valid, true);
  await fs.unlink(file);
  await fs.unlink(reportFile);
  await fs.rmdir(dir);
});
