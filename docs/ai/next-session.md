# Next session

_Updated 2026-08-01. Read `current-focus.md` and `decisions.md` first, then
`CONTEXT.md` (glossary) at the repo root._

**Branch: `claude/phase2-structure`, HEAD `7bdc1c0`, pushed.** Working tree
clean. `npm test` = 115 passing. **Phase 1 is merged to `main`** (`576022f`) —
the approval gate is deployed once `main` ships.

## Where we are
Tracks 0 / A1 / A2 / B / C shipped earlier (details in `decisions.md`). A
grilling session on 2026-07-31 turned the owner's backlog into settled
decisions and a five-phase build order (`current-focus.md`). Phase 1 shipped
and is now on `main`.

**Phase 2 items 1–2 are done and committed** (on `claude/phase2-structure`):
- **(1/6, `86515a4`) `?scope=mine` boundary.** `/api/scenarios?scope=mine`
  returns only the caller's own scenarios (drafts, pending, dept, public, and
  soft-deleted for restore); the bare endpoint keeps its mixed
  public-OR-mine-OR-dept semantics. `test/library-scope.test.js` pins it.
- **(2/6, `ef1998d`) My Library = owner-only, two tabs.** `#/library` is now
  "My Library" with My Scenarios (`?scope=mine`, ownership filter removed) and
  My Sessions (the old `#/me` page folded in via a shared `myLibraryShell`).
  The separate My Sessions nav item is gone; `#/me` redirects to
  `#/library/sessions`; the page is login-gated. Community (`renderPublic`)
  gained a Community/Department scope toggle backed by
  `/api/public/scenarios?scope=department` — that is where
  department-shared-by-others scenarios live now (decision:
  `decisions.md` "Library boundaries"). Covered in `departments.test.js`.

## Phase 2 item 3 — DONE (`1100829`)
Persisted drafts shipped: `is_draft` column, draft-aware POST/PUT (never
demotes a published scenario), `canLaunch`/`solo-reveal` block drafts on every
path. Creator two-button save (Save as Draft / Finish → publish step); My
Scenarios Published / Drafts bucket toggle (`?tab=drafts`); DRAFT chip +
"Continue editing" cards. `test/drafts.test.js`.

## Phase 2 item 4 — DONE (`7bdc1c0`)
Session cards: IN PROGRESS/COMPLETED + SOLO/HOSTED/JOINED badges in a fixed
right column; solo-only questions-answered progress bar. `/api/me/sessions` now
returns role-track-accurate `q_total` + `q_answered`. (`renderSessionDetail`
needed no change — its header shows mode as text, no "live" wording.)

## Next up: Phase 2 — items 5–6
5. **Browse UI**: list/grid toggle (default grid, remembered in localStorage),
   collapsed mobile filters ("Filters · N" bottom sheet), "Review & Edit"
   button height. Applies to both `renderLibrary` and `renderPublic` grids.
6. **New home page**: hero → join card → 2×2 grid (incl. My Library +
   Community) → the 4-step "How it works" grid copied **verbatim** from
   `fireground_trainer/templates/home.html:277-298`. The owner explicitly
   rejected rewriting that copy. Replaces `renderLanding` (`public/index.html`).
   Note: `renderLanding`'s "Host a Session" card still points at `#/library`
   from before the boundary change — item 6 rebuilds this, so it was left alone.

Then Phases 3–5 per `current-focus.md`. Commit per item; push when ready.

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
