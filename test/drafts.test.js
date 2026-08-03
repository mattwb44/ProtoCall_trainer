// Phase 2: persisted drafts. A draft is owner-only, unshared, unplayable, and
// exempt from field validation until Finish. Editing a published scenario never
// demotes it back to a draft.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../server/index.js';
import { signup, authed } from './helpers.js';

let ctx, base, author, other;

const post = (path, cookie, body) => fetch(`${base}${path}`, {
  method: 'POST', headers: authed(cookie), body: JSON.stringify(body),
});
const put = (path, cookie, body) => fetch(`${base}${path}`, {
  method: 'PUT', headers: authed(cookie), body: JSON.stringify(body),
});
const get = (path, cookie) => fetch(`${base}${path}`, { headers: cookie ? { cookie } : {} });
const row = id => ctx.db.prepare('SELECT * FROM scenarios WHERE id=?').get(id);

before(async () => {
  ctx = await buildServer({ dbFile: ':memory:', authRateMax: 1000 });
  await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${ctx.app.server.address().port}`;
  ({ cookie: author } = await signup(base, { email: 'author@draft.test', display_name: 'Author' }));
  ({ cookie: other } = await signup(base, { email: 'other@draft.test', display_name: 'Other' }));
});
after(async () => { ctx.io.close(); await ctx.app.close(); });

test('a draft saves with almost nothing — no category, no objective, no questions', async () => {
  const res = await post('/api/scenarios', author, { draft: true, title: 'WIP idea' });
  assert.equal(res.status, 201);
  const r = row((await res.json()).id);
  assert.equal(r.is_draft, 1);
  assert.equal(r.shared_public, 0);
  assert.equal(r.shared_department, 0);
  assert.equal(r.review_status, '');
  assert.equal(r.objective_primary, '');
});

test('a draft ignores any shares in the body — always private', async () => {
  const res = await post('/api/scenarios', author, {
    draft: true, title: 'Sneaky', shared_public: true, visibility: 'public',
  });
  const r = row((await res.json()).id);
  assert.equal(r.is_draft, 1);
  assert.equal(r.shared_public, 0, 'draft cannot be public');
});

test('a draft shows in the author\'s My Library but nowhere public', async () => {
  const id = (await (await post('/api/scenarios', author, { draft: true, title: 'Only Mine' })).json()).id;
  const mine = await get('/api/scenarios?scope=mine', author).then(r => r.json());
  assert.ok(mine.find(s => s.id === id && s.is_draft), 'draft is in My Library, flagged');
  const pub = await get('/api/public/scenarios').then(r => r.json());
  assert.ok(!pub.find(s => s.id === id), 'draft never appears in Community');
  const others = await get('/api/scenarios', other).then(r => r.json());
  assert.ok(!others.find(s => s.id === id), 'and not in anyone else\'s list');
});

test('a draft is unplayable — no live session, no solo run', async () => {
  const id = (await (await post('/api/scenarios', author, { draft: true, title: 'No Play' })).json()).id;
  assert.equal((await post('/api/sessions', author, { scenario_id: id })).status, 403, 'live blocked');
  assert.equal((await post('/api/solo/runs', author, { scenario_id: id })).status, 404, 'solo run blocked');
  assert.equal((await post(`/api/scenarios/${id}/solo-reveal`, author, { answers: {} })).status, 404, 'stateless solo reveal blocked, even for the author');
});

test('Finish validates the deferred fields', async () => {
  const id = (await (await post('/api/scenarios', author, { draft: true, title: 'Half Done' })).json()).id;
  // Finishing without a primary objective is rejected, just like a normal create.
  const bad = await put(`/api/scenarios/${id}`, author, {
    draft: false, title: 'Half Done', category: 'Fireground', subcategory: 'Residential', questions: [],
  });
  assert.equal(bad.status, 400);
  assert.equal(row(id).is_draft, 1, 'still a draft after a failed finish');

  const ok = await put(`/api/scenarios/${id}`, author, {
    draft: false, title: 'All Done', category: 'Fireground', subcategory: 'Residential',
    objective_primary: 'Scene Size-Up', questions: [{ prompt: 'Q?', instructor_answer: 'A' }],
  });
  assert.equal(ok.status, 200);
  assert.equal(row(id).is_draft, 0, 'finished — no longer a draft');
  // and now it is launchable
  assert.equal((await post('/api/sessions', author, { scenario_id: id })).status, 200);
});

test('editing a published scenario with draft:true does not demote it', async () => {
  const id = (await (await post('/api/scenarios', author, {
    title: 'Published', category: 'Fireground', subcategory: 'Residential',
    objective_primary: 'Scene Size-Up', questions: [{ prompt: 'Q?', instructor_answer: 'A' }],
  })).json()).id;
  assert.equal(row(id).is_draft, 0);
  const res = await put(`/api/scenarios/${id}`, author, {
    draft: true, title: 'Published', category: 'Fireground', subcategory: 'Residential',
    objective_primary: 'Scene Size-Up', questions: [{ prompt: 'Q?', instructor_answer: 'A' }],
  });
  assert.equal(res.status, 200);
  assert.equal(row(id).is_draft, 0, 'never demoted to draft');
});

test('a normal (non-draft) create still requires the core fields', async () => {
  assert.equal((await post('/api/scenarios', author, { title: 'X' })).status, 400);
  assert.equal((await post('/api/scenarios', author, {
    title: 'X', category: 'Fireground', subcategory: 'Residential', questions: [],
  })).status, 400, 'objective still required at create');
});
