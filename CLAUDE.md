# ProtoCall Trainer — working agreement

Live tactical fireground / MVC / EMS scenario training. A host launches a session
from the scenario library, the crew joins from any device via QR code, answers
stream into the host's live view in real time, and solo users can run scenarios
stage-by-stage on their own. Vanilla single-page frontend; small Node backend.

## Start every session here (source of truth)

Read these **before doing any work** — they are the distilled state of all prior
sessions and are kept current. Read in order:

1. `docs/ai/next-session.md` — what's done, in progress, and the next steps
2. `docs/ai/current-focus.md` — the active milestone
3. `docs/ai/decisions.md` — settled decisions (architecture, UX, product)
4. `docs/ai/ux-backlog.md` — the feature / polish backlog + future stubs

For ops/launch readiness: `docs/execution-plan.md` (the 50-user plan — complete),
`docs/ops-log.md`, `docs/runbooks.md`. Everything in `docs/archive/` is
inception-era history — **not authoritative**, do not act on it.

**Keep these current.** At the end of a session, update `next-session.md`,
`current-focus.md`, and `decisions.md` to reflect the new state (prune stale
content, don't just append) and tell the user which changed.

## Stack

- **Backend:** Node + Fastify + Socket.IO, `better-sqlite3` (SQLite). Code in
  `server/` — `index.js` (REST API + sockets), `db.js` (schema/seed/migrations),
  `rooms.js` (live-session logic).
- **Frontend:** one file, `public/index.html` — Tailwind + Lucide, hash routing,
  no build step and no framework. Match the existing vanilla style; do not
  introduce a framework or bundler.
- **Persistence:** SQLite on a Railway volume (`DB_PATH=/data/protocall.db`).
  Single instance by design; Postgres/multi-node is a deliberate later migration,
  not a near-term need.
- **Deploy:** merges to `main` auto-deploy to `protocalltrainer.com` via Railway.

## Commands

- `npm test` — full suite (REST + live-session socket loop, `node:test`). Must be
  green before any deploy.
- `npm start` — local server at http://localhost:3000.

## Working rules

- **Migrations are additive only** — new columns get defaults (`addColumn`
  pattern in `db.js`); data rewrites are one-shot and flag-guarded via `app_meta`.
  Never DROP, never RENAME, never change a column's meaning. Old pages/APIs must
  keep working.
- **Commit/push only when asked.** Docs are committed directly to `main` per repo
  convention.
- **Pushing auto-deploys**, and a single-instance + volume deploy causes a
  few-second unavailability blip (expected, self-recovers — see `decisions.md`).
  Don't push during a live session: check
  `SELECT COUNT(*) FROM live_sessions WHERE status='live'` first.
- **Verify previewable changes** in the browser preview before reporting done;
  the app runs at 375px mobile too — check it.
- Content voice/tone lives in `VOICE.md`; domain terms in `CONTEXT.md`.
