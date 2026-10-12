// Real Mongo transactions and two backend processes exercise installation ownership races.
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const User = require("../models/User");
const Guard = require("../models/PushTokenGuard");
const { claimPushToken } = require("../services/pushTokenOwnership");
const { startBackend, stopBackend, request } = require("./integrationHelpers");
const token = label => `ExpoPushToken[synthetic-${label}]`;

test("push ownership remains exclusive across processes, retries, stale-array hazards and failed transfers", { timeout: 180000 }, async t => {
  const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, ip: "127.0.0.1" } });
  const backends = [];
  t.after(async () => {
    await Promise.all(backends.map(stopBackend));
    await mongoose.disconnect(); await mongo.stop();
  });
  const uri = mongo.getUri("push_ownership_fixture");
  await mongoose.connect(uri, { autoIndex: false });
  await User.create([{ id: "A", email: "a@example.invalid" }, { id: "B", email: "b@example.invalid" }]);
  // Independent processes ensure an in-process mutex cannot make this test pass.
  backends.push(await startBackend(uri)); backends.push(await startBackend(uri));
  const post = (index, id, value) => request(backends[index], id, "/users/me/push-token", { method: "POST", body: { token: value } });
  const owners = value => User.find({ $or: [{ "pushTokens.token": value }, { pushToken: value }] }).lean();

  await t.test("simultaneous first claims, repeated registrations and pre-existing legacy duplicates", async () => {
    for (let round = 0; round < 8; round++) {
      const value = token(`claim-${round}`);
      if (round === 0) await User.collection.updateMany({}, { $set: { pushToken: value, pushTokens: [{ token: value }] } });
      await Promise.all(Array.from({ length: 6 }, (_, i) => post(i % 2, i % 2 ? "B" : "A", value)));
      const rows = await owners(value);
      assert.equal(rows.length, 1, `round ${round}: exactly one owner`);
      assert.equal(rows[0].pushTokens.filter(item => item.token === value).length, 1);
      assert.equal(await User.countDocuments({ pushToken: value }), 0);
    }
  });

  await t.test("concurrent new token for A cannot restore an older token transferred to B or lose other installs", async () => {
    const retained = token("retained"); await post(0, "A", retained);
    for (let round = 0; round < 8; round++) {
      const moving = token(`moving-${round}`), fresh = token(`fresh-${round}`);
      await post(0, "A", moving);
      await Promise.all([post(0, "A", fresh), post(1, "B", moving)]);
      assert.deepEqual((await owners(moving)).map(row => row.id), ["B"]);
      assert.deepEqual((await owners(fresh)).map(row => row.id), ["A"]);
      assert.deepEqual((await owners(retained)).map(row => row.id), ["A"]);
      await request(backends[0], "A", "/users/me/push-token", { method: "DELETE", body: { token: moving } });
      assert.deepEqual((await owners(moving)).map(row => row.id), ["B"]);
    }
  });

  await t.test("failure after removal rolls back ownership rather than losing the old token", async () => {
    const value = token("rollback"); await post(0, "A", value);
    const original = User.findOneAndUpdate;
    User.findOneAndUpdate = () => { throw new Error("synthetic append failure"); };
    try { await assert.rejects(claimPushToken("B", { token: value }), /synthetic append failure/); }
    finally { User.findOneAndUpdate = original; }
    assert.deepEqual((await owners(value)).map(row => row.id), ["A"]);
    await post(1, "B", value); assert.deepEqual((await owners(value)).map(row => row.id), ["B"]);
  });

  await t.test("a paused A transaction retries its stale snapshot after B removes A's old token", async () => {
    const moving = token("paused-moving"), fresh = token("paused-fresh");
    await post(0, "A", moving);
    let release, markStarted, paused = false, attempts = 0;
    const gate = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { markStarted = resolve; });
    const original = User.updateMany;
    User.updateMany = function (filter, ...args) {
      if (filter["pushTokens.token"] === fresh) {
        attempts++;
        if (!paused) {
          paused = true; markStarted();
          return gate.then(() => original.call(this, filter, ...args));
        }
      }
      return original.call(this, filter, ...args);
    };
    let pending;
    try {
      pending = claimPushToken("A", { token: fresh });
      await started;
      // B commits while A has already read its token list but has not updated it.
      await post(1, "B", moving);
      release(); await pending;
    } finally { release(); if (pending) await pending.catch(() => {}); User.updateMany = original; }
    assert.ok(attempts > 1, "Mongo must retry the obsolete transaction snapshot");
    assert.deepEqual((await owners(moving)).map(row => row.id), ["B"]);
    assert.deepEqual((await owners(fresh)).map(row => row.id), ["A"]);
  });

  await t.test("actual account-status 403s match mobile cleanup handling and cannot prevent a new owner's claim", async () => {
    for (const [status, error] of [["pending_delete", "Account scheduled for deletion"], ["banned", "ACCOUNT_BANNED"], ["deactivated", "ACCOUNT_DEACTIVATED"]]) {
      const value = token(status);
      await User.updateOne({ id: "A" }, { $set: { visibility: "active", deleteStatus: "active" } });
      await post(0, "A", value);
      await User.updateOne({ id: "A" }, { $set: { visibility: status } });
      const denied = await request(backends[0], "A", "/users/me/push-token", { method: "DELETE", body: { token: value }, status: 403 });
      assert.equal(denied.error, error);
      await post(1, "B", value); assert.deepEqual((await owners(value)).map(row => row.id), ["B"]);
    }
    const guards = await Guard.find().lean(); assert.ok(guards.length > 0);
    assert.ok(guards.every(row => /^[a-f0-9]{64}$/.test(row._id) && !row.token && !row.userId));
  });
});
