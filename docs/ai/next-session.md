# Next session

_Updated 2026-07-14. Read `current-focus.md` and `decisions.md` first._

## Completed (this session)
- **Domain cutover:** `protocalltrainer.com` now serves ProtoCall (was the old
  fireground app). `APP_URL` fixed to the real domain. Old fireground service
  stopped.
- **Track 0 + A1 shipped and live** (commit `bd43edf` on `main`, deployed):
  - Solo: dropped punitive stage lock (earlier stages editable), always-available
    Exit button (confirm only if answers exist).
  - `VOICE.md` — the de-AI'd copy voice for this app.
  - `solo_events` table + start/finish logging (the funnel for Track E gating).
- **Docs:** `docs/ai/` established; `HANDOFF.md` retired (pointer only).

## In progress / pending a decision
- **`Fireground_trainer-old` Railway project** is a broken (502, crash-looping)
  husk with only demo data. Awaiting owner go-ahead to **delete it** (irreversible).
- **Admin model** for Track D: is admin just the owner (seed from
  `SITE_ADMIN_EMAIL`), or promotable from the UI? Not yet decided.

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
  table near the bottom of the `CREATE TABLE` block.
- `server/rooms.js`: live/solo session logic (`revealedAnswers`, stages).
- `VOICE.md`: write user-facing copy to this voice.
- Tests: `npm test` (node:test, currently 75 green).
