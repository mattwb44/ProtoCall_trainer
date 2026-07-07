# ProtoCall Trainer — Product Roadmap

Five planned versions take the app from tonight's working demo to the full CrewTable
vision in SPEC.md. Each version gets its own PRD when it becomes next-up (earlier ones
would go stale); this file is the map.

Guiding principle across all versions: **scanning a QR and answering never requires an
account.** Every version must preserve zero-friction joining.

---

## v1 — The Live Loop ✅ (shipped, PRD.md)
Host launches → crew joins by QR/code → answers stream into the Aggregation Matrix →
host pushes notable answers → session ends and persists. Fastify + Socket.IO + SQLite,
single process. *This is the product's heartbeat; everything after is compounding value
around it.*

## v2 — Accounts, Ownership & the Completed Library (PRD-v2.md — next up)
Email/password auth, scenario ownership (private/public), guest→account claiming that
retroactively attaches past sessions, "My Library" (authored scenarios + completed
sessions), public community browse with taxonomy filters, clone, upvotes.
**Why now:** ownership is the dependency for nearly everything below; retrofitting it
later gets more painful with every table added.

## v3 — Rich Scenarios & the Take-Home (media + PDF)
- Media uploads: photos, EKG strips, maps — multi-image per scenario, stored on local
  disk behind an object-storage-shaped interface (S3 swap later).
- Participant media viewer: full-screen expand, pinch-zoom on mobile.
- PDF archival: on session end, a worker renders scenario, questions, official answers,
  pushed answers, and each participant's own answers/notes into a downloadable PDF —
  the training record for the shift binder.
- Scenario editing (v1/v2 only create); soft-delete with restore.
**Why here:** for fireground/EMS training the image *is* the scenario, and the PDF is
what makes a session feel like it counted. Both are pure value-add on the v2 foundation.

## v4 — Department Spaces & Trust
- Verified departments; Training Chief / Department Admin role.
- "Official Department Protocol" badging — official scenarios pinned and highlighted
  for department members so training aligns with local operating guidelines.
- Department-scoped visibility tier (between private and public).
- Reporting + a minimal moderation queue for the public library (deferred from v2
  until someone can actually act on reports).
- Email verification and password reset (identity starts mattering here).
- Session analytics for chiefs: who trained, participation rates, per-question
  response summaries across sessions.
**Why here:** this is the organizational layer — it only pays off once individuals
(v2) are creating rich content (v3) worth standardizing on.

## v5 — Scale & Reach
- Postgres migration (schema is already column-compatible) and Redis: Socket.IO
  adapter for multi-node fan-out, transient room state, presence.
- Horizontal scaling behind a load balancer; the SPEC.md architecture realized.
- Deployment story: Docker, HTTPS, a real domain; PWA install + offline answer queue
  (IndexedDB) for concrete-stairwell reconnects.
- Hardening: rate limits, backups, monitoring.
**Why last:** it's a swap-in, not a rewrite — the code was structured for this from
day one. Build it when real concurrent departments exist, not before.

---

## Beyond v5 (unscheduled ideas, not commitments)
- Timed/scored modes (Kahoot-style) and spaced-repetition review from your Completed
  Library.
- Scenario packs / curricula (ordered sequences with prerequisites).
- AI-assisted scenario drafting from a dispatch narrative.
- Live audio notes or photo submissions from participants mid-session.

## Sequencing logic in one line each
- v2 before v3: media and PDFs need an owner.
- v3 before v4: departments standardize on content; the content tools must exist first.
- v4 before v5: scale problems are a symptom of organizational adoption, not a cause.
