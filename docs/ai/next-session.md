# Next session

_Updated 2026-07-19. Read `current-focus.md` and `decisions.md` first._

## Completed (prior session)
- **Domain cutover:** `protocalltrainer.com` now serves ProtoCall (was the old
  fireground app). `APP_URL` fixed to the real domain. Old fireground service
  stopped.
- **Track 0 + A1 shipped and live** (commit `bd43edf` on `main`, deployed):
  - Solo: dropped punitive stage lock (earlier stages editable), always-available
    Exit button (confirm only if answers exist).
  - `VOICE.md` — the de-AI'd copy voice for this app.
  - `solo_events` table + start/finish logging (the funnel for Track E gating).
- **Docs:** `docs/ai/` established; `HANDOFF.md` retired (pointer only).

## Settled this session (three batched arch decisions — see `decisions.md`)
- **Objective rename policy: immutable** (create-only, re-tag to change; no
  rename/delete endpoint). Code comments added at the schema + endpoint.
- **Track D admin model: `site_admin` env-bootstrapped only, no in-app
  promotion.** `dept_admin` covers department-scoped moderation. Self-serve
  site-admin grant deferred until a second moderator exists. No code change.
- **Backups: in-app nightly `db.backup()` snapshot** to `$BACKUP_DIR`
  (default `/data/backups`), rotating `BACKUP_KEEP` (default 14) — shipped in
  `server/backup.js`, wired into `buildServer`, 3 tests. On-demand
  `GET /api/admin/backup` stays as the offsite pull.

## In progress / pending a decision
- **`Fireground_trainer-old` Railway project** is a broken (502, crash-looping)
  husk with only demo data. Awaiting owner go-ahead to **delete it** (irreversible).
- **Offsite backup sync** (push nightly snapshots off the Railway volume) is the
  open follow-up on backups — an ops task, not a blocker.

## Recommended next steps (priority order)
1. **A2 — unified After-Action reveal** (see `decisions.md` → Solo run UX). All
   frontend + a minor server touch; no DELETE endpoint needed (deferred save).
2. **Track B — creation flow** (highest-leverage for supply). Start with
   scene-first + sticky reference (mockup was approved), then progressive
   disclosure + tutorial + destination selector.
3. **Track C** then **Track D**. Hold **Track E** until `solo_events` shows
   repeat solo usage.

## Key files to review first
- `public/index.html`: `renderSolo` (~L2016), `soloReveal` (~L2165), the solo
  submit path (~L2120). Single-file vanilla-JS frontend, hash routing.
- `server/index.js`: solo endpoints (~L966: solo-start, solo-reveal, solo/runs).
- `server/db.js`: schema + idempotent `addColumn` migrations; `solo_events`
  table near the bottom of the `CREATE TABLE` block; `learning_objectives`
  (immutable — see the comment there).
- `server/rooms.js`: live/solo session logic (`revealedAnswers`, stages).
- `server/backup.js`: nightly on-volume DB snapshots + rotation, started from
  `buildServer` (skipped for the in-memory test DB; `backup:false` disables).
- `VOICE.md`: write user-facing copy to this voice.
- Tests: `npm test` (node:test, currently 78 green).
