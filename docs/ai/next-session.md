# Next session

_Updated 2026-07-22. Read `current-focus.md` and `decisions.md` first._

## Completed (earlier session)
- **Domain cutover:** `protocalltrainer.com` now serves ProtoCall (was the old
  fireground app). `APP_URL` fixed to the real domain. Old fireground service
  stopped.
- **Track 0 + A1 shipped and live** (commit `bd43edf` on `main`, deployed):
  - Solo: dropped punitive stage lock (earlier stages editable), always-available
    Exit button (confirm only if answers exist).
  - `VOICE.md` — the de-AI'd copy voice for this app.
  - `solo_events` table + start/finish logging (the funnel for Track E gating).
- **Docs:** `docs/ai/` established; `HANDOFF.md` retired (pointer only).

## Shipped this session
- **Three batched arch decisions** (see `decisions.md`): objectives immutable
  (create-only), `site_admin` env-bootstrapped only (no in-app promotion),
  in-app nightly `db.backup()` to `$BACKUP_DIR` (rotating `BACKUP_KEEP`=14,
  `server/backup.js`, 3 tests; on-demand `GET /api/admin/backup` is the offsite pull).
- **A2 — unified After-Action reveal.** Guests and signed-in players land on the
  same stateless reveal (no auto-save-teleport): objectives frame, your answer
  vs. official (open by default), explicit deferred save ("Save to Runs
  Completed"/"Discard" signed-in; "Save — Sign in" guest, stashed + replayed
  after signup), simple same-category Next. `finished` funnel event logged once,
  at solo-reveal. All in `renderSolo`/`soloReveal` + one server touch.
- **Track B — creation flow.** Scene-first ordering; sticky scene reference
  (desktop rail `#scene-rail` / mobile peek `#scene-peek`, dispatch-only when no
  image); progressive disclosure (per-question "Advanced" stage/role, collapsed
  by default); dismissible tutorial (`localStorage.pcCreateTutorialDismissed`);
  destination selector ("Destination" / "Community" / "Create scenario" ·
  "Save changes"). Save payload + element IDs unchanged, so server tests untouched.
  Both verified end-to-end in a headless browser.
- **Track C — objectives (2 of 3 slices).**
  - *Per-question grain:* `questions.objective` (immutable name, '' inherits
    primary); scenario detail returns the `objectives` union; coverage counts
    the union; creator has a per-question objective picker in "Advanced"; A2
    reveal frames the union. 3 tests.
  - *Suggester:* `server/objectives-suggest.js` keyword corpus +
    `POST /api/objectives/suggest` (auth, category-scoped, explainable);
    "Suggest objectives from the scene" button → click-to-apply chips. 4 tests.
  - *Deferred (slice 3):* create-time enforcement of the scenario primary. The
    one-line server guard is trivial, but ~40 existing tests build scenarios
    with no primary — do it with a test-fixture sweep (introduce a shared
    `scenarioBody` helper in `test/helpers.js` and thread a default objective).

## In progress / pending a decision
- **`Fireground_trainer-old` Railway project** is a broken (502, crash-looping)
  husk with only demo data. Awaiting owner go-ahead to **delete it** (irreversible).
- **Offsite backup sync** (push nightly snapshots off the Railway volume) is the
  open follow-up on backups — an ops task, not a blocker.

## Recommended next steps (priority order)
1. **Finish Track C — enforce the scenario primary at creation** (POST + author
   PUT: `if (!t.objective_primary) 400`). Blocked only by test fixtures: add a
   shared `scenarioBody` helper with a default `objective_primary` and sweep the
   ~40 create sites, then flip the guard on. The suggester makes tagging one click.
2. **Track D — community moderation.** Approval queue UI over the existing
   `pending` review workflow; `site_admin` is env-only (no promotion UI).
3. Hold **Track E** until `solo_events` shows repeat solo usage.

## Key files to review first
- `public/index.html`: `renderSolo` + `soloReveal` (A2 unified reveal +
  `saveSoloRun`); `renderCreator` + `drawQs`/`drawSceneRef`/`creationTutorial` +
  the objective suggester (`#c-obj-suggest`) and per-question `objectiveSelect`
  (Track B + C). Single-file vanilla-JS frontend, hash routing.
- `server/index.js`: solo endpoints; `/api/objectives` (immutable, create-only),
  `/api/objectives/suggest`, `taxonomyOf` + `questionObjectiveError` validation;
  `/api/coverage` and `/api/scenarios/:id` compute the objective union.
- `server/objectives-suggest.js`: the keyword corpus + `suggestObjectives`.
- `server/db.js`: schema + idempotent `addColumn` migrations; `solo_events`
  table near the bottom of the `CREATE TABLE` block; `learning_objectives`
  (immutable — see the comment there).
- `server/rooms.js`: live/solo session logic (`revealedAnswers`, stages).
- `server/backup.js`: nightly on-volume DB snapshots + rotation, started from
  `buildServer` (skipped for the in-memory test DB; `backup:false` disables).
- `VOICE.md`: write user-facing copy to this voice.
- Tests: `npm test` (node:test, currently 85 green). Heads-up: the multipart
  size-cap assertion in `test/media-pdf.test.js` is order/timing-flaky under
  `@fastify/multipart` v10 — unrelated to app logic; pin it down before it masks
  a real regression.
