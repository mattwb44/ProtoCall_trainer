# Current focus

**Milestone: Solo consumption + creation-flow overhaul.**

Making the solo run feel finished (a real ending, not a dead-end) and the
scenario-creation flow smooth enough that the public library actually grows —
supply gates everything downstream.

## Tracks (dependency order)
- **Track 0 — housekeeping.** ✅ VOICE.md + solo funnel logging shipped.
- **Track A — consumption.** A1 (solo exit + revision) ✅ and A2 (unified
  After-Action reveal) ✅ shipped. Track A complete.
- **Track B — creation.** ✅ Scene-first ordering, sticky scene reference
  (desktop rail + mobile peek), progressive disclosure of stage/role fields,
  dismissible creation tutorial, and destination selector all shipped in the
  creator (`renderCreator`). Next: corpus-seeded keyword suggester lands with
  Track C.
- **Track C — objectives.** Keyword suggester ✅ shipped (rule-based, local,
  explainable; hand-seed + corpus blend in `server/objectives.js`, "Suggest
  objectives" in the creator). Still to do: per-question objective grain +
  enforced tagging at creation.
- **Track D — community moderation.** Approval queue + admin.
- **Track E — study library.** Self-marking, objective roll-up, personal tags,
  recommender. **Gated** on the solo funnel showing repeat usage.

## Recommended order
0 → A → B → C → D; E only once funnel data justifies it. Tracks 0, A, and B
are shipped. **Track C (objectives)** is next, then D.
