# ProtoCall Trainer — Session Handoff

_Last updated: 2026-07-10. Read this first, then `ENGINEERING_OS.md`, `ROADMAP.md`, and `TODO.md`._

## What this is
**ProtoCall Trainer** ("CrewTable") — a live tactical fireground & EMS scenario training
web app. A host launches a live session from a scenario, crew join by QR code / room code
(no account needed), answers stream into the host's real-time Aggregation Matrix, the host
"pushes" notable answers to every device, and the session archives to each participant's
library. Since v7: guests and users can also play any public scenario **solo**, picking a
role. Mobile-first, dark theme, works on phone/tablet/Mac/PC.

Built with the Engineering OS at `~/engineering-os` (see `ENGINEERING_OS.md`). The workflow
each version follows: PRD → architecture review → implement (TDD) → integration tests →
browser verification → deploy → journal entry.

## Current state: v7 is ~60% shipped (2026-07-10 session)
- **Live URL:** https://protocall-trainer-production.up.railway.app —
  ⚠️ **v6 + v7 work is committed locally but NOT yet deployed.** Deploy with
  `npx railway up --service protocall-trainer --detach`, then poll `/healthz`.
- **Tests:** 50 integration tests, all green (`npm test`).
- **Git:** clean tree, all committed to local `main` (no GitHub remote).

### Shipped this session (PRD-v7.md, in commit order)
1. **Model-answer gating, product-wide** (`201ecdd`, `8e91de8`): participants see no
   instructor answer anywhere — scenario detail API, live socket state, submit acks,
   archived sessions, PDFs — until they've answered every question in *their* set; then
   all reveal at once. **Session end unlocks everything (owner decision 2026-07-10).**
   Hosts and scenario authors unaffected. Fixed a real leak: `GET /api/scenarios/:id`
   was shipping every model answer to logged-out guests.
2. **Scenario detail page + solo play** (`698f689`): public `#/scenario/:id` (taxonomy
   chips, per-track question counts, Try Solo / Host Live / Clone; never shows prompts).
   Guests run solo statelessly via `POST /api/scenarios/:id/solo-reveal` (nothing
   persists, "won't be saved" notices). Signed-in runs persist via `POST /api/solo/runs`
   + `/answers` as `mode='solo'` sessions (host_id NULL, unjoinable room codes), land in
   the library with a SOLO badge, reopen showing player answers beside model answers.
3. **Live role select** (`e3b0ee9`): tracked scenarios show a role-pick screen on join
   (options = tracks present in the scenario + "All roles"); role persists on the
   participant token, locks at first answer, filters questions to common + role
   server-side; the reveal gate is track-aware; host matrix/archive tag responses with
   roles. No role / untracked scenario = exactly the old behavior.
4. **Taxonomy** (`8ad88e0`): `learning_objectives` table seeded with the PRD's 12;
   site admins extend it from `#/moderation`. Scenarios carry validated
   `objective_primary`/`objective_secondary` (max two, must differ), `difficulty`
   (Introductory/Standard/Advanced), `duration_min`, `building_type`. Coverage grid at
   `#/coverage` (`GET /api/coverage`): objectives × categories over public scenarios,
   secondary counts too, gaps visible.

### Remaining in v7 (next session starts here)
1. **Academies** — curated ordered collections: owner, name, description, ordered
   scenario entries; site-admin = global, dept-admin = department-scoped; entries have
   draft/publish staging (publishing requires the scenario to be ≥ department-visible);
   deleting a scenario must not orphan-crash academies. Georgetown is just the first
   dept academy — nothing hard-coded.
2. **Stages** — optional named stage headers over the question list; host advances
   stages live; solo advances as the player submits. **Reveal is per-stage (owner
   decision 2026-07-10, recorded in PRD-v7.md):** finishing a stage's questions unlocks
   that stage's model answers; stageless scenarios keep whole-scenario gating.
   Per-question reveal was explicitly rejected (anchoring).
3. **Content sprint** — 20 scenarios, AI-drafted in dev sessions, owner reviews each,
   tagged with objectives at authoring time; the coverage grid is the progress meter.
   Historical-incident policy in PRD-v7 is a hard constraint. No generation code in-app.

## v7 implementation notes (for whoever continues)
- **Gating helpers:** `rooms.hasAnsweredAll(sessionId, participantId)` is track-aware
  (reads the participant's `role_track`); `rooms.officialAnswers(sessionId, roleTrack)`
  filters to the track set. Archive-side reveal lives in `sessionDetailFor` (index.js).
  Stages will change "all questions" to "all questions in the current stage" in these
  same spots.
- **Schema added by v7** (idempotent addColumn migrations in `db.js`):
  `live_sessions.mode` ('live'|'solo'), `participants.role_track`, scenarios'
  `objective_primary/objective_secondary/difficulty/duration_min/building_type`,
  plus the `learning_objectives` table (seeded every boot, INSERT OR IGNORE).
- **Solo runs are sessions:** everything downstream (library list, session detail, PDF)
  works on them for free; `mode='solo'` + `host_id IS NULL` is the marker. The socket
  `join_room` rejects solo room codes.
- **Client role memory:** chosen role is `sessionStorage['pcRole:'+code]`, `'ALL'`
  sentinel = explicitly play everything. Server ignores role changes once the
  participant has any response.
- **Taxonomy validation** is `taxonomyOf()` in index.js, shared by POST and PUT
  /api/scenarios. Difficulty list is fixed in code; objectives come from the DB.

## Architecture
- **Server:** Node 24, Fastify + Socket.IO, single process. `server/index.js` (routes +
  sockets), `db.js` (SQLite schema/seed/migrations), `rooms.js` (live-session logic),
  `auth.js` (scrypt + cookie sessions), `media.js` (disk store, S3-shaped), `pdf.js`
  (pdfkit), `analysis.js` (v6 AI after-action, env-gated), `mailer.js` (Resend, env-gated).
- **DB:** SQLite via better-sqlite3, synchronous. Postgres-compatible schema (`SPEC.md`).
- **Frontend:** single file `public/index.html` — vanilla JS, hash routing, Tailwind CDN +
  Lucide. Plus `manifest.json`, `sw.js`, icons.
- **Real-time:** one Socket.IO room per session. join_room now takes `role_track`;
  submit ack shape is `{ok, complete, official_answers?}` (the old per-question
  `official_answer` field is gone).

## Deploy / ops
- **Railway** project `protocall-trainer` (id 6aa83d48-81dc-4d73-a40f-d3a9a9958af2),
  deploys from local dir. Persistent volume at `/data`. `npx railway login` already done.
- **Env vars set:** `DB_PATH=/data/protocall.db`, `MEDIA_DIR=/data/media`,
  `SITE_ADMIN_EMAIL=mattwb44@gmail.com`. NOT set (dormant features): `ANTHROPIC_API_KEY`
  (v6 after-action), `RESEND_API_KEY`/`MAIL_FROM`/`APP_URL` (email), `REDIS_URL`.
- **Health:** `GET /healthz`. **Backups:** `GET /api/admin/backup` (site_admin).
- **Verify against production, not just localhost** — proxy-IP and service-worker bugs
  were only visible live. The SW caches the shell: after deploy, confirm the new
  `index.html` actually reaches devices.

## Roles & the site admin
- `standard`, `dept_admin`, `site_admin`. No UI grants site_admin — it's
  `SITE_ADMIN_EMAIL` (owner's mattwb44@gmail.com). Moderation at `#/moderation`:
  pending departments, reported scenarios, and now the learning-objective vocabulary.

## Open items (owner actions)
1. Reject the smoke-test department "Gate Check FD" pending on prod (`#/moderation`).
2. Set Resend env vars + verify sending domain to activate email (see TODO.md).
3. Set `ANTHROPIC_API_KEY` on Railway to activate the v6 after-action.
4. **Deploy the v6+v7 work** (see Current state).

## Gotchas (journal: `~/engineering-os/journal/`)
- `buildServer()` is **async**; tests use
  `await buildServer({ dbFile: ':memory:', authRateMax: 1000 })`.
- Fastify needs `trustProxy: true` behind Railway.
- socket.io `reconnect` only fires on automatic reconnects; client hooks `connect`
  with a joined-once flag. `session_ended` triggers a full rejoin (that's how end-of-
  session answer unlock reaches live participants).
- better-sqlite3 named params throw if you pass unused keys — spread conditional
  params (`...(track ? { track } : {})`), see rooms.js.
- `COALESCE(ls.host_id=?, 0)` in the library query — solo runs have NULL host_id and
  SQLite would return NULL for `hosted`.
- Run `npm install` from the project dir, never the parent.
- QR codes are server-side SVG.

## Key files
`README.md` (run/test), `QUICKSTART.md` (usage), `SPEC.md` (architecture + schema),
`ROADMAP.md`, `TODO.md`, `PRD-v7.md` (current work — includes the 2026-07-10 owner
decisions inline), earlier `PRD*.md` per version.
