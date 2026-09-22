/**
 * Path: server/tests/fixtures.js
 * Purpose: Synthetic legacy records only; no production accounts, credentials, or media.
 */
const at = "2025-01-01T12:00:00.000Z";
function legacyFixture() {
  return {
    users: ["alice", "bob", "carol"].map((id) => ({ id, email: `${id}@example.test`, firstName: id, createdAt: at })),
    matches: [{ id: "match-old", users: ["bob", "alice"], createdAt: at }],
    likes: [{ id: "like-old", from: "carol", to: "alice", createdAt: at }],
    blocks: [{ id: "block-old", blocker: "carol", blocked: "bob", createdAt: at }],
    notifications: [{ id: "notice-old", fromId: "alice", toId: "bob", type: "buzz", message: "Synthetic buzz", read: true, createdAt: at }],
    messages: [{ id: "direct-old", from: "alice", to: "bob", text: "direct", ephemeral: { mode: "once" }, createdAt: at }],
    roomMessages: [{ roomId: "alice_bob", list: [
      { id: "room-old", from: "alice", to: "bob", text: "hello", time: at, seen: true, reactions: { bob: "heart" }, hiddenFor: [] },
    ] }],
    posts: [{ id: "post-old", userId: "alice", text: "post", visibility: "matches", mediaUrl: "https://example.test/image.jpg", type: "image", createdAt: at,
      reactions: { bob: true }, comments: [{ id: "comment-old", userId: "bob", text: "comment", createdAt: at, reactions: { alice: "heart" } }], likes: [{ userId: "bob", createdAt: at }], bookmarks: ["bob"] }],
    stories: [{ id: "story-old", userId: "alice", text: "story", type: "text", createdAt: at, expiresAt: "2099-01-01T00:00:00Z", views: ["bob"] }],
    matchStreaks: { alice_bob: { from: "alice", to: "bob", count: 5, lastBuzz: at, createdAt: at } },
    reports: [{ id: "report-old", from: "carol", targetId: "bob", reason: "Synthetic report", createdAt: at }],
  };
}
module.exports = { at, legacyFixture };
