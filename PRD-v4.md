# PRD: ProtoCall Trainer v4 — Department Spaces & Trust

## User Stories
- As a **training chief**, I want to create a Department Space and have my crew join it with a short code, so that our training lives in one shared place.
- As a **chief**, I want to mark scenarios as **Official Department Protocol**, so that members immediately see which training reflects our local operating guidelines.
- As a **department member**, I want a "department" visibility tier between private and public, so that our SOPs aren't broadcast to the world but the whole house can train on them.
- As a **chief**, I want a training dashboard — sessions run, who hosted, participation and response rates — so that I can show the shift actually trained.
- As a **user browsing the public library**, I want to report a bad or unsafe scenario, and as the **site operator** I want a queue to act on those reports.

## Implementation Decisions

**Department model.** A department has a name and a rotating 6-character join code. Creating one makes you its chief (`users.role = 'dept_admin'`); anyone with the code joins as a member. One department per user (matching the SPEC schema). The chief can regenerate the code and remove members; members can leave. Chiefs cannot leave while members remain (a department must not be orphaned) — remove members first or hand the whole thing off in a future version. `departments.verified_at` exists but self-serve creation does not set it; "verified" remains a manual/operator action, and nothing in v4 gates on it yet.

**Department visibility.** `scenarios.visibility` gains `'department'`; choosing it stamps the author's `department_id` onto the scenario. Members of that department can view, launch, and clone it; everyone else 404s. Clones remain private to the cloner as before.

**Official Protocol.** `scenarios.is_official`, toggleable only by the chief of the scenario's department, only on department-visibility scenarios (official means *ours*; public scenarios can't be official). Official scenarios pin to the top of members' library with an emerald OFFICIAL PROTOCOL badge. Deleting or re-scoping a scenario clears the flag implicitly (it's hidden or no longer departmental).

**Analytics.** `GET /api/departments/mine/analytics`, chief-only: totals (sessions, distinct trained members, responses) plus per-session rows — scenario, host, date, participant count, response count, response rate (responses ÷ (participants × questions)). Sessions counted are those hosted by department members. Participants identified by display name when they were logged in, anonymous tags otherwise — anonymity of guests is preserved even from chiefs.

**Reporting & moderation.** Logged-in users can report a public scenario (free-text reason, one open report per user per scenario). Moderation is a *site-operator* concern, not departmental: a `site_admin` role (set manually in the database — no UI for granting it) sees `#/moderation`, a queue of open reports with two actions: **dismiss** (report resolved, nothing changes) and **unlist** (scenario forced to private; author keeps it, the public stops seeing it). Reporters are not identified to authors.

**Email verification & password reset: deferred.** Both require an outbound mail provider; no provider account exists yet. Building the flows with a stubbed mailer would ship dead UI. When a provider is chosen (Resend/Postmark/SES), the auth table layout already accommodates it (tokens are one small table + two routes away).

**Frontend.** New `#/department` page (create/join when unaffiliated; member list, join code + regenerate, analytics table for chiefs; leave button for members). New `#/moderation` for site admins. Library pins an "Official Department Protocol" section and badges official rows. Creator's visibility control becomes three-way when the author has a department. Public library rows gain a Report action.

## Testing Philosophy
Integration tests must show: create → join by code → wrong code rejected; department scenario visible/launchable/clonable to members and 404 to outsiders; official toggle rejected for non-chiefs, for non-department scenarios, and reflected with pinning in the member library; analytics numbers match a scripted session exactly and are chief-only; report → appears in queue → unlist flips the scenario private and closes the report; all moderation routes 403 for non-site-admins; chief cannot leave with members present.

## Out of Scope (v4)
- Email verification, password reset, email notifications (blocked on mail-provider choice).
- Multi-department membership, department transfer/handoff, member role promotion UI.
- Verified-department gating and a verification request flow.
- Cross-department sharing, analytics exports.
