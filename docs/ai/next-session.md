# Next session

_Updated 2026-08-04. Read `current-focus.md` and `decisions.md` first, then
`CONTEXT.md` (glossary) at the repo root._

**Branch: `claude/phase3-live-loop`, tip `37ca872` (host live view `90a18e0` +
its doc commit), off merged `main` (`deafd6b`). Working tree clean, in sync with
`origin`. `npm test` = 122 passing. Pushed to `origin`; NOT merged to `main`.**
Phase 2 merged via PR #1; Phase 1 on `main`.

**Phase 3 (live loop) is COMPLETE** — all three pieces: **schema** (`805ffaa`),
**frontend role-set UI** (`164e954`), **host live view** (`90a18e0`); see below.

**First decision next session:** merge Phase 3 to `main` (branch is a clean
descendant of `main` — PR or fast-forward; it deploys to production), or start
Phase 4 (creation aids) directly. Ask the owner first.

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

## Phase 3 — live loop

**1. Roles-as-sets (schema) — DONE (`805ffaa`).** Questions and participants
each carry a SET of roles; a participant sees a question when either set is
empty or they intersect. New `server/roles.js` holds the semantics
(`parseRoles`/`serializeRoles`/`primaryRole`/`withRoleFields`, `rolesMatch` for
JS and `rolesMatchSql` for the JSON1 EXISTS predicate). New `roles` JSON column
on `questions` + `participants`, one-shot flagged backfill from the legacy
`role_track` (`json_array(role_track)`, guarded by `roles='[]'` so a redeploy
never double-wraps). **`role_track` is kept** as a legacy column, a scalar
mirror in API output (`withRoleFields` → `role_track = roles[0] ?? ''`), and an
input shim (create/join accept either `roles: [...]` or legacy `role_track:
'x'`) — so the **current frontend is untouched and still works** for the
single-role case. Backend accepts/emits `roles` arrays everywhere. 118 tests
pass; `test/live-roles.test.js` gained three set-semantics tests.

**2. Frontend role-set UI — DONE (`164e954`).** The UI now speaks sets. Creator:
per-question **multi-select toggle chips** (`roleSelect` in `public/index.html`,
`data-roletoggle`/`data-role-add`) over `ROLE_CHOICES` + custom. Live join:
multi-select seat picker (`drawRolePicker`, "Join as A + B" / "All roles"; the
saved pick is a JSON array, legacy single-string still honored) → emits `roles`.
Solo: "Play as" multi-select chips → `#/solo/:id?roles=a,b` (legacy `?role=`
still parsed), intersection filtering. All render sites use `roleLabel()`; shared
helpers `rolesArr`/`roleLabel`/`hasRoles`. **Bug fixed in passing:** `GET
/api/scenarios/:id` was returning `roles` as the raw JSON string — now wrapped in
`withRoleFields` so the editor/solo detail get a parsed array. Verified in the
preview (creator chips both selected on a two-role question; join picker toggles;
create→GET round-trip returns arrays). The only frontend `role_track` left is a
comment and one back-compat read fallback (`q.roles ?? q.role_track`).

**3. Host live view = mirror + roster, three layers — DONE (`90a18e0`).**
`renderHost`/`drawHost` + new `drawRoster` in `public/index.html`; server in
`rooms.roster`/`rooms.boot` + the socket layer in `index.js`. Crew mirror (scene
+ dispatch + current-stage questions; official answers in a host-only
`<details>`; room/QR shrunk to a corner card). Named roster: initials-chips with
a presence dot, roles/shift, "N of M done", per-stage completion chips (grey →
amber ring w/ fraction → green ✓; dimmed when a seat has no questions in a
stage), and a boot (user-x) action; a chip row expands to per-question detail
(computed client-side from the responses the host holds). **Boot** sets
`participants.booted_at` — `rooms.join` refuses a booted token (not just the
socket), the booted client gets a `'booted'` screen, and the roster refreshes.
`emitRoster` pushes a fresh roster to the host on join/answer/shift/boot/
disconnect; presence from live sockets (`connectedParticipantIds`). No
auto-advance — the advance button stays manual and says so. Test:
`test/host-roster.test.js`. Verified in the preview: a crew member join/answer
updates the roster live; boot empties it, signals the crew socket, refuses the
dead token.

## Next: Phase 4 — creation aids (or merge Phase 3 first)
Per `current-focus.md`/`decisions.md` → Creation flow UX: hardcoded template
picker (Blank · Quick drill · Standard incident · Full multi-role) +
duplicate-scenario (clone already exists — `/api/scenarios/:id/clone`);
category-scoped detail fields (Vehicle Type multi-select for MVA, match-any
browse filter); top-down map stamp editor (flattened to `image_url` on save).

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
