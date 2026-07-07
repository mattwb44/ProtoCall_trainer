# PRD: ProtoCall Trainer v2 — Accounts, Ownership & the Completed Library

## User Stories
- As a **training officer**, I want to sign up and log in, so that my scenarios belong to me and survive across devices.
- As a **scenario author**, I want my library split into private and public scenarios, so that rough drafts stay mine and polished ones are shared.
- As a **guest who just finished a session**, I want one-tap account creation from the offboarding drawer that claims tonight's answers, notes, and pushed highlights, so that the training isn't lost.
- As a **returning crew member**, I want a Completed Library of every session I participated in — my answers, the official answers, and what the instructor pushed — so that I can review before a shift or an exam.
- As a **host**, I want only *my* sessions in my history, and only logged-in users to be able to host, so that rooms aren't anonymous free-for-alls.
- As a **standard user**, I want to browse the public library filtered by category/subcategory and clone a public scenario into my own library, so that I can adapt others' work to my department.

## Implementation Decisions

**Auth mechanism.** Email + password with scrypt hashing (Node's built-in `crypto.scrypt` — no new dependency). Session cookie: signed, HttpOnly, 30-day rolling expiry, stored in a `sessions` table so logout and revocation are real. No OAuth, no email verification in v2 — this is a firehouse tool, not a bank; verification arrives with department spaces in v3.

**Identity model.** The existing anonymous participant flow is untouched — joining a room never requires an account (this is the product's core promise). A logged-in user who joins a room gets their participant row linked to their user id at join time. The `users` table follows the v1 SPEC blueprint minus department columns.

**Guest claiming.** Every participant row already carries the localStorage token. The offboarding drawer's "Create Account" opens a signup form; on success, the server links every participant row matching that browser token — across *all* past sessions, not just tonight's — to the new user. Claiming is idempotent and first-come: a token already linked to another user is skipped.

**Ownership & visibility.** `scenarios.author_id` becomes required for new scenarios (seed data owned by a system user). Private scenarios are visible and launchable only by their author. Public scenarios are readable and launchable by any logged-in user, editable only by the author. Editing a public scenario you don't own routes to **clone** — a deep copy (scenario + questions) into your private library with `cloned_from` set.

**Hosting requires login.** `POST /api/sessions` and the host socket role require an authenticated user; the session row records `host_id`. Joining as participant stays anonymous-friendly.

**Completed Library.** Two tabs on a "My Library" page:
1. *My Scenarios* — authored + cloned, with visibility toggles.
2. *Completed Sessions* — every session where the user hosted or participated (via claimed or linked participant rows). Detail view renders read-only: dispatch, each question, the user's own answer, the official answer, pushed answers, and their notes.

**Upvotes.** A `scenario_votes (user_id, scenario_id)` unique-pair table; upvote toggles. Public library sorts by votes then recency. Reporting is deferred to v3 (needs moderation tooling to mean anything).

**Frontend.** Same single-page vanilla app. New routes: `#/login`, `#/signup`, `#/me` (My Library), `#/public` (community browse with taxonomy filters), `#/session/:id` (completed-session detail). Nav shows login state. Auth state fetched once from `GET /api/me` at boot.

**API surface added.** `POST /api/signup`, `POST /api/login`, `POST /api/logout`, `GET /api/me`, `POST /api/claim` (guest token → user), `GET /api/me/sessions`, `GET /api/me/sessions/:id`, `POST /api/scenarios/:id/clone`, `POST /api/scenarios/:id/vote`, `GET /api/public/scenarios?category=&subcategory=`.

## Testing Philosophy
Correct means, verified by integration tests before browser verification:
- Signup → login → cookie survives requests → logout revokes.
- A guest completes a session, signs up from the drawer, and `GET /api/me/sessions` returns that session with their responses and notes; a second claim of the same token by another account is rejected.
- A private scenario 404s for non-authors; a public one launches for anyone logged in; clone produces an editable deep copy with `cloned_from` set.
- Hosting without login is rejected at both REST and socket layers; anonymous participants can still join and submit with zero auth.
- Vote toggling is idempotent per user and changes public-library ordering.

## Out of Scope (v2)
- Department spaces, admin roles, "Official Department Protocol" badging (v3).
- Email verification, password reset, OAuth/SSO.
- Reporting/moderation of public scenarios.
- PDF archival and media uploads (parallel tracks — not blocked by this work, but not part of it).
- Redis/Postgres migration and horizontal scaling.
