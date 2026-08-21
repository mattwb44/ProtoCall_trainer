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
- [ ] **C6. Question numbers.** Number the questions (creator, live, and solo)
  for readability.
- [ ] **C7. Template picker rework.** After a template is chosen: **don't hide**
  the picker and **don't scroll/yank** the page down to Questions. Instead
  minimize the picker to a **"Choose a different template"** button, keep the
  autofill, and **highlight every template-filled field with a yellow border** so
  the user sees what the template populated. Page position stays put.
  - _Decided (2026-08-16):_ each field's yellow border **clears once the user
    edits that specific field** (per-field, signaling "you've taken ownership").
  - _Grounding:_ `templatePicker()` / `SCENARIO_TEMPLATES` in `public/index.html`
    (heading currently reads "\*\* Work in Progress \*\*" at line ~773).
- [ ] **C8. Dropdown caret indicators.** Every choice dropdown gets an up/down
  "^" caret that morphs on open/close.
- [ ] **C9. Relabel MVA → MVC (display only).** **DECIDED (2026-08-16, scoped in
  review): display-map, no data migration.** Add a single label function so
  wherever the app would show the stored `Motor Vehicle Accidents` value it
  renders **"MVC"** instead — category strip, filter, cards, badges, copy. Users
  see MVC everywhere; the **stored value and internal code identifiers stay
  untouched** (no DB migration, no risk).
  - _Grounding:_ the raw stored value is shown to users at e.g.
    `public/index.html:344`/`:366`, so routing display through one map catches
    every site. Leave the `Motor Vehicle Accidents` category value, the `SUBCATS`
    key, `cat-k-mva` CSS, and `icon: 'mva'` as-is (`public/index.html:63`, `:424`,
    `:658`) — users never see them.

---

## Phase D — Larger features

- [ ] **D1. Media View/Edit markup editor.** Each uploaded media item gets a
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
- [ ] **D2. Academies gate + WIP placeholder.** **DECIDED.** Restrict
  `+New Academy` to `site_admin` only (removes verified dept-admins; since
  `site_admin` is env-bootstrapped to a single operator, this = just the owner).
  Non-admins see a **work-in-progress placeholder** page with a short blurb on
  what Academies will become.
  - _Grounding:_ `canCreate = site_admin || (dept_admin && verified)` at
    `public/index.html:3010` — drop the dept-admin arm and add the placeholder
    for the non-create case.
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
