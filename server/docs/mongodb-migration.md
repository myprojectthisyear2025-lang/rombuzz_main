<!-- Path: server/docs/mongodb-migration.md
Purpose: Local migration report, operator commands, parity evidence, and cutover checks. -->

# MongoDB migration report

All changes are local. No commit, push, deployment, production connection, or production data mutation was performed. Mobile source/UI was not changed.

## 1. Inventory and replacements

[The pre-change audit](lowdb-audit.md) lists every active LowDB caller, its reads/writes, dependency graph, model mapping, incorrect imports, and historical references.

| Previous owner | Current Mongo owner / behavior |
| --- | --- |
| users | User, including newly defined lastOnline; location changes persist |
| matches | Match; posts/reels/story membership queries now read Mongo |
| messages | Existing Message for the simple /api/messages contract; seen, reactions, hidden/deleted state and expireAt retained |
| roomMessages / socket-only room map | Existing ChatRoom.messages; socket and HTTP share payload construction, media signing, atomic insertion and stable ids |
| per-message seen / unread | ChatRoom.lastReadAtByUser plus message.seen; monotonic receipts survive restarts |
| posts / comments / likes / reactions / bookmarks / shares | Existing PostModel fields; Map mutations now save correctly in the affected legacy posts route |
| stories / views | Existing StoryModel; Match controls visibility and view authorization |
| likes / blocks | Existing Relationship (type=like/block); embedded legacy blockedUsers entries are also mapped here |
| notifications | Existing Notification, preserving read status and routing metadata |
| reports | Existing ReportModel, preserving evidence and moderation state |
| matchStreaks | Existing MatchStreak, retaining direction, count and timestamps |
| gifts, wallet/ledger, daily streaks, private notes, support, MicroBuzz, meet-middle, calls | Their existing Mongo models; no competing domain models were introduced |

The pre-existing simple Message API and embedded ChatRoom API remain separate existing contracts. This work does not copy every chat message into both collections. The old Block model remains for its pre-existing notification-block compatibility path and account cleanup; migrated LowDB blocks use Relationship, which the main safety/chat paths query.

Socket registration uses the existing token/account middleware, binds identity to the token, and persists presence timestamps. Persistent socket writes require active participants and a current match/block check. Typing/game/call signaling and current socket ids remain transient. Both scalar legacy message:seen and modern chat:seen payloads are preserved. Room media is consumed by the existing /viewed endpoint; simply opening a thread does not consume view-once media. Direct legacy view-once messages retain their seen-triggered deletion. Expiry uses one process job instead of one interval per connection.

The web legacy chat component now supplies the same message id to its HTTP and socket sends. This is a transport correction; no UI was redesigned. Atomic appends and room version checks prevent a stale room save from overwriting concurrent new messages. The small shared services were extracted from the existing chat route without changing its pagination or media DTOs. The named room preference route now bypasses the generic message-edit route so manual unread controls reach their existing handler. Mark-read and mark-all-read clear manual unread flags using atomic, monotonic cursor updates. Simple direct-message reads now also expose persisted seen/reaction/edit/expiry fields and omit messages hidden for the requesting user or already deleted. Boolean legacy post likes retain their original value type; both post reaction route families now mutate Mongoose Maps correctly.

## 2. Existing data and importer behavior

No legacy database snapshot was found in either checkout, including ignored JSON/database candidates. The mobile checkout's backend ZIP contains legacy source, but no database JSON. The deployed server's data is unknown and was not accessed. **Zero real user records were imported.** Tests imported synthetic records into disposable local databases only.

The importer supports the default legacy collections, keyed room/streak objects, list/messages room wrappers, flat room messages, embedded post engagement, and explicitly named collections for the existing additional Mongo models. It validates every supplied field against the relevant schema; it does not silently strip unknown fields. It rejects missing required historical timestamps, invalid structures, unresolved identities/references, oversized documents and conflicting values. Generic ambiguous collections such as `gifts` require an explicit mapping; the supported `giftTransactions`, `mediaGifts`, etc. have specific owners.

Important properties:

- Dry-run is the default. `--validate-only` needs no database connection. Neither dry-run nor validation creates Mongo collections/indexes or migration receipts.
- It uses only the explicitly supplied MIGRATION_MONGO_URI and `--db`; it never loads .env or silently selects the application's production URI.
- It preserves stable ids, Mongo _ids when valid, participants, timestamps, media, reactions, engagement, ownership and read state. Plaintext legacy passwords are hashed without changing the source file.
- It identifies overlap using id/_id, user email, directional relationship keys, roomId, match participant pairs, streak keys and existing unique indexes. Missing fields and distinct embedded members can be added; conflicting existing values block the entire preflight. Different ids on overlapping pairs are reported for reconciliation rather than silently losing either identity.
- Once preflight succeeds, each target document and its migration receipts commit atomically using Mongo transactions. A failed apply can leave earlier documents committed; counts report those commits. Retry with the same source and namespace. Receipts make retries idempotent and prevent old backups from resurrecting already imported records later deleted by the application.
- Changed source records with existing receipts are rejected for manual reconciliation. Keep the default namespace for retries; changing it is not a conflict-resolution mechanism.
- The report contains counts and field/path diagnostics, not passwords, tokens, complete records or connection strings. Report paths are created exclusively and cannot overwrite the source or an existing report.
- The source file is opened for reading only and is never deleted, moved, truncated or rewritten.

When a user has only an embedded blockedUsers list, its original block time is absent. The importer records an explicit warning and uses the available account createdAt for the derived Relationship. Review these warnings. Records that cannot safely map remain in the untouched snapshot and cause a nonzero exit; resolve them before cutover.

## 3. Exact commands

Run from `C:\projects\rombuzz\Rombuzz_main\server`. Obtain an immutable copy of the actual legacy `db.json` first. Keep the original backup. The following paths assume that copy is `server/db.json`.

Offline structure inspection:

```powershell
node scripts/migrate-lowdb-to-mongodb.js --file .\db.json --validate-only --report .\migration-validation.json
```

Dry-run against a review database restored from a recent Mongo backup:

```powershell
$env:MIGRATION_MONGO_URI = '<review MongoDB connection URI>'
node scripts/migrate-lowdb-to-mongodb.js --file .\db.json --db rombuzz_review --report .\migration-dry-run.json
```

Apply to that same review database only after the report is clean:

```powershell
node scripts/migrate-lowdb-to-mongodb.js --file .\db.json --db rombuzz_review --apply --report .\migration-apply.json
```

Use a new report filename on each invocation. Exit 0 means the requested mode completed with no unresolved failures; 2 means validation/apply needs attention; 1 means an input/configuration/infrastructure failure. Inspect warnings even on exit 0. Apply requires Atlas or a Mongo replica set because receipts and domain writes are transactional. The database name must match the intended target exactly; do not assume the deployed URI selects `rombuzz`.

There is no HTTP migration endpoint. Production migration and deployment remain review steps for the owner. During eventual cutover, stop all old and new application writers/background jobs, take both backups, rerun dry-run, resolve every issue, apply, verify counts/relationships, then start the Mongo-only application. Keep backups and receipts. Never run old startup-sync code against the migrated target. A rollback must account for new writes after cutover; this script does not offer a destructive automatic rollback.

## 4. Verification and limits

The automated checks use Node 22 and a disposable local MongoDB replica set. The dev-only Mongo test dependency requires a modern Node version and may download its Mongo executable on first use.

| Area | Evidence |
| --- | --- |
| Users → MongoDB | Import/overlap preservation, token/account lookup, persisted presence after reconnect/restart |
| Matches → MongoDB | Import, HTTP mutual likes, unmatch, denied socket sends while unmatched |
| Messages → MongoDB | Real socket send/receive, HTTP/socket duplicate race, edits, reactions, delete, seen/unread, media consumption, restart |
| Posts → MongoDB | Create, matched read, reactions, comments and delete through HTTP |
| Stories → MongoDB | Import, create, matched feed, persisted view, denied feed after unmatch |
| Bookmarks → MongoDB | HTTP add/read/remove on existing PostModel |
| Sockets → Mongo-backed persistent state | Identity checks, active match/block checks, durable messages/read/presence, reconnect, process restart |
| Other legacy structures → MongoDB | Fixture import for likes/blocks, notifications/read state, reports, directional streaks; unknown structures fail safely |
| Import safety | Read-only dry-run, existing Mongo overlap, reruns, conflicts, missing references, source byte preservation, credential-free output, deletion-resurrection prevention |
| Mobile | 43 existing chat contract tests passed; TypeScript --noEmit passed |
| Web | Production build passed using the Windows equivalent of the package build script |
| Existing web tests | Blocked before tests execute: CRA/Jest cannot resolve `react-router/dom` from the existing react-router-dom dependency. The unchanged App.test.js is also an old starter test. No unrelated test/config redesign was made. |

Final backend verification: `npm test` passed all 22 tests (including the real HTTP/Socket.IO integration group); `npm run check` passed for all 174 JavaScript files. `npm ls lowdb --all` returned an empty dependency tree. Dependency installs completed in the backend and web projects. The final repository-wide source search found no runtime LowDB imports, reads, writes or initialization. No physical Android/iOS devices, app binaries, real push delivery, storage providers, payments or production Mongo were exercised.

Review before deployment:

- Run the importer against the actual snapshot and a restored Mongo backup; local synthetic coverage cannot certify unknown production data. Resolve conflicts and unmappable records, not merely their counts.
- Messages that existed only in the old process-local Map may never have reached disk; a JSON importer cannot recover data absent from its source. Account for any still-live old-process state before shutting down the old deployment.
- Test two devices with send/reply/media, once/twice views, gift unlock, edit/delete/react/pin, unread/manual-unread, unmatch/block, network loss, reconnect and app restart. Verify old client token handshakes and web duplicate-send behavior.
- Embedded ChatRoom messages retain the existing Mongo 16 MiB per-document limit. Import preflight rejects oversized rooms; very large histories need a separate, reviewed storage change.
- Simultaneous room edits can now fail a version check and require a retry; the stale write is rejected so it cannot discard a concurrent message. Include concurrent edits/sends in device testing.
- Existing Mongo indexes are reused. Added indexes cover participants/updatedAt, expiry, post owner/date, bookmarks/active/date, stories owner/active/date, direct message pair/date and notification recipient/read/date. Match.users and Relationship's unique from/to/type index already exist. Do not build a unique index on Match.users: that would prevent a user having multiple matches. Embedded room pagination already selects a room by unique roomId and slices its messages; a separate timestamp index would not accelerate that array slice.
- Static identifier checking found an unchanged pre-existing Reply Ideas issue: `summarizeReplyIdeaMessage` is undefined and the success handler is unfinished. This is separate from persistence and was not redesigned. The extracted migration/chat services have no unresolved identifiers.
- Dependency installs reported existing audit advisories (backend: 17; web: 29). No broad dependency upgrades were applied as part of the persistence migration.

## 5. Remaining LowDB

No runtime LowDB dependency remains. The initializer, write guard, startup sync and unused Mongo migration template were removed. The package and lockfile no longer contain the LowDB dependency. Remaining mentions are the explicit offline importer/tests, this audit/report, and historical comments/documentation. The case-insensitive JSONFile search also finds the unrelated `jsonfile` package used by frontend filesystem/build dependencies; it is not the LowDB JSONFile adapter or an application database. The mobile performance-audit document and old backend ZIP are historical artifacts; they are not loaded by the app. Existing JSON backup files are intentionally not removed.

## 6. Files changed

The complete source/documentation file inventory is in [changed-files.md](changed-files.md).
