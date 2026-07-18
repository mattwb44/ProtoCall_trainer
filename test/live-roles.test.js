import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io as ioc } from 'socket.io-client';
import { buildServer } from '../server/index.js';
import { signup, authed, emit } from './helpers.js';

// PRD-v7 live role select: participants self-select a role on join and get
// common + role questions; the reveal gate counts only their track set.
// Roles stick to the participant token and can't change once answers exist.

let ctx, base;

before(async () => {
  ctx = await buildServer({ dbFile: ':memory:', authRateMax: 1000 });
  await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${ctx.app.server.address().port}`;
});
after(async () => { ctx.io.close(); await ctx.app.close(); });

async function trackedRoom() {
  const { cookie } = await signup(base, { email: `host${Math.random()}@roles.test` });
  const { id } = await fetch(`${base}/api/scenarios`, {
    method: 'POST', headers: authed(cookie),
    body: JSON.stringify({
      title: 'Role fixture', description: 'd', category: 'Fire', subcategory: 'Structure', visibility: 'public', objective_primary: 'Scene Size-Up',
      questions: [
        { prompt: 'Common?', kind: 'text', instructor_answer: 'CA' },
        { prompt: 'FF?', kind: 'text', instructor_answer: 'FA', role_track: 'Firefighter' },
        { prompt: 'Capt?', kind: 'text', instructor_answer: 'KA', role_track: 'Captain' },
      ],
    }),
  }).then(r => r.json());
  const { room_code } = await fetch(`${base}/api/sessions`, {
    method: 'POST', headers: authed(cookie), body: JSON.stringify({ scenario_id: id }),
  }).then(r => r.json());
  return { room_code, hostCookie: cookie };
}

test('join with a role: common + role questions only; tracks offered in state', async () => {
  const { room_code } = await trackedRoom();
  const s = ioc(base);
  try {
    const j = await emit(s, 'join_room', { code: room_code, token: 'ff-tok', role: 'participant', role_track: 'Firefighter' });
    assert.deepEqual(j.state.tracks.sort(), ['Captain', 'Firefighter']);
    assert.equal(j.participant.role_track, 'Firefighter');
    assert.deepEqual(j.state.questions.map(q => q.prompt), ['Common?', 'FF?']);
  } finally { s.close(); }
});

test('track-set completeness: finishing my two questions reveals my track answers only', async () => {
  const { room_code } = await trackedRoom();
  const s = ioc(base);
  try {
    const j = await emit(s, 'join_room', { code: room_code, token: 'cap-tok', role: 'participant', role_track: 'Captain' });
    const [common, capt] = j.state.questions;
    const a1 = await emit(s, 'submit_response', { question_id: common.id, body: 'one' });
    assert.equal(a1.complete, false);
    const a2 = await emit(s, 'submit_response', { question_id: capt.id, body: 'two' });
    assert.equal(a2.complete, true);
    assert.deepEqual(Object.values(a2.official_answers).sort(), ['CA', 'KA']);
  } finally { s.close(); }
});

test('a question outside my track is rejected on submit', async () => {
  const { room_code } = await trackedRoom();
  const observer = ioc(base); // no role — sees everything
  const s = ioc(base);
  try {
    const all = await emit(observer, 'join_room', { code: room_code, token: 'obs-tok', role: 'participant' });
    assert.equal(all.state.questions.length, 3, 'no role = every question, as today');
    const captQ = all.state.questions.find(q => q.role_track === 'Captain');
    await emit(s, 'join_room', { code: room_code, token: 'ff2-tok', role: 'participant', role_track: 'Firefighter' });
    const res = await emit(s, 'submit_response', { question_id: captQ.id, body: 'sneak' });
    assert.equal(res.error, 'invalid');
  } finally { observer.close(); s.close(); }
});

test('role sticks to the token: rejoin keeps it; no changing after an answer lands', async () => {
  const { room_code } = await trackedRoom();
  let s = ioc(base);
  let qid;
  try {
    const j = await emit(s, 'join_room', { code: room_code, token: 'sticky-tok', role: 'participant', role_track: 'Firefighter' });
    qid = j.state.questions[0].id;
    await emit(s, 'submit_response', { question_id: qid, body: 'x' });
  } finally { s.close(); }
  s = ioc(base);
  try {
    // rejoin asking for a different role: ignored, Firefighter persists
    const j2 = await emit(s, 'join_room', { code: room_code, token: 'sticky-tok', role: 'participant', role_track: 'Captain' });
    assert.equal(j2.participant.role_track, 'Firefighter');
    assert.deepEqual(j2.state.questions.map(q => q.prompt), ['Common?', 'FF?']);
  } finally { s.close(); }
});

test('host sees all questions and responses tagged with roles', async () => {
  const { room_code, hostCookie } = await trackedRoom();
  const host = ioc(base, { extraHeaders: { cookie: hostCookie } });
  const s = ioc(base);
  try {
    const hj = await emit(host, 'join_room', { code: room_code, role: 'host' });
    assert.equal(hj.state.questions.length, 3);
    const j = await emit(s, 'join_room', { code: room_code, token: 'r-tok', role: 'participant', role_track: 'Captain' });
    const incoming = new Promise(res => host.once('response_incoming', res));
    await emit(s, 'submit_response', { question_id: j.state.questions[0].id, body: 'crew answer' });
    const r = await incoming;
    assert.equal(r.role_track, 'Captain');
  } finally { host.close(); s.close(); }
});
