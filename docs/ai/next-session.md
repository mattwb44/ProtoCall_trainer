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
- **Track C — objectives (complete, all 3 slices).**
  - *Per-question grain:* `questions.objective` (immutable name, '' inherits
    primary); scenario detail returns the `objectives` union; coverage counts
    the union; creator has a per-question objective picker in "Advanced"; A2
    reveal frames the union.
  - *Suggester:* `server/objectives-suggest.js` keyword corpus +
    `POST /api/objectives/suggest` (auth, category-scoped, explainable);
    "Suggest objectives from the scene" button → click-to-apply chips.
  - *Enforcement:* a primary objective is required at creation and on author
    edits (server: POST + author PUT; reviewer edits exempt). Client blocks the
    save with a nudge toward the suggester. The fixture sweep is done — ~10 test
    files now pass a default `objective_primary` on their scenario creates/edits.

## In progress / pending a decision
- **`Fireground_trainer-old` Railway project** is a broken (502, crash-looping)
  husk with only demo data. Awaiting owner go-ahead to **delete it** (irreversible).
- **Offsite backup sync** (push nightly snapshots off the Railway volume) is the
  open follow-up on backups — an ops task, not a blocker.

## Recommended next steps (priority order)
1. **Track D — community moderation.** Decisions are settled (see `decisions.md`
   → Community + admin model), so this can run without a pause.

   **Read this before starting — Track D is NOT greenfield.** The queue UI
   already exists; do not rebuild it:
   - `#/review` (`renderReview`, `public/index.html:2673`) — a working reviewer
     queue with **Approve / Approve as Official / Request changes**, backed by
     `GET /api/review/queue` and `POST /api/scenarios/:id/review`
     (`server/index.js:686,702`). Nav item is role-gated (`chiefOrAdmin`).
   - `#/moderation` (`renderModeration`, `public/index.html:2712`) — a
     `site_admin` page for **content reports** + **department verification**
     (`/api/moderation/reports`, `/api/moderation/departments`).
   - `POST /api/scenarios/:id/submit-review` (`server/index.js:673`) already
     moves a scenario to `review_status='pending'`.

   **The actual gap (this is the work):** community visibility is *not gated on
   approval*. Both browse queries filter on `shared_public=1` only
   (`/api/scenarios` `server/index.js:533`, `/api/public/scenarios:549`), so a
   scenario shared to Community shows in the public library **instantly**. The
   `pending` flow is a *separate, author-initiated* path that today only grants
   the Official badge — it does not gate visibility. That contradicts the
   settled decision (`decisions.md` → Community: *"submitted to Community enter
   `pending`… only approved + public show in community browse"*).

   **Proposed slices (verify against the decision, then build):**
   1. *Gate on approval.* Sharing to Community should set `review_status='pending'`
      (not instantly public), and the two community browse queries should require
      an approved state, so pending community scenarios are hidden from browse
      until a moderator approves. Author still sees their own (the `OR author_id`
      branch). Keep department + private paths unchanged.
   2. *Reject with reason → author revision loop.* `request_changes` already
      writes `review_note` + `changes_requested`; surface it to the author (the
      CHANGES badge exists at `public/index.html:288`) and let them resubmit.
   3. *Tests + headless verify* the gate: shared-to-community is invisible in
      `/api/public/scenarios` until approved; approve makes it appear; reject
      routes the note back.

   `site_admin` is env-only (no promotion UI — see `decisions.md`); `dept_admin`
   already scopes the queue to their own department (`server/index.js:689-691`).
2. Hold **Track E** until `solo_events` shows repeat solo usage.

Note on test fixtures: scenario creates/edits now require `objective_primary`.
New tests should pass one (any seeded objective, e.g. `'Scene Size-Up'`, is valid
for any category). Consider extracting a shared `scenarioBody` helper if the
inline fixtures keep multiplying.

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
- `public/index.html`: `renderReview` (`:2673`) + `renderModeration` (`:2712`)
  and the destination selector (`vis-seg`, `draftShares`, `:802-826`) — the
  Track D surfaces. Community browse is `renderPublic` (`#/public`, `:1846`).
- `server/index.js`: the review/moderation endpoints (`submit-review`,
  `/api/review/queue`, `/api/scenarios/:id/review`, `:673-723`); the community
  browse queries that need the approval gate (`:526-550`).
- Tests: `npm test` (node:test, **86 tests, 85 green**). Heads-up: the multipart
  size-cap assertion in `test/media-pdf.test.js` is order/timing-flaky under
  `@fastify/multipart` v10 — it was already flaky on the baseline before this
  work, is unrelated to app logic, and is the one non-passing test; pin it down
  before it masks a real regression.
