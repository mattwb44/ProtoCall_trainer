# ProtoCall Trainer ("CrewTable")

Live tactical fireground & EMS scenario training. A host launches a session from the
scenario library, the crew scans a QR code to join from any phone/tablet/PC, answers
stream into the host's Aggregation Matrix in real time, and the host pushes notable
answers to every device to drive the tabletop discussion.

## Run

```bash
npm install
npm start        # http://localhost:3000
```

The SQLite database (`protocall.db`) is created and seeded with the
"Two-Story Residential Fire — Trapped Occupant" scenario on first run.
Crew on the same network can join via your machine's LAN IP (the QR encodes the host URL).

## Test

```bash
npm test         # REST + full live-session socket loop (node:test)
```

## Layout

- `server/` — Fastify + Socket.IO + better-sqlite3 (`index.js` API/sockets, `db.js` schema/seed, `rooms.js` session logic)
- `public/index.html` — single-page frontend (Tailwind + Lucide, hash routing)
- `test/` — integration tests
- `SPEC.md` / `PRD.md` — architecture spec and v1 product requirements
- `ProtoCall_trainer.html` — the original static prototype (superseded by the live app)
