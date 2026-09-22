<!-- Path: server/docs/lowdb-audit.md
Purpose: Pre-change persistence inventory and migration/compatibility decisions. -->

# LowDB audit — 2026-09-20

Inspected the complete backend and web checkout and `C:/projects/rombuzz-mobile`, including ignored database-file candidates and the mobile checkout's backend ZIP directory. No AGENTS.md was found. No db.json or other legacy data snapshot was found; the ZIP contains old source code, including db.lowdb.js, but no db.json. Production files/databases have not been accessed. Both working trees were inspected without changing mobile UI.

## Runtime dependency inventory (before changes)

| File | Reads | Writes | Feature / dependency | Mongo replacement / migration need |
| --- | --- | --- | --- | --- |
| models/db.lowdb.js | server/db.json; users | Initializes users, posts, likes, matches, notifications, messages, blocks, reports, roomMessages, matchStreaks; hashes plaintext user passwords | All legacy callers; initializer runs on import | Existing models listed below; offline importer must hash plaintext passwords without modifying source |
| models/writeGuard.js | none | Queues/retries JSON writes | Startup write wrapper | Remove after callers migrate |
| index.js | legacy users | Rewrites Mongo users on every boot through bulkSyncAllUsers | Startup, connection ordering | Remove startup sync; explicit offline migration, Mongo required before listening/jobs |
| modules/userSync.js | supplied legacy users; User | User upserts including overwriting existing fields | Startup only (no other callers) | Replace with conflict-aware offline importer |
| sockets/connection.js | users, messages, matches indirectly | lastOnline, location; deletes view-once/expired messages; attempts room-message writes | Presence, seen, sendMessage, legacy meet events; hourly cleanup created per socket | User.lastOnline/location, Message expiry/seen, ChatRoom.messages/read state; one process job |
| utils/helpers.js | global._roomMessages Map | room list in memory | getRoomDoc called by sockets with wrong argument shape; db.write does not persist this Map | Remove Map/helper; existing ChatRoom model owns room messages |
| routes/posts.js | legacy matches for create broadcasts, matched feed, reels | Posts/comments/reactions already Mongo | Match membership / feed visibility | Match queries; existing PostModel, no route/response changes |
| routes/stories.js | legacy matches for feed and viewer authorization | Stories/views already Mongo | Matched story feed and authorization | Match queries; existing StoryModel |
| routes/buzzpost/buzz.bookmarks.js | unused destructured db import | Bookmarks/shares already Mongo | Import incorrectly expects {db}; triggers initializer | Remove import; PostModel.bookmarks/shares already own data |
| socket.js | separate onlineUsers map | transient sockets only; relays seen without persistence | Duplicate registration, room, typing, seen handlers | Consolidate handler ownership; preserve both legacy and mobile payloads |

The destructured imports in posts/stories/bookmarks disagree with `module.exports = db`. Repairing that export would leave the split-source architecture in place.

## Structures and ownership

| Legacy structure | Existing Mongo owner | Notes |
| --- | --- | --- |
| users | User | Keep stable id, credentials, profile/media/settings, locations, account state; add lastOnline |
| matches | Match | users pair + id; detect overlapping pairs even when ids differ |
| likes / relationships | Relationship | directed from/to/type; user profile `likes` string is a separate profile field |
| blocks | Relationship(type=block) | Canonical safety/read queries use Relationship; old Block model is a pre-existing separate compatibility store |
| notifications | Notification | id, toId/fromId, read, timestamps, routing metadata |
| messages | Message (simple /api/messages) | Keep separate existing API domain from embedded chat; preserve expiry/seen and legacy metadata |
| roomMessages / chatRooms | ChatRoom.messages + per-room maps | list/messages wrappers and flat room messages; preserve ids, reply/gift/media/reactions, read and preference maps |
| posts | PostModel | comments, reactions, likes, bookmarks, shares are embedded |
| stories | StoryModel | owner, views, expiry; existing TTL intentionally expires stories |
| bookmarks / comments / postLikes | PostModel embedded arrays | No new Bookmark/Comment/Like model |
| matchStreaks | MatchStreak | directional key and count/lastBuzz |
| reports | ReportModel | reporter/target, evidence and moderation fields |
| gifts, wallets, ledgers, support, private notes, daily streaks, MicroBuzz, meet-middle, calls | Existing domain models | Already Mongo; import only records whose shape validates against the corresponding model, reject ambiguity |

Migration must not infer discarded records are useless. Unknown structures/fields, invalid timestamps, missing relationships, duplicate ids with conflicting owners, and overlapping records with different values must be reported. Keep source backups; unresolved reports block cutover. Runtime reads never consult a migration archive or JSON file.

## Client contract audit

Mobile `src/lib/socket.ts` supplies the session token and emits user:register on reconnect. `src/features/chat/window/realtime/useChatRealtime.ts` emits joinRoom, typing `{roomId,from,to,typing}` and message:seen `{roomId,msgId,from,to}`. Its metadata handlers accept scalar and object seen receipts. Message/edit/delete/react/pin/ephemeral events and the existing paginated/full-history chat response shapes must remain compatible. Mobile chat actions use HTTP routes backed by ChatRoom; social stats uses existing like/unmatch/block routes. Posts/stories/bookmarks endpoint names and sorting are retained.

Web `frontend/src/components/ChatWindow.jsx` sends both sendMessage and HTTP POST with unrelated ids. Migrating socket persistence requires sharing a client id across these two writes so a single action cannot create two records. This is transport compatibility only, with no UI change. Web legacy seen listeners require scalar message:seen; modern clients also accept chat:seen object receipts.

## Non-runtime references

Historical comments mention LowDB in models/{ChatRoom,Match,Notification,PostModel,state}.js, routes/{aiWingman,auth,debug,buzzPosts,discover,profile,safety}.js, routes/auth/otp.js, routes/buzzpost/{buzz.create,buzz.edit}.js, services/meetMiddle*.js, sockets/meetMiddleSocket.js, frontend/src/pages/Profile.jsx. INDEX_SPLIT_README.md and rombuzz-backend-modular.txt describe the old architecture. config/db.mongo.template.js.js is an unused, unimported migration template. package.json/package-lock.json contain the LowDB dependency. The mobile performance audit and backend ZIP are historical artifacts, not mobile runtime dependencies.

## Verification plan

Use a disposable local MongoDB only. Test importer validation, reruns, conflicts, source-file hash preservation, relationship references, malformed/unknown data, and Mongo overlap. Exercise HTTP and real Socket.IO with two authenticated users: persistence, duplicate sends, edits/deletes/reactions, seen/unread, typing, match/unmatch/block, reconnect and process restart. Run dependency install, backend syntax/tests, available client checks, and final repository-wide runtime searches. Do not push, deploy, or run against production.
