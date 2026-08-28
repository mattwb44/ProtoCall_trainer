# UX / polish backlog — grill session 2026-08-16

Owner-driven backlog from the 2026-08-16 grilling session. The four forks the
owner decided are marked **DECIDED**; everything else carries the recommended
approach (owner did not object). Grouped by theme, phased by priority
(correctness/safety first). Grounding notes point at the current code so the
executor starts from fact, not guess.

Convention: `[ ]` open, `[x]` done. Tick only when the Definition of Done is met.
Non-trivial items get a `verifier` pass before being marked done.

---

## Phase A — Live-session correctness & safety (do first)

- [x] **A1. Host view rework — mirror the crew view.** The host should see the
  *same* screen participants see (scene, dispatch, current-stage questions) plus:
  a participant **roster** (names + presence), **kick** power, and **advance-stage
  buttons**. It must show **question numbers**, not just an anonymous box per
  question with a "waiting for responses" field.
  - _Grounding:_ Phase 3 already shipped `renderHost`/`drawHost` + `drawRoster`
    (`90a18e0`) that were *supposed* to do this (crew mirror + roster + boot +
    per-stage completion chips). Re-examine why the live result doesn't match —
    likely the crew-mirror half regressed or never rendered question numbers.
    Start at `drawHost`/`drawRoster` in `public/index.html`. Don't rebuild from
    scratch until you've confirmed what's actually rendering.
  - _Decided (2026-08-16):_ host sees the exact crew screen (numbered questions,
    real text) PLUS a **host-only reveal** of the correct/official answer per
    question PLUS a small **"N/total answered"** counter — not the big "waiting
    for responses" box. Who's-in / kick lives in the side roster.
- [x] **A2. Presence cleanup — "1 joined" lingers after the room ends.** When a
  participant leaves an ended session, the host page still shows them as joined.
  Clear roster presence on disconnect / session-end so the count is accurate.
  - _Grounding:_ `emitRoster` fires on join/answer/shift/boot/disconnect;
    check the disconnect + session-end paths and `rooms.roster` presence state.
- [x] **A3. Ended-session wrap-up flow.** On session end, show an unambiguous end
  state with a **"Finished Reviewing"** button.
  - **Logged-in host → auto-save.** The session persists automatically; surface a
    prominent **"Return to Homepage"** with **Discard** as a clearly-secondary
    option (not a 50/50 choice). Rationale: a completed session is training
    history; forcing a keep/lose choice risks accidental data loss, and My
    Sessions already supports deleting later.
  - **Guest → "Create account to save" or Discard** (nothing persists otherwise).
  - Replaces today's ambiguous "is it over?" state. Pairs with A4.
  - _Decided (2026-08-16, revised in review):_ applies to **both hosted sessions
    and solo runs** (solo version stays lightweight). Auto-save for logged-in,
    save-or-signup for guests.
- [x] **A4. Lock ended sessions against restart.** **DECIDED.** After a session
  ends, the **Advance stage** button must not resurrect it. To re-run the same
  scenario, the host goes back to the scenario page and clicks **Host** (fresh
  session/room). _Good news from testing: even when a session was restarted
  3×, it still saved only once — so no dup-save bug, just the restart to block._
  - _Grounding:_ session `status`/`started_at` on live sessions; gate the
    advance/socket handlers on a terminal status.
- [x] **A5. Auto-complete finished sessions + sweep the stuck ones.**
  **DECIDED.** A session flips **IN PROGRESS → COMPLETED** automatically when it
  finishes (last question answered / session ended), and a one-time migration
  sweeps the existing genuinely-finished "In Progress" rows in My Sessions to
  Completed. (Opening a stuck one today shows only the scenario Q&A with no way
  to end it — this removes the dead-end.)
- [x] **A6. Map-editor back-nav guard (bug).** With the top-down map editor open,
  clicking the top-left **Go back** navigates away but the editor stays popped up
  and visible. Add an unsaved-changes guard on back-nav: pop a dialog offering
  **Leave without saving** / **Save as Draft**, and close the editor modal on
  route change regardless.
  - _Grounding:_ `openMapEditor()` in `public/index.html`; the creator already
    has an unload warning gated by `creatorMounted` — reuse that machinery.

---

## Phase B — Library & filter UX

- [x] **B1. Categories + Subcategories → one synced multi-select control.** DONE.
  **DECIDED.** Replace the single-select category strip with an independent
  **multi-toggle** exposed in **two synced places**: the top-of-page strip and
  the filter box. Behavior:
  - Click a category → fills with **its color** and shows its scenarios. Others
    are unaffected (no longer gray out).
  - Click a 2nd → it fills with its own color and adds its scenarios (both now
    on). Click the 3rd → all three on / all shown.
  - **Re-click** a selected category → grays it and **hides** its scenarios;
    re-click again → back on.
  - Zero categories selected = show all (default state).
  - Selecting a category reveals **its subcategories as nested checkboxes**;
    subcategory options come from the existing `SUBCATS`
    (`public/index.html:657`) — the same list scenario creation already uses.
  - **Identical animations** whether toggled at the top or in the filter box;
    the two controls stay in sync.
  - _Decided (2026-08-16):_ the **top strip is categories-only** (quick toggle);
    the **filter box** shows categories + their nested subcategory checkboxes. A
    category toggled on with **no subcategory checked = all its scenarios**;
    checking subcategories narrows within it. Results are the **union** across
    everything selected.
  - _Grounding:_ today's `catStrip` (`public/index.html:462`) is single-select
    (`cur === '' || cur === name`) driving a per-category CSS wash
    (`--c/--tint/--glow`, Fireground=red / EMS=blue / MVA=amber,
    `public/index.html:63`). The "Subcategory filter only shows All" bug is a
    *consequence* of single-select: subcategories key off the one selected
    category (`SUBCATS[st.cat]`), which is empty by default — multi-select fixes
    it for free.
  - _Naming note:_ **DECIDED (2026-08-16): rename MVA → MVC everywhere** (MVC is
    now the prevalent term). See C9 for scope.
- [x] **B2. "Sort By" control + default "Recently updated" sort.** DONE (`e3acc23`).
  **DECIDED (2026-08-16, refined in review).** Add a **"Sort By"** control at the
  top of **My Library** (right-aligned above the grid, near the view toggle).
  Options: **Recently updated** (default) · **Newest** · **Oldest** · **A–Z**.
  My Library only for now — Community and other lists keep their current default.
  - _Requires a new `updated_at` column_ on `scenarios` (today it has only
    `created_at` — `server/db.js`). Backfill `updated_at = created_at` for
    existing rows. Bump it **only on a real content change** (title, description,
    category/subcategory, questions, media) or **publishing a draft** — never on
    a no-op save (fits the existing autosave baseline that already skips no-op
    ticks), and never on plays/views/being-cloned. So a new scenario has
    `updated_at == created_at`; "Recently updated" and "Newest" diverge only once
    an older scenario is edited (which is exactly when floating it up helps).
    Draft autosave bumping it (raising an actively-edited draft) is intended.
- [x] **B3. Reset Filters button.** DONE. One click restores categories/
  subcategories/sort/etc. to the show-everything default. Lives in both the
  desktop dropdown and the mobile sheet (`[data-reset]`).
- [x] **B4. Compact the filter on web.** DONE. Desktop "Filters · N" button
  expands an inline dropdown (`filterRail`/`bindFilterRail`), collapsed by
  default so the grid keeps full width; mobile keeps its Phase 2 bottom sheet.
- [x] **B5. Immediate clone + undo toast + "Cloned" tag.** DONE (`e3acc23`). **DECIDED (2026-08-16,
  revised in review — no pre-clone confirm).**
  Full flow:
  1. Clicking **Clone** copies immediately (no confirm dialog — cloning is cheap
     and the toast is the safety net).
  2. A **bottom-left toast** appears: **"Clone Successful"** with a highlighted
     **"Undo clone"** link that deletes the clone just made. Timing: **5s fully
     visible, then a 2s fade-out** (~7s total). **Hover pauses the countdown**,
     and if the fade has already begun, hover **snaps it back to fully opaque**.
     Once dismissed, undo is no longer offered — the user removes it via My
     Library instead.
  3. In **My Library**, the cloned scenario carries a **"Cloned" tag**.
  - _Optional guard:_ if the user clones something **already in their library**, a
    light "You already have a copy — Clone again?" nudge is acceptable; not for
    the first clone.
  - _Tag design (recommended, senior-UX):_ a small low-emphasis neutral pill —
    slate background, `git-fork` (or `copy`) lucide icon + "Cloned" — with a
    tooltip "Cloned from {source title}". Low emphasis so it informs without
    competing with Official/status badges.
  - _Grounding:_ the `cloned_from` column is written on clone
    (`server/index.js:1112`) but never read back for display — surface it for the
    tag + tooltip. Clone already works reliably (every clone lands in My Library);
    this adds the confirm, the undo affordance, and the feedback.

---

## Phase C — Scenario-creator polish

- [x] **C1. Global delete-confirm modal + media undo.** DONE (2026-08-21). Reusable
  styled `confirmDialog()` (promise-based, Cancel focused so a stray Enter can't
  confirm; Esc/backdrop cancel) replaces native `confirm()` on the persistent
  server-side deletes: **delete scenario, discard session, delete session, delete
  academy**. **Media removal** uses a bottom-left **Undo toast** (`undoToast`,
  re-inserts at the same index) instead of a blocking confirm — it's cheap and
  client-side until save, so undo is the better recovery than double-friction.
  - _Not done — no such feature exists yet:_ **delete account** (the account page
    has no deletion). Add the confirm when/if account deletion is built.
  - _Left as-is (per decision):_ in-form removes (question row / answer option) get
    no modal; end-session / remove-participant / leave-department keep their native
    confirms (not deletes of persistent records in the C1 sense).
  - _Decided (2026-08-16):_ confirm only on **destructive/persistent** deletes
    (delete scenario, delete session, delete academy, remove uploaded media,
    delete account) — **not** on in-form element removes (a question row or an
    answer option before save), which are cheap and reversible until save.
- [x] **C2. Scene Reference sticky buffer.** DONE (2026-08-21). The desktop scene
  rail stuck at `lg:top-20` (80px) while the sticky "Edit Scenario"/"Scenario
  Creator" header bar ends at 105px (56px nav + 49px header) — hiding the rail's
  top ~25px. Bumped the rail to `lg:top-28` (112px), giving a ~7px clearance below
  the header. CSS-only, one class on `#scene-rail` (`public/index.html:1734`).
  Verified in preview at 1280px: rail top 112px, header bottom 105px, no overlap.
- [x] **C3. Finish Scenario → center modal.** DONE (2026-08-21). Clicking **Finish
  Scenario** on a new/draft scenario now opens a centered promise-based
  `publishModal()` (mirrors `confirmDialog`: dimmed backdrop, Esc/backdrop cancel,
  Finish&Save focused) hosting the "Publish to" visibility toggles + a Finish &
  Save confirm — replacing the old inline bottom-expand (`setActions('publish')`
  removed). `applyVis()` was parametrized `(seg, hint)` so the same control drives
  both the modal and the inline `#publish-block` (still used for the
  editing-a-published-scenario "Save changes" flow, unchanged). All in
  `renderCreator`, `public/index.html` (~1834 applyVis, ~1909 publishModal/
  setActions). Verified in preview: modal opens, toggles update hint/highlight,
  Esc cancels, Finish & Save → POST 201 → My Library; 141/141 tests pass.
- [x] **C4. Draft detail page: add "Continue Editing."** DONE (2026-08-21).
  `renderScenarioDetail` (`public/index.html`) now branches on `s.is_draft`: a
  draft shows **Continue Editing** (`<a href="#/create/{id}">`, primary/emerald)
  + **Clone** only; **Try Solo / Host Live / "Play as" role picker** are hidden
  entirely (and their bind logic — `bindLaunchButtons`, solo-role click handlers
  — is skipped for drafts, not just visually hidden). Non-draft scenarios are
  unchanged. Safe by construction: `canSee` only lets the owner (or a reviewer)
  load an unshared draft's detail page at all, so no non-owner ever sees this
  branch. Verified in preview: created a draft, opened its detail page (saw
  Continue Editing + Clone, no play controls), followed the link to
  `#/create/:id` and confirmed the editor loaded the draft's title; 141/141
  tests pass (client-side only, no server change).
  - _Decided (2026-08-16):_ **hide Host Session / Try Solo on draft detail**;
    Continue Editing is the primary action (drafts are unplayable by design).
- [x] **C5. Questions required indicator.** DONE (2026-08-21). Questions section
  header now reads "Questions \*" with a helper line "\* Must have at least 1
  question to submit." (reusing `REQ_MARK`, matching the Scene Details header
  pattern). Also added matching enforcement in `validateFinish()` — Finish
  Scenario now toasts "Add at least one question" and blocks the publish modal
  if every question's prompt is blank (mirrors `buildScenarioBody`'s existing
  `q.prompt.trim()` filter, so the check reflects what actually gets saved).
  `public/index.html` ~1720 (markup) and ~1914 (`validateFinish`). Verified in
  preview: asterisk/helper render, Finish blocked+toasted with a blank prompt,
  proceeds to the C3 publish modal once a real prompt is typed; 141/141 pass.
- [x] **C6. Question numbers.** DONE (2026-08-21) — mostly pre-existing.
  Creator (`drawQs`), live crew (`qCard`), host matrix (`drawMatrix`), solo
  (`renderSolo`), after-action review, and the reviewer queue **all already**
  rendered `Q{n}.` before this session. The one gap found: the host's
  per-participant roster expand (`drawRoster`, `public/index.html` ~2562) listed
  each seat's questions with only a check/circle icon, no number — impossible to
  cross-reference against the numbered matrix above it. Fixed by numbering
  against the *global* question order (`hostState.questions.indexOf(q)+1`, not
  the participant's role-filtered subset index), so "Q3" in the roster always
  matches "Q3" in the matrix even when a seat skips earlier questions. Verified
  live end-to-end: created a 2-question scenario, hosted a session, joined as a
  participant and answered only Q2, confirmed the host's roster-expand showed
  "Q1. First question?" / "Q2. Second question?" matching the matrix's Q1/Q2;
  141/141 tests pass (client-side only, no server change).
- [x] **C7. Template picker rework.** DONE (2026-08-21). Picking a template no
  longer removes the picker or scrolls/yanks the page to Questions — it
  minimizes in place to a **"Started from '{label}' · Choose a different
  template"** bar (`public/index.html` ~1826, `bindTplPicker`/`tplPickerBodyHtml`);
  clicking it re-expands the full grid to switch templates, re-seeding
  `draftQs`. Template-filled fields (question **prompt** and, where the template
  sets it, **stage**) get a yellow/amber ring (`drawQs`'s `q._tplFilled` reads,
  `tplQ` now stamps `_tplFilled: {prompt, stage}`); each ring **clears
  independently** the moment the user edits that specific field (prompt oninput,
  stage onchange), without a full re-render so focus isn't lost. Scope note: did
  **not** highlight the per-question role chips — they already use amber for
  "selected", so a second amber ring would be visually ambiguous; roles are a
  minor field on only one template ("Full multi-role incident"). Verified in
  preview at desktop + mobile widths: no scroll on pick, minimize/reopen/
  re-pick cycle works, prompt+stage rings render and clear independently
  (editing one leaves the other highlighted); 141/141 tests pass.
  - _Decided (2026-08-16):_ each field's yellow border **clears once the user
    edits that specific field** (per-field, signaling "you've taken ownership").
- [x] **C8. Dropdown caret indicators.** DONE (uncommitted). Native `<select>`
  dropdowns in the creator (category, subcategory, primary/secondary objective,
  difficulty, per-question media kind/stage/objective) now show a custom
  chevron caret that flips 180° on open/close via `.sel-wrap:focus-within`
  (`:has(select:open)` layered on for browsers with native support). Verified
  desktop + mobile in the preview; 141/141 pass.
- [x] **C9. Relabel MVA → MVC (display only).** DONE (uncommitted). New
  `catLabel(c)` helper (next to `CAT_META`, `public/index.html`) maps the
  stored `'Motor Vehicle Accidents'` value to `'MVC'`; `CAT_META`'s tab-strip
  label also changed `'MVAs'` → `'MVC'`. Applied at every raw-category display
  site: scenario cards (grid + list), scenario detail, reviewer queue, live
  session header, session detail, "Next in <category>", the curriculum
  coverage table header, and the creator's Category `<select>` (which now
  carries an explicit `value="Motor Vehicle Accidents"` separate from its
  `MVC` label text, so the option's implicit value — previously the display
  text itself — doesn't silently become the stored category). Left untouched
  as designed: the `Motor Vehicle Accidents` category value, `SUBCATS` key,
  `cat-k-mva` CSS class, and `icon: 'mva'` — no DB migration, no risk.
  Verified in the preview: Community tab strip + filter accordion + coverage
  header all read "MVC"; picking "MVC" in the creator round-trips the real
  `Motor Vehicle Accidents` value into `DETAIL_FIELD_BY_CAT` (Vehicle Type
  section correctly appears). 141/141 pass.

---

## Phase D — Larger features

- [x] **D1. Media View/Edit markup editor.** **v1 → v3 + follow-ups all DONE,
  committed** (`d932881` … `f0b968d`, 8 commits ahead of `origin/main`, not
  pushed). v3 added on-canvas text handles (corner-anchored resize, rotate,
  inline editing, letter-border contrast halo), a freehand radius eraser,
  morphing per-tool size popovers (4 sizes + highlighter opacity), Marker→
  Highlighter rename with a boot migration, and three switchable color
  palettes (Standard/Fire/Smoke) presented as chevron accordions matching the
  site's existing Filters pattern, capped 5-color Recently Used, and per-photo
  palette-expansion memory. See `docs/ai/next-session.md` for the full
  per-round changelog. v1 shipped: View/Edit (pencil) button left of trash on every media
  row (`drawMedia`, `public/index.html`), opening `openMarkupEditor(item, onSave)`
  — a full-size viewer + drawer modeled on `openMapEditor` (body overlay, Back-trap,
  leave-guard). Tools: **pen**, **object-level eraser** (tap a stroke to remove —
  the only semantics compatible with the editable-overlay reload), **solid-color
  grid** (single Grid, no opacity/spectrum — distinct from Apple) + **Recently
  used** row (`localStorage.pcMarkupRecentColors`, records on apply). Storage per
  D1a: `scenario_media` gained nullable `base_url` + `overlay` columns
  (`server/db.js`); `url` stays the flattened composite (Canvas-2D `drawImage` +
  stroke, uploaded via existing `POST /api/media`) so every read site stays a plain
  `<img>`. Overlay serialized as a JSON string at the `buildScenarioBody` boundary,
  parsed back on load; server caps it at 256 KB (`replaceMedia`). Reopen reloads
  strokes over the frozen base (individually erasable); erasing all + Save reverts
  to the clean base. Verified end-to-end in the preview (draw→save→composite,
  reopen→reload, erase-all→revert, full server round-trip, mobile, object-erase);
  server round-trip test in `test/media-pdf.test.js`; **142/142 pass.**
  **v2 (deferred, separate pass):** marker, **Add Text** tool, **Undo/Redo**,
  richer recent-colors. See the original spec below for the full v2 intent.
- [ ] **D1 (original full spec, retained for v2).** Each uploaded media item gets a
  **View/Edit** button to the *left* of the trash button (today only the first
  uploaded media shows under Scene Reference, with no way to view its actual
  size). View/Edit opens a markup editor with: **pen**, **marker**, **eraser**,
  and a **colors** button that pops a grid of **solid** colors (no opacity), plus
  a small **"Recently used colors"** row that only records a color once it's
  actually applied to the photo. Design must be visually distinct from Apple's
  Photos markup UI (no copyright echo). _Large — schedule as its own effort._
  - _Decided (2026-08-16):_ the marked-up image is what's used everywhere
    ("overwrite the original"), **but** a re-open **Edit** button must let users
    **erase/delete markups they previously made** — so markups can't be
    irreversibly flattened; they're stored as an **editable overlay** (see D1a).
    Also add an **"Add Text"** tool: colored, typed text placed on the image,
    using the same solid-color palette. Editor also has **Undo / Redo arrow
    buttons**. **Build after Phases A–C** (biggest item). Note: orthogonal to the
    C1 media *Undo* (which recovers a *deleted* media item, not a pre-annotation
    state).
  - _Reference to diverge from:_ owner supplied Apple Photos' "Colors" panel
    (Grid / Spectrum / Sliders tabs, opacity slider, recently-used row with `+`).
    Ours must look distinct: **single Grid only, no opacity/Spectrum/Sliders**,
    solid colors, our own chrome. Use it as a "do not clone this UI" anchor.
  - **D1a. Markup storage — DECIDED (2026-08-16): editable overlay.** Store the
    **base image + the markup layer (strokes + text objects) as editable data**
    (a few KB — negligible), and generate **one flattened composite** as the
    image shown everywhere else (so all other pages stay a plain `<img>`).
    Re-opening Edit reloads the editable objects so any prior stroke/text can be
    erased or moved. The ~2× byte cost applies only to *annotated* images and is
    trivial at scale; if storage ever gets tight, drop the stored composite and
    render on the fly (base + overlay already hold everything).
- [ ] **D3. Live host markup during a session — PARKED (2026-08-17).** Idea:
  while hosting, annotate the scene photo live (or start from a fresh, unmarked
  copy) to drive "what if the scene were different?" discussion. **Deferred by
  owner decision** — it's the heaviest item (needs Phase A host view *and* Phase
  D1 editor first, plus real-time image push + persistence rules), and its value
  is better served cheaply for now: the scenario already supports **multiple
  uploaded photos**, so an instructor can **pre-stage alternate scene photos**
  (garage open, car flipped, night/day) and switch mid-discussion — spatial
  grounding without live editing. Authoring-time markup (D1) still covers
  "annotate the scene." Revisit only if real usage shows instructors repeatedly
  wanting to draw live; if revived, use the pushed-snapshot approach (host draws
  → "Show crew" pushes the updated image over the existing session socket), never
  mutating the source scenario.
- [x] **D2. Academies gate + WIP placeholder.** DONE (uncommitted). `renderAcademies`
  now early-returns a **coming-soon placeholder** (graduation-cap icon, "Academies
  — coming soon", WORK IN PROGRESS tag, the two-paragraph blurb verbatim) for
  everyone whose `me?.role !== 'site_admin'` — standard users, dept admins, guests.
  Only the site admin (the single env-bootstrapped operator) reaches the functional
  list + New Academy button. **UI-only gate** (owner-chosen): the server academy API
  is untouched, so `academies.test.js` and the dept-academy path stay intact; a
  dept-admin could still hit `POST /api/academies` directly but has no UI path.
  Verified in preview: standard user → placeholder (desktop + mobile); promoted to
  site_admin → functional page with New Academy returns. 142/142 pass.
  - _Placeholder copy (draft for owner approval):_ **"Academies — coming soon.**
    An Academy is a curated, ordered path through ProtoCall scenarios: a guided
    track your department (or the whole site) can assign so members train in a
    deliberate sequence instead of picking scenarios at random. Think structured
    onboarding — promote-to-driver tracks, paramedic curricula, and
    department-specific skill ladders, all in one place. We're still building it;
    check back soon." (Ties to future stubs F3/F4.)

---

## Phase E — Attribution & credit (grill 2026-08-16)

- [ ] **E1. "Created by {display_name}" credit on every scenario.** Each scenario
  shows an author credit ("Created by {display_name}"). It **persists through
  cloning** so the *original* maker keeps credit.
  - _Grounding / catch:_ on clone today `author_id` is set to the **cloner**
    (`server/index.js:1112`), not the original — so credit needs a deliberate
    persistent mechanism (E1a). `users.display_name` is the name to show (no
    separate username column). Scenario APIs will need to join/expose the credit
    name (not currently returned for display).
  - **E1a. Credit persistence — DECIDED (2026-08-16):** a **stored persistent
    credit** field, captured at creation and **copied verbatim on every clone /
    re-clone**, kept separate from `author_id` (which still marks who owns *this*
    copy). Survives source deletion + multi-level clones; cheap read. No "Cloned
    by you" line on the scenario itself — the E2 review link covers the adapter.
  - **E1b. Credit form/placement — DECIDED (2026-08-16):** a **UI byline**, not a
    baked image watermark. A subtle "Created by {display_name}" near the title on
    the scenario **detail page** + a small **author chip on cards**. Clean,
    themeable, never obscures the scene or collides with markups.
- [ ] **E2. Clone → original-scenario link, in review contexts only.** A cloned
  scenario links back to the scenario it was cloned from, shown in **exactly two
  places**, both post-session review:
  1. **My Sessions → click an ended session →** the review view shows the link to
     the original scenario.
  2. **End of a hosted session, in the review stage** (after it ends).
  - **Not** visible during a live session, and **not** on the scenario detail /
    My Library (that surface only gets the E-adjacent "Cloned" tag from B5).
  - _Design:_ senior-UX treatment — a subtle, clearly-secondary "Cloned from
    {original title}" link (branch/link icon), placed unobtrusively in the review
    header/footer. Handle a deleted/soft-deleted original gracefully (show the
    remembered title, disable the link).
  - _Grounding:_ uses `cloned_from` (`server/index.js:1112`); ties into the A3
    wrap-up / review stage and the My Sessions ended-session detail.

---

## Future features (stubs — record only, not scheduled)

- [ ] **F1. Messages & chat.** Department head → member broadcasts; user ↔
  website support; user ↔ friends / other users.
- [ ] **F2. Quizlet-style flashcards.**
- [ ] **F3. Academy: "promote to driver" track.**
- [ ] **F4. Academy for paramedics.**
- [ ] **F5. "Choose Random Scenario" button on Community/My Library.** Tabled
  2026-08-24 when the "NEXT IN {category}" button at the end of a run was
  removed (owner liked the impulse to keep going, disliked it living at the
  bottom of a just-finished scenario). Revisit as a button on the Community or
  My Library browse pages instead.
- [ ] **F6. Scenario of the day.** Idea only, no design yet.
- [ ] **F7. Turn a session into index cards.** Idea only, no design yet — likely
  ties into the gated Track E study-library work ([[decisions.md]] → Process).
- [ ] **F8. Scenario version history — likely not worth building as designed.**
  2026-08-28: owner's concern is that as features roll out over the next few
  months, creators will want to polish/update older scenarios, but if a
  scenario already has votes/likes (future feature, not yet built), people who
  voted for v1 might not want v2. Considered a full parallel-version system
  (copy-on-write, versions linked in a chain, sessions permanently pinned to
  the version actually played — both decided, if built). **Recommendation:
  don't build this yet.** It's solving for a voting system that doesn't exist.
  Ship voting first; if creators editing voted scenarios turns out to be a
  real, recurring complaint, the likely fix is lighter than a version system:
  warn on editing a voted scenario, offer "edit in place" vs. "save as a new
  copy" (reusing Clone) — no dual-listing, no per-version vote UI, no new
  tables. Revisit only if that complaint actually shows up.
