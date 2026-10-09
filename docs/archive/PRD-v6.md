# PRD: ProtoCall Trainer v6 — Decision Intelligence (AI After-Action)

The app already captures the one thing that matters — a crew's real decisions under a
scenario, alongside the instructor's model answer for each question. v6 puts that raw
material to work: an AI layer that reads free-text crew answers against the instructor's
ground truth and turns them into instructor-grade signal, both live and in the archive.
It is strictly an **assistant to a human instructor** — it triages and drafts; the
instructor decides. This is safety-critical training; the AI never issues an authoritative
pass/fail on its own.

## User Stories
- As an **instructor running a live drill**, I want the incoming answers triaged for me — aligned vs. defensible-but-different vs. possible safety error — so that under cognitive load I know *which answer to push and why*, instead of eyeballing a dozen responses at once.
- As an **instructor**, I want a possible safety-critical answer flagged for my review the moment it arrives, so that a dangerous misconception becomes a teaching moment while the crew is still engaged.
- As a **participant**, I want a personalized after-action debrief added to my saved session — what I got right, where my answer diverged from the model, and the reasoning — so that a drill produces individual feedback, not just a shared recording.
- As an **instructor**, I want to review and edit the AI's debrief before it's shared, so that the final word is always a human's.
- As the **operator**, I want the whole AI layer to be optional and env-gated, so that the app runs identically with no AI key set and costs nothing until switched on.

## Implementation Decisions

**Ground truth, not an invented rubric.** Every analysis compares a crew answer to the instructor's stored model answer for that question, in the context of the scenario prompt. The AI is scoring against a subject-matter expert's stated correct answer — it is not inventing standards. Where a question has no model answer, the AI summarizes and clusters rather than scoring, and says so.

**Env-gated, no-op without a key.** The AI layer activates only when an Anthropic API key is configured; with no key the app behaves exactly as it does today (no analysis UI, no calls, no cost). The provider client is injectable so tests run against a mocked client with zero network calls — the same pattern already used for the mailer and the Redis adapter. The model is the latest available Claude, configurable by environment so it can be upgraded without a code change.

**Human-in-the-loop is a hard constraint, not a setting.** The AI produces an *advisory* classification and draft text. Live, it annotates answers (aligned / divergent / ⚠️ review) and recommends one to push — the instructor still presses push. In the archive, a participant's debrief is generated as a draft the instructor can accept or edit before it's visible to the participant. The AI never auto-grades as authoritative and never emits an unreviewed pass/fail. Safety flags are phrased as "review this — possible safety error," never as a verdict.

**Two surfaces, one analysis core.**
- *Live triage* runs per answer (or in small batches) as responses stream into the Aggregation Matrix, decorating each with a classification and a one-line rationale, and surfacing the single answer most worth pushing. It must degrade gracefully: if analysis is slow or fails, the Matrix works exactly as it does today — triage is additive, never blocking the live loop.
- *Post-session after-action* runs once when a session ends, producing a per-participant debrief written into that participant's existing archived session entry, plus a short crew-level summary for the instructor. This is the durable, re-readable output and the foundation later work aggregates over.

**Resilience and cost discipline.** Analysis is best-effort and fault-isolated: a provider error, timeout, or missing key degrades to the current no-AI behavior and is logged, never surfaced as a broken session. Post-session analysis is the primary path (bounded, batchable, cacheable); live triage is the enhancement. Results are persisted with the session so a debrief is generated once, not re-computed on every view.

**Privacy and framing.** Answers are training responses, not PII, but crew display tags and answers still leave the box when analysis runs — this is disclosed, and the AI layer being fully optional lets a department decline it. Debriefs are written in a constructive coaching voice appropriate to fire/EMS, not as an exam grade.

## Testing Philosophy
- With no AI key configured, the app is byte-for-byte the current product: no analysis calls, no analysis UI, existing suite green. This is the first test written.
- With a mocked AI client, a completed session produces a per-participant debrief persisted to that participant's archived entry, and a crew-level summary for the instructor; generating twice does not duplicate or re-call (results are cached with the session).
- An answer that clearly contradicts the model answer on a safety dimension is surfaced with a review flag; an aligned answer is not. (Asserted against the mocked client's structured output, not against live model behavior.)
- A provider error or timeout degrades cleanly: the session, the live Matrix, and the archive all still work; the failure is logged, not shown as a broken debrief.
- The instructor can edit a draft debrief before it is shared, and the edited version — not the AI's original — is what the participant sees.
- Live triage never blocks the real-time loop: with analysis stubbed to hang, answers still land in the Matrix and push/end still work.

## Out of Scope (v6)
- **Layer 2 — longitudinal competency profiles.** Scoring an individual across *all* their archived drills to surface recurring patterns and map them to accreditation/training-record standards (NFPA/ISO/CFAI). This is the high-value follow-on, but it aggregates over exactly what v6 produces, so it is deferred until per-session after-action is proven in real use. Explicitly a future PRD, not this one.
- Auto-grading or any AI-issued pass/fail without instructor review — permanently out of scope by design, not just for v6.
- Real-time voice/photo answer capture (a separate UX track).
- AI-*authored* scenarios or model answers (v6 consumes the instructor's ground truth; it does not generate it).
- Fine-tuning or any custom model training; v6 uses a general Claude model with scenario context in the prompt.
