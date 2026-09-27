# Post-device smoke: focused pinned messages

Starting backend: `96f34d4`. Implementation checkpoint: `75dcebe` (`perf: project pinned messages without full history hydration`). Final documentation checkpoint: `docs: record post-device pinned validation` (this document's commit).

The user observed roughly four seconds to open eight pins. The mobile screen fetched the entire unpaginated room after its partial thread cache; the backend hydrated all messages and prepared their media before mobile filtered the pins.

The compatible mobile client was implemented and tested before this backend edit. It uses account/room pin caches and `/chat/rooms/:roomId/pinned`, with a legacy full-room fallback only for a missing route, never a JSON access error. No production deployment occurred.

The new route reuses moderation and active-room authorization. `chatPinnedQuery` performs the existing indexed room lookup and projects candidate pinned IDs inside MongoDB. It retains all versions of candidate IDs to avoid resurrecting an older pin after a later unpin/deletion, then preserves descending pin time and excludes hidden/deleted/temp/unpinned rows. Complete message metadata (text, replies, reactions, media keys) remains. Pin cards display text/type labels and navigate by focusMsgId, so this endpoint does no R2 signing or Stream playback preparation; the thread owns playable media. Existing full-history and paginated routes are unchanged. The embedded message array still requires a MongoDB scan; no new schema/index/Redis or constant-time-query claim.

Controlled disposable Mongo/HTTP fixture: 1,213 stored rows → 12 projected candidates → 8 visible pins. Serialized sizes: full stored history 2,509,852 bytes; candidate projection 1,712 bytes; endpoint 1,571 bytes. Existing room index uses IXSCAN. Signing/playback calls: zero. These are synthetic byte comparisons, not production latency measurements. Media/replies/reactions/order, deleted/hidden/temp/duplicate semantics and access/not-matched gates are tested.

Changed backend files:

- `server/routes/chatRooms.js`
- `server/services/chatPinnedQuery.js`
- `server/tests/chat-pinned.test.js`
- `server/docs/performance-post-device-pinned.md`

Final validation: `npm test` **47 passed, zero failed/skipped**; `npm run check` **192 JavaScript files passed**; complete-batch and working-tree `git diff --check` passed. The existing duplicate `expiresAt` schema-index warning remains. All databases were disposable local fixtures. The untracked `astra-mongodb-audit/` directory is untouched.

Physical cold/warm timing, old-pin cache opening, socket mutations, media navigation, focus cancellation and old-backend compatibility remain device acceptance items. Full mobile details, five checkpoints, regression counts (156 passing mobile tests), and unchanged Gifts/provider constraints are recorded in the mobile repository's `docs/performance-post-device-smoke-fixes.md`.

No push, deploy, production config, `USE_LOCAL`, Gifts/wallet/provider changes, or changes to previous performance fixes outside the requested integration paths.
