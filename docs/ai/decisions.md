# Decisions

Settled decisions only — approved by the owner or already implemented. Concise;
full rationale lives in the PRDs (`PRD-v*.md`), `SPEC.md`, and `VOICE.md`.

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
  fat-fingered deletes but **not** loss of the volume — the offsite copy is the
  existing on-demand `GET /api/admin/backup` pull; an automated offsite sync is
  a later ops task. (`server/backup.js`; boot catch-up only fires if the newest
  snapshot is stale, so redeploys don't spam.)

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

## Creation flow UX
- **Scene-first ordering:** media/dispatch at the top, degrading to
  dispatch-only when there's no image.
- **Sticky scene reference:** desktop = pinned side rail; mobile = collapsible
  peek bar that expands to a sheet.
- **Progressive disclosure** for stage/role fields (advanced, off by default) +
  a dismissible creation tutorial.
- **Destination selector** (Private · Department · Community, default Private)
  replaces the "Save to Library" button; primary reads "Create scenario" /
  "Save changes".

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

## Process
- **Study-library features gated on evidence.** Self-marking, objective
  roll-up, personal tags, and any recommender are held until the solo funnel
  (`solo_events`) shows real repeat usage. Gamified/compulsion mechanics are
  rejected for this professional audience — engagement comes from being fast,
  credible, and relevant.
