# Next session

_Updated 2026-08-17. Read `current-focus.md` and `decisions.md` first. The
ops-hardening execution plan (`docs/execution-plan.md`) is complete; active work
is now the **UX / polish backlog** at `docs/ai/ux-backlog.md` (grill 2026-08-16)._

`npm test` = 141 passing, all on `main`, CI green.

## Resume here

**0. UX / polish backlog (grill 2026-08-16) — `docs/ai/ux-backlog.md`.** 25 items
in phases A–D + future stubs; owner-decided forks recorded in `decisions.md`.

**Phase A — DONE & DEPLOYED** (commit `7098b1e` on `main`, 141/141 tests pass).
All six items shipped: A1 host crew-mirror (`drawMatrix` rewrite — numbered Qs,
host-only answers, N/total counter), A2 presence header, A3 ended-session review
(auto-save + Return to Homepage + Discard), A4 ended-session lock
(`advance_stage`/`submit_response` guards + `rooms.advanceStage` status check),
A5 finished-session sweep (flag `finished_sessions_swept_v1`, age-guarded), A6
map-editor Back guard. **Owner is spot-checking a live hosted session + the map
Back guard on the deploy** — the two paths not exercisable headlessly.

**Phase B — DONE (uncommitted working tree as of 2026-08-17).** B2 Sort By +
B5 clone toast/Cloned tag shipped in `e3acc23`. B1/B3/B4 now implemented in
`public/index.html` (client-only, 141/141 tests still pass, verified live in the
browser preview): B1 multi-select category strip + synced nested subcategory
checkbox tree in the filter box (`catStrip`/`updateCatStrip`/`toggleCat`/
`catTreeHtml`; `st.cats`/`st.subs` Sets keyed `"Cat::Sub"`, union semantics in
both `renderLibrary` and `renderPublic` `visible()`), B3 Reset Filters
(`[data-reset]`, per-view `resetFilters()`), B4 desktop compact filter dropdown
(`filterRail`/`bindFilterRail`, replaced the old always-on `filterPanel` rail,
now removed). **Not yet committed — commit when the owner has eyeballed it.**
Next after commit: **Phase C** (scenario-creator polish) — see `ux-backlog.md`.

**1. Open bug report — Railway deploy crash (not yet diagnosed).**
User reports "Railway always crashes with a new deployment." Missing
`MEDIA_DIR`/`DB_PATH` (the PR 3 boot guard) was the first hypothesis —
**ruled out**, user confirmed `MEDIA_DIR=/data/media` is set on Railway.
Static review of `server/db.js` (migrations, all idempotent `addColumn`
calls), `server/media.js` (`createMediaStore`, looks safe), and
`server/analysis.js` (`ANTHROPIC_API_KEY` missing → returns `null`, not
fatal) turned up nothing. **Next step: get actual Railway deploy-log output
from the user** (Deployments tab → failing deploy → logs) — need to know
whether it dies during build or after start, and whether the boot-guard
`FATAL:` message appears, a stack trace, or a healthcheck timeout. No
further static-analysis guessing without that.

## Execution plan status (`docs/execution-plan.md`)
P1 (pre-beta) done: PR 1–6. P2: PR 7 (optimistic concurrency, server+client),
PR 8 (backup-freshness alert), PR 9 (response dedupe), and the moderation-
consistency fix are all merged/implemented. **Remaining before the 50-user
gate: PR 11 (runbooks — `docs/runbooks.md`) and the Opus final authorization
sweep.** A few checklist items are prod-verification gated (e.g. PR 9's
"migration ran clean in prod (check logs)" — verify on the next deploy).

**Resume here — PR 11 (runbooks).** Sonnet task, prompt in the plan: write
`docs/runbooks.md` (deploy, migration deploy, rollback, missing-data,
outage/restore) with exact commands. Docs only. Then the Opus final review
(inspect-only authorization sweep of every mutating route + socket handler).

## Recent history
- **PR 9 (2026-08-15) — live response dedupe**: implemented, verified (140/140,
  fresh-context verifier CONFIRMED). Flag-guarded one-shot in `server/db.js`
  `migrate()` (`app_meta` `responses_dedupe`) collapses duplicate responses per
  `(session_id, participant_id, question_id)` — keep the `is_pushed=1` row if
  any, else earliest (`ROW_NUMBER() ... ORDER BY is_pushed DESC, submitted_at
  ASC, rowid ASC`) — then a `CREATE UNIQUE INDEX IF NOT EXISTS
  ux_responses_session_participant_question` (idempotent, runs every boot,
  outside the flag guard; the DELETE is inside it and must precede the index).
  `server/rooms.js` `submitResponse` → `INSERT OR IGNORE`, returns the existing
  row on collision so a socket double-fire acks normally. Re-answering confirmed
  *not* a feature (client locks the track at `public/index.html:2324`; solo REST
  already 409s at `server/index.js:1246`). Tests: `test/response-dedupe.test.js`
  (seeded-dupes migration + double-submit-one-row). See `decisions.md` → Live
  sessions.
- **PR 7 (server side) — optimistic concurrency**: implemented, tested
  (133/133). Added a `rev INTEGER NOT NULL DEFAULT 0` column to `scenarios`
  (`server/db.js` `migrate()`, `addColumn` pattern). Scenario PUT
  (`server/index.js` ~1009) now checks: if the body carries `rev` and it
  `!== s.rev`, reply **409 `{error, current_rev}`** before doing any work;
  a versionless body skips the check (back-compat for old cached pages and
  existing tests). The check sits ahead of the transaction, which bumps
  `rev=rev+1` inside the same UPDATE. `rev` is returned by POST (`{id, rev:0}`),
  PUT (`{id, rev: s.rev+1}`), and GET `/api/scenarios/:id` (already via
  `SELECT s.*`). Reviewer edits (`asReviewer` path) are version-checked too —
  the check is above the reviewer/draft branching. `test/optimistic-concurrency.test.js`
  covers stale→409, fresh→200, versionless→200, reviewer-collision→409.
  **Client contract for the follow-up PR:** capture `rev` from every
  POST/PUT/GET response into editor state; send it in PUT bodies; on 409, show
  the banner and keep the form (the user can reload to pick up `current_rev`).
- **PR 6 — error alerting**: implemented, tested (128/128), committed.
  Fastify `setErrorHandler` reports fire-and-forget (own try/catch, never
  passed `request` so bodies/cookies can't leak) via new `mailer.sendAlert`,
  throttled to one email per distinct error message per hour (in-memory Map),
  gated on `ERROR_ALERT_EMAIL`. `unhandledRejection`/`uncaughtException` wired
  once at module scope (not per `buildServer()` call, to avoid listener
  buildup across tests); `uncaughtException` also exits the process after
  reporting. `test/error-alert.test.js` injects a throwing reporter and
  confirms the response is unaffected. Prod verification (an induced 500
  actually reaching an inbox) is still outstanding — see status note below.
- **PR 5 — editor autosave + dirty warning**: implemented, tested (127/127),
  merged via PR #5. Debounced 10s autosave for new/draft scenarios only;
  never auto-PUTs a published scenario or a reviewer's edit of someone
  else's draft; `beforeunload`/`pagehide` warn on any unsaved change.
  Verified live: Safari hard-kill-tab test passed, autosave recovered the
  draft.
- **Follow-up UX fix** (commit `c0742f5`): moved the autosave status chip
  from below the save buttons into a sticky header bar next to the
  Scenario Creator/Edit Scenario `<h1>`, so it stays visible while scrolling
  instead of only flashing near the bottom.
- **PR 3 checkbox fixed**: was merged (`efdf11c`) but never checked off in
  the execution plan; corrected this session.

## Key files (ops-hardening track)
- `docs/execution-plan.md` — the actual current plan/checklist. Read this,
  not the phase-track docs, for "what's next."
- `server/index.js` — Railway boot guard (`railwayBootError`, ~line 1586);
  scenario POST/PUT reconcile-by-id logic (~933–1055).
- `public/index.html` — editor autosave state/logic sits just above
  `saveScenario()`; sticky status chip is inside `renderCreator`'s header.
- `test/drafts.test.js` — draft/publish contract tests, extended this
  session for autosave idempotency.
