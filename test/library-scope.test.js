// Phase 2 ownership boundary: GET /api/scenarios?scope=mine is My Library — it
// returns *only* the caller's own scenarios. The bare endpoint keeps its mixed
// public-OR-mine-OR-department semantics that the host/launch flow depends on.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../server/index.js';
import { signup, authed, approvePublic } from './helpers.js';

let ctx, base, author, other;

const post = (path, cookie, body) => fetch(`${base}${path}`, {
  method: 'POST', headers: authed(cookie), body: JSON.stringify(body),
});
const get = (path, cookie) => fetch(`${base}${path}`, { headers: cookie ? { cookie } : {} });

const share = async (cookie, title, over = {}) => {
  const res = await post('/api/scenarios', cookie, {
    title, category: 'Fireground', subcategory: 'Residential',
    visibility: 'public', objective_primary: 'Scene Size-Up',
    questions: [{ prompt: 'Q1?', instructor_answer: 'A1' }],
    ...over,
  });
  assert.equal(res.status, 201);
  return (await res.json()).id;
};

before(async () => {
  ctx = await buildServer({ dbFile: ':memory:', authRateMax: 1000 });
  await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${ctx.app.server.address().port}`;
  ({ cookie: author } = await signup(base, { email: 'author@scope.test', display_name: 'Author' }));
  ({ cookie: other } = await signup(base, { email: 'other@scope.test', display_name: 'Other' }));
});

after(async () => {
  ctx.io.close();
  await ctx.app.close();
});

test('scope=mine returns only the caller\'s own scenarios, not others\' public ones', async () => {
  const theirs = await share(other, 'Someone Else Public');
  approvePublic(ctx.db, theirs); // visible in the default/community view
  const ownPending = await share(author, 'My Pending');
  const ownPrivate = await share(author, 'My Private', { visibility: 'private' });

  const mine = await get('/api/scenarios?scope=mine', author).then(r => r.json());
  const ids = mine.map(s => s.id);

  assert.ok(ids.includes(ownPending), 'my pending scenario is in My Library');
  assert.ok(ids.includes(ownPrivate), 'my private scenario is in My Library');
  assert.ok(!ids.includes(theirs), "another user's approved public scenario is NOT in My Library");
  assert.ok(mine.every(s => s.mine === true), 'every row is flagged mine');
});

test('scope=mine includes the caller\'s soft-deleted scenarios (restore list)', async () => {
  const id = await share(author, 'To Be Deleted');
  assert.equal((await fetch(`${base}/api/scenarios/${id}`, {
    method: 'DELETE', headers: { cookie: author },
  })).status, 200);

  const mine = await get('/api/scenarios?scope=mine', author).then(r => r.json());
  const row = mine.find(s => s.id === id);
  assert.ok(row, 'soft-deleted scenario still returned under scope=mine');
  assert.ok(row.deleted_at, 'and it carries its deleted_at so the UI can bucket it');
});

test('scope=mine for an anonymous caller returns an empty list', async () => {
  const anon = await get('/api/scenarios?scope=mine').then(r => r.json());
  assert.deepEqual(anon, []);
});

test('the default /api/scenarios still returns others\' approved public scenarios', async () => {
  const theirs = await share(other, 'Other Public For Default');
  approvePublic(ctx.db, theirs);
  const all = await get('/api/scenarios', author).then(r => r.json());
  assert.ok(all.some(s => s.id === theirs),
    'default endpoint keeps its mixed semantics for the host/launch flow');
});
