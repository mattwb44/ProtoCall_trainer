# Next session

_Updated 2026-07-15. Read `current-focus.md` and `decisions.md` first._

## Completed (2026-07-15)
- **Track B — creation flow UX** shipped in `renderCreator` (`public/index.html`):
  scene-first ordering (media + dispatch lead, degrading to dispatch-only with
  no image); sticky scene reference (desktop right rail + mobile collapsible
  peek/sheet) mirroring first image + dispatch, hidden until there's content;
  progressive disclosure of per-question stage/role behind a "Stage & role
  fields" toggle (remembered in `localStorage.pcCreatorAdvanced`, auto-on when
  editing a scenario that already uses them); dismissible creation tutorial
  (`localStorage.pcCreatorTutorial`); destination selector section (button now
  "Create scenario" / "Save changes"). Verified end-to-end in a real browser
  (13 UI assertions + a live create). `npm test` 75 green.
- **Pending owner action:** the old `Fireground_trainer-old` Railway project
  still needs deleting from the Railway dashboard (no CLI/token in the cloud
  session — owner must do it). See below.

## Completed (2026-07-14)
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
  husk with only demo data. Owner has approved deletion, but it must be done
  from the Railway dashboard (Project → Settings → Danger → Delete Project) or
  `railway delete` — no CLI/token exists in the cloud session, so a session
  agent cannot do it. **Owner to delete.**
- **Admin model** for Track D: is admin just the owner (seed from
  `SITE_ADMIN_EMAIL`), or promotable from the UI? Not yet decided.

## Recommended next steps (priority order)
1. **A2 — unified After-Action reveal** (see `decisions.md` → Solo run UX). All
   frontend + a minor server touch; no DELETE endpoint needed (deferred save).
2. **Track C — objectives** (per-question grain + enforced tagging + rule-based
   corpus-seeded keyword suggester), then **Track D**. Hold **Track E** until
   `solo_events` shows repeat solo usage.

## Key files to review first
- `public/index.html`: `renderCreator` (~L559, scene-first layout + rail +
  destination), `drawQs` / `drawMedia` / `drawSceneRef` (creator helpers),
  `renderSolo` (~L2050), `soloReveal`, the solo submit path. Single-file
  vanilla-JS frontend, hash routing.
- `server/index.js`: solo endpoints (~L966: solo-start, solo-reveal, solo/runs).
- `server/db.js`: schema + idempotent `addColumn` migrations; `solo_events`
  table near the bottom of the `CREATE TABLE` block.
- `server/rooms.js`: live/solo session logic (`revealedAnswers`, stages).
- `VOICE.md`: write user-facing copy to this voice.
- Tests: `npm test` (node:test, currently 75 green).
