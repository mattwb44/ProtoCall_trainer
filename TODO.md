# TODO

## Open
- **Implement v7 (PRD-v7.md)** — remaining: taxonomy (learning objectives +
  coverage view), academies, stages (with per-stage answer reveal, owner
  decision 2026-07-10). Then the
  20-scenario content sprint (AI-drafted in dev sessions, owner-reviewed, incl.
  Georgetown Academy).
  - ✅ Model-answer gating on full submission, product-wide; session end unlocks
    (owner call 2026-07-10). ✅ Scenario detail page. ✅ Solo play: guest stateless
    runs + persisted library runs with role-track filtering. ✅ Live role select:
    self-pick on join, track-filtered questions, track-aware reveal, role tags
    in host matrix/archive.
- **v7 deferred follow-ups (from PRD-v7 Out of Scope):** advanced question mechanics
  (branching, drawing, pump-calc, map); in-app AI authoring assistant; per-user
  scenario sharing (Google-Docs style); host-assigned roles in live sessions.
- **Set `ANTHROPIC_API_KEY` on Railway to activate the v6 AI after-action** — without it
  the feature is fully dormant (33 tests prove byte-identical behavior). Optionally set
  `ANALYSIS_MODEL` (defaults to `claude-opus-4-8`).
- ~~**v6 live triage (the second surface in PRD-v6)**~~ — **shelved by decision (2026-07-08).**
  The instructor/session leader judges whether a crew answer is good in real time; the app
  doesn't need to. Live per-answer AI classification is off the roadmap indefinitely (not
  just deferred). The analysis core + schema remain for the post-session after-action only.
- **Set the prod mail env vars & verify a sending domain** — the email flow ships behind
  Resend but is dormant until `RESEND_API_KEY` is set on Railway. Steps: create a Resend
  account, verify a sending domain (DKIM), then set `RESEND_API_KEY`, `MAIL_FROM`
  (e.g. `ProtoCall Trainer <noreply@yourdomain>`), and `APP_URL`
  (`https://protocall-trainer-production.up.railway.app`, or the custom domain once added).
  Until then signups still work — the app logs `[mail:dev] would send…` and skips sending.

## Done
- ~~Email verification & password reset~~ (shipped 2026-07-08 via **Resend**, env-gated:
  signup emails a 24h verify link; `#/reset` requests a 1h reset link that revokes all
  sessions on use. Tokens are single-use and stored sha256-hashed. No key set → mailer
  no-ops and logs the link, so dev/tests/key-less prod all keep working. `server/mailer.js`,
  injectable into `buildServer({ mailer })` for tests.)
- ~~Restrict department creation~~ (shipped 2026-07-08 as **site_admin approval**:
  new departments are pending — join code inactive, department visibility and official
  badging locked — until approved from the moderation page; reject deletes the
  department and resets its creator. Departments created before the gate appear in the
  pending queue for review.)
- ~~Department join code: 8 characters instead of 6~~ (shipped 2026-07-08; existing
  6-character codes keep working until the chief regenerates)
