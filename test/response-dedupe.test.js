// PR 9: live response dedupe.
//
// A participant answers each question exactly once — the client locks the whole
// track after the first submit (public/index.html), and the solo REST path
// rejects a repeat with 409. But a socket double-fire (an offline-queue flush or
// a timed-out re-emit) could still insert a duplicate response row. This PR:
//   (a) a one-shot migration collapses existing duplicates per
//       (session_id, participant_id, question_id) — keep the pushed row if any,
//       else the earliest — then adds a UNIQUE index on those columns;
//   (b) submitResponse uses INSERT OR IGNORE and returns the already-stored row
//       on a collision, so the double-fire acks normally instead of crashing on
//       the new unique constraint.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { io as ioc } from 'socket.io-client';
import { createDb } from '../server/db.js';
import { buildServer } from '../server/index.js';
import { signup, authed, emit } from './helpers.js';

// --- (a) migration over seeded duplicates ---------------------------------

test('migration collapses duplicate responses (pushed wins, else earliest) and adds the unique index', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-dedupe-'));
  const file = path.join(dir, 'dedupe.db');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  let db = createDb(file);
  // Minimal object graph so the responses FKs (session/question/participant) are
  // satisfiable — foreign_keys is ON.
  db.exec(`
    INSERT INTO scenarios (id, title, category, subcategory) VALUES ('sc','S','Fireground','Residential');
    INSERT INTO questions (id, scenario_id, prompt) VALUES ('qa','sc','A?'), ('qb','sc','B?');
    INSERT INTO live_sessions (id, room_code, scenario_id) VALUES ('ls','ROOM-1','sc');
    INSERT INTO participants (id, session_id, token, display_tag) VALUES ('pp','ls','tok','P1');
  `);

  // Simulate a pre-migration database: drop the index and clear the one-shot
  // flag so we can seed the very duplicates the running code now forbids.
  db.exec('DROP INDEX IF EXISTS ux_responses_session_participant_question');
  db.prepare("DELETE FROM app_meta WHERE key='responses_dedupe'").run();

  const ins = db.prepare(
    'INSERT INTO responses (id, session_id, question_id, participant_id, body, is_pushed, submitted_at) VALUES (?,?,?,?,?,?,?)');
  // Group A (question qa): three dupes, the middle one pushed → keep the pushed.
  ins.run('a1', 'ls', 'qa', 'pp', 'first',  0, '2026-01-01 00:00:01');
  ins.run('a2', 'ls', 'qa', 'pp', 'pushed', 1, '2026-01-01 00:00:02');
  ins.run('a3', 'ls', 'qa', 'pp', 'later',  0, '2026-01-01 00:00:03');
  // Group B (question qb): two dupes, none pushed → keep the earliest.
  ins.run('b2', 'ls', 'qb', 'pp', 'newer',  0, '2026-01-01 00:00:09');
  ins.run('b1', 'ls', 'qb', 'pp', 'older',  0, '2026-01-01 00:00:05');
  db.close();

  db = createDb(file); // migrate() re-runs: dedupe fires, then the index is (re)created
  t.after(() => db.close());

  const a = db.prepare("SELECT id, body FROM responses WHERE question_id='qa'").all();
  assert.equal(a.length, 1, 'group A collapsed to one row');
  assert.equal(a[0].id, 'a2', 'the pushed row survives regardless of timestamp');

  const b = db.prepare("SELECT id, body FROM responses WHERE question_id='qb'").all();
  assert.equal(b.length, 1, 'group B collapsed to one row');
  assert.equal(b[0].id, 'b1', 'with no pushed row, the earliest survives');

  // The unique index now exists and actually blocks a plain duplicate insert.
  const idx = db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name=?")
    .get('ux_responses_session_participant_question');
  assert.ok(idx, 'unique index created');
  assert.throws(
    () => db.prepare('INSERT INTO responses (id, session_id, question_id, participant_id, body) VALUES (?,?,?,?,?)')
      .run('dup', 'ls', 'qa', 'pp', 'blocked'),
    /UNIQUE|constraint/i,
    'a raw duplicate insert is rejected by the index');
});

// --- (b) a socket double-submit yields one row, and both calls ack ----------

let ctx, base, hostCookie;

before(async () => {
  ctx = await buildServer({ dbFile: ':memory:', authRateMax: 1000 });
  await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${ctx.app.server.address().port}`;
  ({ cookie: hostCookie } = await signup(base, { email: 'host@dedupe.test' }));
});

after(async () => {
  ctx.io.close();
  await ctx.app.close();
});

test('a double-fired submit_response stores one row and both calls ack ok', async () => {
  const [{ id: scenarioId }] = await fetch(`${base}/api/scenarios`).then(r => r.json());
  const { session_id } = await fetch(`${base}/api/sessions`, {
    method: 'POST', headers: authed(hostCookie), body: JSON.stringify({ scenario_id: scenarioId }),
  }).then(r => r.json());
  const { room_code } = ctx.db.prepare('SELECT room_code FROM live_sessions WHERE id=?').get(session_id);

  const crew = ioc(base);
  try {
    const join = await emit(crew, 'join_room', { code: room_code, token: 'tok-dup', role: 'participant' });
    const pid = join.participant.id;
    const qid = join.state.questions[0].id;

    // Fire the same answer twice — the second is the double-fire (queue flush /
    // timed-out re-emit). Both must ack ok; the second must not crash on the
    // unique index.
    const first = await emit(crew, 'submit_response', { question_id: qid, body: 'VEIS the window' });
    const second = await emit(crew, 'submit_response', { question_id: qid, body: 'VEIS the window' });
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);

    const n = ctx.db.prepare(
      'SELECT COUNT(*) n FROM responses WHERE session_id=? AND participant_id=? AND question_id=?')
      .get(session_id, pid, qid).n;
    assert.equal(n, 1, 'exactly one response row despite two submits');
  } finally {
    crew.close();
  }
});
