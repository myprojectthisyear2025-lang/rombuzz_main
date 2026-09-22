/**
 * Path: server/scripts/lowdb/validation.js
 * Purpose: Validate legacy data without dropping unknown fields or exposing record values.
 */
const crypto = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");
const hash = (value) => crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
const plain = (v) => v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date) && !v._bsontype;

function assertSafe(value, path = "root") {
  if (Array.isArray(value)) return value.forEach((v, i) => assertSafe(v, `${path}[${i}]`));
  if (!plain(value)) return;
  for (const [key, v] of Object.entries(value)) {
    if (/[.$\x00]/.test(key) || ["__proto__", "constructor", "prototype"].includes(key)) {
      throw new Error(`Unsafe object key at ${path}`);
    }
    assertSafe(v, `${path}.${key}`);
  }
}

function projectSupplied(input, cast, path = "record") {
  if (Array.isArray(input)) {
    if (!Array.isArray(cast) || input.length !== cast.length) throw new Error(`Lossy array conversion at ${path}`);
    return input.map((v, i) => projectSupplied(v, cast[i], `${path}[${i}]`));
  }
  if (plain(input)) {
    if (!plain(cast)) throw new Error(`Unsupported structure at ${path}`);
    return Object.fromEntries(Object.entries(input).map(([key, value]) => {
      if (!Object.hasOwn(cast, key)) throw new Error(`Unsupported field at ${path}.${key}`);
      return [key, projectSupplied(value, cast[key], `${path}.${key}`)];
    }));
  }
  return cast;
}

function validateDocument(Model, input) {
  assertSafe(input);
  const document = new Model(input);
  const error = document.validateSync();
  if (error) throw new Error(`Schema validation failed: ${Object.keys(error.errors).join(", ")}`);
  const cast = document.toObject({ flattenMaps: true, minimize: false, depopulate: true });
  const supplied = projectSupplied(input, cast);
  return { supplied, created: cast };
}

function same(a, b) {
  if (a instanceof Date || b instanceof Date) return new Date(a).getTime() === new Date(b).getTime();
  if (a?._bsontype || b?._bsontype) return String(a) === String(b);
  return isDeepStrictEqual(a, b);
}

function mergeMissing(existing, incoming, path = "record") {
  if (same(existing, incoming)) return existing;
  if (existing === undefined) return incoming;
  if (plain(existing) && plain(incoming)) {
    const merged = { ...existing };
    for (const [key, value] of Object.entries(incoming)) merged[key] = mergeMissing(existing[key], value, `${path}.${key}`);
    return merged;
  }
  if (Array.isArray(existing) && Array.isArray(incoming)) {
    const result = [...existing];
    for (const value of incoming) {
      const identity = plain(value) ? (value.id ? "id" : value.userId ? "userId" : null) : null;
      const index = result.findIndex((v) => identity ? v?.[identity] === value[identity] : same(v, value));
      if (index < 0) result.push(value);
      else result[index] = mergeMissing(result[index], value, `${path}[]`);
    }
    return result;
  }
  // Never guess whether Mongo defaults, deleted data, or the legacy snapshot are newer.
  throw new Error(`Conflicting value at ${path}; reconcile with the Mongo owner before cutover`);
}

function orderedMessages(messages) {
  return [...messages].sort((a, b) => new Date(a.time || a.createdAt) - new Date(b.time || b.createdAt));
}

module.exports = { hash, plain, assertSafe, validateDocument, same, mergeMissing, orderedMessages };
