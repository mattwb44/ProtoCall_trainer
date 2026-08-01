# Glossary

## Naming

- **ProtoCall** — the product's one and only current name, everywhere a user can
  see (placeholder until a trademark-cleared name exists). "BlitzFire" (rejected,
  trademark risk) and "CrewTable" (retired working title, survives only in old
  docs) are not to be used on any user-facing surface.

Canonical terms for ProtoCall. Language only — no implementation details.
Decisions live in `docs/ai/decisions.md` (index) and `docs/adr/`.

## Libraries & sharing

- **My Library** — the scenarios a user *owns*: authored, duplicated, or saved
  as drafts. Nothing made by anyone else ever appears here.
- **Community** — the shared public shelf: scenarios approved by moderation and
  visible to everyone.
- **Department** — a private shelf per department, visible only to its members.
  Membership is by invite code (join code); departments must be verified before
  they can be joined. Department scenarios are never mixed into Community.
- **Draft** — a scenario still being written: persisted, owner-only, exempt from
  publish requirements, never shareable or playable until published.

## Learning objectives

- **Objective** — a named learning outcome from the curated, category-scoped
  vocabulary. Objectives are immutable: created once, never renamed or deleted.
- **Primary objective** — the single required objective every scenario declares;
  the scenario's headline learning outcome. Exactly one per scenario, and it
  must belong to the scenario's category.
- **Supporting objective** — any additional objective a scenario covers beyond
  its primary. Behaves like a tag (lightweight to apply, useful for browsing and
  filtering) but is always drawn from the curated objective vocabulary — never
  free-form text. May come from any category, because real incidents cross
  categories. A scenario's full objective set = primary + supporting.
