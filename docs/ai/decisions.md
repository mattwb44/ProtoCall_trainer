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

## Process
- **Study-library features gated on evidence.** Self-marking, objective
  roll-up, personal tags, and any recommender are held until the solo funnel
  (`solo_events`) shows real repeat usage. Gamified/compulsion mechanics are
  rejected for this professional audience — engagement comes from being fast,
  credible, and relevant.
