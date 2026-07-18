# Hardening plan — pre-Track-D risk mitigation

_Written 2026-07-18. Read `current-focus.md` and `decisions.md` first. This plan
mitigates the failure modes most likely to bite in the next ~3 months, in
priority order. H1 should land **before or with Track D** — Track D touches
exactly the state transition H1 protects._

## H1. Centralize the "leaves Private" gate  (do first — Track D depends on it)

**Risk:** the primary-objective requirement is enforced in three hand-written
places (POST `/api/scenarios`, PUT gated on `!asReviewer`, submit-review). Any
new path that makes a scenario shared — Track D approval flipping visibility,
a bulk-publish admin action, an import — silently bypasses it.

**Work:**
- Extract one function in `server/index.js` (near `effectiveObjectives`), e.g.
  `assertShareable(target)` → returns an error string or null, given the
  would-be state (`visibility`, `shared_department`, `objective_primary`).
- Route POST, PUT, and submit-review through it (behavior unchanged; the
  existing tests in `test/taxonomy.test.js` "leaves Private" must stay green).
- **Rule for Track D:** any approve/publish/visibility-flip added later calls
  `assertShareable` — write this into the Track D implementation notes.

**Acceptance:** existing suite green; one new test that drives every current
share path through the helper (reuse the "leaves Private" test, extend for the
PUT path which isn't covered yet).

**Size:** small (~1 hr).

## H2. Objective vocabulary drift / rename safety

**Risk:** objective *names* are the join key everywhere (`objective_primary`,
`objective_secondary`, `questions.objective`, coverage grid, suggester) with no
FK. The vocabulary is admin-extendable (`POST /api/objectives`,
`server/index.js:738`). A future rename orphans every scenario tagged with the
old string; new objectives are invisible to the suggester's hand seed.

**Work:**
1. **Decide rename policy** (recommend: names are immutable — admins can add,
   never rename; a "rename" is add-new + a one-shot admin migration). If the
   owner instead wants renames, build `PUT /api/objectives/:name` (site admin)
   that transactionally cascades across all three columns. Immutable is far
   cheaper and probably right — put it to the owner as the default.
2. **Integrity check:** at startup (in `server/db.js` or `buildServer`), one
   query that finds objective strings in scenarios/questions not present in the
   vocabulary; `app.log.warn` each. Cheap tripwire, no behavior change.
3. **Suggester coverage for unseeded objectives:** verify that an admin-added
   objective (no `SEED_KEYWORDS` entry) is still suggestible once the corpus
   has tagged examples — `buildCorpusModel` should learn it. Add a unit test in
   `test/objectives.test.js` for exactly that (candidate not in seed, corpus
   provides the weights). If the candidates list is filtered to seeded names
   anywhere, fix it.

**Acceptance:** new unit test for unseeded-but-corpus-learned suggestion;
integrity warning proven by a test that tags a scenario then deletes the
objective row directly via `ctx.db`.

**Size:** medium (~2 hrs). The rename-policy decision needs the owner.

## H3. Media size-cap flake — root-cause and fix  (quick win, do early)

**Risk:** `test/media-pdf.test.js:40` (11 MB upload → expect 413) fails
intermittently with 201. Untriaged, it trains us to ignore red CI — or worse,
the cap genuinely doesn't enforce sometimes and the Railway volume eats huge
uploads.

**Likely mechanism (verified in source, not yet proven at runtime):**
`server/index.js:439-441` relies on `file.toBuffer()` **throwing** when the
multipart `fileSize` limit (`server/index.js:52`) is exceeded. In
`@fastify/multipart`, a limit hit can instead **truncate** the stream and set
`file.file.truncated = true` without `toBuffer()` throwing — the truncated
buffer then proceeds to `media.save` and returns 201. Timing-dependent → flake.

**Work:**
- After `toBuffer()`, explicitly check `if (file.file.truncated) return
  reply.code(413)...` (keep the try/catch too — either signal means too big).
- Prove it: loop the single test ~50× (`for i in $(seq 50); do node --test
  test/media-pdf.test.js || break; done`) before and after the fix.

**Acceptance:** 50 consecutive green runs of `media-pdf.test.js`; full suite
green (would be 84/84 — first fully green suite in a while).

**Size:** small (~30 min).

## H4. Frontend smoke tests (Playwright)

**Risk:** `public/index.html` is a single file with global mutable state
(`draftQs`, `draftObjectives`, `advancedQ`) and **zero automated frontend
tests** — all browser verification so far was manual and session-local. Track
D/E edits can silently break creator or reveal flows.

**Work:**
- New `test/browser/smoke.mjs` (plain node script or node:test, not the
  Playwright runner — keeps deps at zero). Environment facts to encode in the
  file header comment, learned the hard way this session:
  - import: `import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
    const { chromium } = pkg;` (NODE_PATH is ignored by ESM; the package is CJS
    so destructure the default export).
  - launch: `executablePath: '/opt/pw-browsers/chromium'`.
  - CDN (Tailwind/lucide) is proxy-blocked: stub via
    `page.addInitScript(() => { window.lucide = { createIcons: () => {} }; })`
    and assert on classes/DOM, never on Tailwind-computed styles.
- Coverage (three journeys, ~15 assertions total — smoke, not exhaustive):
  1. sign up → creator → fill scene-first form → save private → appears in
     library;
  2. solo run → answer → After-Action reveal shows objectives + official
     answers → explicit Save persists a run;
  3. share-gate: attempt Community share without a primary objective → amber
     toast, no save.
- `package.json` script `test:browser`; keep it **out of** `npm test` (needs
  the sandbox browser; document that in README or the script name).

**Acceptance:** `npm run test:browser` green from a clean checkout in this
environment.

**Size:** medium (~2 hrs, mostly assertions).

## H5. SQLite / volume operational guardrail  (small, last)

**Risk:** DB and media share the Railway volume (`/data`); a full volume fails
writes with no warning. Known deferral in `decisions.md` — keep this minimal.

**Work:**
- Extend the health endpoint (or startup log) with free-bytes for the directory
  containing `DB_PATH` (`fs.statfsSync`); log a warning under ~500 MB free.
- Document (in `docs/`, one paragraph) the backup story: nightly
  `sqlite3 .backup` to `/data/backups` with N-day rotation **or** Railway
  volume snapshots — owner's call; don't build cron infra speculatively,
  a note + manual command is enough for now.

**Acceptance:** health output shows disk headroom; doc paragraph exists.

**Size:** small (~45 min).

## Open decisions to get from the owner (batch these up front)

1. **H2 rename policy:** immutable objective names (recommended) vs cascading
   rename endpoint.
2. **Track D admin model** (pre-existing open question, `next-session.md`):
   owner-only via `SITE_ADMIN_EMAIL` vs promotable from the UI. Needed the
   moment Track D starts; H1 doesn't depend on it.
3. **H5 backup mechanism:** nightly in-app backup vs Railway snapshots.

## Suggested session shape

H3 (quick, makes the suite trustworthy) → H1 → H2 → H4 → H5. H1+H3 alone are a
worthwhile session if time is short. Then Track D can start on top of H1's
centralized gate.
