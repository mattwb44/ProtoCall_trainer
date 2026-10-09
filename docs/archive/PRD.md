# PRD: ProtoCall Trainer v1 — Live Scenario Sessions

## User Stories
- As a **training officer (host)**, I want to launch a live session from a scenario and get a room code + QR, so that my crew can join from their phones in seconds.
- As a **crew member (guest)**, I want to join by code/QR without an account, answer questions, and see the official answer after I submit, so that training starts with zero friction.
- As a **host**, I want to watch anonymous responses stream in per question and push notable ones to every device, so that I can drive the tabletop discussion.
- As a **host**, I want to end a session and have everything persisted, so that the training record isn't lost.
- As a **scenario author**, I want to create/edit scenarios with categorized questions and instructor answers, so that I can build a reusable library.

## Implementation Decisions
- **Server:** Node.js with Fastify serving both the REST API and static frontend; Socket.IO for real-time. One process for v1; the Redis adapter and Postgres from SPEC.md are the scale-up path, not v1.
- **Persistence:** SQLite (better-sqlite3) with a schema mirroring the Postgres blueprint in SPEC.md (scenarios, questions, live_sessions, participants, responses, notes). Zero-setup local dev; migration path to Postgres is column-compatible.
- **Live room state:** in-memory map keyed by room code, hydrated from DB rows; every mutation (response, push, end) writes through to SQLite so a server restart loses nothing durable.
- **Identity:** guests get a random participant token stored in localStorage so refresh rejoins the same participant. Accounts/auth are out of scope for v1.
- **Frontend:** single-page vanilla JS app (hash routing) styled with Tailwind CDN + Lucide, evolving the approved prototype UI. Views: landing (host/join), scenario library + creator, host control room, participant session.
- **Real-time events:** `join_room`, `submit_response`, `push_answer`, `end_session` from clients; `room_state`, `participant_count`, `response_incoming`, `answer_pushed`, `session_ended` from server. Reconnect re-sends full `room_state`.

## Testing Philosophy
Correct means: two browser contexts (host + participant) can complete the full loop — create session → join by code → submit answer → answer appears in host matrix → push → highlight appears on participant → end session → data present in SQLite. API endpoints validated with automated tests; the socket loop verified with an integration test using two socket.io clients.

## Out of Scope (v1)
- Accounts, login, guest-to-account claiming, department spaces, official-protocol badging.
- Public community library, upvotes/reports/cloning.
- PDF archival, media uploads (scenario image URL field only).
- Redis/Postgres/horizontal scaling (designed for, not built).
