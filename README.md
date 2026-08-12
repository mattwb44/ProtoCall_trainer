# ProtoCall Trainer ("CrewTable")

Live tactical fireground & EMS scenario training. A host launches a session from the
scenario library, the crew scans a QR code to join from any phone/tablet/PC, answers
stream into the host's Aggregation Matrix in real time, and the host pushes notable
answers to every device to drive the tabletop discussion.

## Run

```bash
npm install
npm start        # http://localhost:3000
```

The SQLite database (`protocall.db`) is created and seeded with the
"Two-Story Residential Fire — Trapped Occupant" scenario on first run.
Crew on the same network can join via your machine's LAN IP (the QR encodes the host URL).

## Test

```bash
npm test         # REST + full live-session socket loop (node:test)
```

## Production configuration

Environment variables read by `server/`:

| Variable | Purpose | Required in prod | If missing |
| --- | --- | --- | --- |
| **`DB_PATH`** | Path to the SQLite database file. **Must point at the mounted persistent volume**, or data is lost on every redeploy/restart. | Yes | Falls back to `protocall.db` next to the source, which lives on ephemeral container storage. |
| `APP_URL` | Base URL used to build links (email verification/reset, QR host URL) when a request's `Host` header isn't reliable. | Yes | Falls back to `req.protocol://req.headers.host`, which can be wrong behind a proxy/load balancer. |
| `SITE_ADMIN_EMAIL` | Email of the account to promote to `site_admin` on boot. | No | No account is auto-promoted; you must grant site-admin access another way. |
| `BACKUP_DIR` | Directory where local SQLite backups are written. | No | Defaults to a `backups/` folder next to the database file. |
| `BACKUP_KEEP` | Number of local backups to retain before pruning. | No | Defaults to `14`. |
| `BACKUP_S3_ENDPOINT` | S3-compatible endpoint URL for offsite backup uploads (e.g. an R2 origin). | No (all-or-nothing with the other `BACKUP_S3_*` vars) | Offsite backups stay off; if only some `BACKUP_S3_*` vars are set, backups warn loudly instead of silently skipping. |
| `BACKUP_S3_BUCKET` | Bucket name for offsite backup uploads. | No | Same as above. |
| `BACKUP_S3_ACCESS_KEY_ID` | Access key ID for offsite backup uploads. | No | Same as above. |
| `BACKUP_S3_SECRET_ACCESS_KEY` | Secret access key for offsite backup uploads. | No | Same as above. |
| `BACKUP_S3_REGION` | Region for the S3-compatible endpoint. | No | Defaults to `auto`. |
| `BACKUP_S3_PREFIX` | Key prefix under which backup objects are stored. | No | Objects are stored at the bucket root. |
| `REDIS_URL` | Redis connection string used for the Socket.IO adapter, enabling multi-instance fan-out. | Yes (any deploy with more than one server instance) | Socket.IO falls back to single-process pub/sub, so events won't propagate across instances. |
| `PORT` | Port the HTTP server listens on. | Yes (platform-provided) | Defaults to `3000`. |
| `RESEND_API_KEY` | API key for sending transactional email (verification, password reset) via Resend. | Yes | Mailer no-ops and logs the link instead of emailing it — users can't self-serve verification/reset. |
| `MAIL_FROM` | From address/name used on outgoing email. | No | Defaults to `ProtoCall Trainer <onboarding@resend.dev>`. |
| `ERROR_ALERT_EMAIL` | Address to email (via Resend/`RESEND_API_KEY`) on server errors — 500s, `unhandledRejection`, `uncaughtException`. Throttled to one email per distinct error message per hour. | No | Error alerting is off; errors are only logged to stdout. |
| `ANTHROPIC_API_KEY` | API key for Claude-powered scenario analysis. | Yes (if analysis features are used) | Analyzer can't be created / analysis endpoints fail. |
| `ANALYSIS_MODEL` | Claude model used for scenario analysis. | No | Defaults to `claude-opus-4-8`. |
| `MEDIA_DIR` | Directory for uploaded media storage. | No | Defaults to a `media/` folder next to the source. |
| `RAILWAY_ENVIRONMENT` | Set automatically by Railway; used to mark auth cookies `Secure`. | Yes (on Railway) | Auth cookies are issued without `Secure`, which is unsafe if the app is ever served over HTTP. |

## Layout

- `server/` — Fastify + Socket.IO + better-sqlite3 (`index.js` API/sockets, `db.js` schema/seed, `rooms.js` session logic)
- `public/index.html` — single-page frontend (Tailwind + Lucide, hash routing)
- `test/` — integration tests
- `SPEC.md` / `PRD.md` — architecture spec and v1 product requirements
- `ProtoCall_trainer.html` — the original static prototype (superseded by the live app)
