import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io as ioc } from 'socket.io-client';
import { buildServer } from '../server/index.js';
import { signup, authed, emit } from './helpers.js';

// F4 (fireground migration): participants set an optional shift label that tags
// their answers in the host matrix and archive. It's settable until the first
// answer lands, then locks. Skipping it entirely keeps zero-friction joining.

let ctx, base;

before(async () => {
  ctx = await buildServer({ dbFile: ':memory:', authRateMax: 1000 });
  await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${ctx.app.server.address().port}`;
});
after(async () => { ctx.io.close(); await ctx.app.close(); });

async function room() {
  const { cookie } = await signup(base, { email: `host${Math.random()}@shift.test` });
  const { id } = await fetch(`${base}/api/scenarios`, {
    method: 'POST', headers: authed(cookie),
    body: JSON.stringify({
      title: 'Shift fixture', description: 'd', category: 'Fire', subcategory: 'Structure', visibility: 'public',
      questions: [{ prompt: 'Q1?', kind: 'text', instructor_answer: 'A1' }],
    }),
  }).then(r => r.json());
  const { room_code } = await fetch(`${base}/api/sessions`, {
    method: 'POST', headers: authed(cookie), body: JSON.stringify({ scenario_id: id }),
  }).then(r => r.json());
  return { room_code, hostCookie: cookie };
}

test('shift set before answering tags the response the host receives', async () => {
  const { room_code, hostCookie } = await room();
  const host = ioc(base, { extraHeaders: { cookie: hostCookie } });
  const s = ioc(base);
  try {
    const hj = await emit(host, 'join_room', { code: room_code, role: 'host' });
    const j = await emit(s, 'join_room', { code: room_code, token: 'shift-tok', role: 'participant' });
    const set = await emit(s, 'set_shift', { shift: 'B' });
    assert.equal(set.shift, 'B');
    const incoming = new Promise(res => host.once('response_incoming', res));
    await emit(s, 'submit_response', { question_id: hj.state.questions[0].id, body: 'crew answer' });
    const r = await incoming;
    assert.equal(r.shift_label, 'B');
  } finally { host.close(); s.close(); }
});

test('shift locks once an answer lands, and persists across rejoin', async () => {
  const { room_code } = await room();
  let s = ioc(base);
  let qid;
  try {
    const j = await emit(s, 'join_room', { code: room_code, token: 'lock-tok', role: 'participant' });
    qid = j.state.questions[0].id;
    await emit(s, 'set_shift', { shift: 'C' });
    await emit(s, 'submit_response', { question_id: qid, body: 'x' });
    const locked = await emit(s, 'set_shift', { shift: 'D' });
    assert.equal(locked.error, 'locked');
  } finally { s.close(); }
  s = ioc(base);
  try {
    const j2 = await emit(s, 'join_room', { code: room_code, token: 'lock-tok', role: 'participant' });
    assert.equal(j2.participant.shift_label, 'C');
    assert.equal(j2.state.responses.find(r => r.question_id === qid).shift_label, 'C');
  } finally { s.close(); }
});

test('shift is optional — no pick means a blank label, joining still works', async () => {
  const { room_code } = await room();
  const s = ioc(base);
  try {
    const j = await emit(s, 'join_room', { code: room_code, token: 'noshift-tok', role: 'participant' });
    assert.equal(j.participant.shift_label, '');
    const a = await emit(s, 'submit_response', { question_id: j.state.questions[0].id, body: 'y' });
    assert.equal(a.ok, true);
  } finally { s.close(); }
});
