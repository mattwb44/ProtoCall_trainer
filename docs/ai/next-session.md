# Next session

_Updated 2026-08-24. Read `current-focus.md` and `decisions.md` first. The
ops-hardening execution plan (`docs/execution-plan.md`) is complete; active work
is now the **UX / polish backlog** at `docs/ai/ux-backlog.md` (grill 2026-08-16)._

`npm test` = **143 passing**. **Phase C (C1–C9) committed AND pushed** to
`origin/main` (latest `f82407f`). **Phase D:** D1 v1 (`d932881`), D2 (`929d136`),
D1 v2 (`68cb885`), plus two docs commits (`363d392`, `983541f`) are committed —
**5 commits ahead of `origin/main`, NONE pushed.** **D1 v3 (markup editor rework)
is now BUILT + verified but UNCOMMITTED** in the working tree.

## Resume here — commit + push

**First action:** commit D1 v3 (working tree = `public/index.html`, `server/db.js`,
`test/media-pdf.test.js`), then **push all 6 local commits** to deploy on Railway.
Then options: **Phase E** (E1 credit byline surviving cloning + card chip, E2
clone→original review link), or build the **Fire & Smoke tools** (plan-only,
`docs/prd-fire-smoke-tools.md`; they default to their palette tab, now in place).

## D1 v3 (markup editor rework) — DONE, UNCOMMITTED (2026-08-24)

All 7 owner-decided items (grill 2026-08-23) built additively on the D1 v2 overlay
pipeline in `openMarkupEditor` (`public/index.html`) + one server migration. Verified
end-to-end in the browser preview (editor driven via `openMarkupEditor` on a data-URL
base; desktop + 375px mobile; console clean; 143/143).

1. **On-canvas text handles.** Removed the DOM options bar **and** the separate **Move
   tool** — selection is folded into the **Text tool** (tap empty = new label; tap a
   label = select). Handles are drawn **inside the SVG** in a `<g>` rotated about the
   label anchor: dashed **accent frame** (`ACCENT = '#38bdf8'` sky — reads over orange
   flame + gray smoke), **4 round corner handles** (uniform scale), a **rotate handle
   on a stem** above top-center, a red **× delete chip** outside the top-right. All
   sized in user units via `uPerPx()` so they stay **constant on-screen** regardless of
   photo resolution; none baked into the export (`#mk-handles` is stripped before the
   canvas composite).
2. **Edit vs move:** `labelDown` selects + arms a drag; `onPointerUp` → stationary
   release on an **already-selected** label = **edit** (`openTextEntry`), a drag =
   **move**; **`dblclick` also edits** (`labelDbl`).
3. **Freehand radius eraser** (`eraseAt`): removes stroke points within
   `eraserBase * SIZE_MULTS[toolSize.eraser]` and **splits a stroke into sub-strokes**
   where cut (new ids, keeps the vector model). **Ignores text.** One undo snapshot per
   drag (`erasedThisDrag` gate, lazy on first hit).
4. **Morphing per-tool size** (`renderSizePop`/`updateSizeDots`): S/M/L bar gone.
   Selecting Pen/Highlighter/Eraser opens an **overlaid 3-dot popover** (`[data-sizepop]`,
   absolute → no reflow); dots preview the real size, **filled in the current ink** (eraser
   = neutral rings), recolor live on color change. Pick → collapses; level shown as a
   **`[data-sizedot]`** on the tool button. **Per-tool** (`toolSize` map). Text is NOT
   here (sizes via the corner handles).
5. **Marker → Highlighter.** UI relabel + `data-tool="highlighter"` + new strokes store
   `tool:'highlighter'`. **Client back-compat**: `isHi(o)` treats `'marker'||'highlighter'`
   as translucent in render **and** canvas export (no opacity regression). **Server boot
   migration** (`server/db.js`, flag `markup_marker_to_highlighter`): parses each
   `scenario_media.overlay` JSON and rewrites `tool:'marker'`→`'highlighter'` once
   (defensive parse; a label whose text is literally "marker" is left alone). Covered by
   a new test.
6. **Drawing over a label no longer selects its text:** `user-select:none` on the SVG +
   labels are `pointer-events:none` unless the Text tool is active (`objSvg` `pe`).
7. **Three palettes** (`MARKUP_PALETTES`): **Standard | Fire | Smoke** switcher in the
   color popover (`buildPop`), owner hexes, presented in the given order, **recents
   shared** across palettes. Tooltips: plain names for Standard & Fire; semantic names
   for Smoke. Palette state persists per editor session (`palette` var).

**Test:** `test/media-pdf.test.js` — new "D1 v3 boot migration" test seeds a legacy
`marker` overlay, clears the one-shot flag, reopens the DB, and asserts the rewrite
(idempotent; ignores a label named "marker"). The existing overlay round-trip still
asserts `tool:'marker'` persists on the **write** path (server stores overlay verbatim;
migration only touches pre-existing rows at boot). **143/143.**

Known minor (unchanged from v2): re-editing orphans the prior composite in `/media`
(no GC — acceptable at this scale).

Not in D1 v3: the **Fire & Smoke tools** — plan-only, see `docs/prd-fire-smoke-tools.md`.

## Resume here — Phase D

**D1 v2 — marker + Add Text + Undo/Redo + richer recents — DONE, UNCOMMITTED.**
All additive on the v1 overlay pipeline in `openMarkupEditor` (`public/index.html`):
- **Marker** tool — translucent highlighter stroke (`tool:'marker'`, `stroke-opacity`
  0.4, width = penW×3); canvas export uses `globalAlpha=0.4`.
- **Add Text** — `type:'text'` objects `{id,type:'text',color,size,x,y,text}`. Text
  tool: tap empty scene → `openTextEntry` modal (Enter=commit, Esc=cancel); tap an
  existing label (text tool) → edit/remove; eraser removes it too. SVG `<text>` +
  canvas `fillText`, both alphabetic baseline so composite matches the on-screen
  preview. Placed at tap point + `size*0.35` vertical nudge.
- **Undo/Redo** — deep-clone snapshot stack (`pushUndo` before every mutation:
  stroke commit, erase, clear, text add/edit/remove), cap 60. Toolbar buttons +
  ⌘/Ctrl+Z / ⇧⌘Z / Ctrl+Y (listener skipped while the text input is focused).
- **Richer recents** — inline swatch strip (`#mk-recents`, 6 most-recent) beside the
  Color button; storage bumped 8→12 (`localStorage.pcMarkupRecentColors`). `pickColor`
  helper drops eraser→pen on color pick.
- **Test:** `test/media-pdf.test.js` overlay round-trip extended with a marker stroke
  + a text object; asserts both persist. Server unchanged (overlay is opaque JSON,
  still capped at `MAX_OVERLAY_BYTES`). **142/142.**
- **Verified in preview** (editor driven via `openMarkupEditor` on a data-URL base):
  pen/marker widths+opacity, undo/redo counts, text add/edit/erase, recents strip,
  and full Save → composited PNG uploaded (`/media/…png`) with the editable overlay
  (all 4 object types) returned to `onSave`. Console clean.
- **Two bugs found in owner testing (2026-08-22) and FIXED (also uncommitted):**
  (1) placing text kicked the user out of the editor / showed a spurious "leave the
  editor?" guard — opening the entry modal (a direct child of `ov`) on `pointerdown`
  made the browser re-target the trailing `click` to `ov`, which the backdrop-close
  read as leave. Fix: text placement + edit now fire on `click`, not `pointerdown`
  (new-text on an svg `click` listener; edit-existing rebinds `[data-obj-text]` to
  `click`). (2) reopening an overlay containing a text label threw (`o.pts.map` on a
  pts-less text object) → "can't go back into the editor." Fix: the reopen map only
  deep-copies `pts` when present. Both reproduced + confirmed fixed in preview
  (faithful pointerdown→pointerup→click simulation; save→reopen round-trip with a
  text object restores cleanly).
- **Owner-requested follow-ups (2026-08-23) — ALL BUILT + verified, uncommitted:**
  - **Brush/text Size** — one S/M/L toolbar control (`sizeLevel` 0.6/1/1.6) scales pen
    & marker stroke width and the size of newly placed text. Stroke `width` / text
    `size` stored per-object (self-describing; export unchanged).
  - **Move tool** (`data-tool="select"`, move icon) — click a label to select it (dashed
    highlight via an appended `#mk-selrect` using `getBBox`); drag to reposition;
    contextual `#mk-selbar` gives Edit (reopens the entry), per-label **S/M/L** resize,
    **rotate ±15°** buttons (map-editor style), and Delete. Rotation stored as `rot`
    (deg) on the text object; rendered `transform="rotate(rot x y)"` and exported via
    canvas `translate/rotate` about the anchor (alphabetic baseline preserved).
  - Interaction hardening: text placement + move-deselect run on `click` (not
    pointerdown) and `ov`'s backdrop click-to-close was **removed** — both were
    footguns that re-targeted a mid-gesture click to `ov` and closed the editor. A
    capture-phase `pointerdown` resets a one-shot `suppressClick` so a drag's trailing
    click never deselects.
  - Verified in preview (1280×900 viewport — note: the headless viewport can collapse
    to 0×0 after a reload, making `pt()` divide-by-zero and coords read `NaN`; set a
    viewport before coordinate-based simulation): size scaling (3× S→L), place/select/
    drag/rotate/resize/edit/delete/deselect, save→composite upload, and reopen of an
    overlay with a rotated+resized label restoring `rotate(-20 …)` / size 34. 142/142,
    console clean.

### v1 baseline + D2 (already committed)

**D2 — Academies gate + WIP placeholder — DONE (committed `929d136`, not pushed).** `renderAcademies`
early-returns a coming-soon placeholder (graduation-cap, "Academies — coming
soon", WORK IN PROGRESS, decided two-paragraph blurb) for anyone whose
`me?.role !== 'site_admin'`; only the site admin sees the functional list + New
Academy. **UI-only gate** (owner-chosen) — server academy API untouched, so
`academies.test.js` stays green. Verified both roles, desktop + mobile; 142/142.

**D1 v1 — Media View/Edit markup editor — committed locally (`d932881`); v2 now built on top (uncommitted, see above).**
Full-size viewer + drawer on every media row. Plan file:
`~/.claude/plans/refactored-marinating-lamport.md`. What landed:
- **Client** (`public/index.html`): `openMarkupEditor(item, onSave)` (modeled on
  `openMapEditor` — body overlay, Back-trap, leave-guard); pencil View/Edit button
  left of trash in `drawMedia`; tools = pen, object-level eraser (tap a stroke),
  solid-color grid + Recently used (`localStorage.pcMarkupRecentColors`). Overlay
  is serialized to a JSON string in `buildScenarioBody` and parsed back in the
  `renderCreator` load path. Export composites via **Canvas 2D** (`drawImage` +
  stroke), NOT SVG-with-`<image>` (browsers taint/block that), then uploads through
  the existing `POST /api/media`.
- **Server**: `scenario_media` gained nullable `base_url` + `overlay` columns
  (`server/db.js` `addColumn`); `mediaFor` selects them; `replaceMedia` persists
  them and **caps `overlay` at 256 KB** (`MAX_OVERLAY_BYTES`). `url` stays the
  flattened composite so all read sites remain plain `<img>` (no read-site changes).
- **Test**: `test/media-pdf.test.js` — overlay round-trip, plain-media-stays-null,
  over-cap-dropped. **142/142.**
- **Verified in preview** end-to-end: draw (2 colors) → save → composite + Scene
  Reference update; reopen → strokes reload over the frozen base; erase-all → save
  → reverts to clean base; full save-draft → server → reload → reopen persists;
  object-erase; mobile 375px; console clean.

**Next options:** (a) **commit D1 v2** (working-tree `public/index.html` +
`test/media-pdf.test.js`), then **push** all 3 local commits to deploy on Railway;
(b) **Phase E** (E1 credit byline surviving cloning + card chip, E2 clone→original
review link). D1 v2 is done; D3 stays parked. Known minor: re-editing orphans the
prior composite in `/media` (no GC today — acceptable at this scale).

---

## Phase C — COMPLETE, committed & pushed (`f82407f`)

**C9 — Relabel MVA → MVC (display only) — DONE.** New
`catLabel(c)` helper (next to `CAT_META`, `public/index.html`) maps the
stored `'Motor Vehicle Accidents'` value to `'MVC'` for display; `CAT_META`'s
tab-strip label changed `'MVAs'` → `'MVC'` too. Applied at every raw-category
display site: scenario cards (grid + list), scenario detail, reviewer queue,
live session header, session detail, "Next in <category>", the coverage
table header, and the creator's Category `<select>` — which now has an
explicit `value="Motor Vehicle Accidents"` on the option, separate from its
`MVC` label text (previously the value was implicit = the label text, so
just relabeling would have silently changed what gets saved). Stored value,
`SUBCATS` key, `cat-k-mva` CSS, `icon:'mva'` all untouched — no migration.
Verified in the preview: Community tab strip + filter accordion read "MVC";
picking "MVC" in the creator round-trips the real `Motor Vehicle Accidents`
value (Vehicle Type detail section still appears correctly). 141/141 pass.

**C8 — Dropdown caret indicators — DONE (committed `f82407f`).** Every native
`<select>` in the creator (category, subcategory, primary/secondary
objective, difficulty, and the per-question media-kind/stage/objective
selects) is now wrapped in `.sel-wrap` with a custom chevron (`selCaret`,
`public/index.html` next to `ftChev`) that flips 180° on open/close via
`.sel-wrap:focus-within .sel-caret` (plus `:has(select:open)` for browsers
with native support — CSS lives right after `.ft-plain`, ~line 91). Native
select doesn't have a universal JS "open" event, so `:focus-within` is the
open/close proxy; verified it flips on focus and resets on blur. Scoped to
the scenario creator (Phase C), not the app-wide `lib-sort`/`ac-add`/settings
selects outside it. Verified in the preview at desktop + mobile; 141/141
pass.

**C2, C3, C4, C5, C6, C7 — DONE, committed** (`8977e8b`, `26c19fe`, `98870e0`,
`3dd541b`, `886f954`, `251b5db`).
- **C2 (Scene Reference sticky buffer):** bumped the desktop scene rail
  `lg:top-20`→`lg:top-28` so it clears the sticky header (`public/index.html:1734`).
- **C3 (Finish Scenario → center modal):** new promise-based `publishModal()` in
  `renderCreator` replaces the inline bottom-expand publish step; `applyVis()`
  parametrized `(seg, hint)` to serve both modal and the inline `#publish-block`
  (kept for the editing-a-published-scenario "Save changes" path).
- **C4 (draft detail "Continue Editing"):** `renderScenarioDetail` branches on
  `s.is_draft`: Continue Editing + Clone only; Try Solo / Host Live / role picker
  hidden and their bind logic skipped.
- **C5 (Questions required indicator):** "Questions \*" header + helper text;
  `validateFinish()` also blocks Finish (toast) if every question prompt is
  blank, mirroring `buildScenarioBody`'s existing filter.
- **C6 (Question numbers):** mostly pre-existing (creator/live/host/solo/review/
  reviewer-queue already numbered); fixed the one gap — host's per-participant
  roster-expand now numbers against the *global* question order.

**C7 (Template picker rework, `251b5db`):** picking a template
minimizes the picker in place to a "Choose a different template" bar
(`bindTplPicker`/`tplPickerBodyHtml`, `public/index.html` ~1826) instead of
removing it and force-scrolling; re-opening lets the author switch templates.
Template-filled **prompt** and **stage** fields get an amber ring
(`q._tplFilled`, stamped by `tplQ`), each clearing independently the moment the
user edits that specific field. Scoped out: role chips (already amber for
"selected" — a second amber ring there would be ambiguous). Verified in preview
at desktop + mobile: no scroll on pick, minimize/reopen/re-pick cycle, rings
clear independently; 141/141 pass.

Phase-C UI primitives already built in C1 and reusable downstream:
`confirmDialog()` (styled promise-based modal) and `undoToast()` (bottom-left
undo). C3's publish modal can lean on `confirmDialog`'s markup/pattern.

## Recent (2026-08-18 → 08-21) — shell/access rework + C1 (all on `main`, 141/141)
Each its own commit, all verified in the browser preview:
- **C1. Delete-confirm modal + media undo** (`76fdf83`). `confirmDialog()`
  replaces native `confirm()` on the 4 persistent deletes (scenario, discard
  session, delete session, delete academy); Cancel focused, Esc/backdrop cancel.
  Media removal now uses `undoToast()` (re-inserts at same index) not a confirm.
  Moot/left as-is: delete-account (no such feature), in-form question/answer
  removes, end-session/remove-participant/leave-department native confirms.
- **Difficulty/Objective accordions + mobile rename** (`01a6775`) — diff/obj
  filters use the same accordion dropdown as categories; mobile "New" → "Create
  Scenario".
- **Guest scenario creation** (`9ccf38a`) — "+ Create Scenario" visible to all;
  guests build freely, sign up at Save, work auto-posts to the new account
  (stashed in `sessionStorage.pendingScenario`, replayed in `renderAuth` `go`).
  Media prompts signup. Post-login default → My Library.
- **Collapsible sidebar** (`3a08de0`) — ☰ collapses to an icons-only rail
  (persisted), hover tooltips on collapsed icons + account/logout.
- **Filter left drawer** (`4344a57`) — replaces the inline dropdown; docks right
  of the sidebar, dims content, Esc/backdrop close.
- Decisions recorded in `f26103a`. Loose thread: guests still can't upload media
  (prompt-to-signup only); revisit if owner wants inline guest media.

## Older backlog context

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

**Phase B — DONE & COMMITTED on `main`.** B2 Sort By + B5 clone toast/Cloned
tag (`e3acc23`); B1/B3/B4 filter rework (multi-select category strip + synced
nested subcategory tree, Reset Filters, compact desktop filter). The B4 inline
dropdown was later superseded by the **left-docked filter drawer** (`4344a57`);
`filterRail`/`bindFilterRail` → `filterDrawer`/`bindFilterDrawer`. Category +
subcategory state lives in `st.cats`/`st.subs` Sets keyed `"Cat::Sub"` with
union semantics in both `renderLibrary` and `renderPublic`; the accordion markup
is `catTreeHtml`, and diff/obj use `selAccordionHtml`. **Now in Phase C** — see
"Resume here" at top.

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
