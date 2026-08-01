// Phase 1: community visibility is gated on approval.
//
// Before this, sharing a scenario to Community set shared_public=1 and it
// appeared in the public library instantly — the `pending` review flow was a
// separate, author-initiated path that only granted the OFFICIAL badge. That
// contradicted the settled decision (docs/ai/decisions.md → Community):
// "scenarios submitted to Community enter pending; only approved + public show
// in community browse."
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../server/index.js';
import { signup, authed } from './helpers.js';

let ctx, base, author, admin, stranger;

const post = (path, cookie, body) => fetch(`${base}${path}`, {
  method: 'POST',
  headers: body === undefined ? { cookie } : authed(cookie),
  body: body === undefined ? undefined : JSON.stringify(body),
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
const publicTitles = async cookie =>
  (await get('/api/public/scenarios', cookie).then(r => r.json())).map(s => s.title);

before(async () => {
  ctx = await buildServer({ dbFile: ':memory:', authRateMax: 1000 });
  await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${ctx.app.server.address().port}`;
  ({ cookie: author } = await signup(base, { email: 'author@gate.test', display_name: 'Author' }));
  ({ cookie: stranger } = await signup(base, { email: 'stranger@gate.test', display_name: 'Stranger' }));
  ({ cookie: admin } = await signup(base, { email: 'admin@gate.test', display_name: 'Admin' }));
  ctx.db.prepare("UPDATE users SET role='site_admin' WHERE email='admin@gate.test'").run();
});

after(async () => {
  ctx.io.close();
  await ctx.app.close();
});

test('sharing to Community submits for review — it is not instantly public', async () => {
  const id = await share(author, 'Pending Drill');
  const row = ctx.db.prepare('SELECT review_status, shared_public FROM scenarios WHERE id=?').get(id);
  assert.equal(row.shared_public, 1, 'still flagged public');
  assert.equal(row.review_status, 'pending', 'but awaiting approval');

  assert.ok(!(await publicTitles()).includes('Pending Drill'), 'hidden from anonymous browse');
  assert.ok(!(await publicTitles(stranger)).includes('Pending Drill'), 'hidden from other users');
  // A stranger cannot reach it by direct link either.
  assert.equal((await get(`/api/scenarios/${id}`, stranger)).status, 404);
});

test('the author still sees their own pending scenario', async () => {
  const id = await share(author, 'Mine While Pending');
  const mine = await get('/api/scenarios', author).then(r => r.json());
  assert.ok(mine.some(s => s.id === id), 'own work never disappears from the author');
  assert.equal((await get(`/api/scenarios/${id}`, author)).status, 200);
});

test('approval publishes it; the seed example ships pre-approved', async () => {
  const id = await share(author, 'Approve Me');
  assert.ok(!(await publicTitles(stranger)).includes('Approve Me'));

  const res = await post(`/api/scenarios/${id}/review`, admin, { action: 'approve' });
  assert.equal(res.status, 200);
  assert.ok((await publicTitles(stranger)).includes('Approve Me'), 'visible once approved');
  assert.equal((await get(`/api/scenarios/${id}`, stranger)).status, 200);

  // The system seed is the one pre-approved example, so Community is never bare.
  assert.ok((await publicTitles()).some(t => /Two-Story Residential Fire/.test(t)));
});

test('request_changes sends the note back and keeps it out of Community', async () => {
  const id = await share(author, 'Needs Work');
  const res = await post(`/api/scenarios/${id}/review`, admin,
    { action: 'request_changes', note: 'Add a water supply question.' });
  assert.equal(res.status, 200);

  const detail = await get(`/api/scenarios/${id}`, author).then(r => r.json());
  assert.equal(detail.review_status, 'changes_requested');
  assert.equal(detail.review_note, 'Add a water supply question.');
  assert.ok(!(await publicTitles(stranger)).includes('Needs Work'));
});

test('an author edit to an approved scenario re-enters the queue', async () => {
  const id = await share(author, 'Edit After Approval');
  await post(`/api/scenarios/${id}/review`, admin, { action: 'approve' });
  assert.ok((await publicTitles(stranger)).includes('Edit After Approval'));

  const res = await fetch(`${base}/api/scenarios/${id}`, {
    method: 'PUT', headers: authed(author),
    body: JSON.stringify({
      title: 'Edit After Approval', description: 'quietly rewritten',
      category: 'Fireground', subcategory: 'Residential', visibility: 'public',
      objective_primary: 'Scene Size-Up',
      questions: [{ prompt: 'Different question?', instructor_answer: 'Different answer' }],
    }),
  });
  assert.equal(res.status, 200);
  const row = ctx.db.prepare('SELECT review_status FROM scenarios WHERE id=?').get(id);
  assert.equal(row.review_status, 'pending', 'no silent edits behind an approved badge');
  assert.ok(!(await publicTitles(stranger)).includes('Edit After Approval'), 'pulled from Community until re-approved');
});

test('private and department scenarios are untouched by the gate', async () => {
  const priv = await share(author, 'Private Drill', { visibility: 'private' });
  const row = ctx.db.prepare('SELECT review_status FROM scenarios WHERE id=?').get(priv);
  assert.equal(row.review_status, '', 'no review state for a private scenario');
  assert.equal((await get(`/api/scenarios/${priv}`, author)).status, 200);
  assert.equal((await get(`/api/scenarios/${priv}`, stranger)).status, 404);
});

// review_status serves two workflows: the new community gate AND the older
// Official-badge review, which a non-public (private/department) scenario can
// also be sitting in. Editing such a scenario must not silently drop it out of
// its queue just because it isn't public.
test('a non-public scenario keeps its pending Official-badge review across edits', async () => {
  const id = await share(author, 'Badge Candidate', { visibility: 'private' });
  const sub = await post(`/api/scenarios/${id}/submit-review`, author);
  assert.equal(sub.status, 200);
  assert.equal(ctx.db.prepare('SELECT review_status FROM scenarios WHERE id=?').get(id).review_status, 'pending');

  const res = await fetch(`${base}/api/scenarios/${id}`, {
    method: 'PUT', headers: authed(author),
    body: JSON.stringify({
      title: 'Badge Candidate', description: 'typo fixed', category: 'Fireground',
      subcategory: 'Residential', visibility: 'private', objective_primary: 'Scene Size-Up',
      questions: [{ prompt: 'Q1?', instructor_answer: 'A1' }],
    }),
  });
  assert.equal(res.status, 200);
  assert.equal(ctx.db.prepare('SELECT review_status FROM scenarios WHERE id=?').get(id).review_status,
    'pending', 'still in the reviewer queue');
});

// The migration is destructive-ish (it un-publishes the existing catalogue), so
// it must fire exactly once — a re-run would undo the owner's approvals.
test('migration sweeps legacy public scenarios into the queue, exactly once', async t => {
  const { createDb } = await import('../server/db.js');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pc-sweep-')), 'sweep.db');
  t.after(() => fs.rmSync(path.dirname(file), { recursive: true, force: true }));

  let db = createDb(file);
  db.prepare(`INSERT INTO users (id, email, password_hash, display_name)
              VALUES ('someone','someone@sweep.test','x','Someone')`).run();
  // A scenario shared under the OLD rules: public, never reviewed.
  db.prepare(`INSERT INTO scenarios (id, title, category, subcategory, visibility, shared_public, author_id, review_status)
              VALUES ('legacy','Legacy Public','Fireground','Residential','public',1,'someone','')`).run();
  // Pretend this database predates the gate.
  db.prepare("DELETE FROM app_meta WHERE key='approval_gate_sweep'").run();
  db.close();

  db = createDb(file); // migrate() re-runs → sweep fires
  assert.equal(db.prepare("SELECT review_status FROM scenarios WHERE id='legacy'").get().review_status, 'pending');

  // Owner approves it, then the app restarts: the sweep must NOT undo that.
  db.prepare("UPDATE scenarios SET review_status='approved' WHERE id='legacy'").run();
  db.close();
  db = createDb(file);
  assert.equal(db.prepare("SELECT review_status FROM scenarios WHERE id='legacy'").get().review_status, 'approved',
    'the sweep is one-shot — a restart must not re-pend approved scenarios');
  db.close();
});

test('leaving Community clears the review state', async () => {
  const id = await share(author, 'Retracted');
  const res = await fetch(`${base}/api/scenarios/${id}`, {
    method: 'PUT', headers: authed(author),
    body: JSON.stringify({
      title: 'Retracted', description: '', category: 'Fireground', subcategory: 'Residential',
      visibility: 'private', objective_primary: 'Scene Size-Up',
      questions: [{ prompt: 'Q1?', instructor_answer: 'A1' }],
    }),
  });
  assert.equal(res.status, 200);
  const row = ctx.db.prepare('SELECT review_status, shared_public FROM scenarios WHERE id=?').get(id);
  assert.equal(row.shared_public, 0);
  assert.equal(row.review_status, '');
});
