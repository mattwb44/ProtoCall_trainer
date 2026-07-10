import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../server/index.js';
import { signup, authed } from './helpers.js';

// PRD-v7 academies: curated ordered collections of scenarios. Site-admin
// academies are global; dept-admin academies are department-scoped. Entries
// carry a draft/publish flag — a draft is visible only to the academy owner,
// and publishing requires the scenario to be at least department-visible
// (public, for a global academy). Deleting a scenario must never orphan-crash
// the academies that reference it.

let ctx, base;
let admin, chief, member, outsider; // {cookie, body}
let deptId;

const mkScenario = (cookie, extra = {}) =>
  fetch(`${base}/api/scenarios`, {
    method: 'POST', headers: authed(cookie),
    body: JSON.stringify({
      title: 'Academy fixture', description: 'd', category: 'Fire', subcategory: 'Structure',
      visibility: 'public', questions: [{ prompt: 'Q?', instructor_answer: 'A' }], ...extra,
    }),
  }).then(r => r.json());

before(async () => {
  ctx = await buildServer({ dbFile: ':memory:', authRateMax: 1000 });
  await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${ctx.app.server.address().port}`;

  admin = await signup(base, { email: 'admin@acad.test' });
  ctx.db.prepare("UPDATE users SET role='site_admin' WHERE email='admin@acad.test'").run();
  chief = await signup(base, { email: 'chief@acad.test' });
  member = await signup(base, { email: 'member@acad.test' });
  outsider = await signup(base, { email: 'out@acad.test' });

  const d = await fetch(`${base}/api/departments`, {
    method: 'POST', headers: authed(chief.cookie), body: JSON.stringify({ name: 'Georgetown FD' }),
  }).then(r => r.json());
  deptId = d.id;
  ctx.db.prepare("UPDATE departments SET verified_at=datetime('now') WHERE id=?").run(deptId);
  const { join_code } = ctx.db.prepare('SELECT join_code FROM departments WHERE id=?').get(deptId);
  await fetch(`${base}/api/departments/join`, {
    method: 'POST', headers: authed(member.cookie), body: JSON.stringify({ code: join_code }) });
});
after(async () => { ctx.io.close(); await ctx.app.close(); });

test('only site admins create global academies; only dept admins create dept academies', async () => {
  const denied = await fetch(`${base}/api/academies`, {
    method: 'POST', headers: authed(member.cookie), body: JSON.stringify({ name: 'Nope' }) });
  assert.equal(denied.status, 403);

  const global = await fetch(`${base}/api/academies`, {
    method: 'POST', headers: authed(admin.cookie),
    body: JSON.stringify({ name: 'Fireground Fundamentals', description: 'Start here' }) });
  assert.equal(global.status, 201);
  const g = await global.json();
  assert.equal(g.department_id, null);

  const dept = await fetch(`${base}/api/academies`, {
    method: 'POST', headers: authed(chief.cookie),
    body: JSON.stringify({ name: 'Georgetown Academy' }) });
  assert.equal(dept.status, 201);
  const d = await dept.json();
  assert.equal(d.department_id, deptId);
});

test('listing: guests see global only; dept members also see their dept academies', async () => {
  const guestList = await fetch(`${base}/api/academies`).then(r => r.json());
  assert.ok(guestList.some(a => a.name === 'Fireground Fundamentals'));
  assert.ok(!guestList.some(a => a.name === 'Georgetown Academy'), 'dept academy hidden from guests');

  const memberList = await fetch(`${base}/api/academies`, { headers: { cookie: member.cookie } }).then(r => r.json());
  assert.ok(memberList.some(a => a.name === 'Georgetown Academy'));

  const outList = await fetch(`${base}/api/academies`, { headers: { cookie: outsider.cookie } }).then(r => r.json());
  assert.ok(!outList.some(a => a.name === 'Georgetown Academy'), 'dept academy hidden from non-members');
});

test('owner curates ordered entries; drafts visible only to the owner; publishing enforces visibility', async () => {
  const pub = await mkScenario(chief.cookie, { title: 'Public One' });
  const deptScen = await mkScenario(chief.cookie, { title: 'Dept One', visibility: 'department' });
  const priv = await mkScenario(chief.cookie, { title: 'Private Draft', visibility: 'private' });

  const acad = ctx.db.prepare("SELECT id FROM academies WHERE name='Georgetown Academy'").get();

  // publishing a private scenario is rejected
  const bad = await fetch(`${base}/api/academies/${acad.id}`, {
    method: 'PUT', headers: authed(chief.cookie),
    body: JSON.stringify({ name: 'Georgetown Academy', entries: [{ scenario_id: priv.id, published: true }] }) });
  assert.equal(bad.status, 400);

  // ordered mix: two published + one private draft staged
  const ok = await fetch(`${base}/api/academies/${acad.id}`, {
    method: 'PUT', headers: authed(chief.cookie),
    body: JSON.stringify({ name: 'Georgetown Academy', description: 'Local SOPs',
      entries: [
        { scenario_id: deptScen.id, published: true },
        { scenario_id: priv.id, published: false },
        { scenario_id: pub.id, published: true },
      ] }) });
  assert.equal(ok.status, 200);

  // owner sees all three in order
  const mine = await fetch(`${base}/api/academies/${acad.id}`, { headers: { cookie: chief.cookie } }).then(r => r.json());
  assert.deepEqual(mine.entries.map(e => e.title), ['Dept One', 'Private Draft', 'Public One']);
  assert.equal(mine.entries[1].published, 0);
  assert.equal(mine.mine, true);

  // a member sees only published entries
  const theirs = await fetch(`${base}/api/academies/${acad.id}`, { headers: { cookie: member.cookie } }).then(r => r.json());
  assert.deepEqual(theirs.entries.map(e => e.title), ['Dept One', 'Public One']);

  // outsiders can't open the dept academy at all
  const nope = await fetch(`${base}/api/academies/${acad.id}`, { headers: { cookie: outsider.cookie } });
  assert.equal(nope.status, 404);

  // non-owner can't edit
  const notYours = await fetch(`${base}/api/academies/${acad.id}`, {
    method: 'PUT', headers: authed(member.cookie), body: JSON.stringify({ name: 'Hijack', entries: [] }) });
  assert.equal(notYours.status, 404);
});

test('global academies publish public scenarios only', async () => {
  const acad = ctx.db.prepare("SELECT id FROM academies WHERE name='Fireground Fundamentals'").get();
  const deptScen = await mkScenario(chief.cookie, { title: 'Dept Only', visibility: 'department' });
  const bad = await fetch(`${base}/api/academies/${acad.id}`, {
    method: 'PUT', headers: authed(admin.cookie),
    body: JSON.stringify({ name: 'Fireground Fundamentals', entries: [{ scenario_id: deptScen.id, published: true }] }) });
  assert.equal(bad.status, 400, 'global academies require public scenarios to publish');

  const pub = await mkScenario(admin.cookie, { title: 'Global Lesson' });
  const ok = await fetch(`${base}/api/academies/${acad.id}`, {
    method: 'PUT', headers: authed(admin.cookie),
    body: JSON.stringify({ name: 'Fireground Fundamentals', entries: [{ scenario_id: pub.id, published: true }] }) });
  assert.equal(ok.status, 200);

  const guestView = await fetch(`${base}/api/academies/${acad.id}`).then(r => r.json());
  assert.deepEqual(guestView.entries.map(e => e.title), ['Global Lesson']);
});

test('deleting a scenario does not orphan-crash its academies', async () => {
  const acad = ctx.db.prepare("SELECT id FROM academies WHERE name='Georgetown Academy'").get();
  const doomed = ctx.db.prepare("SELECT id FROM scenarios WHERE title='Public One'").get();
  const del = await fetch(`${base}/api/scenarios/${doomed.id}`, { method: 'DELETE', headers: { cookie: chief.cookie } });
  assert.equal(del.status, 200);

  const view = await fetch(`${base}/api/academies/${acad.id}`, { headers: { cookie: member.cookie } });
  assert.equal(view.status, 200);
  const body = await view.json();
  assert.ok(!body.entries.some(e => e.title === 'Public One'), 'soft-deleted scenario drops out of the academy');
});

test('owner (or site admin) deletes an academy', async () => {
  const r = await fetch(`${base}/api/academies`, {
    method: 'POST', headers: authed(chief.cookie), body: JSON.stringify({ name: 'Temp Academy' }) });
  const { id } = await r.json();
  const denied = await fetch(`${base}/api/academies/${id}`, { method: 'DELETE', headers: { cookie: member.cookie } });
  assert.equal(denied.status, 404);
  const ok = await fetch(`${base}/api/academies/${id}`, { method: 'DELETE', headers: { cookie: admin.cookie } });
  assert.equal(ok.status, 200);
  assert.equal((await fetch(`${base}/api/academies/${id}`, { headers: { cookie: chief.cookie } })).status, 404);
});
