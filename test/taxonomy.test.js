import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../server/index.js';
import { signup, authed } from './helpers.js';

// PRD-v7 taxonomy: learning objectives are a controlled vocabulary (12 seeded,
// site-admin extendable); scenarios carry primary + optional secondary (max 2)
// plus difficulty/duration/building-type filter labels; the coverage grid
// (objectives × categories) makes curriculum gaps visible.

let ctx, base;

before(async () => {
  ctx = await buildServer({ dbFile: ':memory:', authRateMax: 1000 });
  await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${ctx.app.server.address().port}`;
});
after(async () => { ctx.io.close(); await ctx.app.close(); });

const scenarioBody = extra => JSON.stringify({
  title: 'Tax fixture', description: 'd', category: 'Fire', subcategory: 'Structure',
  visibility: 'public', questions: [{ prompt: 'Q?', kind: 'text', instructor_answer: 'A' }],
  ...extra,
});

test('seed objectives exist and are publicly listable', async () => {
  const list = await fetch(`${base}/api/objectives`).then(r => r.json());
  for (const o of ['Reading Smoke', 'VEIS', 'Command Presence', 'Resource Management'])
    assert.ok(list.includes(o), o);
});

test('objectives are filterable by category; general ones show everywhere', async () => {
  const ems = await fetch(`${base}/api/objectives?category=EMS`).then(r => r.json());
  assert.ok(ems.includes('Airway Management'), 'EMS objective present');
  assert.ok(ems.includes('Command Presence'), 'general objective present');
  assert.ok(!ems.includes('VEIS'), 'Fireground objective excluded from EMS');
});

test('scenario taxonomy is validated against the controlled list', async () => {
  const { cookie } = await signup(base, { email: 'tax@tax.test' });
  const post = body => fetch(`${base}/api/scenarios`, { method: 'POST', headers: authed(cookie), body });

  // valid: primary + secondary + labels
  const ok = await post(scenarioBody({
    objective_primary: 'Reading Smoke', objective_secondary: 'Fire Dynamics',
    difficulty: 'Standard', building_type: ['2 story', 'Type V (wood frame)', 'bogus tag'],
  }));
  assert.equal(ok.status, 201);
  const { id } = await ok.json();
  const detail = await fetch(`${base}/api/scenarios/${id}`, { headers: { cookie } }).then(r => r.json());
  assert.equal(detail.objective_primary, 'Reading Smoke');
  assert.equal(detail.objective_secondary, 'Fire Dynamics');
  assert.equal(detail.difficulty, 'Standard');
  // building type stores known tags as a JSON array; unknown members are dropped
  assert.deepEqual(JSON.parse(detail.building_type), ['2 story', 'Type V (wood frame)']);

  // rejections
  assert.equal((await post(scenarioBody({ objective_primary: 'Vibes' }))).status, 400);
  assert.equal((await post(scenarioBody({ objective_primary: 'Search', objective_secondary: 'Vibes' }))).status, 400);
  assert.equal((await post(scenarioBody({ objective_secondary: 'Search' }))).status, 400, 'secondary requires primary');
  assert.equal((await post(scenarioBody({ objective_primary: 'Search', objective_secondary: 'Search' }))).status, 400);
  assert.equal((await post(scenarioBody({ difficulty: 'Impossible' }))).status, 400);

  // update path validates too
  const bad = await fetch(`${base}/api/scenarios/${id}`, {
    method: 'PUT', headers: authed(cookie),
    body: scenarioBody({ objective_primary: 'Made Up' }),
  });
  assert.equal(bad.status, 400);
});

test('site admin extends the vocabulary; standard users cannot', async () => {
  const { cookie: pleb } = await signup(base, { email: 'pleb@tax.test' });
  const denied = await fetch(`${base}/api/objectives`, {
    method: 'POST', headers: authed(pleb), body: JSON.stringify({ name: 'Rogue Objective' }) });
  assert.equal(denied.status, 403);

  const { cookie: admin } = await signup(base, { email: 'admin@tax.test' });
  ctx.db.prepare("UPDATE users SET role='site_admin' WHERE email='admin@tax.test'").run();
  const added = await fetch(`${base}/api/objectives`, {
    method: 'POST', headers: authed(admin), body: JSON.stringify({ name: 'Salvage & Overhaul' }) });
  assert.equal(added.status, 201);
  const list = await fetch(`${base}/api/objectives`).then(r => r.json());
  assert.ok(list.includes('Salvage & Overhaul'));

  // scenario can now use it
  const ok = await fetch(`${base}/api/scenarios`, {
    method: 'POST', headers: authed(admin),
    body: scenarioBody({ objective_primary: 'Salvage & Overhaul' }) });
  assert.equal(ok.status, 201);
});

test('coverage grid counts public scenarios by objective × category; private excluded', async () => {
  const { cookie } = await signup(base, { email: 'cov@tax.test' });
  const mk = extra => fetch(`${base}/api/scenarios`, { method: 'POST', headers: authed(cookie), body: scenarioBody(extra) });
  await mk({ objective_primary: 'Ventilation', objective_secondary: 'Fire Attack' });
  await mk({ objective_primary: 'Ventilation' });
  await mk({ objective_primary: 'Ventilation', visibility: 'private' }); // not counted

  const cov = await fetch(`${base}/api/coverage`).then(r => r.json());
  assert.ok(cov.objectives.includes('Ventilation'));
  assert.ok(cov.categories.includes('Fire'));
  assert.equal(cov.grid['Ventilation']['Fire'], 2);
  assert.equal(cov.grid['Fire Attack']['Fire'], 1, 'secondary objective counts too');
  assert.equal(cov.grid['Air Management']['Fire'], 0, 'gaps are visible as zeros');
});
