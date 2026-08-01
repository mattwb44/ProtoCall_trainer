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
- **`Fireground_trainer-old` Railway project — deleted** by the owner (2026-07-31).
  No longer a pending item.
- **Offsite backup sync** (push nightly snapshots off the Railway volume) is the
  open follow-up on backups — an ops task, not a blocker.

## User-reported bugs — FIXED in Phase 1
- **QR-join "logout" + stuck-at-end.** Root cause was *not* the guest drawer: a
  QR scan opens the join link in a different browser context (no session cookie
  → arrives as guest), and `IMMERSIVE_ROUTES` sets the sidebar to `display:none`
  on join/solo/host — a full-focus choice that never lifted when the session
  ended, so every menu tap hit an invisible sidebar. Fixed with an
  `immersionLifted` flag (set on `session_ended` and when rejoining an ended
  session, re-armed on navigation), an explicit "Done — back to Home" button on
  the ended view, a "you're not signed in" hint on join, and the guest drawer
  dropped to z-10 so it can never sit over the menu.
- **Category-switch objective amnesia** — per-category memory of objective and
  subcategory picks; nothing carries across categories. Verified with the exact
  reported repro (MVA → EMS → MVA restores the pick).

## Recommended next steps (priority order)
Phases 2–5 in `current-focus.md`, in order. Phase 1 is done (approval gate +
sweep, revision loop, bug batch, required-field markers, offsite backups).

Next up is **Phase 2 — structure**: My Library ownership boundary + two tabs,
persisted drafts with "Save as Draft" / "Finish Scenario" + publish step,
session-card badges/alignment/solo progress bar, list/grid toggle + collapsed
mobile filters, and the new home page.

Hold **Track E** until `solo_events` shows repeat solo usage.

Note on test fixtures: scenario creates/edits require `objective_primary` (any
seeded objective, e.g. `'Scene Size-Up'`, is valid for any category). Public
scenarios are no longer instantly visible — use `approvePublic(ctx.db, id)` from
`test/helpers.js` when a test needs a *visible* community scenario.

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
- `public/index.html`: `renderReview` + `renderModeration` and the destination
  selector (`vis-seg`, `draftShares`) — the moderation surfaces. Community
  browse is `renderPublic` (`#/public`). `IMMERSIVE_ROUTES` + `immersionLifted`
  govern whether the sidebar exists on session routes.
- `server/index.js`: `gatedStatus` + `APPROVED_PUBLIC` are the approval gate;
  `canSee` requires approved-and-public for strangers. Review endpoints:
  `submit-review`, `/api/review/queue`, `/api/scenarios/:id/review`.
- `server/db.js`: the one-shot `approval_gate_sweep` migration and the `app_meta`
  flag table that keeps one-shot migrations one-shot.
- Tests: `npm test` (node:test). `test/approval-gate.test.js` covers the gate,
  the sweep's exactly-once guarantee, and the Official-badge workflow it must
  not disturb. Heads-up: the multipart size-cap assertion in
  `test/media-pdf.test.js` has been order/timing-flaky under `@fastify/multipart`
  v10; it passed consistently through Phase 1, but if it fails spuriously that's
  the known offender, not a regression.
