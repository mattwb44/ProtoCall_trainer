# PRD: ProtoCall Trainer v3 — Rich Scenarios & the Take-Home

## User Stories
- As a **scenario author**, I want to upload photos, EKG strips, and maps directly into a scenario (not paste URLs), so that the visual — which *is* the scenario in fire/EMS training — lives with it.
- As a **participant**, I want to expand scenario media full-screen and zoom on my phone, so that I can read an EKG strip or a map in a dark dayroom.
- As a **host or participant**, I want to download a PDF of a completed session — dispatch, questions, official answers, pushed answers, my own answers and notes — so that there's a record for the shift binder.
- As a **scenario author**, I want to edit my scenarios after creation, so that a typo or improved instructor answer doesn't require rebuilding from scratch.
- As a **scenario author**, I want to delete a scenario without destroying history, and restore it if I change my mind.

## Implementation Decisions

**Media storage.** Multipart uploads via `@fastify/multipart`, saved to `MEDIA_DIR` (defaults to `./media`; on Railway `/data/media` on the persistent volume — same survival story as the DB). Filenames are server-generated UUIDs + sanitized extension; original names are never trusted. Accepted types: png/jpeg/webp/gif, 10 MB cap. Served statically under `/media/`. The storage helper is one small module so an S3 swap later touches one file.

**Media model.** `scenario_media` rows (`kind`: photo | ekg | map, `url`, `sort_order`) attached to a scenario. The creator uploads files first (each upload returns a URL), then saves the scenario with the media list — no orphan-cleanup complexity in v3; stray files are cheap and a future janitor job can sweep them. The legacy single `image_url` field stays readable but the creator now drives `scenario_media`.

**Participant viewer.** Media renders as a swipeable strip above the dispatch; tapping opens a full-screen overlay using native browser pinch-zoom (an `<img>` inside an overscrollable container — no JS zoom library).

**PDF.** Generated on demand — `GET /api/me/sessions/:id/pdf` — with `pdfkit`, not a background worker; at this scale a request-time render is instant and a queue is accidental complexity. Access mirrors the session-detail rule (host or claimed participant). Content: header (title, taxonomy, room code, date), dispatch, then per question: prompt, the requester's own answer, pushed answers with participant tags, official answer, and the requester's notes. Download buttons live on the completed-session detail page and in the guest drawer's logged-in counterpart.

**Editing.** `PUT /api/scenarios/:id`, author-only. Scenario fields update in place. Questions reconcile by id: existing ids update, new ones insert, removed ones **soft-delete** (`questions.deleted` flag) because responses may reference them — history must not break. Live rooms and new sessions only see non-deleted questions; completed-session views keep every question that was answered.

**Soft delete.** `scenarios.deleted_at` timestamp. Deleted scenarios vanish from all lists and cannot launch, but their sessions/history remain intact. `DELETE /api/scenarios/:id` sets it; `POST /api/scenarios/:id/restore` clears it. My Library shows a collapsed "Deleted" section with restore buttons.

**Frontend routes.** `#/create` gains an edit mode (`#/create/:id`) that loads an owned scenario into the same form. My Library rows get Edit / Delete actions.

## Testing Philosophy
Correct means, via integration tests first:
- Upload a real image buffer → get a `/media/...` URL → GET it back byte-identical; oversized and wrong-type uploads rejected; anonymous uploads rejected.
- A scenario saved with media returns it ordered in detail and in live room state.
- Editing: field changes persist; a question that has responses survives removal as soft-deleted (historic session detail still shows it) while vanishing from new room state; non-author edit 404s.
- Delete hides a scenario from every list and blocks launching; restore reverses it; sessions of a deleted scenario still open.
- PDF endpoint streams a valid `%PDF` document containing the requester's answer text; access denied to strangers.

## Out of Scope (v3)
- Background job queue, S3/object storage (interface-shaped for it, not built).
- Video/audio media; media on individual questions.
- Orphaned-upload garbage collection.
- Department spaces, moderation, email verification (v4). Scale work (v5).
