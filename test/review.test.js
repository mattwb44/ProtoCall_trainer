// PRD-v8: in-app scenario review & approval workflow.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../server/index.js';
import { signup, authed } from './helpers.js';

let ctx, base;
let chief, member, outsider, admin; // cookies
let deptId;

const post = (path, cookie, body) => fetch(`${base}${path}`, {
  method: 'POST',
  headers: body === undefined ? { cookie } : authed(cookie),
  body: body === undefined ? undefined : JSON.stringify(body),
});
const get = (path, cookie) => fetch(`${base}${path}`, { headers: { cookie } });

const makeScenario = async (cookie, over = {}) => {
  const res = await post('/api/scenarios', cookie, {
    title: over.title ?? 'Review Me', category: 'Fireground', subcategory: 'Residential',
    objective_primary: 'Scene Size-Up',
    visibility: over.visibility ?? 'private',
    questions: [{ prompt: 'Q1?', instructor_answer: 'A1', stage: 'Arrival' }],
    ...over,
  });
  assert.equal(res.status, 201);
  return (await res.json()).id;
};

before(async () => {
  ctx = await buildServer({ dbFile: ':memory:', authRateMax: 1000 });
  await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${ctx.app.server.address().port}`;
  ({ cookie: chief } = await signup(base, { email: 'chief@rev.test', display_name: 'Chief' }));
  ({ cookie: member } = await signup(base, { email: 'ff@rev.test', display_name: 'FF Author' }));
  ({ cookie: outsider } = await signup(base, { email: 'out@rev.test', display_name: 'Outsider' }));
  ({ cookie: admin } = await signup(base, { email: 'site@rev.test', display_name: 'Site Admin' }));
  ctx.db.prepare("UPDATE users SET role='site_admin' WHERE email='site@rev.test'").run();
  // department: chief creates, site admin verifies, member joins
  await post('/api/departments', chief, { name: 'Review FD' });
  const pending = await get('/api/moderation/departments', admin).then(r => r.json());
  deptId = pending.find(d => d.name === 'Review FD').id;
  await post(`/api/moderation/departments/${deptId}/approve`, admin);
  const { department } = await get('/api/departments/mine', chief).then(r => r.json());
  await post('/api/departments/join', member, { code: department.join_code });
});

after(async () => {
  ctx.io.close();
  await ctx.app.close();
});

test('author submits for review; empty scenarios and re-submits are rejected', async () => {
  const empty = await post('/api/scenarios', member, {
    title: 'No Questions', category: 'EMS', subcategory: 'Trauma', questions: [],
  }).then(r => r.json());
  assert.equal((await post(`/api/scenarios/${empty.id}/submit-review`, member)).status, 400);

  const id = await makeScenario(member);
  assert.equal((await post(`/api/scenarios/${id}/submit-review`, outsider)).status, 404, 'author only');
  const ok = await post(`/api/scenarios/${id}/submit-review`, member);
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).review_status, 'pending');
  assert.equal((await post(`/api/scenarios/${id}/submit-review`, member)).status, 409, 'already pending');
});

test('queue scope: chief sees own-department submissions, site admin sees all, others 403', async () => {
  const outsideId = await makeScenario(outsider, { title: 'Outsider Draft' });
  await post(`/api/scenarios/${outsideId}/submit-review`, outsider);

  const chiefQ = await get('/api/review/queue', chief).then(r => r.json());
  assert.ok(chiefQ.some(s => s.title === 'Review Me'), 'member submission in chief queue');
  assert.ok(!chiefQ.some(s => s.title === 'Outsider Draft'), 'outsider not in chief queue');

  const adminQ = await get('/api/review/queue', admin).then(r => r.json());
  assert.ok(adminQ.some(s => s.title === 'Review Me'));
  assert.ok(adminQ.some(s => s.title === 'Outsider Draft'));
  assert.equal(adminQ[0].author_name.length > 0, true);

  assert.equal((await get('/api/review/queue', member)).status, 403);
  assert.equal((await get('/api/review/queue', outsider)).status, 403);
});

test('reviewer can read a pending private scenario (with answers) and edit content but not visibility', async () => {
  const id = await makeScenario(member, { title: 'Chief Edits Me' });
  await post(`/api/scenarios/${id}/submit-review`, member);

  const seen = await get(`/api/scenarios/${id}`, chief);
  assert.equal(seen.status, 200);
  const body = await seen.json();
  assert.equal(body.can_review, true);
  assert.equal(body.questions[0].instructor_answer, 'A1', 'reviewer sees model answers');
  assert.equal((await get(`/api/scenarios/${id}`, outsider)).status, 404, 'still private to others');

  const put = await fetch(`${base}/api/scenarios/${id}`, {
    method: 'PUT', headers: authed(chief),
    body: JSON.stringify({
      title: 'Chief Edited', category: 'Fireground', subcategory: 'Residential',
      visibility: 'public', // reviewer attempt to publish is ignored
      questions: [{ prompt: 'Q1 improved?', instructor_answer: 'A1 improved', stage: 'Arrival' }],
    }),
  });
  assert.equal(put.status, 200);
  const after = ctx.db.prepare('SELECT * FROM scenarios WHERE id=?').get(id);
  assert.equal(after.title, 'Chief Edited');
  assert.equal(after.visibility, 'private', 'reviewer cannot change visibility');
  assert.equal(after.review_status, 'pending', 'reviewer edit keeps it pending');
});

test('approve is plain by default, official only on request; request_changes requires and stores a note; scope enforced', async () => {
  const id = await makeScenario(member, { title: 'Approve Me' });
  await post(`/api/scenarios/${id}/submit-review`, member);

  assert.equal((await post(`/api/scenarios/${id}/review`, member, { action: 'approve' })).status, 403);
  assert.equal((await post(`/api/scenarios/${id}/review`, outsider, { action: 'approve' })).status, 403);
  assert.equal((await post(`/api/scenarios/${id}/review`, chief, { action: 'request_changes' })).status, 400, 'note required');

  const rc = await post(`/api/scenarios/${id}/review`, chief, { action: 'request_changes', note: 'Add a backup line question.' });
  assert.equal(rc.status, 200);
  const mine = await get(`/api/scenarios/${id}`, member).then(r => r.json());
  assert.equal(mine.review_status, 'changes_requested');
  assert.equal(mine.review_note, 'Add a backup line question.');

  // author resubmits after changes, chief approves — Part 7: a plain approve
  // does NOT badge the scenario Official; that's a separate opt-in.
  assert.equal((await post(`/api/scenarios/${id}/submit-review`, member)).status, 200);
  const ap = await post(`/api/scenarios/${id}/review`, chief, { action: 'approve' });
  assert.equal(ap.status, 200);
  assert.equal((await ap.json()).is_official, 0);
  const row = ctx.db.prepare('SELECT is_official, review_status FROM scenarios WHERE id=?').get(id);
  assert.equal(row.is_official, 0, 'plain approve leaves the official badge off');
  assert.equal(row.review_status, 'approved');

  // approve with official:true grants the badge
  const id2 = await makeScenario(member, { title: 'Badge Me' });
  await post(`/api/scenarios/${id2}/submit-review`, member);
  const ap2 = await post(`/api/scenarios/${id2}/review`, chief, { action: 'approve', official: true });
  assert.equal(ap2.status, 200);
  assert.deepEqual(await ap2.json(), { review_status: 'approved', is_official: 1 });
});

test('author edit after approval voids the badge and status', async () => {
  const id = await makeScenario(member, { title: 'Void Me' });
  await post(`/api/scenarios/${id}/submit-review`, member);
  await post(`/api/scenarios/${id}/review`, chief, { action: 'approve', official: true });

  const put = await fetch(`${base}/api/scenarios/${id}`, {
    method: 'PUT', headers: authed(member),
    body: JSON.stringify({
      title: 'Void Me v2', category: 'Fireground', subcategory: 'Residential', visibility: 'private',
      questions: [{ prompt: 'Q1?', instructor_answer: 'A1' }],
    }),
  });
  assert.equal(put.status, 200);
  const row = ctx.db.prepare('SELECT is_official, review_status FROM scenarios WHERE id=?').get(id);
  assert.equal(row.is_official, 0, 'edit clears the official badge');
  assert.equal(row.review_status, '', 'must resubmit for review');
});

test('site admin can review (and self-review) scenarios from authors with no department', async () => {
  const id = await makeScenario(admin, { title: 'Owner Draft' });
  await post(`/api/scenarios/${id}/submit-review`, admin);
  const q = await get('/api/review/queue', admin).then(r => r.json());
  assert.ok(q.some(s => s.id === id), 'own draft in own queue (content-sprint flow)');
  const ap = await post(`/api/scenarios/${id}/review`, admin, { action: 'approve', official: true });
  assert.equal(ap.status, 200);
  assert.equal((await ap.json()).is_official, 1);
});
