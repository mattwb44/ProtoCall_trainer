# ProtoCall Trainer — 50+ User Execution Plan

**How to use this doc:** Work top to bottom. Each task says which model runs it
(Opus 4.8 for risky/design-heavy work, Sonnet 5 for well-scoped implementation)
and has a ready-to-paste prompt in the [Prompts](#prompts) section. Tick the
checkbox when the Definition of Done is met — not before. Record completed
verifications in `docs/ops-log.md`.

**To run any task:** start a Claude Code session on this repo, pick the model
named for the task, and paste its prompt. Every prompt tells the model to read
this file and the audit context it needs. One task per session; merge and
deploy before starting the next.

**Status:** P0 complete (2026-08-10, see `docs/ops-log.md`). Currently executing P1.

---

## The goal, in plain English

"Ready for 50+ users" means:

- **Work is not lost.** An instructor never loses more than ~10s of typing —
  refresh, deploy, dead battery, or double-click.
- **Data stays private.** No user can reach another user's drafts, scenarios,
  sessions, or debriefs by changing an ID.
- **Deploys never destroy data.** DB on a verified persistent volume; a bad
  deploy leaves the old version serving.
- **Failures are visible fast.** Downtime, save errors, and stale backups
  reach the operator within minutes.
- **Backups are proven.** A restore has been rehearsed, not assumed.
- **Shipping is boring.** CI on every push; deploys follow a checklist with
  one-click rollback.

---

## P0 — Before any external users ✅ COMPLETE

- [x] **Railway config verified** — volume at `/data`, `DB_PATH=/data/protocall.db`,
      healthcheck `/healthz`, replicas=1. Verified by deploy survival. *(2026-08-10)*
- [x] **Offsite backups live** — `BACKUP_S3_*` set (Cloudflare R2, bucket-scoped
      token); forced upload verified HTTP 200 + object confirmed in bucket. *(2026-08-10)*
- [x] **Uptime monitoring** — UptimeRobot on `/healthz`, 5-min interval, test
      notification received. *(2026-08-10)*
- [x] **Restore rehearsal** — R2 snapshot run locally via `DB_PATH` override,
      real data verified in browser. *(2026-08-10)*

---

## P1 — Before the 10-user beta

Do these as PRs 1–6, in order. Details per PR in [PR sequence](#pr-sequence).

- [ ] **PR 1 — `railway.json` + env docs** (Sonnet 5, risk: none)
      Healthcheck config in git; README table of every env var.
      *Done when:* merged; dashboard matches the doc.
- [ ] **PR 2 — CI workflow** (Sonnet 5, risk: none)
      `.github/workflows/test.yml` running `npm ci && npm test` on every push/PR.
      *Done when:* a deliberately red branch shows a red check. From here on:
      **never deploy without green CI.**
- [ ] **PR 3 — DB_PATH boot guard** (Opus 4.8, risk: low)
      On Railway (`RAILWAY_ENVIRONMENT` set) with no `DB_PATH`, refuse to boot
      loudly instead of silently writing to ephemeral disk (`server/db.js:8`).
      *Done when:* guard test green; all 123 existing tests pass.
- [ ] **PR 4 — Save-button in-flight guard** (Sonnet 5, risk: low)
      Disable buttons in `saveScenario()` (`public/index.html:~1742`) during
      save; sweep other create buttons (solo save at ~3273 is the model).
      *Done when:* double-click creates exactly one scenario/session/clone.
- [ ] **PR 5 — Editor autosave + unload warning** (Opus designs, Sonnet implements; risk: medium)
      Debounced 10s autosave via the existing draft API; new/draft scenarios
      only — never auto-PUT a published scenario; capture returned `id` on
      first save; status chip; `beforeunload` **and** `pagehide` (mobile Safari).
      *Done when:* kill-tab test recovers the draft on desktop and phone;
      published scenario untouched by an idle editor.
- [ ] **PR 6 — Error alerting** (Sonnet 5, risk: low)
      Fastify `setErrorHandler` → Sentry or throttled email via `server/mailer.js`.
      Fire-and-forget; no request bodies (passwords) in reports.
      *Done when:* one induced 500 in prod reaches you.

**→ Invite the 10 beta users.** Run the beta 2–3 weeks while doing P2.

---

## P2 — Before 50+ users

- [ ] **PR 7 — Optimistic concurrency** (Opus server, Sonnet client; risk: med-high)
      Integer `rev` on `scenarios`; stale PUT → 409 `{error, current_rev}`;
      versionless PUT still accepted (back-compat — old tabs must keep working);
      client sends `rev`, shows "edited in another tab" banner on 409, keeps
      form populated. Reviewer edits version-checked too.
      *Done when:* two-tab test 409s without data loss; all existing tests pass.
- [ ] **PR 8 — Backup freshness alert** (Sonnet 5, risk: low)
      Last successful offsite upload tracked in `app_meta`; >48h stale → email,
      max once/24h. Uses existing seams (`now`, `offsite`, `log`) in `server/backup.js`.
      *Done when:* test green; one real alert verified by breaking the S3 secret briefly.
- [ ] **PR 9 — Live response dedupe** (Opus 4.8, risk: medium)
      Flag-guarded one-shot migration: remove duplicate responses (keep
      `is_pushed=1` row if any, else earliest), unique index on
      `(session_id, participant_id, question_id)`, `INSERT OR IGNORE` in
      `Rooms.submitResponse` (`server/rooms.js:76`).
      *Done when:* seeded-dupes migration test passes; double-submit yields one row.
- [ ] **PR 10 — Moderation consistency** (Sonnet 5, risk: low)
      `vote` (`server/index.js:~1095`) and `report` (~371) switch from legacy
      `visibility='public'` to the `APPROVED_PUBLIC` predicate (~530).
      *Done when:* pending scenario → 404 on vote/report; approved → works.
- [ ] **PR 11 — Runbooks** (Sonnet 5 writes, Opus reviews; risk: none)
      `docs/runbooks.md`: deploy, migration, rollback, missing-data,
      outage/restore — exact commands, executable without thinking.
      *Done when:* missing-data runbook dry-run once against a backup copy.
- [ ] **Opus final review** (inspect-only)
      Authorization sweep of every mutating route + socket handler; runbook
      review; go/no-go against the readiness checklist below.

**→ Work the 50-user checklist, then open it up.**

---

## P3 — After launch

- [ ] **PR 12 — Scenario version history** (Opus + Sonnet; the highest-leverage one)
      Snapshot scenario+questions JSON inside the existing PUT transaction
      (`server/index.js:~1026`), cap 20/scenario; author-only restore that flows
      through normal edit gating (`gatedStatus` — approval is voided).
      Build it the week *after* the 50-user gate, not before.
- [ ] Pagination on `/api/scenarios` (Sonnet)
- [ ] Media garbage collection — admin-triggered, never automatic at first (Sonnet)
- [ ] CSRF tokens — Opus review first; currently mitigated by SameSite=Lax + JSON-only bodies
- [ ] Staging environment (second Railway service off a branch)
- [ ] Redis/multi-node — skip until well past 100 users (`server/index.js:1575` hook exists)

---

## PR sequence

| # | Title | Owner | Risk | Gate |
|---|---|---|---|---|
| 1 | railway.json + launch safety docs | Sonnet 5 | None | Beta |
| 2 | CI workflow | Sonnet 5 | None | Beta |
| 3 | DB_PATH boot guard | Opus 4.8 | Low | Beta |
| 4 | Save-button in-flight guard | Sonnet 5 | Low | Beta |
| 5 | Editor autosave + dirty warning | Both | Medium | Beta |
| 6 | Uptime + error alerting | Sonnet 5 | Low | Beta |
| 7 | Optimistic concurrency + 409 UX | Both | Med-High | 50+ |
| 8 | Backup freshness alert | Sonnet 5 | Low | 50+ |
| 9 | Live response dedupe | Opus 4.8 | Medium | 50+ |
| 10 | Moderation consistency fix | Sonnet 5 | Low | 50+ |
| 11 | Runbooks | Sonnet 5 + Opus | None | 50+ |
| 12 | Scenario version history | Both | Medium | Post-launch |

Rollback notes: PRs 1–6 revert cleanly (config/frontend/additive). PR 7's
server accepts versionless requests, so the frontend can be reverted alone.
PR 9's unique index stays if code reverts — that's fine; the inserts it blocks
were already bugs. PR 12's table is additive.

---

## Prompts

Copy-paste these verbatim into a fresh Claude Code session on this repo, using
the model named in the heading.

### Prompt for Sonnet 5 — PR 1 + PR 2 (railway.json, env docs, CI)

> Two small PRs, config/docs only, no behavior changes. Read
> docs/execution-plan.md for context.
>
> PR 1: add railway.json with healthcheckPath "/healthz", a sensible
> healthcheck timeout, and restartPolicyType ON_FAILURE. Add a README
> "Production configuration" section: table of every env var the server reads
> (grep server/*.js for process.env — includes DB_PATH, APP_URL,
> SITE_ADMIN_EMAIL, BACKUP_DIR, BACKUP_KEEP, BACKUP_S3_ENDPOINT/BUCKET/
> ACCESS_KEY_ID/SECRET_ACCESS_KEY/REGION/PREFIX, REDIS_URL, PORT, mailer vars
> in server/mailer.js, ANTHROPIC_API_KEY in analysis.js) with: purpose,
> required-in-prod yes/no, and what breaks if missing. Call out in bold that
> DB_PATH must point at the mounted volume.
>
> PR 2: .github/workflows/test.yml — Node 22, npm ci, npm test, on push and
> pull_request, npm cache enabled. better-sqlite3 compiles fine on
> ubuntu-latest; add nothing extra.
>
> Acceptance: npm test passes locally; the workflow is valid YAML; every
> process.env reference in server/ appears in the README table.

### Prompt for Opus 4.8 — PR 3 (Railway failure-mode review + boot guard)

> Inspect first, then implement one small guard. Read docs/execution-plan.md
> for context.
>
> 1) INSPECT ONLY: read server/db.js (createDb, line 8 — note the DB_PATH
> fallback to a repo-relative file), server/index.js lines 29–60 (backup dir
> derivation) and 1586–1605 (shutdown), docs/ai/decisions.md. Write a short
> memo: exactly what happens on a Railway deploy if DB_PATH is unset or the
> volume is missing, and which env vars are load-bearing.
>
> 2) IMPLEMENT: add a boot guard — when process.env.RAILWAY_ENVIRONMENT is set
> and DB_PATH is not, log a clear fatal message and exit non-zero BEFORE
> opening any database. Do not change behavior for local dev or tests (they
> rely on the fallback and ':memory:'). Add a test for the guard.
>
> Acceptance: all existing tests still pass; new test proves the guard. Do not
> add config frameworks, dotenv, or refactor createDb's signature. If you find
> any OTHER path that silently writes data to ephemeral disk (check media.js
> MEDIA_DIR), report it in the memo — do not fix it in this PR without asking.

### Prompt for Sonnet 5 — PR 4 (in-flight guard)

> Frontend-only PR in public/index.html. Read docs/execution-plan.md for
> context. In saveScenario() (~1742), disable both save buttons on entry
> (show "Saving…"), re-enable in finally. Then sweep other create-actions for
> the same double-fire risk: session create, scenario clone, department
> create/join — the solo save button at ~3273 already does this correctly;
> copy that pattern. List every guarded button in the PR description. Manual
> test: double-click each → exactly one resource created. No server changes;
> existing test suite must pass.

### Prompt for Sonnet 5 — PR 5 (autosave + dirty warning)

> Implement editor autosave in public/index.html. Read docs/execution-plan.md
> for context. You may change frontend code and add server tests; do NOT
> change server behavior.
>
> Read first: saveScenario() (~1742), the editor state variables (~648:
> draftQs, draftMedia, draftShares, editingId), renderCreator, and how "Save
> as Draft" calls saveScenario({draft:true}). Server contract: POST
> /api/scenarios with draft:true creates a draft and returns {id}; PUT
> /api/scenarios/:id with draft:true updates it; the server ignores draft:true
> on published rows (index.js ~987) but a PUT still overwrites content — so:
>
> Rules:
> - Autosave ONLY when creating a new scenario or editing an existing draft
>   (!editingId || existing.is_draft). NEVER auto-PUT a published scenario.
> - Debounce 10s after last edit; skip when nothing changed since last save.
> - First autosave of a new scenario captures the returned id into editingId
>   so all later saves (auto and manual) target one row.
> - Status chip near the save buttons: "Saving… / Saved just now / Autosave
>   failed — will retry". Failures retry on next debounce tick, never lose
>   form state.
> - beforeunload + pagehide warning whenever there are unsaved changes
>   (published edits included).
>
> Tests: extend test/drafts.test.js — repeated draft PUTs are idempotent;
> draft:true on a published scenario does not change is_draft. Manual checks:
> kill-tab recovery; published scenario untouched by idle editor.
>
> Do not add a framework, state library, or localStorage mirror. If the
> editingId capture conflicts with how renderCreator initializes state, stop
> and describe the issue instead of restructuring the editor.

### Prompt for Sonnet 5 — PR 6 (error alerting)

> Add error reporting to server/index.js. Read docs/execution-plan.md for
> context. Use [Sentry / mailer — owner will say which]. Requirements: a
> Fastify setErrorHandler that (1) reports the error fire-and-forget, wrapped
> in its own try/catch so reporting can never affect the response, (2) still
> returns the normal error response, (3) never includes request bodies or
> cookies in the report (passwords live in bodies). Also report
> unhandledRejection/uncaughtException. If using the mailer
> (server/mailer.js), throttle: max one email per error-message signature per
> hour, tracked in memory. Enabled only when its env var is set, so tests/dev
> are silent. Test: the handler swallows a throwing reporter. Keep it under
> ~60 lines; no wrapper libraries.

### Prompt for Opus 4.8 — PR 7 server side (optimistic concurrency)

> Implement stale-write protection for scenario editing. Read
> docs/execution-plan.md for context. Inspect server/index.js PUT
> /api/scenarios/:id (~978–1055, note the question soft-delete reconcile at
> ~1045 — a stale write soft-deletes questions the other tab added), POST
> /api/scenarios, server/db.js migrate(), and public/index.html saveScenario()
> (~1742) for the client contract.
>
> Design + implement:
> - Add an integer `rev` column to scenarios via the existing addColumn
>   pattern (default 0). Bump it inside the PUT transaction.
> - PUT accepts optional `rev` in the body: if present and != current, return
>   409 with {error, current_rev}. If absent, accept (backward compat —
>   existing tests and old cached pages must keep working).
> - Return the new rev from POST and PUT responses and in GET /api/scenarios/:id.
> - Reviewer edits (asReviewer path) are version-checked too.
>
> Do NOT redesign the PUT handler, add ETags/middleware, or make rev
> mandatory. All existing tests must pass unchanged; add tests: stale→409,
> fresh→200, versionless→200, reviewer-collision→409. State clearly in your
> summary how the client-side autosave should thread the rev (implemented
> separately).

### Prompt for Sonnet 5 — PR 7 client side + PR 10 (409 UX, moderation fix)

> Two small PRs. Read docs/execution-plan.md for context.
>
> A) public/index.html saveScenario(): include the scenario's rev (from the
> last GET/save response) in PUT bodies; on a 409 response show a persistent
> banner: "Edited in another tab — reload to get the latest. Your changes here
> are kept until you leave." Do not auto-reload; keep the form populated.
> Manual test: two tabs, save both.
>
> B) server/index.js: POST /api/scenarios/:id/vote (~1095) and /report (~371)
> currently check visibility='public' (legacy column). Switch both to the
> APPROVED_PUBLIC predicate used elsewhere (~530): shared_public=1 AND
> review_status='approved', plus deleted_at IS NULL. Add two tests (pending
> scenario → 404; approved → works) in the style of test/approval-gate.test.js.

### Prompt for Sonnet 5 — PR 8 (backup freshness alert)

> Extend server/backup.js. Read docs/execution-plan.md for context. After
> each successful offsite upload, record the timestamp in app_meta (key
> 'last_offsite_ok'). Add a check inside the existing runOnce cycle: if
> offsite is configured and last_offsite_ok is missing or >48h old, send an
> alert email via the mailer — at most one per 24h (track last-alert in
> app_meta too). Use the existing injectable seams (now, offsite, log) and add
> a mailer seam the same way. Extend test/backup-offsite.test.js: failing
> uploader + advanced clock → exactly one alert; a subsequent success clears
> the condition. Do not restructure the scheduler.

### Prompt for Opus 4.8 — PR 9 (response dedupe migration)

> Implement duplicate-response protection. Read docs/execution-plan.md for
> context. Inspect server/rooms.js submitResponse (line 76), the solo answer
> path in server/index.js (~1202–1225, which already has a manual duplicate
> check — keep it), and the migrate() pattern in server/db.js (flag-guarded
> one-shots via app_meta).
>
> Implement a flag-guarded one-shot migration that (a) removes existing
> duplicate responses per (session_id, participant_id, question_id) — keep a
> pushed row (is_pushed=1) if one exists, else the earliest — then (b) creates
> a UNIQUE index on those columns. Change submitResponse to INSERT OR IGNORE
> and return the existing row when the insert was ignored, so a socket
> double-fire acks normally instead of crashing.
>
> Add tests: seeded duplicates survive migration correctly (pushed row wins);
> double submit yields one row and both calls ack. Do not touch the
> reveal/stage logic. If you believe hosts rely on multiple answers per
> question as a feature (re-answering), STOP and ask before deleting anything
> — check test/session-loop.test.js and the frontend first.

### Prompt for Sonnet 5 — PR 11 (runbooks)

> Write docs/runbooks.md. Read docs/execution-plan.md and docs/ops-log.md for
> context. Five runbooks — normal deploy, migration deploy, rollback, missing
> user data, outage/restore — with exact commands (sqlite3 queries for finding
> a user's scenarios incl. deleted_at, Railway UI steps, how to fetch an
> offsite snapshot per server/offsite.js's key layout, the DB_PATH-override
> local restore procedure already proven in ops-log). Terse, imperative,
> executable without thinking. Docs only, no code changes.

### Prompt for Opus 4.8 — Final review (inspect only)

> INSPECT ONLY — change no code. Read docs/execution-plan.md for context.
> Produce a route-by-route table of every mutating endpoint and socket handler
> in server/index.js and server/rooms.js: route, ownership predicate (quote
> the actual WHERE/check), verdict. Pay special attention to anything added
> recently: autosave-driven draft PUTs, the rev/409 path, response dedupe.
> Then review docs/runbooks.md against the real code paths (backup.js,
> offsite.js, /api/admin/backup). Finish with a go/no-go for a 50-user launch
> against the checklist in docs/execution-plan.md, naming any residual risks.
> If you find an authorization gap, report it with a failing-test sketch — do
> not fix it in this pass.

### Prompt for Opus 4.8 + Sonnet 5 — PR 12 (version history, post-launch)

> Design and implement per-scenario version history. Read
> docs/execution-plan.md for context. Inspect the PUT transaction in
> server/index.js (~1026–1053), gatedStatus (~525), and the drafts semantics
> (is_draft).
>
> Implement: a scenario_versions table (id, scenario_id, rev, snapshot JSON of
> scenario fields + non-deleted questions + media, saved_by, created_at),
> written inside the existing PUT transaction before the update, capped at the
> newest 20 per scenario. Add author-only endpoints: GET list of versions,
> POST restore — restore must flow through the same validation/gating as a
> normal edit (approval is voided, shares re-derived), not write columns
> verbatim. Small history UI is a follow-up.
>
> Tests: 3 edits → 3 versions; restore v1 → content matches, approval voided;
> cap enforced; a reviewer cannot list/restore another author's versions. Do
> not build diffing, per-question history, or retention config.

---

## Deployment rules (standing, from day one of real users)

1. **Never deploy with CI red.** No exceptions.
2. **Backup before any migration-bearing deploy** — hit `GET /api/admin/backup`,
   save the file, then deploy.
3. **Additive migrations only.** New columns get defaults (`addColumn`
   pattern); data rewrites are one-shot and flag-guarded in `app_meta`.
   Never DROP, never RENAME, never change a column's meaning.
4. **Two-step removals.** Release 1 stops writing a field; release 2 (weeks
   later) stops reading it. The column can stay forever.
5. **Old pages must keep working.** APIs accept the previous request shape
   (PR 7's versionless-PUT compat is the template).
6. **Deploy in low-usage windows** — never during a live session
   (`SELECT COUNT(*) FROM live_sessions WHERE status='live'`).
7. **Post-deploy check, every time (2 min):** `/healthz` → log in → open a
   scenario → save a trivial draft edit.
8. **Roll back immediately** (Railway → previous deployment → redeploy) on:
   failing healthcheck, broken login, save 5xx, `SQLITE_` errors, or missing
   backup-scheduler log line. Investigate after, not before.

---

## 50-user readiness checklist

- [x] `DB_PATH=/data/protocall.db` on the mounted volume (dashboard-verified)
- [x] A deploy survived with accounts/scenarios intact
- [ ] `railway.json` with healthcheck merged; deploy log shows healthcheck passing
- [ ] Boot guard merged (prod without DB_PATH refuses to start; test green)
- [x] `BACKUP_S3_*` set; logs show "Offsite backup uploaded"
- [x] Restore rehearsal within the last 30 days (see ops-log)
- [x] Uptime monitor live; test alert received
- [ ] Error alerting live; one induced 500 received
- [ ] Backup-freshness alert merged and test-fired once
- [ ] CI on every push; main green
- [ ] Autosave merged; kill-tab test passed on desktop and mobile
- [ ] In-flight guards merged; double-click test passed on every create button
- [ ] Optimistic concurrency merged; two-tab 409 test passed, no silent overwrite
- [ ] Response dedupe merged; migration ran clean in prod (check logs)
- [ ] Moderation consistency fix merged
- [ ] Opus authorization sweep completed with zero open gaps
- [ ] Runbooks merged; missing-data runbook dry-run once
- [ ] `SITE_ADMIN_EMAIL` set; your account shows site_admin
- [ ] Post-deploy verification followed on the last 3 deploys

---

## Final recommendations

- **Today → 10 users:** ship PRs 1–6 in order (~3–4 focused days), then invite.
- **10 → 50:** run the beta 2–3 weeks while shipping PRs 7–11; beta users are
  the canary for the concurrency change (watch for spurious-409 reports); Opus
  final review; work the checklist; open up.
- **Never skip:** volume verification (done), restore rehearsal (done),
  autosave, CI.
- **Can wait:** version history, pagination, media GC, CSRF, staging, Redis.
- **Highest-leverage post-launch feature:** version history (PR 12) — turns
  every future "my changes are gone" into a one-click restore. Build it the
  week after the 50-user gate.
