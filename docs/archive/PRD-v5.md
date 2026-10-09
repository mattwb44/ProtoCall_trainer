# PRD: ProtoCall Trainer v5 — Scale & Reach

## User Stories
- As a **firefighter in a concrete stairwell**, I want my answers to survive dropped connectivity and submit themselves when the signal returns, so that training doesn't punish bad reception.
- As a **crew member**, I want to install the app on my phone's home screen and have it open instantly, so that it feels like an app, not a bookmark.
- As the **operator**, I want login/signup brute-forcing rate-limited, security headers set, a health endpoint for uptime checks, and one-click database backups, so that a public site holds up to the public internet.
- As the **operator**, I want the real-time layer ready for multi-node the day it's needed, without paying for infrastructure it doesn't need today.

## Implementation Decisions

**PWA.** A web manifest (name, theme colors, SVG icon) plus a service worker: cache-first for the app shell and media, network-first with cache fallback for the API's read-only GETs, never caching auth or live-session state. Installable on iOS/Android/desktop. The service worker versions its cache and cleans up old ones on activate.

**Offline answer queue.** Participant submissions that fail (socket disconnected) are queued in `localStorage` with their room, question, and body, shown as "queued — will send when back online" in the UI, and flushed automatically on reconnect/rejoin — surviving page reloads. localStorage over IndexedDB deliberately: the queue is a handful of tiny text records, and localStorage is synchronous and 20 lines instead of 200.

**Rate limiting.** `@fastify/rate-limit`: tight per-IP limits on `/api/login` and `/api/signup` (10/minute — brute-force protection), a generous global default (300/minute) so live sessions are never throttled.

**Hardening.** `@fastify/helmet` for security headers (CSP disabled — the app intentionally uses CDN scripts and inline JS; revisit if that changes). `/healthz` endpoint (checks a real DB read) for Railway healthchecks/uptime monitors. Graceful SIGTERM shutdown: close sockets and the HTTP server so redeploys don't drop mid-session events.

**Backups.** Two layers, both on better-sqlite3's online backup API (consistent while the app is live). (1) `GET /api/admin/backup` (site_admin only) streams a snapshot on demand — this is the offsite pull. (2) An in-app nightly scheduler (`server/backup.js`) writes a rotating snapshot to the volume (`$BACKUP_DIR`, default `/data/backups`, keeping `BACKUP_KEEP`=14) so recovery from a crash / bad deploy / accidental deletion doesn't depend on someone remembering to click. Chosen over Railway volume snapshots as the baseline (free on any plan, SQLite-consistent, testable); volume snapshots are welcome defense-in-depth on top. Media files are already durable on the volume; the DB snapshot is the part that needs the offsite copy.

**Redis adapter: env-gated, not default.** If `REDIS_URL` is set, Socket.IO loads `@socket.io/redis-adapter` at boot; without it, nothing changes. The day a second node exists, provisioning Railway Redis + setting one variable turns on cross-node fan-out. Zero cost until then.

**Postgres: deliberately deferred, with a trigger.** Migrating means rewriting every query from synchronous better-sqlite3 to async pg and re-testing all of it — worthwhile only when its sole benefit (multiple app nodes sharing state) is actually needed. The trigger: sustained concurrent sessions pushing a single Railway instance's CPU, or a second region. Until then SQLite-on-volume is faster than a networked Postgres for this workload. The schema has been column-compatible since v1; this stays a swap, not a rewrite.

## Testing Philosophy
- Rate limit: the 11th login attempt inside a minute returns 429; normal API traffic doesn't trip the global limit.
- `/healthz` returns 200 with a real DB read; backup endpoint is site_admin-only and streams bytes beginning with the SQLite magic header that open as a valid database.
- Manifest and service worker are served with correct types.
- Offline queue verified in the browser: kill the socket, submit, see the queued state, restore, watch it flush and land in the host matrix.
- Full existing suite (19 tests) still green — hardening must not break the product.

## Out of Scope (v5)
- Postgres migration (trigger documented above), multi-node deployment, Redis provisioning.
- Custom domain (a Railway dashboard action, not code), CDN.
- Push notifications, background sync API (plain reconnect-flush is sufficient).
- Media backup tooling (volume-durable; offsite media sync is an ops task for later).
