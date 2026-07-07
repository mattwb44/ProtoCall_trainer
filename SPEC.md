# ProtoCall Trainer ("CrewTable") — Technical Specification

**Product:** Live Tactical Fireground & EMS Scenario Simulation Hub
**Audience:** On-duty firefighters, paramedics, EMTs, training chiefs, students — smartphone, tablet, Mac, PC.
**Prototype:** `ProtoCall_trainer.html` (single-file interactive demo, seeded with the "Two-Story Residential Fire" scenario).

---

## 1. System Breakdown

### 1.1 High-Level Architecture

```
 [ Browser (PWA) ]  ←HTTPS→  [ CDN / Edge (static assets) ]
        │
        │  WebSocket (Socket.IO) — sub-100ms sync
        ▼
 [ Load Balancer (sticky by roomCode hash) ]
        │
 ┌──────┴───────────────────────────────┐
 │  App Nodes (Node.js / Fastify)       │  ← horizontally scaled, stateless
 │  - REST API (auth, libraries, CRUD)  │
 │  - Socket.IO w/ Redis adapter        │
 └──────┬───────────────┬───────────────┘
        │               │
   [ PostgreSQL ]   [ Redis Cluster ]
   durable data     - pub/sub fan-out (Socket.IO adapter)
                    - transient room state (hash per room, TTL)
                    - presence / participant counts
        │
   [ Worker queue (BullMQ) ] → PDF generation, session archival, media processing
        │
   [ Object storage (S3-compatible) ] → scenario media, generated PDFs
```

### 1.2 Real-Time Design

- **Protocol:** WebSockets (Socket.IO) with automatic fallback to long-polling; Redis adapter for cross-node pub/sub so any app node can serve any room.
- **Room model:** one Socket.IO room per session (`session:{roomCode}`), plus a host-only channel (`session:{roomCode}:host`) that receives the response firehose.
- **Events (client→server):** `join_room`, `submit_response`, `typing_progress` (throttled 500ms), `save_note`, `push_answer` (host), `end_session` (host).
- **Events (server→client):** `room_state`, `participant_count`, `response_incoming` (host only, anonymous), `answer_pushed` (broadcast highlight), `session_ended`.
- **Transient state in Redis:** room hash (`room:{code}` → scenario snapshot, status, hostId), sorted set of participants, list of responses per question. TTL 24h; flushed to Postgres on `end_session`.
- **Scale path:** 150 concurrent users/node baseline → add nodes behind LB; Redis Cluster shards pub/sub; Postgres read replicas for library browsing; per-region deployments for global latency.

### 1.3 Reliability

- Client keeps a monotonic `seq` per room; on reconnect it sends `last_seq` and the server replays missed events from the Redis response list.
- Persistent connection-status badge on every participant screen (Live / Reconnecting / Offline); answers queue locally (IndexedDB) while offline and flush on reconnect.
- Guest identity = signed anonymous token in localStorage, so a page refresh rejoins the same participant record.

---

## 2. User Roles & Permissions

| Capability | Guest | Standard User | Training Chief / Dept Admin |
|---|---|---|---|
| Join via QR/link, answer, take notes | ✅ | ✅ | ✅ |
| Prompted to create account at session end | ✅ | — | — |
| Private Personal Library | — | ✅ | ✅ |
| Public Library: browse, upvote, report, clone | — | ✅ | ✅ |
| Host standard rooms | — | ✅ | ✅ |
| Historical completed sessions | — | ✅ | ✅ |
| Verified Department Space | — | member view | ✅ manage |
| Mark scenario "Official Department Protocol" | — | — | ✅ |

Official scenarios render with an emerald "OFFICIAL PROTOCOL" badge and are pinned/highlighted for department members.

---

## 3. Taxonomy

- **Fireground:** Residential · Commercial · Wildland · High-Rise
- **EMS:** Cardiac · Trauma · Pediatric · Medical
- **Motor Vehicle Accidents:** Extrication · Rollover · Hazardous Materials

Stored as a `categories` reference table (parent/child) so admins can extend without migration.

---

## 4. Data Schema Blueprints (PostgreSQL)

```sql
-- USERS ----------------------------------------------------------
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           CITEXT UNIQUE NOT NULL,
  password_hash   TEXT NOT NULL,
  display_name    TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'standard'
                  CHECK (role IN ('standard','dept_admin')),
  department_id   UUID REFERENCES departments(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE departments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  verified_at  TIMESTAMPTZ            -- verified "Department Space"
);

-- SCENARIOS ------------------------------------------------------
CREATE TABLE categories (
  id        SERIAL PRIMARY KEY,
  parent_id INT REFERENCES categories(id),   -- NULL = top level
  name      TEXT NOT NULL
);

CREATE TABLE scenarios (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id      UUID NOT NULL REFERENCES users(id),
  title          TEXT NOT NULL,
  description    TEXT,
  category_id    INT NOT NULL REFERENCES categories(id),  -- subcategory
  visibility     TEXT NOT NULL DEFAULT 'private'
                 CHECK (visibility IN ('private','public','department')),
  is_official    BOOLEAN NOT NULL DEFAULT FALSE,          -- dept_admin only
  department_id  UUID REFERENCES departments(id),
  cloned_from    UUID REFERENCES scenarios(id),
  upvotes        INT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE scenario_media (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id  UUID NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('photo','ekg','map')),
  url          TEXT NOT NULL,
  sort_order   INT NOT NULL DEFAULT 0
);

CREATE TABLE questions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id        UUID NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  prompt             TEXT NOT NULL,
  kind               TEXT NOT NULL CHECK (kind IN ('text','multiple_choice')),
  choices            JSONB,               -- ["A","B",...] when multiple_choice
  instructor_answer  TEXT,                -- the "Official Answer"
  role_track         TEXT,                -- e.g. 'Firefighter', 'Driver', 'Officer'
  sort_order         INT NOT NULL DEFAULT 0
);

-- LIVE SESSIONS --------------------------------------------------
CREATE TABLE live_sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_code    TEXT UNIQUE NOT NULL,        -- e.g. 'FIRE-4821'
  scenario_id  UUID NOT NULL REFERENCES scenarios(id),
  host_id      UUID NOT NULL REFERENCES users(id),
  status       TEXT NOT NULL DEFAULT 'live'
               CHECK (status IN ('live','ended','archived')),
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at     TIMESTAMPTZ,
  archive_pdf  TEXT                          -- object-storage key
);

CREATE TABLE session_participants (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   UUID NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
  user_id      UUID REFERENCES users(id),   -- NULL = guest
  guest_token  TEXT,                        -- claim key for post-session signup
  display_tag  TEXT NOT NULL                -- 'Participant 7' (anonymous to host)
);

-- RESPONSES ------------------------------------------------------
CREATE TABLE responses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
  question_id     UUID NOT NULL REFERENCES questions(id),
  participant_id  UUID NOT NULL REFERENCES session_participants(id),
  body            TEXT NOT NULL,
  is_pushed       BOOLEAN NOT NULL DEFAULT FALSE,  -- host pushed to crew
  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
  question_id     UUID REFERENCES questions(id),
  participant_id  UUID NOT NULL REFERENCES session_participants(id),
  body            TEXT NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Guest claim flow:** at session end the guest's `guest_token` is embedded in the signup CTA; creating an account sets `session_participants.user_id`, permanently attaching their responses, notes, and pushed answers to the new account's Completed Library.

---

## 5. Design System

- **Theme:** dark-mode default, `slate-950` background, `slate-800` card surfaces.
- **Accents:** `rose-600` critical/structural prompts · `amber-500` tactical notes · `emerald-600` verified/official answers.
- **Typography:** system sans stack, fluid scale; all tap targets ≥ 48×48px.
- **Layout:** mobile-first participant view; host "Control Room" is a 30/70 split (room info + QR | Aggregation Matrix) collapsing to stacked on tablet portrait.

## 6. Offboarding

- **Host End Session:** destructive confirm → "Archive this completed session?" → worker renders PDF (scenario, all questions, pushed answers, aggregate responses) → stored to library + object storage.
- **Guest drawer:** sticky bottom drawer — *"Don't lose tonight's training. Create a quick account to permanently save your answers, pushed notes, and the full scenario to your Completed Library."*
