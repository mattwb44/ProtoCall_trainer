# TODO

## Restrict department creation (requested 2026-07-08)
Right now any logged-in user can create a department and instantly become its Training
Chief — exactly how the owner created theirs, and that's the problem: nothing stops a
random visitor from spinning up fake departments.

Decide and implement a gate. Options, roughly in order of effort:
1. **site_admin approval** — `POST /api/departments` creates a *pending* department;
   a site_admin approves it from the moderation page (sets `verified_at`, activates it).
2. **site_admin-only creation** — only site_admin can create departments and hand the
   chief role to a named user. Simplest; fine while the operator knows every department.
3. **Verification request flow** — self-serve creation stays, but unverified departments
   are capped (e.g. 5 members, no official badging) until a site_admin verifies them.
   `departments.verified_at` already exists for this.

Note: existing self-created departments (e.g. any test ones) should be reviewed/removed
when this lands.

## Done
- ~~Department join code: 8 characters instead of 6~~ (shipped 2026-07-08; existing
  6-character codes keep working until the chief regenerates)
