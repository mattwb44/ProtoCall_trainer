import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../server/index.js';
import { signup, authed } from './helpers.js';

// PRD-v7 solo play: guests run public scenarios statelessly (nothing persists);
// signed-in runs persist as mode='solo' sessions in the library. Role tracks
// filter to common + chosen role; answers reveal only on full submission.

let ctx, base;

before(async () => {
  ctx = await buildServer({ dbFile: ':memory:', authRateMax: 1000 });
  await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${ctx.app.server.address().port}`;
});
after(async () => { ctx.io.close(); await ctx.app.close(); });

const json = { 'Content-Type': 'application/json' };

async function makeScenario(cookie, { visibility = 'public', questions } = {}) {
  const res = await fetch(`${base}/api/scenarios`, {
    method: 'POST', headers: authed(cookie),
    body: JSON.stringify({
      title: 'Solo fixture', description: 'd', category: 'Fire', subcategory: 'Structure', visibility,
      questions: questions ?? [
        { prompt: 'Common Q?', kind: 'text', instructor_answer: 'CA' },
        { prompt: 'Engineer Q?', kind: 'text', instructor_answer: 'EA', role_track: 'Engineer/Driver-Operator' },
        { prompt: 'Captain Q?', kind: 'text', instructor_answer: 'KA', role_track: 'Captain' },
      ],
    }),
  });
  return (await res.json()).id;
}

test('guest solo reveal: full submission required, nothing persists, private stays 404', async () => {
  const { cookie } = await signup(base, { email: 'soloauthor@solo.test' });
  const sid = await makeScenario(cookie);
  const detail = await fetch(`${base}/api/scenarios/${sid}`).then(r => r.json());
  const qs = detail.questions;

  // partial submission is rejected
  const partial = await fetch(`${base}/api/scenarios/${sid}/solo-reveal`, {
    method: 'POST', headers: json,
    body: JSON.stringify({ answers: { [qs[0].id]: 'my answer' } }),
  });
  assert.equal(partial.status, 400);

  // full submission (no role → every question) reveals all model answers
  const answers = Object.fromEntries(qs.map(q => [q.id, 'attempt']));
  const full = await fetch(`${base}/api/scenarios/${sid}/solo-reveal`, {
    method: 'POST', headers: json, body: JSON.stringify({ answers }),
  }).then(r => r.json());
  assert.deepEqual(Object.values(full.official_answers).sort(), ['CA', 'EA', 'KA']);

  // nothing persisted
  assert.equal(ctx.db.prepare("SELECT COUNT(*) n FROM live_sessions WHERE mode='solo'").get().n, 0);

  // private scenarios are invisible to guests
  const priv = await makeScenario(cookie, { visibility: 'private' });
  const denied = await fetch(`${base}/api/scenarios/${priv}/solo-reveal`, {
    method: 'POST', headers: json, body: JSON.stringify({ answers: {} }),
  });
  assert.equal(denied.status, 404);
});

test('guest solo reveal with a role: common + that role only', async () => {
  const { cookie } = await signup(base, { email: 'roleauthor@solo.test' });
  const sid = await makeScenario(cookie);
  const qs = (await fetch(`${base}/api/scenarios/${sid}`).then(r => r.json())).questions;
  const engineerSet = qs.filter(q => !q.role_track || q.role_track === 'Engineer/Driver-Operator');
  assert.equal(engineerSet.length, 2);

  const res = await fetch(`${base}/api/scenarios/${sid}/solo-reveal`, {
    method: 'POST', headers: json,
    body: JSON.stringify({
      role_track: 'Engineer/Driver-Operator',
      answers: Object.fromEntries(engineerSet.map(q => [q.id, 'a'])),
    }),
  }).then(r => r.json());
  // captain answer is NOT included — only the played track set
  assert.deepEqual(Object.values(res.official_answers).sort(), ['CA', 'EA']);
});

test('signed-in solo run: persists, completes, lands in library as solo, replayable with answers', async () => {
  const { cookie: author } = await signup(base, { email: 'runauthor@solo.test' });
  const sid = await makeScenario(author);
  const { cookie } = await signup(base, { email: 'player@solo.test' });

  const run = await fetch(`${base}/api/solo/runs`, {
    method: 'POST', headers: authed(cookie),
    body: JSON.stringify({ scenario_id: sid, role_track: 'Captain' }),
  }).then(r => r.json());
  assert.ok(run.run_id);
  assert.equal(run.questions.length, 2, 'common + captain');
  for (const q of run.questions) assert.equal(q.instructor_answer, undefined);

  // first answer: not complete, no reveal
  const a1 = await fetch(`${base}/api/solo/runs/${run.run_id}/answers`, {
    method: 'POST', headers: authed(cookie),
    body: JSON.stringify({ question_id: run.questions[0].id, body: 'one' }),
  }).then(r => r.json());
  assert.equal(a1.complete, false);
  assert.equal(a1.official_answers, undefined);

  // second answer completes the run: reveal + session ends
  const a2 = await fetch(`${base}/api/solo/runs/${run.run_id}/answers`, {
    method: 'POST', headers: authed(cookie),
    body: JSON.stringify({ question_id: run.questions[1].id, body: 'two' }),
  }).then(r => r.json());
  assert.equal(a2.complete, true);
  assert.deepEqual(Object.values(a2.official_answers).sort(), ['CA', 'KA']);

  // library: listed as a solo run, not hosted
  const mine = await fetch(`${base}/api/me/sessions`, { headers: { cookie } }).then(r => r.json());
  const entry = mine.find(s => s.id === run.run_id);
  assert.equal(entry.mode, 'solo');
  assert.equal(entry.hosted, 0);
  assert.equal(entry.status, 'ended');

  // re-opening shows my answers beside the model answers, track-filtered
  const detail = await fetch(`${base}/api/me/sessions/${run.run_id}`, { headers: { cookie } }).then(r => r.json());
  assert.equal(detail.questions.length, 2);
  assert.deepEqual(detail.questions.map(q => q.instructor_answer).sort(), ['CA', 'KA']);
  assert.equal(detail.responses.length, 2);
});

test('solo run guards: no double answers, no answering other tracks, no joining solo rooms', async () => {
  const { cookie: author } = await signup(base, { email: 'guardauthor@solo.test' });
  const sid = await makeScenario(author);
  const { cookie } = await signup(base, { email: 'guard@solo.test' });
  const run = await fetch(`${base}/api/solo/runs`, {
    method: 'POST', headers: authed(cookie),
    body: JSON.stringify({ scenario_id: sid, role_track: 'Captain' }),
  }).then(r => r.json());

  await fetch(`${base}/api/solo/runs/${run.run_id}/answers`, {
    method: 'POST', headers: authed(cookie),
    body: JSON.stringify({ question_id: run.questions[0].id, body: 'x' }),
  });
  const dup = await fetch(`${base}/api/solo/runs/${run.run_id}/answers`, {
    method: 'POST', headers: authed(cookie),
    body: JSON.stringify({ question_id: run.questions[0].id, body: 'again' }),
  });
  assert.equal(dup.status, 409);

  // a question outside my track set is rejected
  const all = (await fetch(`${base}/api/scenarios/${sid}`).then(r => r.json())).questions;
  const engineerQ = all.find(q => q.role_track === 'Engineer/Driver-Operator');
  const wrong = await fetch(`${base}/api/solo/runs/${run.run_id}/answers`, {
    method: 'POST', headers: authed(cookie),
    body: JSON.stringify({ question_id: engineerQ.id, body: 'nope' }),
  });
  assert.equal(wrong.status, 400);

  // someone else's run is not mine to answer
  const { cookie: other } = await signup(base, { email: 'other@solo.test' });
  const theirs = await fetch(`${base}/api/solo/runs/${run.run_id}/answers`, {
    method: 'POST', headers: authed(other),
    body: JSON.stringify({ question_id: run.questions[1].id, body: 'hijack' }),
  });
  assert.equal(theirs.status, 404);
});
