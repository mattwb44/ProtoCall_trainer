# PRD v7: The Scenario Library — Solo Play, Academies & Curriculum Taxonomy

_Distilled from the "ProtoCall Fireground Curriculum Framework" vision doc (2026-07-09)
through the engineering-os senior-engineer interrogation. That doc is the curriculum
north star; this PRD is the buildable software slice. Owner decisions below are final
unless revisited explicitly._

## User Stories

- As a **visitor (guest, no account)**, I want to browse the community library, open a
  scenario, read what it's about, and **try it solo** — answering every question and then
  seeing the instructor's model answers — so that the site gives me real training value
  before asking me for anything.
- As a **guest playing solo**, I want a clear notice before I start and after I submit
  that my attempt won't be saved without an account, so the "sign up" moment feels like
  an offer, not a wall.
- As a **signed-in firefighter**, I want my solo runs saved to my library — visually
  separate from crew sessions — so I can find a scenario I like, vet it alone, and bring
  it to the crew to host later that day.
- As a **solo player**, I want to pick my role (Firefighter, Engineer/Driver-Operator,
  Captain, Battalion Chief, Incident Commander) and get the common questions plus my
  role's questions, so the same scenario trains every seat on the rig.
- As a **scenario author**, I want to tag my scenario with an academy-ready taxonomy
  (learning objectives from a fixed list, scenario family, difficulty, duration, building
  type) so it's findable and the curriculum's coverage is measurable.
- As a **site admin**, I want to create global academies — curated, ordered collections
  of scenarios — so the library grows into a curriculum, not a pile.
- As a **department admin**, I want to create academies visible only to my department
  (e.g. Georgetown Academy), stage private draft scenarios inside them, and publish each
  one to my members when it's ready, so I can build local training that matches our SOPs.
- As a **participant in a live session**, I want the instructor's model answers revealed
  only after I've answered and submitted all questions, so my thinking isn't anchored.

## Implementation Decisions

**Solo play is a first-class run mode, not a new engine.** A solo run reuses the
session/response model with a `solo` mode marker: no room code, no sockets, no host —
the player advances through stages and questions alone. Guests can run any public
scenario; nothing persists for them (a banner says so before start and at submit).
Signed-in users' solo runs archive to their library, rendered as a visually distinct
section/badge from crew sessions.

**Model answers are gated on full submission — everywhere.** Solo: answers withheld
until every question is answered and the run is submitted, then all model answers are
revealed side-by-side with the player's own. Live sessions: a participant sees model
answers only after answering and submitting all questions. No partial reveals. This is
now a product-wide rule.

**No AI in solo mode (owner decision).** Model-answer self-comparison is the debrief.
The v6 after-action stays host-session-only and env-gated. Live per-answer triage
remains shelved (see TODO). No pass/fail, no scoring — consistent with the standing
no-auto-grading constraint.

**Role tracks are an overlay, not parallel scenario sets.** Questions already carry a
`role_track` field. Untracked questions are the common track everyone gets; a question
tagged for a role appears only for that role. Solo players pick a role at start (shown
as tabs/choice under the scenario description); in live sessions participants
self-select a role on join. Roles are labels from a fixed list: Firefighter,
Engineer/Driver-Operator, Captain, Battalion Chief, Incident Commander. Authoring 20
scenarios must never mean authoring 5×20 question sets.

**Learning objectives are a controlled vocabulary (enum), not free text.** Seed list:
Reading Smoke, Water Application, Search, VEIS, Ventilation, Fire Attack, Apparatus
Placement, Air Management, Building Construction, Fire Dynamics, Command Presence,
Resource Management. Site admin can extend the list; authors pick from it (one primary,
optional secondary — max two, per the curriculum doc). This is what makes "coverage"
measurable: the goal is a coverage grid of objectives × scenario families with visible
gaps, not a scenario count.

**Scenario detail page (fixes a real gap).** The community library currently offers
Vote/Clone/Launch with no way to read a scenario. New public-facing detail view: title,
description, media, taxonomy tags, question count per role track, author, votes — and
the "Try Solo" / "Host Live" / "Clone" actions. Question prompts and model answers are
never shown on the detail page; they're revealed by playing.

**Academies are curated ordered collections.** An academy has an owner, a name, a
description, and an ordered list of scenario entries; a scenario can appear in many
academies and keeps its own visibility. Site-admin academies are global; dept-admin
academies are department-scoped. Georgetown Academy is simply the first
department-scoped academy — nothing hard-coded. Academy entries have a
published/draft flag: a dept admin may stage their own private scenario in their
academy as a draft (visible only to them) and publish it to members when ready —
publishing requires the scenario to be at least department-visible.

**Stages: host-revealed, not software-timed.** Scenarios gain optional named stage
headers over the ordered question list ("Dispatch", "Arrival", "Conditions Change").
The host advances stages in live sessions; solo mode advances stage-by-stage as the
player submits. Stageless scenarios behave exactly as today. No timers, no branching.
_Reveal granularity (owner decision 2026-07-10): when stages exist, the full-submission
gate applies per stage — finishing all questions in a stage unlocks that stage's model
answers. Later stages can't be anchored because their questions aren't visible yet.
Stageless scenarios keep whole-scenario gating. Per-question reveal stays rejected
(anchoring); the host's read-as-they-come + selective push workflow is unaffected
either way._

**Historical incident policy (hard constraint).** Scenario narratives are fictionalized
(ambiguous city/department). Historical incidents may be named factually and
respectfully in teaching notes / after-action content ("Principles from the Charleston
Sofa Super Store fire, 2007"), linking the official public report (NIOSH LODD reports
are public record and fire-service teaching culture is "never forget"). No dramatized
victim details; no named LODD victims in-app; memorial phrasing only where official
report language supports it.

**Content is a workstream, not a feature.** Target: first 20 scenarios (general +
Georgetown), authored via AI-assisted drafting in development sessions — Claude
generates structured drafts matching the schema, the owner reviews and edits every one,
approved scenarios are seeded. No in-app generation code in v7. Per-objective authoring
templates (what a "Reading Smoke" scenario must contain) live in engineering-os
`knowledge/`, not in code. 500–1,000 scenarios is the long-term coverage goal, never a
launch gate.

**Zero-friction joining is untouched.** Scanning a QR and answering in a live session
still never requires an account. Guest solo play extends that spirit; it doesn't modify
the live join path.

## Testing Philosophy

Before code, these must be provable:
- A guest can complete a solo run of a public scenario and see model answers only after
  submitting all questions; nothing persists for them; private/department scenarios
  remain invisible to guests (404).
- A signed-in user's solo run lands in their library, distinguishable from crew
  sessions; re-opening it shows their answers beside the model answers.
- A participant in a live session cannot obtain model answers (API or UI) until they
  have submitted all questions; the host view is unaffected.
- Role filtering: a solo Engineer sees common + engineer questions only; an untagged
  scenario behaves identically to today for every role.
- Academy permissions: dept academies invisible to non-members; a draft entry visible
  only to its owner; publishing enforces department visibility; deleting a scenario
  doesn't orphan-crash its academies.
- Taxonomy: creating a scenario with an objective outside the controlled list fails;
  the coverage view reflects seeded data correctly.
- Existing behavior is byte-stable where untouched: all prior tests stay green.

## Out of Scope (with owner sign-off)

- **AI after-action for solo runs** — model answers are the solo debrief. Revisit later.
- **Live per-answer AI triage** — shelved permanently (2026-07-08 decision).
- **Advanced question mechanics** — branching decisions, drawing, pump-calc widgets,
  map interaction, timed reveals. TODOs; the cheap ones (ranking/prioritization,
  image interpretation) may ride along only if they don't grow the slice.
- **In-app AI scenario generation / authoring assistant** — TODO; authoring happens in
  dev sessions for now.
- **Google-Docs-style per-user sharing** ("share with specific people") — TODO; the
  private / department / public tiers cover v7.
- **Role assignment in live sessions beyond self-select** (host-assigned roles) — TODO.
- **Progress tracking, competency mapping, adaptive paths, prerequisites enforcement**
  — difficulty/role are filter labels only; longitudinal anything stays out (standing
  Layer-2 decision).
- **Department profile templating** ("substitute your own profile") — dept-scoped
  academies already deliver the need; no templating system.
