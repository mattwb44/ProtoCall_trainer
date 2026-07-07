import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createDb(file = process.env.DB_PATH || path.join(__dirname, '..', 'protocall.db')) {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
  CREATE TABLE IF NOT EXISTS scenarios (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    category TEXT NOT NULL,
    subcategory TEXT NOT NULL,
    image_url TEXT DEFAULT '',
    visibility TEXT NOT NULL DEFAULT 'private',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS questions (
    id TEXT PRIMARY KEY,
    scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
    prompt TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'text',
    choices TEXT,                -- JSON array when kind='multiple_choice'
    instructor_answer TEXT DEFAULT '',
    role_track TEXT DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS live_sessions (
    id TEXT PRIMARY KEY,
    room_code TEXT UNIQUE NOT NULL,
    scenario_id TEXT NOT NULL REFERENCES scenarios(id),
    status TEXT NOT NULL DEFAULT 'live',
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    ended_at TEXT
  );
  CREATE TABLE IF NOT EXISTS participants (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
    token TEXT NOT NULL,
    display_tag TEXT NOT NULL,
    UNIQUE(session_id, token)
  );
  CREATE TABLE IF NOT EXISTS responses (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
    question_id TEXT NOT NULL REFERENCES questions(id),
    participant_id TEXT NOT NULL REFERENCES participants(id),
    body TEXT NOT NULL,
    is_pushed INTEGER NOT NULL DEFAULT 0,
    submitted_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
    question_id TEXT REFERENCES questions(id),
    participant_id TEXT NOT NULL REFERENCES participants(id),
    body TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS auth_sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS scenario_votes (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, scenario_id)
  );`);

  migrate(db);
  return db;
}

// Idempotent column additions for databases created before v2.
function migrate(db) {
  const addColumn = (table, column, ddl) => {
    const cols = db.pragma(`table_info(${table})`).map(c => c.name);
    if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  };
  addColumn('scenarios', 'author_id', 'author_id TEXT REFERENCES users(id)');
  addColumn('scenarios', 'cloned_from', 'cloned_from TEXT REFERENCES scenarios(id)');
  addColumn('live_sessions', 'host_id', 'host_id TEXT REFERENCES users(id)');
  addColumn('participants', 'user_id', 'user_id TEXT REFERENCES users(id)');

  // System user owns pre-v2 content; the seed scenario becomes public.
  db.prepare(`INSERT OR IGNORE INTO users (id, email, password_hash, display_name)
              VALUES ('system', 'system@protocall.local', '!', 'ProtoCall')`).run();
  db.prepare(`UPDATE scenarios SET author_id='system', visibility='public' WHERE author_id IS NULL`).run();
}

export const uuid = () => randomUUID();

export function seedIfEmpty(db) {
  if (db.prepare('SELECT COUNT(*) n FROM scenarios').get().n > 0) return;
  const sid = uuid();
  db.prepare(`INSERT INTO scenarios (id, title, description, category, subcategory, visibility, author_id)
              VALUES (?,?,?,?,?,'public','system')`).run(
    sid,
    'Two-Story Residential Fire — Trapped Occupant',
    "Two-story single-family wood-frame residence, fire at 14:00. Heavy dark smoke pushes from the roof and second-floor windows. A frantic bystander yells that an elderly person is trapped in a second-floor bedroom.",
    'Fireground', 'Residential'
  );
  const qs = [
    ['Firefighter', 'Primary Action: You are assigned to the primary search. Which window or door do you enter first, and why?', 'text', null,
     'Enter closest to the reported victim location — VEIS the second-floor bedroom window off ladder access if the interior stairs are untenable; otherwise front door to the stairs, staying oriented to your egress.'],
    ['Firefighter', 'Hose Selection: Do you pull a 1¾-inch or a 2½-inch line for this residential structure?', 'multiple_choice', JSON.stringify(['1¾-inch handline', '2½-inch handline']),
     '1¾-inch — mobility and adequate flow (150–185 gpm) for a residential fire load; a 2½ is too slow to advance to the second floor with a trapped occupant.'],
    ['Firefighter', 'Tools: What specific tools must you carry to the second floor for search and ventilation?', 'text', null,
     'Halligan and flathead axe (irons), TIC, hand light, webbing/search rope, and a hook for horizontal ventilation and ceiling checks.'],
    ['Firefighter', 'Air Management: Your low-air alarm goes off while searching the second floor. What is your immediate next step?', 'text', null,
     'Exit immediately with your partner via the nearest known egress and notify your officer — low-air is your exit alarm, not a warning to finish the search.'],
    ['Driver / Pump Operator', 'Spotting: Where do you position the engine relative to the front of the house to leave room for the ladder truck?', 'text', null,
     'Pull past or stop short of the address to leave the front of the building for the truck; position for your own hydrant lay and pump panel visibility.'],
    ['Driver / Pump Operator', 'Water Supply: Hook up to a nearby hydrant (forward lay), or rely on tank water first?', 'text', null,
     'Start attack off tank water for speed, then establish the hydrant supply immediately — never let the attack line depend on a 500-gallon tank alone.'],
    ['Driver / Pump Operator', 'Pump Pressures: How do you calculate the correct discharge pressure for the attack line to the second floor?', 'text', null,
     'PDP = nozzle pressure + friction loss per length/diameter + elevation (≈5 psi per story above grade).'],
    ['Driver / Pump Operator', 'Scene Safety: What panel warning signs indicate the pump is cavitating or running out of water?', 'text', null,
     'Fluctuating/dropping discharge pressure, RPM rising without pressure gain, popping/gravel sound, and the tank level dropping to empty.'],
    ['Company Officer', 'Initial Report: What are the four key pieces of information in your initial radio report on arrival?', 'text', null,
     'Building/size-up description, smoke and fire conditions, actions being taken (mode declaration), and command establishment / resource requests.'],
    ['Company Officer', 'Risk Assessment: Bystander reports someone inside, but the first floor is fully engulfed. How do you balance crew risk vs rescue?', 'text', null,
     'Risk a lot to save a savable life — but assess survivability. Fully engulfed first floor may mean an unsurvivable environment; consider VEIS to the bedroom over an interior push through the fire.'],
    ['Company Officer', 'Ventilation: Vertical (cut the roof) or horizontal (break windows) — and when do you execute?', 'text', null,
     'Coordinate with attack: ventilate only when the line is in place. Horizontal at the point of attack is faster; vertical if crews can safely work a tenable roof over a top-floor fire.'],
    ['Company Officer', 'Mayday: A firefighter is separated from the crew in heavy smoke. What is your precise radio transmission to the IC?', 'text', null,
     '"Mayday, Mayday, Mayday" then LUNAR: Location, Unit, Name, Assignment/Air, Resources needed — and activate the RIC.'],
  ];
  const ins = db.prepare(`INSERT INTO questions (id, scenario_id, prompt, kind, choices, instructor_answer, role_track, sort_order)
                          VALUES (?,?,?,?,?,?,?,?)`);
  qs.forEach(([track, prompt, kind, choices, answer], i) =>
    ins.run(uuid(), sid, prompt, kind, choices, answer, track, i));
}
