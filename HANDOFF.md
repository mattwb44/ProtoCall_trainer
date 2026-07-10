# ProtoCall Trainer — Session Handoff

_Last updated: 2026-07-08. Read this first, then `ENGINEERING_OS.md`, `ROADMAP.md`, and `TODO.md`._

## What this is
**ProtoCall Trainer** ("CrewTable") — a live tactical fireground & EMS scenario training
web app. A host launches a live session from a scenario, crew join by QR code / room code
(no account needed), answers stream into the host's real-time Aggregation Matrix, the host
"pushes" notable answers to every device, and the session archives to each participant's
library. Mobile-first, dark theme, works on phone/tablet/Mac/PC.

Built with the Engineering OS at `~/engineering-os` (see `ENGINEERING_OS.md`). The workflow
each version followed: PRD (from `~/engineering-os/templates/prd-template.md`) → implement →
integration tests → browser verification → deploy → journal entry.

## Current state: all 5 planned versions shipped + department-approval gate
- **Live URL:** https://protocall-trainer-production.up.railway.app
- **Tests:** 33 integration tests, all green. Run with `npm test`.
- **v6 (Decision Intelligence, PRD-v6.md) post-session after-action is built** — env-gated
  behind `ANTHROPIC_API_KEY` (dormant without it). `server/analysis.js` (raw fetch, structured
  JSON, injectable as `buildServer({ analyzer })`); on session end a draft crew summary +
  per-participant debriefs generate in the background; host reviews/edits/shares from the
  session detail page; participants see only their own shared debrief. Live triage deferred.
- **Git:** clean tree, all work committed to `main` (local git repo; no GitHub remote).
- **Deploy:** `npx railway up --service protocall-trainer --detach` from the project dir.

Version history (each has a PRD-vN.md): v1 live loop · v2 accounts/ownership/library ·
v3 media uploads + PDF records + edit/soft-delete · v4 departments/official-badging/
analytics/moderation · v5 PWA/offline-queue/rate-limiting/backups/env-gated-Redis.
Most recent work: department creation now requires site_admin approval (pending until approved).

## Architecture
- **Server:** Node 24, Fastify + Socket.IO, single process. `server/index.js` (routes +
  sockets), `db.js` (SQLite schema/seed/migrations), `rooms.js` (live-session logic),
  `auth.js` (scrypt + cookie sessions), `media.js` (disk store, S3-shaped), `pdf.js` (pdfkit).
- **DB:** SQLite via better-sqlite3, synchronous. Schema is column-compatible with the
  Postgres blueprint in `SPEC.md`. Migrations are idempotent `ALTER TABLE`s in `db.js`.
- **Frontend:** single file `public/index.html` — vanilla JS, hash routing, Tailwind CDN +
  Lucide. Plus `manifest.json`, `sw.js` (service worker), icon SVGs.
- **Real-time:** one Socket.IO room per session. Events: join_room, submit_response,
  push_answer, save_note, end_session (client→server); room_state, participant_count,
  response_incoming, answer_pushed, session_ended (server→client). Reconnect re-sends full state.

## Deploy / ops
- **Railway** project `protocall-trainer` (id 6aa83d48-81dc-4d73-a40f-d3a9a9958af2), deploys
  from local git. Persistent volume at `/data`. `npx railway login` already done for this user.
- **Env vars set:** `DB_PATH=/data/protocall.db`, `MEDIA_DIR=/data/media`,
  `SITE_ADMIN_EMAIL=mattwb44@gmail.com` (promotes that account to site_admin on every boot).
  `PORT` is injected by Railway. `REDIS_URL` intentionally NOT set (see below).
  `RESEND_API_KEY` / `MAIL_FROM` / `APP_URL` **not yet set** — email flow stays dormant
  (logs instead of sends) until they are; see open item #2.
- **Health check:** `GET /healthz`. **Backups:** `GET /api/admin/backup` (site_admin only)
  streams a live SQLite snapshot.
- **Verify against production, not just localhost** — two infra bugs (proxy IPs defeating
  rate limits; stale service-worker shell) were only visible live. Deploys take ~30–60s;
  poll `/healthz` `uptime_s` to confirm the new build is up.

## Roles & the site admin
- Roles: `standard`, `dept_admin` (training chief), `site_admin`. There is deliberately NO
  UI to grant site_admin — it's the `SITE_ADMIN_EMAIL` env var (or a manual DB flag).
- Owner's account **mattwb44@gmail.com is site_admin** (via the env var). Moderation queue
  lives at `#/moderation`: pending departments (approve/reject) + reported scenarios (dismiss/unlist).

## Open items / next steps
1. **Owner action:** a live smoke-test department **"Gate Check FD"** is sitting pending on
   prod — reject it from `#/moderation`. Any real department the owner created before the
   approval gate will also be pending — approve it there.
2. **Email verification & password reset** — ✅ **built 2026-07-08 with Resend** (env-gated,
   `server/mailer.js`, 29 tests green). Dormant until you set the prod env vars:
   `RESEND_API_KEY`, `MAIL_FROM`, `APP_URL` on Railway + verify a Resend sending domain
   (DKIM). Until then signups work and the app logs `[mail:dev] would send…` instead of
   sending. Routes: `POST /api/auth/verify(/request)`, `POST /api/auth/reset(/request)`;
   UI at `#/verify/:token`, `#/reset`, `#/reset/:token`, plus a verify banner on `#/me`.
3. **Postgres migration** — deliberately deferred with a documented trigger (see `PRD-v5.md`):
   do it only when sustained concurrent load maxes the single instance or a 2nd region is
   needed. It's a swap (schema compatible), not a rewrite. Redis adapter is already wired —
   set `REDIS_URL` to enable multi-node fan-out.
4. **Custom domain** — a Railway dashboard action if wanted.

## Gotchas the journal already records (`~/engineering-os/journal/`)
- `buildServer()` is **async** (awaits helmet + rate-limit registration so per-route rate
  configs attach). Tests call `await buildServer({ dbFile: ':memory:', authRateMax: 1000 })`
  — the high authRateMax stops many signups tripping the limiter.
- Fastify needs `trustProxy: true` behind Railway or rate limits key on rotating edge IPs.
- socket.io `reconnect` only fires on *automatic* reconnects; the client hooks `connect`
  with a joined-once flag for rejoin/queue-flush.
- Run deps `npm install` from the project dir — a stray install in the parent
  `/Users/user/Documents/VSCode/Projects/` once crashed the deploy.
- QR codes are generated server-side (SVG endpoint); the qrcode npm has no browser bundle.

## Key files to know
`README.md` (run/test), `QUICKSTART.md` (crew-facing usage), `SPEC.md` (full architecture +
schema), `ROADMAP.md` (all 5 versions, shipped), `TODO.md` (done + open), `PRD*.md` (per-version).
