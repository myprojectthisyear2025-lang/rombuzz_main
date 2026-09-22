/**
 * Path: server/scripts/lowdb/mappings.js
 * Purpose: Explicit legacy collection mappings to existing RomBuzz Mongo domain models.
 */
const bcrypt = require("bcrypt");
const { hash, plain, orderedMessages } = require("./validation");
const names = {
  users: "User", posts: "PostModel", stories: "StoryModel", matches: "Match",
  messages: "Message", roomMessages: "ChatRoom", chatRooms: "ChatRoom",
  likes: "Relationship", blocks: "Relationship", relationships: "Relationship",
  notifications: "Notification", reports: "ReportModel", matchStreaks: "MatchStreak",
  dailyStreaks: "DailyStreak", giftTransactions: "GiftTransaction", giftSummaries: "GiftSummary",
  mediaGifts: "MediaGift", buzzPostGifts: "BuzzPostGift", buzzCoinWallets: "BuzzCoinWallet",
  buzzCoinLedgers: "BuzzCoinLedger", giftWithdrawalRequests: "GiftWithdrawalRequest",
  privateNotes: "PrivateNote", mediaThreads: "MediaThread", supportTickets: "SupportTicket",
  microBuzzPresence: "MicroBuzzPresence", microBuzzBuzzes: "MicroBuzzBuzz",
  microBuzzIgnores: "MicroBuzzIgnore", microBuzzSessionIgnores: "MicroBuzzSessionIgnore",
  meetMiddleSessions: "MeetMiddleSession", videoCallSessions: "VideoCallSession",
  videoCallGiftRequests: "VideoCallGiftRequest",
};
const embedded = { bookmarks: "bookmarks", comments: "comments", postLikes: "likes" };
const models = Object.fromEntries(Object.entries(names).map(([key, name]) => [key, require(`../../models/${name}`)]));

function alias(doc, old, current) {
  if (!Object.hasOwn(doc, old)) return;
  if (Object.hasOwn(doc, current) && JSON.stringify(doc[old]) !== JSON.stringify(doc[current])) {
    throw new Error(`Conflicting aliases ${old}/${current}`);
  }
  doc[current] = doc[old];
  delete doc[old];
}
function stableId(doc, domain) {
  if (doc.id != null) doc.id = String(doc.id);
  else if (doc._id != null) doc.id = String(doc._id);
  else throw new Error(`Missing stable id in ${domain}`);
  if (doc._id && !/^[a-f\d]{24}$/i.test(String(doc._id))) delete doc._id;
}
function pair(doc) {
  if (!Array.isArray(doc.users) && doc.user1 && doc.user2) {
    doc.users = [doc.user1, doc.user2]; delete doc.user1; delete doc.user2;
  }
  if (!Array.isArray(doc.users) || doc.users.length !== 2 || doc.users[0] === doc.users[1]) throw new Error("Invalid match participants");
  doc.users = doc.users.map(String).sort();
}
function roomMessage(raw, participants) {
  const doc = { ...raw };
  stableId(doc, "room message");
  delete doc._id;
  delete doc.roomId;
  alias(doc, "fromId", "from"); alias(doc, "toId", "to");
  alias(doc, "read", "seen");
  if (!doc.from || !doc.to) throw new Error("Missing message sender/receiver");
  if (!doc.system && (!participants.includes(String(doc.from)) || !participants.includes(String(doc.to)))) throw new Error("Message participants disagree with room");
  if (!doc.time && doc.createdAt) doc.time = doc.createdAt;
  if (!doc.createdAt && doc.time) doc.createdAt = doc.time;
  if (!doc.time) throw new Error("Missing message timestamp");
  if (["photo", "image", "video", "audio"].includes(doc.type)) {
    doc.mediaType ||= doc.type === "photo" ? "image" : doc.type;
    doc.type = "media";
  }
  if (typeof doc.ephemeral === "string") {
    const mode = doc.ephemeral === "keep" ? "none" : doc.ephemeral;
    doc.ephemeral = { mode, viewsLeft: mode === "once" ? 1 : mode === "twice" ? 2 : 0 };
  }
  return doc;
}

async function mapRecord(collection, raw, key) {
  if (!plain(raw)) throw new Error("Expected a record object");
  let doc = structuredClone(raw);
  let Model = models[collection];
  if (embedded[collection]) {
    Model = models.posts;
    const postId = doc.postId;
    if (!postId) throw new Error("Missing postId");
    delete doc.postId;
    const value = collection === "bookmarks" ? doc.userId : doc;
    if (collection === "bookmarks" && Object.keys(doc).some((k) => k !== "userId")) throw new Error("Bookmark metadata requires manual mapping");
    return { Model, doc: { [embedded[collection]]: [value] }, filter: { id: String(postId) }, partial: true };
  }
  if (!Model) throw new Error("Unknown collection; an explicit mapping is required");
  if (collection === "users") {
    stableId(doc, collection);
    if (doc.password) {
      if (!doc.passwordHash) doc.passwordHash = await bcrypt.hash(String(doc.password), 12);
      else if (!(await bcrypt.compare(String(doc.password), doc.passwordHash))) throw new Error("Conflicting user password credentials");
      delete doc.password;
    }
    if (!doc.createdAt) throw new Error("Missing user createdAt");
  } else if (collection === "matches") {
    pair(doc);
    doc.id ||= `legacy-match-${hash(doc.users).slice(0, 24)}`;
  } else if (["likes", "blocks", "relationships"].includes(collection)) {
    if (collection === "blocks") { alias(doc, "blocker", "from"); alias(doc, "blocked", "to"); }
    alias(doc, "fromId", "from"); alias(doc, "toId", "to");
    doc.type ||= collection === "blocks" ? "block" : "like";
  } else if (collection === "posts") {
    stableId(doc, collection);
    alias(doc, "visibility", "privacy");
  } else if (collection === "notifications") {
    stableId(doc, collection);
    alias(doc, "to", "toId"); alias(doc, "from", "fromId");
  } else if (collection === "messages") {
    stableId(doc, collection);
    alias(doc, "fromId", "from"); alias(doc, "toId", "to");
    alias(doc, "time", "createdAt");
    alias(doc, "read", "seen");
    if (plain(doc.ephemeral)) {
      if (Object.keys(doc.ephemeral).some((k) => k !== "mode")) throw new Error("Direct message ephemeral metadata requires manual mapping");
      doc.ephemeral = doc.ephemeral.mode === "none" ? "keep" : doc.ephemeral.mode;
    }
  } else if (collection === "matchStreaks") {
    doc.key ||= key;
    if (!doc.from || !doc.to || `${doc.from}_${doc.to}` !== doc.key) throw new Error("Streak needs explicit from/to matching its key");
    doc.id ||= `legacy-streak-${hash(doc.key).slice(0, 24)}`;
  } else if (Model === models.roomMessages) {
    if (!doc.roomId) throw new Error("Missing roomId");
    alias(doc, "list", "messages");
    if (!Array.isArray(doc.messages)) {
      if (!doc.from || !doc.to) throw new Error("Expected room messages/list array");
      doc = { roomId: doc.roomId, participants: [doc.from, doc.to], messages: [doc] };
    }
    if (!doc.participants) {
      doc.participants = [...new Set(doc.messages.filter((m) => !m.system).flatMap((m) => [m.from || m.fromId, m.to || m.toId]).filter(Boolean))];
    }
    if (doc.participants.length !== 2) throw new Error("Room needs two unambiguous participants");
    doc.participants = doc.participants.map(String).sort();
    doc.messages = orderedMessages(doc.messages.map((m) => roomMessage(m, doc.participants)));
    const unique = new Set(doc.messages.map((m) => m.id));
    if (unique.size !== doc.messages.length) throw new Error("Duplicate embedded message ids require reconciliation");
    doc.createdAt ||= doc.messages[0]?.createdAt;
    if (!doc.createdAt) throw new Error("Empty room needs createdAt");
    doc.updatedAt ||= doc.messages.at(-1)?.time || doc.createdAt;
    // Preserve explicit room cursors. Infer only a contiguous prefix of seen messages.
    if (!doc.lastReadAtByUser) {
      doc.lastReadAtByUser = {};
      for (const userId of doc.participants) {
        let cursor = 0;
        for (const message of doc.messages.filter((m) => m.to === userId)) {
          if (!message.seen) break;
          cursor = new Date(message.time).getTime();
        }
        doc.lastReadAtByUser[userId] = new Date(cursor);
      }
    }
  }
  if (Model.schema.path("id")?.isRequired && !doc.id) stableId(doc, collection);
  if (Model.schema.path("createdAt") && !doc.createdAt) throw new Error("Missing createdAt; refusing to invent a historical timestamp");
  let filter;
  if (Model === models.matches) filter = { users: { $all: doc.users } };
  else if (Model === models.relationships) filter = { from: doc.from, to: doc.to, type: doc.type };
  else if (Model === models.roomMessages) filter = { roomId: doc.roomId };
  else if (Model === models.matchStreaks) filter = { key: doc.key };
  else if (doc.id) filter = { id: doc.id };
  else if (doc._id && /^[a-f\d]{24}$/i.test(String(doc._id))) filter = { _id: doc._id };
  else {
    const unique = Model.schema.indexes().find(([fields, options]) => options.unique && Object.keys(fields).every((field) => doc[field] !== undefined));
    if (!unique) throw new Error("No safe unique identity for record");
    filter = Object.fromEntries(Object.keys(unique[0]).map((field) => [field, doc[field]]));
  }
  return { Model, doc, filter, partial: false };
}
module.exports = { mapRecord, models, embedded };
