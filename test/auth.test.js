import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io as ioc } from 'socket.io-client';
import { buildServer } from '../server/index.js';
import { signup, authed, emit } from './helpers.js';

let ctx, base;

before(async () => {
  ctx = await buildServer({ dbFile: ':memory:', authRateMax: 1000 });
  await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${ctx.app.server.address().port}`;
});

after(async () => {
  ctx.io.close();
  await ctx.app.close();
});

test('signup → me → logout → me revoked; login works; dup email rejected', async () => {
  const { res, cookie } = await signup(base, { email: 'ff1@dept.test', password: 'longenough1' });
  assert.equal(res.status, 201);
  const me = await fetch(`${base}/api/me`, { headers: { cookie } }).then(r => r.json());
  assert.equal(me.email, 'ff1@dept.test');

  await fetch(`${base}/api/logout`, { method: 'POST', headers: { cookie } });
  const meAfter = await fetch(`${base}/api/me`, { headers: { cookie } }).then(r => r.json());
  assert.equal(meAfter, null);

  const badLogin = await fetch(`${base}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'ff1@dept.test', password: 'wrongwrong' }),
  });
  assert.equal(badLogin.status, 401);
  const goodLogin = await fetch(`${base}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'ff1@dept.test', password: 'longenough1' }),
  });
  assert.equal(goodLogin.status, 200);

  const dup = await signup(base, { email: 'ff1@dept.test' });
  assert.equal(dup.res.status, 409);
  const weak = await signup(base, { email: 'weak@dept.test', password: 'short' });
  assert.equal(weak.res.status, 400);
});

test('guest completes a session, signs up, and claims it; second claim is a no-op', async () => {
  const { cookie: hostCookie } = await signup(base, { email: 'chief@dept.test' });
  const [{ id: scenarioId }] = await fetch(`${base}/api/scenarios`).then(r => r.json());
  const { room_code, session_id } = await fetch(`${base}/api/sessions`, {
    method: 'POST', headers: authed(hostCookie), body: JSON.stringify({ scenario_id: scenarioId }),
  }).then(r => r.json());

  const guest = ioc(base);
  let qid;
  try {
    const j = await emit(guest, 'join_room', { code: room_code, token: 'guest-tok-9', role: 'participant' });
    qid = j.state.questions[0].id;
    await emit(guest, 'submit_response', { question_id: qid, body: 'pull the crosslay' });
    await emit(guest, 'save_note', { question_id: qid, body: 'ask about standpipes' });
  } finally { guest.close(); }

  // signup with guest_token claims the participation
  const { body, cookie } = await signup(base, { email: 'probie@dept.test', guest_token: 'guest-tok-9' });
  assert.equal(body.claimed_sessions, 1);

  const mine = await fetch(`${base}/api/me/sessions`, { headers: { cookie } }).then(r => r.json());
  assert.equal(mine.length, 1);
  assert.equal(mine[0].id, session_id);
  assert.equal(mine[0].hosted, 0);

  const detail = await fetch(`${base}/api/me/sessions/${session_id}`, { headers: { cookie } }).then(r => r.json());
  assert.equal(detail.responses.length, 1);
  assert.equal(detail.responses[0].body, 'pull the crosslay');
  assert.equal(detail.notes.length, 1);
  assert.ok(detail.questions.find(q => q.id === qid).instructor_answer.length > 0);

  // another account claiming the same token gets nothing
  const second = await signup(base, { email: 'poacher@dept.test', guest_token: 'guest-tok-9' });
  assert.equal(second.body.claimed_sessions, 0);
  const theirs = await fetch(`${base}/api/me/sessions`, { headers: { cookie: second.cookie } }).then(r => r.json());
  assert.equal(theirs.length, 0);

  // host sees the session too
  const hostView = await fetch(`${base}/api/me/sessions`, { headers: { cookie: hostCookie } }).then(r => r.json());
  assert.ok(hostView.find(s => s.id === session_id && s.hosted === 1));
});

test('ownership: private hidden from others; public launchable; clone deep-copies', async () => {
  const { cookie: authorCookie } = await signup(base, { email: 'author@dept.test' });
  const { cookie: readerCookie } = await signup(base, { email: 'reader@dept.test' });

  const mk = (title, visibility) => fetch(`${base}/api/scenarios`, {
    method: 'POST', headers: authed(authorCookie),
    body: JSON.stringify({
      title, visibility, category: 'EMS', subcategory: 'Cardiac',
      questions: [{ prompt: 'Rhythm?', kind: 'text', instructor_answer: 'V-fib' }],
    }),
  }).then(r => r.json());

  const priv = await mk('Private Draft', 'private');
  const pub = await mk('Shared Cardiac Drill', 'public');

  // private 404s for non-author, works for author
  assert.equal((await fetch(`${base}/api/scenarios/${priv.id}`, { headers: { cookie: readerCookie } })).status, 404);
  assert.equal((await fetch(`${base}/api/scenarios/${priv.id}`, { headers: { cookie: authorCookie } })).status, 200);

  // launching: private forbidden for others, public allowed
  const launchPriv = await fetch(`${base}/api/sessions`, {
    method: 'POST', headers: authed(readerCookie), body: JSON.stringify({ scenario_id: priv.id }),
  });
  assert.equal(launchPriv.status, 403);
  const launchPub = await fetch(`${base}/api/sessions`, {
    method: 'POST', headers: authed(readerCookie), body: JSON.stringify({ scenario_id: pub.id }),
  });
  assert.equal(launchPub.status, 200);

  // clone
  const clone = await fetch(`${base}/api/scenarios/${pub.id}/clone`, {
    method: 'POST', headers: { cookie: readerCookie },
  }).then(r => r.json());
  const cloned = await fetch(`${base}/api/scenarios/${clone.id}`, { headers: { cookie: readerCookie } }).then(r => r.json());
  assert.equal(cloned.cloned_from, pub.id);
  assert.equal(cloned.visibility, 'private');
  assert.equal(cloned.mine, true);
  assert.equal(cloned.questions.length, 1);
  assert.equal((await fetch(`${base}/api/scenarios/${priv.id}/clone`, { method: 'POST', headers: { cookie: readerCookie } })).status, 404);
});

test('votes toggle and drive public ordering', async () => {
  const { cookie: v1 } = await signup(base, { email: 'voter1@dept.test' });
  const { cookie: v2 } = await signup(base, { email: 'voter2@dept.test' });
  const pubs = await fetch(`${base}/api/public/scenarios`).then(r => r.json());
  const target = pubs.find(s => s.title === 'Shared Cardiac Drill');

  let r = await fetch(`${base}/api/scenarios/${target.id}/vote`, { method: 'POST', headers: { cookie: v1 } }).then(x => x.json());
  assert.deepEqual([r.voted, r.votes], [true, 1]);
  r = await fetch(`${base}/api/scenarios/${target.id}/vote`, { method: 'POST', headers: { cookie: v1 } }).then(x => x.json());
  assert.deepEqual([r.voted, r.votes], [false, 0]);
  await fetch(`${base}/api/scenarios/${target.id}/vote`, { method: 'POST', headers: { cookie: v1 } });
  await fetch(`${base}/api/scenarios/${target.id}/vote`, { method: 'POST', headers: { cookie: v2 } });

  const ordered = await fetch(`${base}/api/public/scenarios`).then(x => x.json());
  assert.equal(ordered[0].id, target.id);
  assert.equal(ordered[0].votes, 2);

  const filtered = await fetch(`${base}/api/public/scenarios?category=EMS&subcategory=Cardiac`).then(x => x.json());
  assert.ok(filtered.every(s => s.category === 'EMS' && s.subcategory === 'Cardiac'));

  const anonVote = await fetch(`${base}/api/scenarios/${target.id}/vote`, { method: 'POST' });
  assert.equal(anonVote.status, 401);
});
