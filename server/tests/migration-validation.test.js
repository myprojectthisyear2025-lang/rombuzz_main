/**
 * Path: server/tests/migration-validation.test.js
 * Purpose: Test offline mapping, non-lossy validation, conflict detection, and CLI safeguards.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { planMigration } = require("../scripts/lowdb/planner");
const { mergeMissing } = require("../scripts/lowdb/validation");
const { parseArgs } = require("../scripts/migrate-lowdb-to-mongodb");
const { legacyFixture } = require("./fixtures");
test("all discovered legacy domains map without losing relationships or timestamps", async () => {
  const plan = await planMigration(legacyFixture());
  assert.equal(plan.report.valid, true, JSON.stringify(plan.report.issues));
  assert.equal(plan.report.totals.planned, 13);
  const room = plan.operations.find((op) => op.Model.modelName === "ChatRoom").doc;
  assert.equal(room.messages[0].id, "room-old");
  assert.equal(room.messages[0].reactions.bob, "heart");
  assert.equal(plan.operations.find((op) => op.Model.modelName === "PostModel").doc.reactions.bob, true);
  assert.equal(room.lastReadAtByUser.bob.toISOString(), room.messages[0].time.toISOString());
});
test("unknown collections/fields and invalid dates stop cutover with clear diagnostics", async () => {
  const data = legacyFixture();
  data.users[0].unknownUsefulField = "must not be dropped";
  data.posts[0].createdAt = "invalid";
  data.gifts = [{ id: "ambiguous" }];
  const plan = await planMigration(data);
  assert.equal(plan.report.valid, false);
  assert.ok(plan.report.issues.some((i) => i.reason.includes("unknownUsefulField")));
  assert.ok(plan.report.issues.some((i) => i.reason.includes("createdAt")));
  assert.ok(plan.report.issues.some((i) => i.collection === "gifts"));
});
test("dangling user references and conflicting duplicate ids are rejected", async () => {
  const data = legacyFixture();
  data.messages[0].to = "missing-user";
  data.posts.push({ ...data.posts[0], text: "different" });
  const plan = await planMigration(data);
  assert.equal(plan.report.valid, false);
  assert.ok(plan.report.issues.some((i) => i.reason.includes("Missing referenced")));
  assert.ok(plan.report.issues.some((i) => i.reason.includes("Conflicting duplicate")));
});
test("merges preserve Mongo values, add missing array members, and reject conflicts", () => {
  assert.deepEqual(mergeMissing({ bookmarks: ["a"] }, { bookmarks: ["a", "b"] }), { bookmarks: ["a", "b"] });
  assert.throws(() => mergeMissing({ text: "new" }, { text: "old" }), /Conflicting/);
});
test("CLI cannot implicitly use the production URI or overwrite its input", () => {
  assert.throws(() => parseArgs(["--apply", "--validate-only"]), /cannot be combined/);
  assert.throws(() => parseArgs(["--validate-only", "--file", "same.json", "--report", "same.json"]), /overwrite/);
  assert.throws(() => parseArgs(["--unknown"]), /Unknown argument/);
});
test("embedded blocks and directional streak keys retain safety state", async () => {
  const data = legacyFixture();
  data.users[0].blockedUsers = ["carol"];
  delete data.matchStreaks.alice_bob.from;
  delete data.matchStreaks.alice_bob.to;
  const plan = await planMigration(data);
  assert.equal(plan.report.valid, true, JSON.stringify(plan.report.issues));
  assert.ok(plan.operations.some((op) => op.Model.modelName === "Relationship" && op.doc.from === "alice" && op.doc.to === "carol" && op.doc.type === "block"));
  assert.equal(plan.report.warnings.length, 1);
});
test("overlapping message API stores require explicit ownership reconciliation", async () => {
  const data = legacyFixture();
  data.messages[0].id = "room-old";
  const plan = await planMigration(data);
  assert.equal(plan.report.valid, false);
  assert.ok(plan.report.issues.some((issue) => issue.reason.includes("API ownership")));
});
