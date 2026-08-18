# Decisions

Settled decisions only — approved by the owner or already implemented. Concise;
full rationale lives in the PRDs (`PRD-v*.md`), `SPEC.md`, and `VOICE.md`.

## UX backlog (grill 2026-08-16)
Full item list + grounding in `docs/ai/ux-backlog.md`. The four decided forks:
- **Academies gated to the owner + WIP placeholder.** `+New Academy` restricted
  to `site_admin` only (drops verified dept-admins; `site_admin` is
  env-bootstrapped to one operator, so this = just the owner). Non-admins see a
  work-in-progress placeholder describing what Academies will become.
- **Ended sessions: "Finished Reviewing" end state, no restart.** On end,
  logged-in hosts get **auto-save** + a prominent "Return to Homepage" (Discard is
  secondary); **guests** get "Create account to save"/Discard. Applies to hosted
  and solo. Ended sessions are locked — Advance stage cannot resurrect them;
  re-running means going back to the scenario and clicking Host (fresh room).
  (Testing confirmed no dup-save even across restarts — only the restart needs
  blocking.)
- **Sessions auto-complete on finish + sweep the backlog.** IN PROGRESS →
  COMPLETED flips automatically when a session finishes; a one-time migration
  sweeps the existing genuinely-finished stuck rows.
- **Categories + Subcategories = one synced multi-select control.** Single-select
  category strip becomes an independent multi-toggle, mirrored in the top strip
  and the filter box (synced, same animation). Click = color + show scenarios;
  re-click = gray + hide; zero selected = show all. Each selected category
  reveals its subcategories as nested checkboxes from the existing `SUBCATS`.
  This also fixes the "Subcategory filter only shows All" bug (a side effect of
  the old single-select keying).

## Product / infrastructure
- **Name stays ProtoCall.** "BlitzFire" carries trademark risk (a fire-ground
  monitor company). Placeholder until a cleared name exists.
- **fireground_trainer is being decommissioned.** ProtoCall_trainer is the
  successor. `protocalltrainer.com` points at the ProtoCall Railway service.
- **Persistence: SQLite on a Railway volume.** `DB_PATH=/data/protocall.db`,
  `MEDIA_DIR=/data/media`. Stay on SQLite until multiple app instances are
  needed (redundancy / zero-downtime deploys) — not raw load. Postgres is a
  later, deliberate migration, not a near-term need.
- **Deploy model:** merges to `main` auto-deploy to `protocalltrainer.com` via
  Railway. Branch per PR, run `npm test` + a preview check, then merge.
- **Backups: in-app nightly snapshot is the baseline, not Railway volume
  snapshots.** A scheduler in the app process runs better-sqlite3's online
  `db.backup()` (point-in-time-consistent while live) once a day to
  `$BACKUP_DIR` (default `<dir of DB_PATH>/backups`, i.e. `/data/backups`),
  rotating to keep `BACKUP_KEEP` (default 14). Chosen over Railway snapshots
  because it's free on any plan, consistent for SQLite, and testable. Railway
  volume snapshots, where available, are welcome defense-in-depth on top.
  Honest limit: these sit on the same volume, so they cover crash / bad deploy /
  fat-fingered deletes but **not** loss of the volume. (`server/backup.js`; boot
  catch-up only fires if the newest snapshot is stale, so redeploys don't spam.)
- **Offsite sync closes the volume-loss gap** (`server/offsite.js`, Phase 1).
  After each successful local snapshot the scheduler PUTs it to S3-compatible
  storage (Cloudflare R2 / B2 / S3) via hand-rolled SigV4 — no new dependency.
  Strictly defence-in-depth: an upload failure is logged and never degrades the
  local backup. **Off unless all four of `BACKUP_S3_ENDPOINT` (bare https
  origin), `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY_ID`,
  `BACKUP_S3_SECRET_ACCESS_KEY` are set**; optional `BACKUP_S3_REGION`
  (default `auto`, correct for R2) and `BACKUP_S3_PREFIX`. Half-configured warns
  loudly rather than failing silent. Ops notes: issue a **write-only,
  single-bucket** token (the app never needs list/get/delete), set a **bucket
  lifecycle rule** for retention (the app deliberately can't delete offsite
  copies), and confirm the first nightly run logs
  `Offsite backup uploaded: <key>` — a signing/permission failure surfaces there.

## Solo run UX
- **No punitive stage lock.** Progressive stage reveal stays (later stages
  unlock in order), but earlier answers are editable again before final submit.
  Solo is formative, not a test. An "Exam mode" lock is a future opt-in.
- **Always-available Exit** during a run; confirm only when answers exist.
- **Unified After-Action reveal (both auth states).** Everyone lands on the
  same reveal via the stateless reveal fetch — no silent auto-save-and-teleport
  for signed-in users. Save is explicit and deferred ("Save to Runs Completed" /
  "Discard"; logged-out "Save — Sign in"). Official answers open by default.
  Show the scenario's objectives as the frame. Simple, non-personalized "Next"
  (another in the same category).

## Objectives architecture
- **Per-question objective grain.** Objectives move to the question level
  (optional, inheriting the scenario's primary by default); a scenario's
  objective set is the union of its questions'. Fixes the 2-objective cap that
  under-tags multi-topic scenarios.
- **Objective tagging is enforced at creation** (at least the scenario primary).
- **Assisted tagging = rule-based, corpus-seeded, local, explainable,
  human-in-the-loop.** Suggest per-question objectives + quality nudges;
  analyze the draft once at creation, store suggested + accepted, don't re-run.
  No external AI / API dependency. (Embeddings/local-LLM deferred; revisit only
  if the keyword suggester visibly misses.)
- **Objective names are immutable — create-only, never renamed.** Scenarios
  (and, in Track C, questions) tag objectives by *name*, denormalized as a plain
  string, so a rename would silently orphan every scenario using the old
  wording. To change wording, add a new objective and re-tag. Retiring old
  wording is a future "deprecate" flag (hide from pickers, keep existing tags),
  never a rename or delete. There is deliberately no rename/delete endpoint.
- **Objective minting stays `site_admin`-only.** Because objectives are immutable,
  a bad mint is permanent — so authors never create objectives directly. An
  author missing an objective reports it out-of-band; a "request an objective"
  queue is the documented escalation path, built only when misses actually recur.
- **"Supporting objectives"** is the canonical term for a scenario's objectives
  beyond the primary (see `CONTEXT.md`). Tag-like in use, but always drawn from
  the curated vocabulary — never free-form. Supporting objectives may cross
  categories; the **primary must match the scenario's category**.
- **Creator category switches: remember per category, validate on save.** The
  draft keeps per-category memory of objective picks (and subcategory); switching
  categories shows that category's remembered picks, never silently carries picks
  across. Save validates only against the current category.

## Creation flow UX
- **Guests can create (2026-08-18).** "+ Create Scenario" (renamed from "New
  Scenario") shows to everyone, logged in or out. A guest opens the creator and
  builds a new scenario freely; at Save/Finish the finished body is stashed and
  they're sent to signup, which posts it to their brand-new account right after
  (same claim-on-signup pattern as guest solo runs — no anonymous rows, no
  backend change). Media attaches server-side, so guests are told they can add
  photos/maps once they save. Editing an *existing* scenario still requires an
  account. Post-login default is now **My Library** (was My Sessions).
- **Scene-first ordering:** media/dispatch at the top, degrading to
  dispatch-only when there's no image.
- **Sticky scene reference:** desktop = pinned side rail; mobile = collapsible
  peek bar that expands to a sheet.
- **Progressive disclosure** for stage/role fields (advanced, off by default) +
  a dismissible creation tutorial.
- **Two-button save: "Save as Draft" / "Finish Scenario"** (supersedes the
  Track B pre-save destination selector). Draft requires nothing, is owner-only,
  unshareable, unplayable, uncounted in coverage; all field validation fires at
  Finish. After Finish, a publish step offers **Publish to Community** and
  **Publish to Department** (shown only to department members; both selectable) —
  and regardless of choices, the scenario is **always saved to My Library**.
  Community publish routes through the Track D approval gate (`pending`).
  Editing a published scenario never demotes it to draft; unpublish deferred
  until someone needs it.
- **Required-field set stays as-is** (title, category, subcategory, primary
  objective; dispatch/description optional). The fix is visual: mandatory fields
  are marked as required from the moment the creator opens — not discovered via
  failed save.
- **Category-scoped detail fields.** Each category declares which detail fields
  apply: Building Type shows for structure-ish categories, hidden for MVA/EMS.
  **Vehicle Type** is MVA-only, multi-select, fixed additive-only vocabulary
  (no free text, no renames): Sedan · SUV · Pickup · Van · Motorcycle ·
  Semi/18-wheeler · Bus · School bus · Commercial truck · Ambulance ·
  Fire apparatus · Police vehicle · Train · **Train derailment** ·
  Bicycle/pedestrian involved. Browse filtering is match-any.
- **Top-down maps: stamp editor, flattened on save.** Five in-house flat-SVG
  base maps (residential normal lot · residential corner lot · intersection ·
  highway · commercial) + a fixed stampable icon set (apparatus, civilian
  vehicles, PD, hydrant…) with drag + rotate only — no scaling, layers, or
  freehand. Saving flattens to a plain image (`image_url`), so solo/live/review
  pipelines are untouched. Consciously accepted trade-off: flattened maps are
  not re-editable — re-place from the base map to change. Keeping placements
  editable is exactly the escalation into a full diagram editor, which we reject.
- **Scenario templates: hardcoded picker + duplicate-scenario; no wizard.**
  Creation starts from Blank · Quick drill · Standard incident · Full multi-role
  incident — templates seed draft structure (stages, role-tagged placeholder
  questions) into the existing form; the full template opens Track B's
  "Advanced" disclosure pre-populated. Template set is hardcoded (owner-approved),
  not user-savable — "save as template" is just duplicate-scenario, which we
  also build (copy any visible scenario to My Library and edit).
- **Roles are sets on both sides, matched by intersection.** A question carries
  a set of roles (empty = everyone); a participant carries a set of roles
  (empty = everyone); a participant sees a question if either set is empty or
  they intersect. Fixes the firefighter-medic case (one participant, two
  tracks). Custom free-text roles stay (per-scenario flavor, not a vocabulary).

## Home page
- **Landing layout (top to bottom):** hero (ProtoCall + tagline) → join-a-live-
  session card (stays first; invited crew is the most time-pressed visitor) →
  2×2 action grid: Host a Session · Build a Scenario · My Library · Community →
  **"How it works" 4-step grid ported verbatim from the old fireground home**
  (Browse a scenario… / …or create your own / Then start a session (solo or
  team) / Review results) — owner explicitly wants the original copy kept, not
  rewritten.
- **User-facing product name is "ProtoCall" everywhere** (landing h1 + title tag
  fixed; "CrewTable" retired — see `CONTEXT.md` → Naming).

## Libraries
- **Library boundaries (fixes three QC reports at once):** My Library = owned
  only (authored + duplicated + drafts); Community = approved public;
  department-shared-by-others = a scope on the browse page, never in My Library.
  The `/api/scenarios` mixed query (public OR mine OR dept) stops backing a page
  called "Library". Seed scenario stays as an approved system example in
  Community. Department membership stays invite-code-gated (already built:
  `join_code` + verified-department requirement).
- **Persisted drafts are a new feature.** Scenarios can be saved incomplete
  (owner-only, in My Library). Publish-time validation unchanged.
- **One personal area: "My Library" nav entry with two tabs** — My Scenarios
  (drafts + published) and My Sessions (hosted/joined/solo history). No separate
  My Sessions nav item.
- **Session cards:** status badge reads IN PROGRESS / COMPLETED (never "live" —
  it collided with the live *mode*); mode is its own badge (SOLO/HOSTED/JOINED);
  all badges in a fixed right-side column; thin questions-answered progress bar
  on in-progress solo runs only (no account-level progress — gamification stays
  rejected).

## Community
- **Approval queue.** Scenarios submitted to Community enter `pending`; admins
  approve/reject (with reason); only approved + public show in community browse.
  Admin is bootstrapped from `SITE_ADMIN_EMAIL`.
- **Track D admin model: `site_admin` is env-bootstrapped only — no in-app
  promotion.** Site-wide moderation is single-operator at this scale, and a UI
  to mint a superuser is attack surface we don't need yet. Department-scoped
  moderation already scales via `dept_admin` (granted through the
  department-verification flow, `dept_admin` sees only their department's
  queue). A self-serve `site_admin` grant (an existing site admin promoting
  another user, with an audit trail) is the documented next step for when a
  second site-wide moderator actually exists — build it then, not now.
- **Approval-gate migration: sweep, don't grandfather.** When the gate lands,
  every currently-public scenario moves to `pending` and community browse
  empties until the owner approves them (one sitting via the existing review
  queue; doubles as the seed-clutter purge). Authors keep seeing their own via
  the `OR author_id` branch. No timing courtesy required — an empty community
  page during the review pass is acceptable.

## Live sessions
- **Host live view = mirror + roster, three layers.** (1) Host sees what the
  crew sees: scene image + dispatch + current stage's questions, official
  answers collapsed host-only; QR/room code shrink to a corner card. (2) Named
  roster of initials-chips with **boot** behind a tap-menu (boot invalidates the
  participant token, not just the socket). (3) Completion: per-stage chip state
  — grey → amber ring with fraction → green check — measured against *that
  participant's* visible questions (role intersection); "N of M done" header;
  tapping a chip expands their per-question detail. **No auto-advance, ever** —
  the roster informs, the host decides.
- **One response per (session, participant, question) — enforced in the DB.**
  Re-answering is deliberately not a feature: the client locks the whole track
  after the first submit, and reveal/roster math already dedupes with
  `DISTINCT question_id`. A UNIQUE index on
  `(session_id, participant_id, question_id)` makes that invariant real, so a
  socket double-fire (offline-queue flush, timed-out re-emit) can't create a
  second row. `submitResponse` uses `INSERT OR IGNORE` and returns the existing
  row on collision, so the double-fire still acks normally. A flag-guarded
  one-shot (`app_meta` `responses_dedupe`) collapsed any pre-existing dupes —
  pushed row wins, else earliest — before the index was added (PR 9).

## Browse UI defaults
- **List/grid toggle** on all scenario pages: default grid, remembered per user
  (localStorage), list rows are single-line dense. **Mobile filters** collapse
  to a "Filters · N" button opening a bottom sheet; category color tabs stay
  visible. Review queue's "Review & Edit" button sized to standard.
- **Desktop filter = left drawer (2026-08-18).** The "Filters · N" button opens a
  full-height drawer docked at the content's left edge (just right of the
  sidebar), dimming/freezing the main content; the sidebar stays live (backdrop
  starts at the sidebar's right edge). `left` tracks the sidebar's live width, so
  it re-docks when the sidebar collapses. Closes on backdrop click or Esc.
  Replaced the earlier inline dropdown (`filterRail`). Mobile keeps the sheet.

## Shell / navigation
- **Collapsible sidebar (2026-08-18).** The top-left ☰ collapses the desktop
  sidebar to an icons-only rail (persisted, `localStorage.pcSidebarCollapsed`);
  on mobile it still slides the full menu in/out. Collapsed icons show a light
  pill tooltip on hover (data-tip); same styled tooltip on the top-nav account +
  logout buttons.

## Onboarding
- **One reusable spotlight-tour engine; one tour shipped.** Engine: auto-popping
  spotlight boxes with pointer, "step N/M" counter, once-per-account per tour,
  dismissible anytime, replayable from Help. First (and only initial) tour:
  **first-login orientation** (~6 steps: Home, join, host, My Library,
  Community), written after the new home/library layouts land. The other tours
  (community, my library, creation) are gated on completion data from the first
  — if people insta-dismiss it, they don't get built.

## Process
- **Study-library features gated on evidence.** Self-marking, objective
  roll-up, personal tags, and any recommender are held until the solo funnel
  (`solo_events`) shows real repeat usage. Gamified/compulsion mechanics are
  rejected for this professional audience — engagement comes from being fast,
  credible, and relevant.
- **Track E design lens: competence feedback, never reward accumulation.**
  Per self-determination theory (competence · autonomy · relatedness), the
  study library shows *where you're getting stronger or thinner* per objective —
  no points, streaks, badges, or leaderboards. Extrinsic rewards crowd out the
  intrinsic motivation this audience already has.
- **Lobby mini-game: parked, with a named re-entry condition.** Not banned (it's
  a waiting-room toy, not a compulsion mechanic), but only revisited if real
  sessions still show long dead waits *after* the new host live view (which
  shrinks them) ships.
