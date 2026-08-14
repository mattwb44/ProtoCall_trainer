// PR 10: vote and report were still checking the legacy visibility='public'
// column, so a scenario pending review (shared_public=1, review_status !=
// 'approved') was votable/reportable even though it's invisible everywhere
// else in Community. Both routes now use the same APPROVED_PUBLIC predicate
// as browse/list (server/index.js ~556).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../server/index.js';
import { signup, authed, approvePublic } from './helpers.js';

let ctx, base, author, stranger;

const post = (path, cookie, body) => fetch(`${base}${path}`, {
  method: 'POST',
  headers: body === undefined ? { cookie } : authed(cookie),
  body: body === undefined ? undefined : JSON.stringify(body),
});

const share = async (cookie, title) => {
  const res = await post('/api/scenarios', cookie, {
    title, category: 'Fireground', subcategory: 'Residential',
    visibility: 'public', objective_primary: 'Scene Size-Up',
    questions: [{ prompt: 'Q1?', instructor_answer: 'A1' }],
  });
  assert.equal(res.status, 201);
  return (await res.json()).id;
};

before(async () => {
  ctx = await buildServer({ dbFile: ':memory:', authRateMax: 1000 });
  await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${ctx.app.server.address().port}`;
  ({ cookie: author } = await signup(base, { email: 'author@mod.test', display_name: 'Author' }));
  ({ cookie: stranger } = await signup(base, { email: 'stranger@mod.test', display_name: 'Stranger' }));
});

after(async () => {
  ctx.io.close();
  await ctx.app.close();
});

test('a pending (unapproved) public scenario 404s on vote and report', async () => {
  const id = await share(author, 'Pending Vote Target');

  const vote = await post(`/api/scenarios/${id}/vote`, stranger);
  assert.equal(vote.status, 404);

  const report = await post(`/api/scenarios/${id}/report`, stranger, { reason: 'spam' });
  assert.equal(report.status, 404);
});

test('an approved public scenario is votable and reportable', async () => {
  const id = await share(author, 'Approved Vote Target');
  approvePublic(ctx.db, id);

  const vote = await post(`/api/scenarios/${id}/vote`, stranger);
  assert.equal(vote.status, 200);
  const voteBody = await vote.json();
  assert.equal(voteBody.voted, true);
  assert.equal(voteBody.votes, 1);

  const report = await post(`/api/scenarios/${id}/report`, stranger, { reason: 'spam' });
  assert.equal(report.status, 201);
});
