# RomBuzz backend persistence

The running backend now uses MongoDB exclusively. See [the migration guide](docs/mongodb-migration.md) and [the pre-change audit](docs/lowdb-audit.md) before cutover. Legacy JSON import is an explicit server-side command; startup never reads or rewrites it.

The historical split inventory below records the earlier modularization; its removed database helpers are no longer runtime files.

- Entry file left intact: `server/index.js` (so Render deploy keeps working)
- The script created/updated these files from your header sections:
  - `config/cloudinary.js`
  - `config/config.js`
  - `config/cors.js`
  - `config/sendgrid.js`
  - `config/db.js`
  - `models/User.js` and the other domain models
  - `routes/account.js`
  - `routes/auth-middleware.js`
  - `routes/auth.js`
  - `routes/buzz.js`
  - `routes/microbuzz.js`
  - `routes/misc.js`
  - `routes/notifications.js`
  - `routes/profile.js`
  - `routes/settings.js`
  - `routes/social.js`
  - `routes/users.js`
  - `sockets/calls.js`
  - `sockets/connection.js`
  - `sockets/index.js`
  - `sockets/meet-realtime.js`
  - `utils/helpers.js`
  - `utils/jwt.js`

## Database checks

Run `npm test` and `npm run check` in `server`. The tests use synthetic records and a disposable local MongoDB replica set. Never use production credentials for tests.
