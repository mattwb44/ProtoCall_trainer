import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io as ioc } from 'socket.io-client';
import { buildServer } from '../server/index.js';
import { signup, authed, emit } from './helpers.js';

// PRD-v7 product-wide rule: model answers are gated on full submission —
// a participant sees no instructor answer anywhere (REST or socket) until
// they have answered every question; then all answers reveal at once.

let ctx, base;

before(async () => {
  ctx = await buildServer({ dbFile: ':memory:', authRateMax: 1000 });
  await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${ctx.app.server.address().port}`;
});
after(async () => { ctx.io.close(); await ctx.app.close(); });

const seededScenario = async () => {
  const [s] = await fetch(`${base}/api/scenarios`).then(r => r.json());
  return fetch(`${base}/api/scenarios/${s.id}`).then(r => r.json());
};

test('REST: scenario detail never exposes instructor answers to guests or non-authors', async () => {
  const s = await seededScenario(); // fetched as guest
  assert.ok(s.questions.length > 0);
  for (const q of s.questions) assert.equal(q.instructor_answer, undefined);

  const { cookie } = await signup(base, { email: 'reader@gate.test' });
  const asUser = await fetch(`${base}/api/scenarios/${s.id}`, { headers: { cookie } }).then(r => r.json());
  for (const q of asUser.questions) assert.equal(q.instructor_answer, undefined);
});

test('REST: the author still sees instructor answers (needed to edit)', async () => {
  const { cookie } = await signup(base, { email: 'author@gate.test' });
  const created = await fetch(`${base}/api/scenarios`, {
    method: 'POST', headers: authed(cookie),
    body: JSON.stringify({
      title: 'Gating fixture', description: 'x', category: 'Fire', subcategory: 'Structure', visibility: 'public',
      questions: [
        { prompt: 'Q1?', kind: 'text', instructor_answer: 'A1' },
        { prompt: 'Q2?', kind: 'text', instructor_answer: 'A2' },
      ],
    }),
  }).then(r => r.json());
  const mine = await fetch(`${base}/api/scenarios/${created.id}`, { headers: { cookie } }).then(r => r.json());
  assert.deepEqual(mine.questions.map(q => q.instructor_answer), ['A1', 'A2']);
});

test('live session: answers withheld until the participant has submitted every question', async () => {
  const { cookie: hostCookie } = await signup(base, { email: 'gatehost@gate.test' });
  const created = await fetch(`${base}/api/scenarios`, {
    method: 'POST', headers: authed(hostCookie),
    body: JSON.stringify({
      title: 'Gating live', description: 'x', category: 'Fire', subcategory: 'Structure', visibility: 'public',
      questions: [
        { prompt: 'Q1?', kind: 'text', instructor_answer: 'A1' },
        { prompt: 'Q2?', kind: 'text', instructor_answer: 'A2' },
      ],
    }),
  }).then(r => r.json());
  const { room_code } = await fetch(`${base}/api/sessions`, {
    method: 'POST', headers: authed(hostCookie), body: JSON.stringify({ scenario_id: created.id }),
  }).then(r => r.json());

  const guest = ioc(base);
  const guest2 = ioc(base);
  try {
    const j = await emit(guest, 'join_room', { code: room_code, token: 'gate-tok', role: 'participant' });
    for (const q of j.state.questions) assert.equal(q.instructor_answer, undefined);
    assert.equal(j.state.answers_revealed, false);

    // partial submission: no answer leaks in the ack
    const [q1, q2] = j.state.questions;
    const ack1 = await emit(guest, 'submit_response', { question_id: q1.id, body: 'first' });
    assert.equal(ack1.ok, true);
    assert.equal(ack1.official_answer, undefined);
    assert.equal(ack1.complete, false);
    assert.equal(ack1.official_answers, undefined);

    // rejoin mid-run: still gated
    const rejoin = await emit(guest2, 'join_room', { code: room_code, token: 'gate-tok', role: 'participant' });
    for (const q of rejoin.state.questions) assert.equal(q.instructor_answer, undefined);
    assert.equal(rejoin.state.answers_revealed, false);

    // final submission completes the set: all answers reveal at once
    const ack2 = await emit(guest, 'submit_response', { question_id: q2.id, body: 'second' });
    assert.equal(ack2.complete, true);
    assert.deepEqual(ack2.official_answers, { [q1.id]: 'A1', [q2.id]: 'A2' });

    // rejoin after completion: answers present in state
    const done = await emit(guest2, 'join_room', { code: room_code, token: 'gate-tok', role: 'participant' });
    assert.equal(done.state.answers_revealed, true);
    assert.deepEqual(done.state.questions.map(q => q.instructor_answer), ['A1', 'A2']);
  } finally { guest.close(); guest2.close(); }
});

test('archived session detail: participant gated on completeness, host unaffected', async () => {
  const { cookie: hostCookie } = await signup(base, { email: 'archhost@gate.test' });
  const created = await fetch(`${base}/api/scenarios`, {
    method: 'POST', headers: authed(hostCookie),
    body: JSON.stringify({
      title: 'Gating archive', description: 'x', category: 'Fire', subcategory: 'Structure', visibility: 'public',
      questions: [
        { prompt: 'Q1?', kind: 'text', instructor_answer: 'A1' },
        { prompt: 'Q2?', kind: 'text', instructor_answer: 'A2' },
      ],
    }),
  }).then(r => r.json());
  const { room_code, session_id } = await fetch(`${base}/api/sessions`, {
    method: 'POST', headers: authed(hostCookie), body: JSON.stringify({ scenario_id: created.id }),
  }).then(r => r.json());

  const host = ioc(base, { extraHeaders: { cookie: hostCookie } });
  const partial = ioc(base);
  const complete = ioc(base);
  try {
    await emit(host, 'join_room', { code: room_code, token: 'h', role: 'host' });
    const jp = await emit(partial, 'join_room', { code: room_code, token: 'partial-tok', role: 'participant' });
    const jc = await emit(complete, 'join_room', { code: room_code, token: 'complete-tok', role: 'participant' });
    await emit(partial, 'submit_response', { question_id: jp.state.questions[0].id, body: 'only one' });
    await emit(complete, 'submit_response', { question_id: jc.state.questions[0].id, body: 'one' });
    await emit(complete, 'submit_response', { question_id: jc.state.questions[1].id, body: 'two' });
    await emit(host, 'end_session', {});
  } finally { host.close(); partial.close(); complete.close(); }

  const { cookie: pCookie } = await signup(base, { email: 'archpart@gate.test', guest_token: 'partial-tok' });
  const { cookie: cCookie } = await signup(base, { email: 'archdone@gate.test', guest_token: 'complete-tok' });

  const pDetail = await fetch(`${base}/api/me/sessions/${session_id}`, { headers: { cookie: pCookie } }).then(r => r.json());
  for (const q of pDetail.questions) assert.equal(q.instructor_answer, undefined);

  const cDetail = await fetch(`${base}/api/me/sessions/${session_id}`, { headers: { cookie: cCookie } }).then(r => r.json());
  assert.deepEqual(cDetail.questions.map(q => q.instructor_answer), ['A1', 'A2']);

  const hDetail = await fetch(`${base}/api/me/sessions/${session_id}`, { headers: { cookie: hostCookie } }).then(r => r.json());
  assert.deepEqual(hDetail.questions.map(q => q.instructor_answer), ['A1', 'A2']);
});
