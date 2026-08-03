# Next session

_Updated 2026-08-03. Read `current-focus.md` and `decisions.md` first, then
`CONTEXT.md` (glossary) at the repo root._

**Branch: `claude/phase2-structure`, HEAD `e254318`, pushed. NOT merged to
`main`.** Working tree clean. `npm test` = 115 passing. **Phase 1 is merged to
`main`** (`576022f`) — the approval gate is deployed once `main` ships.

## Where we are
Tracks 0 / A1 / A2 / B / C shipped earlier (details in `decisions.md`). A
grilling session on 2026-07-31 turned the owner's backlog into settled
decisions and a five-phase build order (`current-focus.md`).

**Phase 2 (structure) is complete** — all six items on `claude/phase2-structure`,
per-commit detail in `current-focus.md`. In short: `?scope=mine` ownership
boundary; My Library as an owner-only two-tab area (My Scenarios / My Sessions)
with the Community Department scope; persisted drafts (`is_draft`, two-button
Save-as-Draft / Finish → publish); session-card badges + solo progress bar;
list/grid toggle + mobile filter sheet; the new home page. Tests:
`library-scope`, `drafts`, plus additions to `departments` and `solo`.

**Decisions worth remembering (may surprise a fresh session):**
- `#/me` now redirects to `#/library/sessions`; My Library is login-gated.
- Drafts are unshared/unplayable and validation-deferred; a published scenario
  is never demoted to draft (server ignores a stray `draft:true` on it).
- Browse view is one shared `localStorage.pcBrowseView` across both pages.
- Home tiles "Host a Session" and "My Library" both point at `#/library` (no
  separate host route) — trivially redirectable if the owner wants otherwise.

## Next up: Phase 3 — live loop
Per `current-focus.md` and `decisions.md` → "Live sessions":
1. **Roles-as-sets with intersection matching (schema first).** A question
   carries a set of roles, a participant carries a set; a participant sees a
   question if either set is empty or they intersect. Today `role_track` is a
   single string (see `trackQuestions` in `server/index.js` and `role_track` on
   `questions`/`participants` in `server/db.js`). Migrate to sets, keep custom
   free-text roles.
2. **Host live view = mirror + roster, three layers** (`renderHost` in
   `public/index.html`, `server/rooms.js`): crew-mirror (scene + dispatch +
   current-stage questions, official answers host-only collapsed), named roster
   with **boot** (invalidate the participant token, not just the socket), and
   per-stage completion chips measured against each participant's visible
   questions (role intersection) — "N of M done", tap to expand. No
   auto-advance, ever.

If merging Phase 2 first: it's a clean branch off `main`; open a PR or
fast-forward. Commit per sub-step; push when ready.

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
  `renderLibrary` (My Library, two tabs) + `renderMe` (sessions tab) share
  `myLibraryShell`; `renderPublic` (community browse, scope + view toggles);
  `renderHost` (Phase 3 starting point) + `renderJoin`; `renderCreator` +
  `drawQs`/`drawSceneRef`; `renderSolo`/`soloReveal`;
  `renderReview`/`renderModeration`; `IMMERSIVE_ROUTES` + `immersionLifted`.
  Shared browse helpers: `scenarioCard`/`scenarioRow`/`viewToggle`/`filterSheet`.
- `server/index.js` — `gatedStatus` + `APPROVED_PUBLIC` (the gate), `canSee`,
  browse queries, review endpoints, objectives + suggester + validation.
- `server/db.js` — schema, idempotent `addColumn` migrations, the `app_meta`
  flag table and the one-shot `approval_gate_sweep`.
- `server/rooms.js` — live/solo session logic. `server/backup.js` +
  `server/offsite.js` — nightly snapshots and their offsite replication.
- `VOICE.md` — write all user-facing copy to this voice.
- Tests: `npm test` (node:test). `test/approval-gate.test.js` is the Phase 1
  contract, including the Official-badge workflow the gate must not disturb.
