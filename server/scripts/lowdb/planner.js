/**
 * Path: server/scripts/lowdb/planner.js
 * Purpose: Build a read-only, conflict-aware import plan and check relationship integrity.
 */
const { mapRecord, models, embedded } = require("./mappings");
const { hash, plain, assertSafe, validateDocument, mergeMissing, same, orderedMessages } = require("./validation");
const mongoose = require("mongoose");
const { normalizeShapes } = require("./legacyShapes");

function entries(collection, value) {
  if (Array.isArray(value)) return value.map((record, index) => [String(index), record]);
  if (["matchStreaks", "roomMessages", "chatRooms"].includes(collection) && plain(value)) {
    return Object.entries(value).map(([key, record]) => [key,
      collection === "matchStreaks" ? record : Array.isArray(record)
        ? { roomId: key, messages: record } : { roomId: key, ...record }]);
  }
  throw new Error("Expected collection array (or keyed room/streak object)");
}

function referenceIds(modelName, doc) {
  const ids = [];
  const add = (...values) => values.filter((v) => typeof v === "string" && v && v !== "system").forEach((v) => ids.push(v));
  if (modelName === "User") { add(...(doc.blockedUsers || [])); return ids; }
  if (modelName === "Match") add(...doc.users);
  if (modelName === "ChatRoom") {
    add(...doc.participants);
    for (const msg of doc.messages || []) {
      add(msg.from, msg.to, ...(msg.hiddenFor || []), ...Object.keys(msg.reactions || {}), ...(msg.gift?.unlockedBy || []));
      if (msg.replyTo?.id && !(doc.messages || []).some((m) => m.id === msg.replyTo.id)) {
        // A reply snapshot can intentionally outlive a deleted original.
      }
    }
  }
  for (const field of ["userId", "from", "to", "fromId", "toId", "senderId", "receiverId", "recipientId", "reporterId", "reportedUserId", "targetOwnerId"]) add(doc[field]);
  if (modelName === "PostModel") {
    add(...(doc.bookmarks || []), ...(doc.sharedWith || []), ...Object.keys(doc.reactions || {}));
    for (const c of doc.comments || []) add(c.userId, ...(c.visibleTo || []), ...Object.keys(c.reactions || {}));
    for (const like of doc.likes || []) add(like.userId);
    for (const share of doc.shares || []) add(share.userId, share.sharedBy);
  }
  if (modelName === "StoryModel") add(...(doc.views || []));
  return [...new Set(ids)];
}

async function planMigration(data, { connected = false, namespace = "rombuzz-lowdb-v1" } = {}) {
  if (!plain(data)) throw new Error("Database root must be an object");
  assertSafe(data);
  const normalized = normalizeShapes(data);
  data = normalized.data;
  const report = { mode: connected ? "dry-run" : "validate-only", collections: {}, warnings: normalized.warnings, issues: [], totals: {} };
  const operations = new Map();
  const aliases = new Map();
  const sourceKeys = new Map();
  const journal = connected ? mongoose.connection.db.collection("legacyMigrationRecords") : null;
  const ordered = Object.keys(data).sort((a, b) => (a === "users" ? -1 : b === "users" ? 1 : Number(!!embedded[a]) - Number(!!embedded[b])));
  for (const collection of ordered) {
    const counts = report.collections[collection] = { discovered: 0, planned: 0, migrated: 0, skipped: 0, duplicates: 0, failures: 0 };
    let records;
    try { records = entries(collection, data[collection]); }
    catch (err) { counts.failures++; report.issues.push({ collection, reason: err.message }); continue; }
    counts.discovered = records.length;
    for (const [key, raw] of records) {
      try {
        const rawIdentity = raw?.id || raw?._id || raw?.roomId || (collection === "matchStreaks" ? key : null) ||
          (collection === "bookmarks" ? `${raw.postId}:${raw.userId}` : hash(raw));
        const receiptId = hash(`${namespace}:${collection}:${rawIdentity}`);
        const fingerprint = hash(raw);
        const priorSource = sourceKeys.get(receiptId);
        if (priorSource) {
          if (priorSource !== fingerprint) throw new Error("Conflicting duplicate legacy identity");
          counts.duplicates++; counts.skipped++; continue;
        }
        sourceKeys.set(receiptId, fingerprint);
        const receipt = await journal?.findOne({ _id: receiptId });
        if (receipt) {
          if (receipt.fingerprint !== fingerprint) throw new Error("Previously imported record changed; manual reconciliation required");
          counts.skipped++; counts.duplicates++; continue;
        }
        const mapped = await mapRecord(collection, raw, key);
        const { Model, filter, partial } = mapped;
        let { doc } = mapped;
        const lookup = [filter];
        if (doc.id) lookup.push({ id: doc.id });
        if (doc._id) lookup.push({ _id: new mongoose.Types.ObjectId(String(doc._id)) });
        if (Model.modelName === "User" && doc.email) {
          const escaped = String(doc.email).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          lookup.push({ email: { $regex: `^${escaped}$`, $options: "i" } });
        }
        const keys = lookup.map((f) => `${Model.modelName}:${JSON.stringify(f)}`);
        const pending = [...new Set(keys.map((k) => aliases.get(k)).filter(Boolean))];
        const found = connected ? await Model.find({ $or: lookup }).limit(3).lean() : [];
        if (found.length > 1 || pending.length > 1 || (pending[0] && found[0] && String(pending[0].doc._id) !== String(found[0]._id))) {
          throw new Error("Identity collision across ids, participants, or unique fields");
        }
        let op = pending[0];
        const current = op?.doc || found[0];
        if (partial && !current) throw new Error("Embedded record has no target post");
        let next;
        if (current) {
          // Validate the partial fields against a complete candidate, then merge only supplied values.
          const { supplied } = validateDocument(Model, { ...current, ...doc });
          const incoming = Object.fromEntries(Object.keys(doc).map((field) => [field, supplied[field]]));
          next = mergeMissing(current, incoming);
          counts.duplicates++;
        } else {
          doc._id ||= new mongoose.Types.ObjectId(hash(`${Model.modelName}:${JSON.stringify(filter)}`).slice(0, 24));
          next = validateDocument(Model, doc).created;
          if (Model.schema.path("__v") && next.__v === undefined) next.__v = 0;
        }
        if (Model.modelName === "ChatRoom") next.messages = orderedMessages(next.messages);
        validateDocument(Model, next);
        if (mongoose.mongo.BSON.calculateObjectSize(next) >= 16 * 1024 * 1024) {
          throw new Error("Document exceeds MongoDB's 16 MiB limit; explicit data restructuring is required before cutover");
        }
        if (!op) {
          op = { Model, filter, before: found[0] || null, doc: next, receipts: [] };
          operations.set(`${Model.modelName}:${String(next._id)}`, op);
        } else op.doc = next;
        for (const alias of keys) aliases.set(alias, op);
        op.receipts.push({ _id: receiptId, fingerprint, collection, sourceIndex: key, target: Model.collection.name, targetId: String(next._id) });
        counts.planned++;
      } catch (err) {
        counts.failures++;
        // Messages here are controlled schema/path diagnostics, never Mongo error values.
        report.issues.push({ collection, sourceIndex: key, reason: /Mongo|Cast to|E11000/.test(err.message) ? "Database identity/schema check failed" : err.message });
      }
    }
  }
  const plannedUsers = new Set([...operations.values()].filter((op) => op.Model.modelName === "User").map((op) => op.doc.id));
  const checkedUsers = new Map();
  const directIds = new Set([...operations.values()].filter((op) => op.Model.modelName === "Message").map((op) => op.doc.id));
  for (const op of operations.values()) {
    const roomIds = op.Model.modelName === "ChatRoom" ? op.doc.messages.map((m) => m.id) : [];
    const duplicateMessage = roomIds.some((id) => directIds.has(id)) || (connected && (
      (roomIds.length && await models.messages.exists({ id: { $in: roomIds } })) ||
      (op.Model.modelName === "Message" && await models.roomMessages.exists({ "messages.id": op.doc.id }))
    ));
    if (duplicateMessage) {
      report.collections[op.receipts[0].collection].failures++;
      report.issues.push({ collection: op.receipts[0].collection, sourceIndex: op.receipts[0].sourceIndex,
        reason: "Message identity overlaps the simple Message and embedded ChatRoom stores; reconcile API ownership before cutover" });
    }
    for (const id of referenceIds(op.Model.modelName, op.doc)) {
      if (plannedUsers.has(id)) continue;
      if (!checkedUsers.has(id)) checkedUsers.set(id, connected && !!(await models.users.exists({ id })));
      if (!checkedUsers.get(id)) {
        report.collections[op.receipts[0].collection].failures++;
        report.issues.push({ collection: op.receipts[0].collection, sourceIndex: op.receipts[0].sourceIndex, reason: "Missing referenced user (reference values omitted)" });
      }
    }
  }
  report.totals = Object.values(report.collections).reduce((total, counts) => {
    for (const [key, count] of Object.entries(counts)) total[key] = (total[key] || 0) + count;
    return total;
  }, {});
  report.valid = report.issues.length === 0;
  return { report, operations: [...operations.values()] };
}

async function applyPlan(plan) {
  if (!plan.report.valid) throw new Error("Preflight failed; no writes performed");
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  if (!hello.setName && hello.msg !== "isdbgrid") throw new Error("Apply requires a replica set/Atlas for atomic documents and migration receipts");
  const receipts = mongoose.connection.db.collection("legacyMigrationRecords");
  plan.report.mode = "apply";
  for (const op of plan.operations) {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const current = await op.Model.findOne({ _id: op.doc._id }).session(session).lean();
        if (!same(current, op.before)) throw new Error("Mongo data changed after preflight; rerun dry-run during maintenance");
        const collision = await op.Model.exists({ $and: [op.filter, { _id: { $ne: op.doc._id } }] }).session(session);
        if (collision) throw new Error("Target identity changed after preflight");
        // Receipt and domain change commit together, so reruns cannot resurrect deletions.
        await receipts.insertMany(op.receipts.map((r) => ({ ...r, appliedAt: new Date() })), { session });
        if (current) await op.Model.collection.replaceOne({ _id: current._id }, op.doc, { session });
        else await op.Model.collection.insertOne(op.doc, { session });
      });
      for (const receipt of op.receipts) plan.report.collections[receipt.collection].migrated++;
    } catch (err) {
      const source = op.receipts[0];
      plan.report.collections[source.collection].failures++;
      plan.report.valid = false;
      plan.report.issues.push({ collection: source.collection, sourceIndex: source.sourceIndex,
        reason: "Atomic write failed or target changed since preflight; rerun dry-run during maintenance" });
      throw err;
    } finally {
      await session.endSession();
      plan.report.totals.migrated = Object.values(plan.report.collections).reduce((n, c) => n + c.migrated, 0);
      plan.report.totals.failures = Object.values(plan.report.collections).reduce((n, c) => n + c.failures, 0);
    }
  }
  plan.report.mode = "apply";
  plan.report.totals.migrated = Object.values(plan.report.collections).reduce((n, c) => n + c.migrated, 0);
  return plan.report;
}
module.exports = { planMigration, applyPlan };
