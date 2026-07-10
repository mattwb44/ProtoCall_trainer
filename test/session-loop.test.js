import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io as ioc } from 'socket.io-client';
import { buildServer } from '../server/index.js';
import { signup, authed, emit, once } from './helpers.js';

let ctx, base, hostCookie;

before(async () => {
  ctx = await buildServer({ dbFile: ':memory:', authRateMax: 1000 });
  await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${ctx.app.server.address().port}`;
  ({ cookie: hostCookie } = await signup(base, { email: 'chief@station1.test' }));
});

after(async () => {
  ctx.io.close();
  await ctx.app.close();
});

const createSession = async () => {
  const [{ id: scenarioId }] = await fetch(`${base}/api/scenarios`).then(r => r.json());
  return fetch(`${base}/api/sessions`, {
    method: 'POST', headers: authed(hostCookie),
    body: JSON.stringify({ scenario_id: scenarioId }),
  }).then(r => r.json());
};

test('REST: seeded library and scenario detail', async () => {
  const list = await fetch(`${base}/api/scenarios`).then(r => r.json());
  assert.equal(list.length, 1);
  assert.match(list[0].title, /Two-Story Residential Fire/);
  const detail = await fetch(`${base}/api/scenarios/${list[0].id}`).then(r => r.json());
  assert.equal(detail.questions.length, 12);
  const mc = detail.questions.find(q => q.kind === 'multiple_choice');
  assert.equal(mc.choices.length, 2);
});

test('REST: creating scenarios requires login, then validates fields', async () => {
  const anon = await fetch(`${base}/api/scenarios`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'x' }),
  });
  assert.equal(anon.status, 401);
  const bad = await fetch(`${base}/api/scenarios`, {
    method: 'POST', headers: authed(hostCookie), body: JSON.stringify({ title: 'x' }),
  });
  assert.equal(bad.status, 400);
});

test('full live-session loop: create → join → submit → push → end → persisted', async () => {
  const { room_code, session_id } = await createSession();
  assert.match(room_code, /^[A-Z]+-\d{4}$/);

  const host = ioc(base, { extraHeaders: { cookie: hostCookie } });
  const crew = ioc(base);
  try {
    const hostJoin = await emit(host, 'join_room', { code: room_code, role: 'host' });
    assert.equal(hostJoin.state.session.room_code, room_code);
    assert.ok(hostJoin.state.questions[0].instructor_answer.length > 0);

    const crewJoin = await emit(crew, 'join_room', { code: room_code.toLowerCase(), token: 'tok-1', role: 'participant' });
    assert.equal(crewJoin.participant.display_tag, 'P1');
    assert.equal(crewJoin.state.questions[0].instructor_answer, undefined);

    const qid = crewJoin.state.questions[0].id;
    const incoming = once(host, 'response_incoming');
    const subRes = await emit(crew, 'submit_response', { question_id: qid, body: 'VEIS the bedroom window' });
    assert.equal(subRes.ok, true);
    assert.equal(subRes.complete, false, 'PRD-v7: no reveal until every question is answered');
    assert.equal(subRes.official_answers, undefined);
    const hostSaw = await incoming;
    assert.equal(hostSaw.body, 'VEIS the bedroom window');
    assert.equal(hostSaw.display_tag, 'P1');

    const pushedOnCrew = once(crew, 'answer_pushed');
    host.emit('push_answer', { response_id: hostSaw.id });
    const pushed = await pushedOnCrew;
    assert.equal(pushed.id, hostSaw.id);
    assert.equal(pushed.is_pushed, 1);

    await emit(crew, 'save_note', { question_id: qid, body: 'remember LUNAR' });

    const endedOnCrew = once(crew, 'session_ended');
    const endAck = await emit(host, 'end_session', {});
    assert.equal(endAck.ok, true);
    await endedOnCrew;

    const db = ctx.db;
    assert.equal(db.prepare('SELECT status FROM live_sessions WHERE id=?').get(session_id).status, 'ended');
    const resp = db.prepare('SELECT * FROM responses WHERE session_id=?').all(session_id);
    assert.equal(resp.length, 1);
    assert.equal(resp[0].is_pushed, 1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM notes WHERE session_id=?').get(session_id).n, 1);

    const crew2 = ioc(base);
    try {
      const rejoin = await emit(crew2, 'join_room', { code: room_code, token: 'tok-1', role: 'participant' });
      assert.equal(rejoin.participant.display_tag, 'P1');
      const q0 = rejoin.state.questions.find(q => q.id === qid);
      // session ended → debrief: answers unlock even with 1 of 12 answered
      assert.ok(q0.instructor_answer.length > 0);
      assert.equal(rejoin.state.answers_revealed, true);
    } finally { crew2.close(); }
  } finally {
    host.close(); crew.close();
  }
});

test('access control: hosting needs login; only the host user opens the control room', async () => {
  const [{ id: scenarioId }] = await fetch(`${base}/api/scenarios`).then(r => r.json());
  const anon = await fetch(`${base}/api/sessions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenario_id: scenarioId }),
  });
  assert.equal(anon.status, 401);

  const { room_code } = await createSession();
  const { cookie: otherCookie } = await signup(base, { email: 'other@station2.test' });

  const stranger = ioc(base, { extraHeaders: { cookie: otherCookie } });
  const anonSock = ioc(base);
  const a = ioc(base), b = ioc(base);
  try {
    const denied1 = await emit(stranger, 'join_room', { code: room_code, role: 'host' });
    assert.match(denied1.error, /Only the session host/);
    const denied2 = await emit(anonSock, 'join_room', { code: room_code, role: 'host' });
    assert.match(denied2.error, /Only the session host/);

    const ja = await emit(a, 'join_room', { code: room_code, token: 'a', role: 'participant' });
    const jb = await emit(b, 'join_room', { code: room_code, token: 'b', role: 'participant' });
    assert.notEqual(ja.participant.display_tag, jb.participant.display_tag);
    const denied3 = await emit(a, 'end_session', {});
    assert.equal(denied3.error, 'host only');
  } finally { stranger.close(); anonSock.close(); a.close(); b.close(); }
});
