# Next session

_Updated 2026-08-06. Read `current-focus.md` and `decisions.md` first, then
`CONTEXT.md` (glossary) at the repo root._

**Branch: `claude/phase4-creation-aids`, off merged `main` (`c6d7006`), pushed to
`origin` (NOT merged). Phase 3 (live loop) was merged via PR #2 (merge commit
`c6d7006`) and deployed. Phase 4 (creation aids) is COMPLETE — all three pieces
done and committed: category-scoped detail fields (`ee2b55f`), template picker
(`5f09721`), and the top-down map stamp editor (this session). Duplicate-scenario
already existed.**
`npm test` = 123 passing. Phase 2 merged via PR #1; Phase 1 on `main`.

**Resume here:** the only open decision is whether to merge `claude/phase4-creation-aids`
to `main`. All three pieces are deploy-safe and verified in the preview
individually. No server changes were needed for any of them.

**Phase 3 (live loop) is COMPLETE & MERGED** — schema (`805ffaa`), frontend
role-set UI (`164e954`), host live view (`90a18e0`); all on `main` now.

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

## Phase 4 — creation aids (COMPLETE)
Per `current-focus.md`/`decisions.md` → Creation flow UX. All three pieces done;
branch not yet merged to `main`.
- **Duplicate-scenario — already done** before Phase 4: the scenario detail view's
  "Clone" button (`POST /api/scenarios/:id/clone`) copies any visible scenario to
  My Library. No further work needed.
- **Category-scoped detail fields — DONE.** `vehicle_type` JSON
  column (`server/db.js`); `VEHICLE_TYPES` vocab + `normalizeVehicleType` +
  `taxonomyOf` + create/edit SQL (`server/index.js`, mirrors `building_type`).
  Frontend (`public/index.html`): `DETAIL_FIELD_BY_CAT` drives which detail field
  shows (`toggleDetails`) — building for Fireground, vehicle for MVA, neither for
  EMS; `drawVeh` multi-select; save payload sends only the active field; detail
  view renders vehicle chips; Community browse has a **match-any** Vehicle Type
  chip filter (`st.veh` Set, `syncVeh`) shown only under the MVA category. Server
  stays a permissive vocab validator (category names aren't server-enforced — the
  taxonomy test uses `category:'Fire'` — so scoping lives in the frontend, like
  building_type always has). Test: `test/taxonomy.test.js` (Phase 4 vehicle case).
- **Template picker — DONE.** `SCENARIO_TEMPLATES` + `templatePicker()`
  in `public/index.html`: a "Start from a template" card (Blank · Quick drill ·
  Standard incident · Full multi-role) shown only when creating a new scenario.
  Picking one sets `draftQs` to the template's questions (staged; the full one
  role-tagged so drawQs auto-opens Advanced) and removes the picker. Verified.
- **Map stamp editor — DONE.** `MAP_BASES` (5 hardcoded flat-SVG base maps:
  residential, corner lot, intersection, highway, commercial, all sharing a single
  `0 0 800 600` viewBox) + `MAP_STAMPS` (12 fixed apparatus/vehicle/hazard icons,
  drawn centred on their own origin for rotation) + `openMapEditor()` — all in
  `public/index.html`, entry point is a secondary button ("Or build a top-down
  map") under the media drop zone in "The scene". Full-screen overlay appended to
  `document.body` (same pattern as `openMediaViewer`), not a route, so it doesn't
  disturb `draftQs`/`draftMedia`/`draftBldg`. Pointer Events (not mouse) for
  drag; 15°-step rotate buttons + delete in a floating toolbar on the selected
  stamp (no drag-handle — unreliable on touch); tap-to-place from the palette
  (no drag-from-palette); clear all; no scaling/layers/freehand/undo/re-edit.
  On Insert: clone the live SVG, strip `[data-editor-only]` chrome (the dashed
  selection box), serialize → Blob → Image → draw onto a 1600×1200 canvas (2x for
  crispness, opaque `#e2e8f0` background so there's no transparent PNG), `canvas.
  toBlob('image/png')`, upload via the same `/api/media` POST `uploadImage()`
  uses, then `draftMedia.push({ kind: 'map', url })` + `drawMedia()`. On upload
  failure: toast the error, leave the modal open with placements intact (never
  lose the user's work).
  **No server changes** — confirmed and used as-is: `replaceMedia` already
  whitelists `kind: 'map'` (`server/index.js`), the media `<select>` already
  offers `map`, `mediaStrip`'s `KIND_LABEL` already renders a MAP badge. Server
  media upload already accepts PNG (`server/media.js`) well under
  `MAX_UPLOAD_BYTES`.
  **Doc-wording note:** `decisions.md`'s "flattened to a plain `image_url`" is
  intent ("flattened to a plain image"), not a literal column — `saveScenario`
  never sends `image_url` (legacy, a PUT would blank it); the map rides
  `draftMedia`/the `media` array exactly like an uploaded photo. No `image_url`
  write path was added.
  Verified in the preview (`preview_snapshot`/`preview_inspect`/
  `preview_console_logs`, screenshot taken): opened the editor, switched all 5
  base maps, placed 4+ different stamps, dragged multiple, rotated one past
  180°, deleted one, cleared all and re-placed, Insert map closed the modal with
  a new `#c-media` row (`kind` select = `map`, thumbnail = the rendered scene),
  the scene-reference rail picked it up as the first media item, saved the
  scenario, reopened it from My Library, and confirmed the map persists and
  renders in the scenario detail's media strip. Zero console errors throughout.
  Re-verified at a 375px mobile viewport: canvas scales, palette scrolls, tap-
  to-place/drag/rotate all work. `npm test` stayed at 123 passing (no server
  change).

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
