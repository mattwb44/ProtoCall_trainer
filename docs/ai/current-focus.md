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
- **Track C — objectives.** ✅ Complete. Keyword suggester (rule-based, local,
  explainable; `server/objectives.js`), per-question objective grain (union set),
  and enforced tagging when a scenario leaves Private — all shipped. Optional
  follow-up: persist suggested/accepted objectives for later analysis.
- **Track D — community moderation.** Approval queue + admin.
- **Track E — study library.** Self-marking, objective roll-up, personal tags,
  recommender. **Gated** on the solo funnel showing repeat usage.

## Recommended order
0 → A → B → C → D; E only once funnel data justifies it. Tracks 0, A, B, and C
are shipped. **Track D (community moderation)** is next; hold E until the solo
funnel shows repeat usage.
