# Next session

_Updated 2026-08-01. Read `current-focus.md` and `decisions.md` first, then
`CONTEXT.md` (glossary) at the repo root._

**Branch: `claude/three-arch-decisions-vp35dd`, HEAD `87ebeaa`, pushed and in
sync with origin. Not merged to `main`.** Working tree clean. `npm test` = 104
passing.

## Where we are
Tracks 0 / A1 / A2 / B / C shipped earlier (details in `decisions.md`). A
grilling session on 2026-07-31 turned the owner's backlog into settled
decisions and a five-phase build order (`current-focus.md`).

**Phase 1 is done, committed, and pushed** (`87ebeaa`):
- **Community approval gate.** Sharing to Community is a *submission*, not an
  instant publish. `gatedStatus` + `APPROVED_PUBLIC` in `server/index.js`;
  `canSee` requires approved-and-public for strangers; author edits to a public
  scenario re-enter the queue. A one-shot `approval_gate_sweep` migration
  (guarded by the new `app_meta` flag table) sweeps the pre-gate catalogue into
  the queue; the system seed ships pre-approved.
- **Bug batch.** QR-join "logout" + stuck-at-end (root cause: `IMMERSIVE_ROUTES`
  hid the sidebar with no release on session end — fixed with an
  `immersionLifted` flag, an explicit "Done — back to Home", a not-signed-in
  hint on join, guest drawer dropped to `z-10`). Category-switch objective
  amnesia (picks now remembered per category).
- **Required-field markers** in the creator; **offsite backup sync**
  (`server/offsite.js`, hand-rolled SigV4, off unless `BACKUP_S3_*` is set).

## Next up: Phase 2 — structure
Nothing implemented yet. The scope, in the order it makes sense to build:

1. **My Library ownership boundary.** `/api/scenarios` (server/index.js:533)
   returns `public OR mine OR dept` — that mixed query is why a brand-new
   account sees other people's scenarios on a page called "Library". Plan
   (decided, not yet written): add a `?scope=mine` option rather than change
   the default, because the host flow and many tests depend on the current
   semantics. `renderLibrary` is `public/index.html:407-452`.
2. **Two tabs** on My Library: My Scenarios (drafts + published) and My Sessions
   (hosted / joined / solo history). No separate My Sessions nav item.
3. **Persisted drafts** + "Save as Draft" / "Finish Scenario", then a publish
   step (Publish to Community / Publish to Department). Drafts require nothing;
   every scenario always lands in the author's library regardless.
4. **Session-card badges** (IN PROGRESS/COMPLETED + SOLO/HOSTED/JOINED),
   right-column alignment, solo-only progress bar.
5. **Browse UI**: list/grid toggle (default grid, remembered in localStorage),
   collapsed mobile filters ("Filters · N" bottom sheet), "Review & Edit"
   button height.
6. **New home page**: hero → join card → 2×2 grid (incl. My Library +
   Community) → the 4-step "How it works" grid copied **verbatim** from
   `fireground_trainer/templates/home.html:277-298`. The owner explicitly
   rejected rewriting that copy.

Then Phases 3–5 per `current-focus.md`. Commit and push per phase.

## Working notes
- **Test fixtures:** scenario creates/edits require `objective_primary` (any
  seeded objective, e.g. `'Scene Size-Up'`, works for any category). Public
  scenarios are no longer instantly visible — use `approvePublic(ctx.db, id)`
  from `test/helpers.js` when a test needs a *visible* community scenario.
- **Known flake:** the multipart size-cap assertion in `test/media-pdf.test.js`
  is order/timing-sensitive under `@fastify/multipart` v10. It passed
  consistently through Phase 1; a spurious failure there is not a regression.
- **Preview:** `.claude/launch.json` runs `node server/index.js` directly
  (port 3100) — `npm start` fails with `EPERM ... uv_cwd` in this sandbox. The
  local gitignored `protocall.db` has a `preview@test.local` account promoted to
  `site_admin`.
- Ops follow-up: set `BACKUP_S3_*` on Railway to actually turn offsite backups
  on (see `decisions.md` for the variable list).

## Key files
- `public/index.html` — single-file vanilla-JS frontend, hash routing.
  `renderLibrary` (Phase 2 starting point), `renderPublic` (community browse),
  `renderCreator` + `drawQs`/`drawSceneRef`, `renderSolo`/`soloReveal`,
  `renderReview`/`renderModeration`, `IMMERSIVE_ROUTES` + `immersionLifted`.
- `server/index.js` — `gatedStatus` + `APPROVED_PUBLIC` (the gate), `canSee`,
  browse queries, review endpoints, objectives + suggester + validation.
- `server/db.js` — schema, idempotent `addColumn` migrations, the `app_meta`
  flag table and the one-shot `approval_gate_sweep`.
- `server/rooms.js` — live/solo session logic. `server/backup.js` +
  `server/offsite.js` — nightly snapshots and their offsite replication.
- `VOICE.md` — write all user-facing copy to this voice.
- Tests: `npm test` (node:test). `test/approval-gate.test.js` is the Phase 1
  contract, including the Official-badge workflow the gate must not disturb.
