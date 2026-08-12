# Next session

_Updated 2026-08-11. Read `current-focus.md` and `decisions.md` first if you
need feature-track background — as of this update, active work is the
**ops-hardening execution plan** at `docs/execution-plan.md`, not the phase
tracks described in those two files (which are all shipped/merged)._

`npm test` = 127 passing, all on `main`, CI green.

## Resume here: one thing

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
P1 (pre-beta) progress: PR 1–6 done (`[x]`), including PR 6's prod
verification (induced `/__test-error`, alert email confirmed, route
removed). P2+ (PR 7–12) not started. Full checklist is in the doc; don't
duplicate it here — this file only tracks what's *different* from the
doc's own checkboxes (nothing right now; PR 3's checkbox was fixed this
session to
match its already-merged state).

## Recent history (this session)
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
