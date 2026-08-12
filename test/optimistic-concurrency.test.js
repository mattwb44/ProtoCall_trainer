// PR 7 (optimistic concurrency): scenario PUT accepts an optional `rev`. A stale
// rev → 409 {error, current_rev} instead of silently clobbering a concurrent
// edit (the question soft-delete reconcile would otherwise drop questions the
// winning edit added). A versionless PUT skips the check for back-compat.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../server/index.js';
import { signup, authed } from './helpers.js';

let ctx, base;
let author, chief, member; // cookies
let deptId;

const post = (path, cookie, body) => fetch(`${base}${path}`, {
  method: 'POST',
  headers: body === undefined ? { cookie } : authed(cookie),
  body: body === undefined ? undefined : JSON.stringify(body),
});
const put = (path, cookie, body) => fetch(`${base}${path}`, {
  method: 'PUT', headers: authed(cookie), body: JSON.stringify(body),
});
const get = (path, cookie) => fetch(`${base}${path}`, { headers: cookie ? { cookie } : {} });

const scenarioBody = (over = {}) => ({
  title: 'Concurrency', category: 'Fireground', subcategory: 'Residential',
  objective_primary: 'Scene Size-Up',
  questions: [{ prompt: 'Q1?', instructor_answer: 'A1', stage: 'Arrival' }],
  ...over,
});

before(async () => {
  ctx = await buildServer({ dbFile: ':memory:', authRateMax: 1000 });
  await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${ctx.app.server.address().port}`;
  ({ cookie: author } = await signup(base, { email: 'author@rev.test', display_name: 'Author' }));
  ({ cookie: chief } = await signup(base, { email: 'chief@rev.test', display_name: 'Chief' }));
  ({ cookie: member } = await signup(base, { email: 'member@rev.test', display_name: 'Member' }));
  // A verified department with chief + member, so the chief is an in-scope
  // reviewer of the member's submitted scenarios (reviewer-collision test).
  const admin = (await signup(base, { email: 'admin@rev.test', display_name: 'Admin' })).cookie;
  ctx.db.prepare("UPDATE users SET role='site_admin' WHERE email='admin@rev.test'").run();
  await post('/api/departments', chief, { name: 'Rev FD' });
  const pending = await get('/api/moderation/departments', admin).then(r => r.json());
  deptId = pending.find(d => d.name === 'Rev FD').id;
  await post(`/api/moderation/departments/${deptId}/approve`, admin);
  const { department } = await get('/api/departments/mine', chief).then(r => r.json());
  await post('/api/departments/join', member, { code: department.join_code });
});

after(async () => { ctx.io.close(); await ctx.app.close(); });

test('POST and GET expose rev; a fresh scenario is rev 0', async () => {
  const created = await post('/api/scenarios', author, scenarioBody()).then(r => r.json());
  assert.equal(created.rev, 0, 'POST returns the new rev');
  const fetched = await get(`/api/scenarios/${created.id}`, author).then(r => r.json());
  assert.equal(fetched.rev, 0, 'GET exposes rev');
});

test('a fresh rev → 200 and bumps the rev', async () => {
  const { id } = await post('/api/scenarios', author, scenarioBody()).then(r => r.json());
  const res = await put(`/api/scenarios/${id}`, author, scenarioBody({ rev: 0, title: 'Edited' }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).rev, 1, 'PUT returns the incremented rev');
  const fetched = await get(`/api/scenarios/${id}`, author).then(r => r.json());
  assert.equal(fetched.rev, 1);
  assert.equal(fetched.title, 'Edited');
});

test('a stale rev → 409 with current_rev and no write', async () => {
  const { id } = await post('/api/scenarios', author, scenarioBody()).then(r => r.json());
  // First edit takes rev 0 → 1.
  await put(`/api/scenarios/${id}`, author, scenarioBody({ rev: 0, title: 'First' }));
  // Second edit still thinks it is on rev 0 — stale.
  const stale = await put(`/api/scenarios/${id}`, author, scenarioBody({ rev: 0, title: 'Stale write' }));
  assert.equal(stale.status, 409);
  const j = await stale.json();
  assert.equal(j.current_rev, 1);
  assert.ok(j.error);
  const fetched = await get(`/api/scenarios/${id}`, author).then(r => r.json());
  assert.equal(fetched.title, 'First', 'stale write did not land');
  assert.equal(fetched.rev, 1, 'rev unchanged by the rejected write');
});

test('a versionless PUT is accepted (back-compat) and still bumps rev', async () => {
  const { id } = await post('/api/scenarios', author, scenarioBody()).then(r => r.json());
  await put(`/api/scenarios/${id}`, author, scenarioBody({ rev: 0, title: 'Bumped' }));
  // Old cached page sends no rev — must not 409 even though rev is now 1.
  const res = await put(`/api/scenarios/${id}`, author, scenarioBody({ title: 'Versionless' }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).rev, 2);
});

test('reviewer collision: a stale reviewer rev → 409', async () => {
  // Member authors and submits; chief is the in-scope reviewer.
  const { id } = await post('/api/scenarios', member, scenarioBody({ title: 'For Review' })).then(r => r.json());
  await post(`/api/scenarios/${id}/submit-review`, member);
  // Reviewer loads the scenario at its current rev.
  const loaded = await get(`/api/scenarios/${id}`, chief).then(r => r.json());
  assert.ok(loaded.can_review, 'chief can review the member scenario');
  const revAtLoad = loaded.rev;
  // The author edits underneath the reviewer (versionless, bumps rev).
  const authorEdit = await put(`/api/scenarios/${id}`, member, scenarioBody({ title: 'Author moved it' }));
  assert.equal(authorEdit.status, 200);
  // Reviewer's save carries the now-stale rev → 409.
  const collide = await put(`/api/scenarios/${id}`, chief, scenarioBody({ rev: revAtLoad, title: 'Reviewer edit' }));
  assert.equal(collide.status, 409);
  assert.equal((await collide.json()).current_rev, revAtLoad + 1);
});
