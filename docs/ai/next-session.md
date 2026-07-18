# Next session

_Updated 2026-07-15. Read `current-focus.md` and `decisions.md` first._

## Completed (2026-07-15)
- **Track C (slice 2) — per-question objective grain + enforced tagging** shipped.
  Migration adds `questions.objective` (blank inherits the scenario primary).
  Scenario detail now returns `objectives` = the union (primary first). Editor
  gets a per-question objective select in the advanced cluster (relabelled
  "Per-question stage · role · objective"); saveScenario forwards it. Enforcement:
  a primary objective is required when a scenario is shared (public/department) or
  submitted for review — **a refinement of the "enforced at creation" decision**
  (private drafts stay exempt; see `decisions.md`). Enforced in POST/PUT +
  submit-review, guarded in the creator before save; clone copies per-question
  objectives + scenario objectives. ~10 test fixtures updated to tag their shared
  scenarios; 2 new taxonomy tests. Full suite 84 (1 pre-existing media size-cap
  flake, unrelated — flakes identically on the clean tree). **Track C complete.**
- **Track C (slice 1) — objective keyword suggester** shipped. New
  `server/objectives.js`: a rule-based, local, explainable suggester blending a
  hand-curated seed (`SEED_KEYWORDS`, one entry per learning objective) with a
  corpus-learned model (`buildCorpusModel` — smoothed log-odds over tagged
  public scenarios, cached 60s). Endpoint `POST /api/objectives/suggest`
  ({category, text} → ranked {name, score, matched[]}). Creator has a "Suggest
  objectives" button under the objective dropdowns that reads the draft
  (title + dispatch + question prompts + instructor answers) and renders
  tappable chips showing the matched words; tapping fills primary (then
  secondary). 7 unit tests in `test/objectives.test.js`; full suite 82 green.
  Verified API + UI in a browser. **Still open on Track C:** per-question
  objective grain (DB migration) + enforced tagging at creation, and storing
  suggested/accepted per `decisions.md`.
- **Track A — A2 unified After-Action reveal** shipped (`public/index.html`):
  both guest and signed-in players now land on the same stateless reveal
  (`soloReveal`) — the silent auto-save-and-teleport for signed-in users is
  gone. Save is explicit + deferred ("Save to Runs Completed" / "Discard";
  guest gets "Save — Sign in"), persisting via the existing
  `/api/solo/runs` + `/answers` endpoints only on click. Official answers open
  by default (`officialDrop(body, open)`), the scenario's objectives frame the
  debrief, and a non-personalized "Next call" pulls another public scenario in
  the same category (`/api/public/scenarios?category=`). No server change.
  Verified both auth paths end-to-end in a browser. **Track A complete.**
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
- **`Fireground_trainer-old` Railway project deleted** by the owner. The
  fireground decommission is now complete — ProtoCall is the only live service.

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
- **Admin model** for Track D: is admin just the owner (seed from
  `SITE_ADMIN_EMAIL`), or promotable from the UI? Not yet decided.

## Recommended next steps (priority order)
1. **Track D — community moderation** (see `decisions.md` → Community): approval
   queue exists (`submit-review` → pending → admin approve/reject; only approved
   + public show in community browse). Confirm the browse/query actually gates on
   approval, and resolve the open **admin model** question below. Optionally, the
   Track C follow-up: persist suggested/accepted objectives from the suggester.
2. **Track D — community moderation** (approval queue is largely in place; see
   the admin-model open question above). Hold **Track E** until `solo_events`
   shows repeat solo usage.

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
