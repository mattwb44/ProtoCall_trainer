import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io as ioc } from 'socket.io-client';
import { buildServer } from '../server/index.js';
import { signup, authed, emit } from './helpers.js';

let ctx, base;
let chief, member, outsider, admin; // cookies

const post = (path, cookie, body) => fetch(`${base}${path}`, {
  method: 'POST',
  headers: body === undefined ? { cookie } : authed(cookie),
  body: body === undefined ? undefined : JSON.stringify(body),
});

before(async () => {
  ctx = await buildServer({ dbFile: ':memory:', authRateMax: 1000 });
  await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${ctx.app.server.address().port}`;
  ({ cookie: chief } = await signup(base, { email: 'chief@sta1.test', display_name: 'Chief Miller' }));
  ({ cookie: member } = await signup(base, { email: 'ff@sta1.test', display_name: 'FF Jones' }));
  ({ cookie: outsider } = await signup(base, { email: 'out@sta9.test', display_name: 'Outsider' }));
  ({ cookie: admin } = await signup(base, { email: 'ops@site.test', display_name: 'Site Ops' }));
  ctx.db.prepare("UPDATE users SET role='site_admin' WHERE email='ops@site.test'").run();
});

after(async () => {
  ctx.io.close();
  await ctx.app.close();
});

let joinCode, deptScenarioId;

test('create department → pending until site_admin approval; then join works', async () => {
  const created = await post('/api/departments', chief, { name: 'Station 1' });
  assert.equal(created.status, 201);
  assert.equal((await created.json()).pending, true);
  const mine = await fetch(`${base}/api/departments/mine`, { headers: { cookie: chief } }).then(r => r.json());
  assert.equal(mine.chief, true);
  assert.equal(mine.department.verified_at, null, 'starts pending');
  assert.match(mine.department.join_code, /^[A-Z2-9]{8}$/);
  joinCode = mine.department.join_code;

  // while pending: joining, department visibility, and badging are all locked
  assert.equal((await post('/api/departments/join', member, { code: joinCode })).status, 403);
  const pendingScenario = await fetch(`${base}/api/scenarios`, {
    method: 'POST', headers: authed(chief),
    body: JSON.stringify({ title: 'Locked', visibility: 'department', category: 'EMS', subcategory: 'Trauma', questions: [] }),
  });
  assert.equal(pendingScenario.status, 400);

  // approval is site_admin only
  const pendingList = await fetch(`${base}/api/moderation/departments`, { headers: { cookie: admin } }).then(r => r.json());
  const row = pendingList.find(d => d.name === 'Station 1');
  assert.equal(row.creator_name, 'Chief Miller');
  assert.equal((await post(`/api/moderation/departments/${row.id}/approve`, chief)).status, 403);
  assert.equal((await post(`/api/moderation/departments/${row.id}/approve`, admin)).status, 200);
  assert.equal((await post(`/api/moderation/departments/${row.id}/approve`, admin)).status, 404, 'already approved');

  assert.equal((await post('/api/departments/join', member, { code: 'ZZZZ99ZZ' })).status, 404);
  const joined = await post('/api/departments/join', member, { code: joinCode.toLowerCase() });
  assert.equal(joined.status, 200);

  const memberView = await fetch(`${base}/api/departments/mine`, { headers: { cookie: member } }).then(r => r.json());
  assert.equal(memberView.chief, false);
  assert.equal(memberView.department.join_code, undefined, 'join code hidden from members');
  assert.equal(memberView.members.length, 2);

  // double-membership blocked; chief cannot leave with members present
  assert.equal((await post('/api/departments', member, { name: 'Rogue Dept' })).status, 409);
  assert.equal((await post('/api/departments/leave', chief, {})).status, 409);
});

test('department visibility: members see/launch/clone, outsiders 404', async () => {
  const created = await fetch(`${base}/api/scenarios`, {
    method: 'POST', headers: authed(chief),
    body: JSON.stringify({
      title: 'Station 1 SOP — First Due Engine', visibility: 'department',
      category: 'Fireground', subcategory: 'Residential',
      questions: [{ prompt: 'First-due engine responsibilities?', instructor_answer: 'Attack line, water supply, 360' }],
    }),
  }).then(r => r.json());
  deptScenarioId = created.id;

  // outsider without a department cannot use department visibility
  const noDept = await fetch(`${base}/api/scenarios`, {
    method: 'POST', headers: authed(outsider),
    body: JSON.stringify({ title: 'X', visibility: 'department', category: 'EMS', subcategory: 'Trauma', questions: [] }),
  });
  assert.equal(noDept.status, 400);

  assert.equal((await fetch(`${base}/api/scenarios/${deptScenarioId}`, { headers: { cookie: member } })).status, 200);
  assert.equal((await fetch(`${base}/api/scenarios/${deptScenarioId}`, { headers: { cookie: outsider } })).status, 404);

  const launch = await post('/api/sessions', member, { scenario_id: deptScenarioId });
  assert.equal(launch.status, 200);
  assert.equal((await post('/api/sessions', outsider, { scenario_id: deptScenarioId })).status, 403);

  const clone = await post(`/api/scenarios/${deptScenarioId}/clone`, member);
  assert.equal(clone.status, 201);
  assert.equal((await post(`/api/scenarios/${deptScenarioId}/clone`, outsider)).status, 404);

  // hidden from public library and from outsiders' lists
  const pub = await fetch(`${base}/api/public/scenarios`).then(r => r.json());
  assert.ok(!pub.find(s => s.id === deptScenarioId));
  const outList = await fetch(`${base}/api/scenarios`, { headers: { cookie: outsider } }).then(r => r.json());
  assert.ok(!outList.find(s => s.id === deptScenarioId));
});

test('official badge: chief-only, department scenarios only, pins to top', async () => {
  assert.equal((await post(`/api/scenarios/${deptScenarioId}/official`, member, { official: true })).status, 403);
  assert.equal((await post(`/api/scenarios/${deptScenarioId}/official`, outsider, { official: true })).status, 403);

  const ok = await post(`/api/scenarios/${deptScenarioId}/official`, chief, { official: true });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { is_official: 1 });

  // public scenario cannot be official (seed scenario is public)
  const [seed] = await fetch(`${base}/api/public/scenarios`).then(r => r.json());
  assert.equal((await post(`/api/scenarios/${seed.id}/official`, chief, { official: true })).status, 403);

  const list = await fetch(`${base}/api/scenarios`, { headers: { cookie: member } }).then(r => r.json());
  assert.equal(list[0].id, deptScenarioId, 'official pinned first');
  assert.equal(list[0].is_official, 1);

  // re-scoping to private clears the badge
  const detail = await fetch(`${base}/api/scenarios/${deptScenarioId}`, { headers: { cookie: chief } }).then(r => r.json());
  await fetch(`${base}/api/scenarios/${deptScenarioId}`, {
    method: 'PUT', headers: authed(chief),
    body: JSON.stringify({
      title: detail.title, visibility: 'private', category: detail.category, subcategory: detail.subcategory,
      questions: detail.questions.map(q => ({ id: q.id, prompt: q.prompt, kind: q.kind, choices: q.choices, instructor_answer: q.instructor_answer, role_track: q.role_track })),
    }),
  });
  const after1 = await fetch(`${base}/api/scenarios/${deptScenarioId}`, { headers: { cookie: chief } }).then(r => r.json());
  assert.equal(after1.is_official, 0);
  assert.equal(after1.department_id, null);
  // restore department scope + badge for the analytics test
  await fetch(`${base}/api/scenarios/${deptScenarioId}`, {
    method: 'PUT', headers: authed(chief),
    body: JSON.stringify({
      title: detail.title, visibility: 'department', category: detail.category, subcategory: detail.subcategory,
      questions: detail.questions.map(q => ({ id: q.id, prompt: q.prompt, kind: q.kind, choices: q.choices, instructor_answer: q.instructor_answer, role_track: q.role_track })),
    }),
  });
});

test('Part 6: a scenario can be shared with the department AND the public at once', async () => {
  const created = await fetch(`${base}/api/scenarios`, {
    method: 'POST', headers: authed(chief),
    body: JSON.stringify({
      title: 'Both-Shared Drill', shared_department: true, shared_public: true,
      category: 'Fireground', subcategory: 'Residential',
      questions: [{ prompt: 'Size-up priorities?', instructor_answer: 'Life safety, incident stabilization' }],
    }),
  }).then(r => r.json());

  const detail = await fetch(`${base}/api/scenarios/${created.id}`, { headers: { cookie: chief } }).then(r => r.json());
  assert.equal(detail.shared_department, 1);
  assert.equal(detail.shared_public, 1);
  assert.equal(detail.visibility, 'public', 'legacy visibility derives to public');
  assert.equal(detail.department_id != null, true, 'keeps its department link');

  // it shows in the public library…
  const pub = await fetch(`${base}/api/public/scenarios`).then(r => r.json());
  assert.ok(pub.find(s => s.id === created.id), 'appears in the public library');

  // …and the chief can still badge it Official (department dimension intact)
  const badged = await post(`/api/scenarios/${created.id}/official`, chief, { official: true });
  assert.equal(badged.status, 200);
  assert.deepEqual(await badged.json(), { is_official: 1 });

  // outsiders can see it because it's public
  assert.equal((await fetch(`${base}/api/scenarios/${created.id}`, { headers: { cookie: outsider } })).status, 200);
});

test('analytics: exact numbers, chief-only', async () => {
  // member hosts a session on the dept scenario; one logged-in member + one guest respond
  const { room_code } = await post('/api/sessions', member, { scenario_id: deptScenarioId }).then(r => r.json());

  const chiefSock = ioc(base, { extraHeaders: { cookie: chief } });
  const guest = ioc(base);
  try {
    const j1 = await emit(chiefSock, 'join_room', { code: room_code, token: 'chief-tok', role: 'participant' });
    await emit(chiefSock, 'submit_response', { question_id: j1.state.questions[0].id, body: 'attack line + 360' });
    const j2 = await emit(guest, 'join_room', { code: room_code, token: 'guest-tok', role: 'participant' });
    await emit(guest, 'submit_response', { question_id: j2.state.questions[0].id, body: 'water supply first' });
  } finally { chiefSock.close(); guest.close(); }

  assert.equal((await fetch(`${base}/api/departments/mine/analytics`, { headers: { cookie: member } })).status, 403);
  assert.equal((await fetch(`${base}/api/departments/mine/analytics`, { headers: { cookie: outsider } })).status, 403);

  const a = await fetch(`${base}/api/departments/mine/analytics`, { headers: { cookie: chief } }).then(r => r.json());
  const row = a.sessions.find(s => s.room_code === room_code);
  assert.equal(row.host_name, 'FF Jones');
  assert.equal(row.participant_count, 2);
  assert.equal(row.response_count, 2);
  assert.equal(row.question_count, 1);
  assert.equal(row.response_rate, 100);
  assert.equal(a.totals.members_trained, 1, 'guest participant not counted as a trained member');
  assert.ok(a.totals.sessions >= 2); // includes the earlier launch test session
});

test('report → queue → unlist flips private and closes all reports; access control', async () => {
  // author (outsider) publishes a public scenario; two users report it
  const { id } = await fetch(`${base}/api/scenarios`, {
    method: 'POST', headers: authed(outsider),
    body: JSON.stringify({
      title: 'Sketchy Freelancing Drill', visibility: 'public', category: 'Fireground', subcategory: 'Commercial',
      questions: [{ prompt: 'Enter alone without command approval?', instructor_answer: 'yes' }],
    }),
  }).then(r => r.json());

  assert.equal((await post(`/api/scenarios/${id}/report`, chief, { reason: 'Unsafe: encourages freelancing' })).status, 201);
  assert.equal((await post(`/api/scenarios/${id}/report`, chief, { reason: 'dup' })).status, 409, 'one open report per user');
  assert.equal((await post(`/api/scenarios/${id}/report`, member, { reason: 'Contradicts NFPA guidance' })).status, 201);

  // moderation is site_admin only
  assert.equal((await fetch(`${base}/api/moderation/reports`, { headers: { cookie: chief } })).status, 403);

  // promote a fresh account to site_admin directly in the DB (no UI for this by design)
  const { cookie: admin } = await signup(base, { email: 'ops@protocall.test', display_name: 'Site Ops' });
  ctx.db.prepare("UPDATE users SET role='site_admin' WHERE email='ops@protocall.test'").run();

  const queue = await fetch(`${base}/api/moderation/reports`, { headers: { cookie: admin } }).then(r => r.json());
  const mine2 = queue.filter(r => r.scenario_id === id);
  assert.equal(mine2.length, 2);
  assert.equal(mine2[0].open_reports, 2);

  const res = await post(`/api/moderation/reports/${mine2[0].id}/resolve`, admin, { action: 'unlist' });
  assert.equal(res.status, 200);

  const pub = await fetch(`${base}/api/public/scenarios`).then(r => r.json());
  assert.ok(!pub.find(s => s.id === id), 'unlisted scenario gone from public');
  const authorView = await fetch(`${base}/api/scenarios/${id}`, { headers: { cookie: outsider } }).then(r => r.json());
  assert.equal(authorView.visibility, 'private', 'author keeps the scenario, now private');
  const queue2 = await fetch(`${base}/api/moderation/reports`, { headers: { cookie: admin } }).then(r => r.json());
  assert.equal(queue2.filter(r => r.scenario_id === id).length, 0, 'unlist closed every open report');
});

test('membership management: remove member, then chief can leave', async () => {
  const mine = await fetch(`${base}/api/departments/mine`, { headers: { cookie: chief } }).then(r => r.json());
  const jones = mine.members.find(m => m.display_name === 'FF Jones');
  assert.equal((await post('/api/departments/remove-member', member, { user_id: jones.id })).status, 403);
  assert.equal((await post('/api/departments/remove-member', chief, { user_id: jones.id })).status, 200);
  const after1 = await fetch(`${base}/api/departments/mine`, { headers: { cookie: member } }).then(r => r.json());
  assert.equal(after1.department, null);
  // regenerate code still works, then chief (now alone) can leave
  const regen = await post('/api/departments/regenerate-code', chief, {});
  assert.equal(regen.status, 200);
  assert.equal((await post('/api/departments/leave', chief, {})).status, 200);
  const chiefAfter = await fetch(`${base}/api/me`, { headers: { cookie: chief } }).then(r => r.json());
  assert.equal(chiefAfter.role, 'standard');
  assert.equal(chiefAfter.department, null);
});

test('reject: deletes pending department, resets creator, reverts its scenarios', async () => {
  const { cookie: rogue } = await signup(base, { email: 'rogue@sta7.test', display_name: 'Rogue' });
  await post('/api/departments', rogue, { name: 'Fake Dept' });

  const pending = await fetch(`${base}/api/moderation/departments`, { headers: { cookie: admin } }).then(r => r.json());
  const row = pending.find(d => d.name === 'Fake Dept');
  assert.ok(row);
  assert.equal((await post(`/api/moderation/departments/${row.id}/reject`, rogue)).status, 403);
  assert.equal((await post(`/api/moderation/departments/${row.id}/reject`, admin)).status, 200);

  const meAfter = await fetch(`${base}/api/me`, { headers: { cookie: rogue } }).then(r => r.json());
  assert.equal(meAfter.department, null);
  assert.equal(meAfter.role, 'standard');
  const pendingAfter = await fetch(`${base}/api/moderation/departments`, { headers: { cookie: admin } }).then(r => r.json());
  assert.ok(!pendingAfter.find(d => d.name === 'Fake Dept'));
});
