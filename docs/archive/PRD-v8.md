# PRD v8 — In-App Scenario Review & Approval

_2026-07-10. Owner request: review the content-sprint drafts inside the app instead of
in markdown files — and generalize it: any instructor can submit a scenario for
official review; the Training Chief (dept admin) or site admin reviews, edits, and
approves it in the app._

## User Stories
- As a **scenario author**, I want to submit my scenario for official review, see its
  review status, and read the reviewer's feedback if changes are requested.
- As a **Training Chief (dept_admin)**, I want a review queue of scenarios submitted by
  my department's members, the ability to open and edit each one, and Approve /
  Request-changes actions — approval grants the OFFICIAL badge.
- As the **site admin**, I want the same queue across the whole site (covers authors
  with no department, and the owner reviewing AI-drafted content).

## Implementation Decisions
- **Review state lives on the scenario**: `review_status` ('' none | 'pending' |
  'approved' | 'changes_requested'), `review_note` (reviewer feedback), `submitted_at`.
- **Routing rule**: a submission goes to the author's department chief if the author
  belongs to a verified department; otherwise (and always, additionally) the site admin
  sees it. Site admin's queue = all pending; chief's queue = pending scenarios whose
  author is in their department.
- **Approval = official.** Approve sets `is_official=1` + status 'approved'. Visibility
  is untouched — publishing stays the author's/admin's separate choice. The existing
  chief badge toggle (`POST /:id/official`) remains for department scenarios.
- **Reviewers can edit**: PUT is opened to in-scope reviewers while a scenario is under
  review; reviewer edits cannot change visibility/department/official (content only).
- **Edits invalidate approval**: an author PUT on an 'approved' scenario resets it to
  unreviewed and clears the official badge — no silent edits behind the badge.
- **Reviewers see everything**: in-scope reviewers can read a pending scenario
  (including model answers) even if it's private. Answer gating for participants is
  unchanged.
- **No email notifications** (mailer stays dormant); the queue + nav badge is the
  signal.
- **Drafts intake**: `scripts/seed-content.js --submit` creates each scenario and
  submits it for review, so the 20 drafts land in the owner's in-app queue.

## Testing (must be provable)
- Author submit → pending; visible in the right queues (chief scope vs site admin);
  outsiders/members get 403 on queue and review actions.
- Approve sets official + approved; request-changes stores the note and the author can
  see it and resubmit.
- Reviewer can GET (with answers) and PUT a pending private scenario in scope; cannot
  change its visibility; out-of-scope chief cannot.
- Author edit after approval clears official + status.
