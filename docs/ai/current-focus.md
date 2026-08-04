# Current focus

**Milestone: post-grill build-out (Phases 1–5).**

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
- **Phase 3 — live loop. ← in progress.** Roles-as-sets with intersection
  matching (schema first), then the host live view (crew mirror + roster +
  completion chips + boot). Branch `claude/phase3-live-loop` off merged `main`.
  - **(schema) DONE** (`805ffaa`): questions and participants each carry a SET
    of roles (`roles` JSON column); a participant sees a question when either
    set is empty or they intersect. New `server/roles.js` (parse/serialize/
    match + JSON1 SQL predicate); `role_track` kept as a legacy column + scalar
    mirror + input shim so the **current frontend is unchanged and still
    works** (single role per question/participant). 118 tests pass.
  - **(frontend) TODO:** expose role *sets* in the creator (per-question) and
    at join (participant multi-role pick); today the UI still speaks single
    `role_track` through the shim. `public/index.html` role sites: creator
    `drawQs` (~1141), participant join `renderJoin` (~1487), solo role pick
    (~2374/2445/2584).
  - **(host live view) TODO:** mirror + roster + completion chips + boot
    (`renderHost` in `public/index.html`, `server/rooms.js`).
- **Phase 4 — creation aids.** Hardcoded templates + duplicate-scenario;
  category-scoped detail fields (Vehicle Type multi-select for MVA); top-down
  map stamp editor (flattened on save).
- **Phase 5 — onboarding.** Spotlight tour engine + first-login tour only
  (deliberately after Phase 2 layouts settle).

## Parked / gated
- **Lobby mini-game** — parked; revisit only if dead waits persist after the
  Phase 3 host view.
- **Track E (study library)** — gated on `solo_events` showing repeat usage;
  design lens is competence feedback, never rewards.
