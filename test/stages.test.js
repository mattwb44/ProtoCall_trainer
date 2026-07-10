import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io as ioc } from 'socket.io-client';
import { buildServer } from '../server/index.js';
import { signup, authed, emit, once } from './helpers.js';

// PRD-v7 stages: optional named stage headers over the question list. The host
// advances stages live (participants only see questions up to the current
// stage); solo advances as the player submits. Reveal is per-stage (owner
// decision 2026-07-10): finishing a stage's questions unlocks that stage's
// model answers. Stageless scenarios keep whole-scenario gating.

let ctx, base;
let host, player;
let scenarioId;

before(async () => {
  ctx = await buildServer({ dbFile: ':memory:', authRateMax: 1000 });
  await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${ctx.app.server.address().port}`;
  host = await signup(base, { email: 'host@stage.test' });
  player = await signup(base, { email: 'player@stage.test' });

  const r = await fetch(`${base}/api/scenarios`, {
    method: 'POST', headers: authed(host.cookie),
    body: JSON.stringify({
      title: 'Staged Fire', description: 'd', category: 'Fire', subcategory: 'Structure',
      visibility: 'public',
      questions: [
        { prompt: 'D1?', instructor_answer: 'dA1', stage: 'Dispatch' },
        { prompt: 'D2?', instructor_answer: 'dA2' },                    // blank inherits Dispatch
        { prompt: 'A1?', instructor_answer: 'aA1', stage: 'Arrival' },
      ],
    }),
  });
  assert.equal(r.status, 201);
  scenarioId = (await r.json()).id;
});
after(async () => { ctx.io.close(); await ctx.app.close(); });

const connect = cookie =>
  ioc(base, { transports: ['websocket'], forceNew: true, extraHeaders: cookie ? { cookie } : {} });

test('live: participants see only the current stage; host advance reveals the next; reveal is per stage', async () => {
  const { session_id, room_code } = await fetch(`${base}/api/sessions`, {
    method: 'POST', headers: authed(host.cookie), body: JSON.stringify({ scenario_id: scenarioId }),
  }).then(r => r.json());

  const hostSock = connect(host.cookie);
  const hostJoin = await emit(hostSock, 'join_room', { code: room_code, role: 'host' });
  assert.deepEqual(hostJoin.state.session.stages, ['Dispatch', 'Arrival']);
  assert.equal(hostJoin.state.questions.length, 3, 'host sees every stage');

  const pSock = connect(player.cookie);
  const pJoin = await emit(pSock, 'join_room', { code: room_code, token: 'tok-1' });
  assert.equal(pJoin.state.session.stage_index, 0);
  assert.deepEqual(pJoin.state.questions.map(q => q.prompt), ['D1?', 'D2?'], 'later stages hidden');

  const [d1, d2] = pJoin.state.questions;
  const a1 = await emit(pSock, 'submit_response', { question_id: d1.id, body: 'x' });
  assert.equal(a1.official_answers, undefined, 'stage incomplete — nothing revealed');

  const a2 = await emit(pSock, 'submit_response', { question_id: d2.id, body: 'y' });
  assert.equal(a2.complete, false, 'scenario not complete yet');
  assert.deepEqual(a2.official_answers, { [d1.id]: 'dA1', [d2.id]: 'dA2' },
    'finishing Dispatch reveals only Dispatch answers');

  // host advances; the room learns and a rejoin shows stage 2's questions
  const advanced = once(pSock, 'stage_advanced');
  const advAck = await emit(hostSock, 'advance_stage', {});
  assert.equal(advAck.stage_index, 1);
  assert.equal((await advanced).stage_index, 1);

  const rejoin = await emit(pSock, 'join_room', { code: room_code, token: 'tok-1' });
  assert.deepEqual(rejoin.state.questions.map(q => q.prompt), ['D1?', 'D2?', 'A1?']);
  const revealed = rejoin.state.questions.filter(q => q.instructor_answer !== undefined);
  assert.deepEqual(revealed.map(q => q.prompt), ['D1?', 'D2?'], 'Dispatch stays revealed, Arrival gated');
  assert.equal(rejoin.state.answers_revealed, false);

  const a3 = await emit(pSock, 'submit_response', { question_id: rejoin.state.questions[2].id, body: 'z' });
  assert.equal(a3.complete, true);
  assert.equal(Object.keys(a3.official_answers).length, 3, 'all answers once every stage is done');

  // advancing never runs past the last stage
  const again = await emit(hostSock, 'advance_stage', {});
  assert.equal(again.stage_index, 1);

  hostSock.disconnect(); pSock.disconnect();
});

test('non-hosts cannot advance the stage', async () => {
  const { room_code } = await fetch(`${base}/api/sessions`, {
    method: 'POST', headers: authed(host.cookie), body: JSON.stringify({ scenario_id: scenarioId }),
  }).then(r => r.json());
  const pSock = connect(player.cookie);
  await emit(pSock, 'join_room', { code: room_code, token: 'tok-2' });
  const denied = await emit(pSock, 'advance_stage', {});
  assert.equal(denied.error, 'host only');
  pSock.disconnect();
});

test('solo: each completed stage reveals its answers; the whole set ends the run', async () => {
  const run = await fetch(`${base}/api/solo/runs`, {
    method: 'POST', headers: authed(player.cookie), body: JSON.stringify({ scenario_id: scenarioId }),
  }).then(r => r.json());
  assert.deepEqual(run.questions.map(q => q.stage), ['Dispatch', 'Dispatch', 'Arrival'],
    'blank stages resolve for the client');
  const [d1, d2, ar1] = run.questions;
  const answer = (q, body) => fetch(`${base}/api/solo/runs/${run.run_id}/answers`, {
    method: 'POST', headers: authed(player.cookie), body: JSON.stringify({ question_id: q.id, body }),
  }).then(r => r.json());

  const r1 = await answer(d1, 'x');
  assert.equal(r1.official_answers, undefined);
  const r2 = await answer(d2, 'y');
  assert.equal(r2.complete, false);
  assert.deepEqual(r2.official_answers, { [d1.id]: 'dA1', [d2.id]: 'dA2' });
  const r3 = await answer(ar1, 'z');
  assert.equal(r3.complete, true);
  assert.equal(Object.keys(r3.official_answers).length, 3);
});

test('archive while live: a participant sees only completed-stage answers', async () => {
  const { room_code, session_id } = await fetch(`${base}/api/sessions`, {
    method: 'POST', headers: authed(host.cookie), body: JSON.stringify({ scenario_id: scenarioId }),
  }).then(r => r.json());
  const pSock = connect(player.cookie);
  const pJoin = await emit(pSock, 'join_room', { code: room_code, token: 'tok-3' });
  for (const q of pJoin.state.questions) await emit(pSock, 'submit_response', { question_id: q.id, body: 'a' });

  const detail = await fetch(`${base}/api/me/sessions/${session_id}`, { headers: { cookie: player.cookie } })
    .then(r => r.json());
  const byPrompt = Object.fromEntries(detail.questions.map(q => [q.prompt, q.instructor_answer]));
  assert.equal(byPrompt['D1?'], 'dA1');
  assert.equal(byPrompt['A1?'], undefined, 'unfinished stage stays gated in the archive');
  pSock.disconnect();
});
