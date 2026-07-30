# Current focus

**Milestone: Solo consumption + creation-flow overhaul.**

Making the solo run feel finished (a real ending, not a dead-end) and the
scenario-creation flow smooth enough that the public library actually grows —
supply gates everything downstream.

## Tracks (dependency order)
- **Track 0 — housekeeping.** ✅ VOICE.md + solo funnel logging shipped.
- **Track A — consumption.** A1 (solo exit + revision) ✅ shipped/live.
  A2 (unified After-Action reveal) ✅ shipped (objectives frame, official-open,
  explicit deferred save both auth states, guest sign-in replay, Next).
- **Track B — creation.** ✅ shipped: scene-first + sticky reference (desktop
  rail / mobile peek), progressive disclosure (Advanced stage/role), dismissible
  creation tutorial, destination selector (Private · Department · Community).
- **Track C — objectives.** ✅ Complete: per-question grain + union rollup
  (lifts the 2-objective cap); corpus-seeded keyword suggester
  (`/api/objectives/suggest`, explainable, local); create-time enforcement of
  the scenario primary (client + server). Objectives immutable — see `decisions.md`.
- **Track D — community moderation.** Approval queue + admin. (`site_admin`
  env-bootstrapped only — see `decisions.md`.)
- **Track E — study library.** Self-marking, objective roll-up, personal tags,
  recommender. **Gated** on the solo funnel showing repeat usage.

## Recommended order
0 → A → B → C → D; E only once funnel data justifies it. A, B, and C are done;
**D is next**.
