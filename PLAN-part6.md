# ProtoCall — Part 6 Implementation Plan

Source: owner's field notes from exploring the site (2026-07-10). Executor: Opus 4.8.

## Codebase orientation

- **Client**: entire SPA lives in `public/index.html` (~2,100 lines, template-literal render functions). Scenario creator is `renderCreate` (~line 385–630); question editor is `drawQs` (~line 560–595); library filters ~line 270–360; public library ~line 1269+; review queue is `renderReview` (route map line 192).
- **Server**: Fastify app in `server/index.js`. Scenario create/update ~lines 740–800; taxonomy validation (`duration_min`, `building_type`, objectives) ~lines 531–556. Schema + migrations in `server/db.js` (`addColumn` helper, ~line 175+).
- **Tests**: `test/*.test.js` (node test runner via `npm test`). Taxonomy rules in `test/taxonomy.test.js`, review flow in `test/review.test.js`.
- Run `npm test` after each numbered task. Update tests that assert removed fields (e.g. `duration_min`).

---

## Task 1 — Visibility: allow Department + Public together

Today `scenarios.visibility` is a single enum (`private` | `department` | `public`), picked via mutually-exclusive tag buttons in the creator (index.html ~line 526–530, `draftVis`).

- **Data model** (server/db.js): keep `visibility` for back-compat but add migrated boolean columns `shared_department INTEGER DEFAULT 0` and `shared_public INTEGER DEFAULT 0`. Migration: `visibility='department'` → shared_department=1; `'public'` → shared_public=1; `'private'` → both 0. Derive an effective visibility for existing queries (a scenario is visible to dept members if shared_department, to everyone if shared_public; private = neither).
- **API** (server/index.js): accept `shared_department` / `shared_public` booleans on create/update; reject shared_department without a department membership. Keep writing a legacy `visibility` value (public > department > private precedence) so old code paths and the review queue keep working.
- **UI**: in the creator (and the Review/Edit view — same `renderCreate` function handles both), turn Private into one option and Department/Public into toggleable chips that can both be on. Private deselects the others and vice versa. Update the library/public filters and the DEPARTMENT/PUBLIC badges in `scenarioCard` (~line 243) to show both badges when both are set.
- Update `test/review.test.js`, `test/departments.test.js`, `test/taxonomy.test.js` as needed; add a test for the combined state.

## Task 2 — Category-aware learning objectives + field decluttering

Objectives come from `GET /api/objectives` (flat list from `learning_objectives` table, seeded in server/db.js ~line 196).

- Add a `category` (or `categories` CSV/tag) column to `learning_objectives`; tag each seeded objective as Fire, EMS, MVA (Motor Vehicle Accident), or General. **Expand the seed list for EMS and MVA** — add ~5–8 solid objectives each (e.g. EMS: primary assessment, airway management, triage/START, patient handoff, refusal documentation; MVA: extrication priorities, traffic incident management, vehicle stabilization, hazard control).
- `GET /api/objectives?category=X` returns objectives tagged X plus General; no param returns all (keeps filters working).
- In `renderCreate`, repopulate the two objective `<select>`s whenever `#c-cat` changes; clear a selected objective if it's no longer in the list.
- **Hide Building type for EMS**: when category is EMS/Medical, hide the `#c-bldg` field and submit `building_type: ''`.
- Server: on create/update, optionally validate objective belongs to the scenario's category (soft — General always allowed).

## Task 3 — Remove Duration entirely

- Delete the Duration field from `renderCreate` (index.html ~line 454) and drop `duration_min` from the submit body (~line 604).
- Server: stop accepting/validating `duration_min` (server/index.js ~lines 542, 551–552, and the INSERT/UPDATE column lists ~752, 797). Leave the DB column in place (harmless) but stop writing it.
- Remove any duration display/filter in library and public views; fix `test/taxonomy.test.js` assertions.

## Task 4 — Building type: structured multi-select

Replace the free-text `#c-bldg` input (~line 456) with a checkbox tree, e-commerce-filter style:

- **Residential**: 1 story, 2 story, 3+ story, Has basement, Attached garage, Mobile home
- **Commercial**: Strip mall, Big box, High-rise, Warehouse, Mixed-use
- **Construction type**: Type I (fire-resistive), Type II (non-combustible), Type III (ordinary), Type IV (heavy timber), Type V (wood frame)
- **Other**: Vacant/abandoned, Under construction/renovation

UI: collapsible `<details>` groups with checkboxes; multiple selections allowed across groups. Store as JSON array in the existing `building_type` TEXT column (migrate: existing free-text values become a single-element array). Server validates it's an array of strings from the known list (plus allow legacy strings). Display in scenario cards/host view joins with " · ".

## Task 5 — Image upload: drag & drop

The upload control (~line 463, handler ~line 544) is click-only.

- Wrap it in a drop zone: `dragover`/`dragleave` toggle a highlight class; `drop` takes `e.dataTransfer.files[0]` and feeds the same upload function the file-input change handler uses. Keep click-to-browse. Validate image MIME client-side before uploading; server validation already exists in `server/media.js`.

## Task 6 — Question editor overhaul (`drawQs`, index.html ~560–595)

1. **Stage field → preset dropdown + custom** (~line 575). Presets: Dispatch, En Route, On Arrival / Size-Up, Initial Actions, Escalation, Command Transfer, Patient Contact, Transport, Termination — plus "Custom…" which reveals a text input. **Remembered custom stages**: on scenario save, POST the user's custom stage names to a new `user_stage_presets` table (user_id, name, last_used_at); `GET /api/me/stage-presets` returns them, and the dropdown lists them under a "Your stages" group. (This is the seed of per-user creation memory — keep the table generic enough to extend later.)
2. **Role track → choice list** (~line 576): replace free text with multi-select chips from a fixed list (Firefighter, Driver/Engineer, Officer, EMT, Paramedic, Battalion Chief, Dispatcher) plus custom entry. Store as comma-joined string to stay compatible with the existing `role_track` matching in `server/rooms.js` — check how role filtering compares tracks and keep it working (may need to split on comma when matching).
3. **Multiple choice: one line per answer** (~line 584): replace the single `|`-separated input with a vertical list of inputs labeled A, B, C, D…; an "+ Add choice" button appends a line; an × removes one. Keep storing `choices` as an array (no schema change). Audience is non-technical firefighters — zero syntax.
4. **Instructor answer for MC**: let the creator click the correct choice letter instead of typing it.
5. **"Select All That Apply" question kind**: new `kind: 'select_all'`. Same A/B/C/D editor, but the creator toggles multiple correct choices; store correct set in `instructor_answer` as JSON array of letters/indices. Server: accept the new kind in question validation (server/index.js create/update); participant UI (`renderJoin` answer rendering) shows checkboxes instead of radio buttons; grading/review views show the correct set. Add tests.
6. **Add-question button** (~line 524, `#c-addq`): move it to the bottom of the question list, label it "+ Add Question".
7. **Delete question**: add an × button on each question card that splices `draftQs[i]` and redraws. Guard: keep at least one question, confirm if the question has content.
8. **Auto-growing textareas**: convert prompt/instructor-answer inputs to `<textarea rows=1>` with an `input` listener setting `style.height = 'auto'; style.height = scrollHeight + 'px'` (make it a small shared helper; apply everywhere long text is entered).

## Task 7 — Review Queue: "Review & Edit" button sizing

In `renderReview`, the Review & Edit button's height is too tall. Reduce vertical padding (likely `py-*` class) so it matches the other compact buttons in the row (e.g. `px-3 py-1.5 text-sm`). Visual check via preview.

---

## Execution order & verification

1. Task 3 (small, clears the field) → 2 → 4 → 1 (largest data-model change) → 5 → 6 → 7.
2. After each task: `npm test`; then start the dev server (`.claude/launch.json` exists) and verify in the browser preview — creator form, review queue, participant join flow for Task 6.5.
3. Commit per task with a descriptive message.
