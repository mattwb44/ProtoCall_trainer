# Current focus

**Milestone: UX / polish backlog (grill 2026-08-16).** The 50-user ops-readiness
plan (`docs/execution-plan.md`) is complete. Active work is the owner UX backlog
captured in `docs/ai/ux-backlog.md` — 25 items in phases A–D + future stubs.
**Progress as of 2026-08-21:** Phase A (live-session correctness) and Phase B
(library/filter UX) are DONE & committed on `main`; a shell/access rework
(guest scenario creation, collapsible sidebar, left filter drawer) also landed.
**Phase C (scenario-creator polish) COMPLETE — committed & pushed** (`f82407f`).
**Now in Phase D:** D1 v1 (`d932881`), D2 (`929d136`), D1 v2 (`68cb885`) + two
docs commits are all committed — **5 commits ahead of `origin/main`, none pushed.**
**D1 v3 (markup editor rework — on-canvas text handles, edit/move gesture split,
freehand radius eraser, morphing per-tool size dots, Marker→Highlighter rename +
boot migration, drawing-over-label fix, three color palettes) is BUILT + verified
(143/143) but UNCOMMITTED in the working tree.** Remaining: commit D1 v3 + push to
deploy, then Phase E (E1 credit byline, E2 clone→original link) or the Fire & Smoke
tools (plan-only, `docs/prd-fire-smoke-tools.md`); D3 parked. See
`docs/ai/next-session.md` for the resume point. Forks decided; see `decisions.md`.

---

**Prior milestone: post-grill build-out (Phases 1–5).**

Tracks 0/A/B/C shipped. A grilling session on 2026-07-31 turned the owner's
backlog into settled decisions (see `decisions.md` and `CONTEXT.md`); this is
the agreed build order for them.

## Phases (dependency order)
- **Phase 1 — protect real users. DONE** (`87ebeaa`, merged to `main` in
  `576022f`). Track D approval gate + pending sweep + reject/revision loop; the
  diagnosed bug batch (session-end immersion trap, ended-view exit, join
  sign-in hint, category-switch objective amnesia); required-field indicators;
  offsite backup sync.
- **Phase 2 — structure. DONE** (branch `claude/phase2-structure`, all six
  items shipped and pushed; not yet merged to `main`).
  - **(1/6) DONE** (`86515a4`): `?scope=mine` ownership boundary on
    `/api/scenarios`.
  - **(2/6) DONE** (`ef1998d`): My Library is now an owner-only two-tab area
    (My Scenarios / My Sessions), the separate My Sessions nav item is gone
    (`#/me` → `#/library/sessions`), and Community gained a Department scope
    toggle (`?scope=department`) so department-shared-by-others scenarios stay
    launchable.
  - **(3/6) DONE** (`1100829`): persisted drafts. New `is_draft` column;
    two-button save ("Save as Draft" / "Finish Scenario" → publish step);
    drafts are owner-only, unshared, unplayable, validation-deferred, and never
    demote a published scenario. My Scenarios has a Published / Drafts bucket
    toggle.
  - **(4/6) DONE** (`7bdc1c0`): session cards — IN PROGRESS / COMPLETED and
    SOLO / HOSTED / JOINED badges in a fixed right column; thin questions-
    answered bar on in-progress solo runs only (`q_total`/`q_answered` on
    `/api/me/sessions`, role-track accurate).
  - **(5/6) DONE** (`15b5001`): browse UI — list/grid toggle (localStorage
    `pcBrowseView`, shared across My Library + Community), mobile "Filters · N"
    bottom sheet (category tabs stay visible), Review & Edit button at standard
    height.
  - **(6/6) DONE** (`e254318`): new home page — hero → join card → 2×2 action
    grid (Host / Build / My Library / Community) → verbatim 4-step "How it
    works" ported from the old fireground home.
- **Phase 3 — live loop. DONE & MERGED** (PR #2 → `main`, merge commit `c6d7006`,
  deployed via Railway). Roles-as-sets with intersection matching, then the host
  live view.
  - **(schema) DONE** (`805ffaa`): questions and participants each carry a SET
    of roles (`roles` JSON column); a participant sees a question when either
    set is empty or they intersect. New `server/roles.js` (parse/serialize/
    match + JSON1 SQL predicate); `role_track` kept as a legacy column + scalar
    mirror + input shim so the **current frontend is unchanged and still
    works** (single role per question/participant). 118 tests pass.
  - **(frontend) DONE** (`164e954`): role *sets* exposed everywhere — creator
    per-question multi-select chips (+ custom), live-join multi-role picker
    ("Join as A + B" / "All roles"), solo "Play as" multi-select (`?roles=a,b`),
    and all render sites show the full set via `roleLabel()`. Also fixed a gap:
    `GET /api/scenarios/:id` now decorates questions with `withRoleFields` so
    `roles` arrives as a parsed array (the editor/solo detail read from it).
    Verified in the browser preview (creator chips, join picker, round-trip).
  - **(host live view) DONE** (`90a18e0`): `renderHost`/`drawHost` + new
    `drawRoster` — crew mirror (scene + dispatch + current-stage questions,
    official answers in a host-only `<details>`), named roster with presence +
    boot, per-stage completion chips (grey → amber fraction → green) measured by
    role intersection, per-participant expand. Server: `rooms.roster`/`rooms.boot`,
    `participants.booted_at`, `boot_participant` socket event, `emitRoster` on
    join/answer/shift/boot/disconnect. No auto-advance. Verified in preview.
- **Phase 4 — creation aids. DONE** (branch `claude/phase4-creation-aids`
  off merged `main`; not yet merged). Duplicate-scenario already existed (the
  detail-view "Clone" button copies any visible scenario to My Library). All
  three remaining pieces (template picker, category-scoped detail fields,
  top-down map stamp editor) are built and committed.
  - **(detail fields) DONE:** category-scoped detail fields. Each category shows
    one detail field — building type for Fireground, **Vehicle Type** for MVA,
    neither for EMS (`DETAIL_FIELD_BY_CAT`). Vehicle Type is a fixed additive-only
    15-item multi-select (`vehicle_type` JSON column + `VEHICLE_TYPES` vocab +
    `normalizeVehicleType`, mirroring `building_type`); rendered as chips in the
    scenario detail; Community browse gained a **match-any** Vehicle Type filter
    that only appears under the MVA category. Building type is now Fireground-only
    (was: any non-EMS). 123 tests pass.
  - **(templates) DONE:** hardcoded "Start from a template" picker (Blank ·
    Quick drill · Standard incident · Full multi-role) shown only on new
    scenarios; seeds draft structure (staged, role-tagged placeholder questions)
    into the creator form and retires itself. `SCENARIO_TEMPLATES` +
    `templatePicker()` in `public/index.html`.
  - **(map editor) DONE:** top-down stamp editor. `MAP_BASES` (5 hardcoded flat-SVG
    scenes: residential, corner lot, intersection, highway, commercial) +
    `MAP_STAMPS` (12 fixed apparatus/vehicle/hazard icons) + `openMapEditor()` in
    `public/index.html`, opened from a secondary button under the media drop zone
    in "The scene". Pointer-events drag, 15°-step rotate buttons, delete, clear
    all — no scaling/layers/freehand. On Insert, the live SVG is cloned (editor
    chrome stripped), rasterized to a 1600×1200 PNG via an offscreen canvas, and
    uploaded through the existing `POST /api/media` — then pushed into
    `draftMedia` as `{ kind: 'map', url }`, identical to an uploaded photo.
    **No server changes** — `replaceMedia`, the media `<select>`, and
    `mediaStrip`'s `KIND_LABEL` already handled `kind: 'map'`. Note:
    `decisions.md`'s "flattened to a plain `image_url`" phrasing is intent, not a
    literal column — `saveScenario` never sends `image_url` (legacy field; a PUT
    would blank it), so the map rides the `media` array like every other image.
    123 tests pass (no server change, none expected). Verified in the preview:
    all 5 bases, 4+ stamps placed/dragged/rotated past 180°/deleted, clear-all +
    re-place, Insert → shows in `#c-media` as kind=map with a rendered thumbnail,
    scene-reference rail picks it up, persists through save → My Library →
    scenario detail media strip; zero console errors; works at 375px mobile.
- **Phase 5 — onboarding.** Spotlight tour engine + first-login tour only
  (deliberately after Phase 2 layouts settle).

## Parked / gated
- **Lobby mini-game** — parked; revisit only if dead waits persist after the
  Phase 3 host view.
- **Track E (study library)** — gated on `solo_events` showing repeat usage;
  design lens is competence feedback, never rewards.
