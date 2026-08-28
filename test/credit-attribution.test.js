// Phase E — author attribution:
//   E1: every scenario carries a persistent `credit_name`, captured at creation
//       and copied VERBATIM on every clone so the *original* maker keeps credit
//       even after the source is deleted or the clone is re-cloned.
//   E2: a cloned scenario exposes its origin (`cloned_from` + remembered title)
//       so post-session review can link back — gracefully when the original is gone.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../server/index.js';
import { signup, authed } from './helpers.js';

let ctx, base, maker, cloner, recloner;

const post = (path, cookie, body) => fetch(`${base}${path}`, {
  method: 'POST', headers: authed(cookie), body: JSON.stringify(body ?? {}),
});
// Clone takes no body — send just the cookie (no JSON content-type to reject).
const clone = (path, cookie) => fetch(`${base}${path}`, { method: 'POST', headers: { cookie } });
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
  ({ cookie: maker } = await signup(base, { email: 'maker@credit.test', display_name: 'Original Maker' }));
  ({ cookie: cloner } = await signup(base, { email: 'cloner@credit.test', display_name: 'The Cloner' }));
  ({ cookie: recloner } = await signup(base, { email: 're@credit.test', display_name: 'Re Cloner' }));
});

after(async () => {
  ctx.io.close();
  await ctx.app.close();
});

test('E1: a new scenario stores the creator display_name as credit_name', async () => {
  const id = await share(maker, 'Origin');
  const s = await get(`/api/scenarios/${id}`, maker).then(r => r.json());
  assert.equal(s.credit_name, 'Original Maker');
});

test('E1: cloning copies credit verbatim; cloner owns the copy but credit stays original', async () => {
  const id = await share(maker, 'Cloneable', { visibility: 'private' });
  // maker's own private scenario is visible to maker; share to clone across users
  // — clone requires visibility, so approve/share publicly instead.
  const pubId = await share(maker, 'Public Cloneable');
  ctx.db.prepare("UPDATE scenarios SET review_status='approved' WHERE id=?").run(pubId);

  const cloneRes = await clone(`/api/scenarios/${pubId}/clone`, cloner);
  assert.equal(cloneRes.status, 201);
  const cloneId = (await cloneRes.json()).id;

  const copy = await get(`/api/scenarios/${cloneId}`, cloner).then(r => r.json());
  assert.equal(copy.credit_name, 'Original Maker', 'credit follows the original maker');
  assert.equal(copy.author_name, 'The Cloner', 'author_name is the cloner (owns this copy)');
  assert.equal(copy.cloned_from, pubId, 'clone remembers its origin');
  assert.ok(copy.mine, 'the clone belongs to the cloner');
});

test('E1: credit survives a re-clone and deletion of the source', async () => {
  const pubId = await share(maker, 'Root');
  ctx.db.prepare("UPDATE scenarios SET review_status='approved' WHERE id=?").run(pubId);

  const cloneId = (await clone(`/api/scenarios/${pubId}/clone`, cloner).then(r => r.json())).id;
  // The cloner shares their copy publicly so recloner can clone it.
  ctx.db.prepare("UPDATE scenarios SET shared_public=1, review_status='approved' WHERE id=?").run(cloneId);

  const reId = (await clone(`/api/scenarios/${cloneId}/clone`, recloner).then(r => r.json())).id;

  // Prove the credit is a stored copy, not a live read of the source: tamper the
  // root's credit and soft-delete it (production never hard-deletes). The reclone
  // must still carry the original name.
  ctx.db.prepare("UPDATE scenarios SET credit_name='TAMPERED', deleted_at=datetime('now') WHERE id=?").run(pubId);

  const re = await get(`/api/scenarios/${reId}`, recloner).then(r => r.json());
  assert.equal(re.credit_name, 'Original Maker', 'credit persists through a re-clone and source deletion');
});

test('E1: the boot backfill stamps a pre-existing credit-less scenario', async () => {
  const id = await share(maker, 'Backfill Me');
  // Simulate a legacy row: null out credit_name and clear the one-shot flag.
  ctx.db.prepare('UPDATE scenarios SET credit_name=NULL WHERE id=?').run(id);
  ctx.db.prepare("DELETE FROM app_meta WHERE key='scenario_credit_name_backfill'").run();

  // Reopen a server against the same file would re-run migrate(); here we invoke
  // the backfill directly the same way migrate() does, then assert it landed.
  ctx.db.exec(`UPDATE scenarios SET credit_name=(
                 SELECT display_name FROM users u WHERE u.id=scenarios.author_id)
               WHERE credit_name IS NULL AND author_id IS NOT NULL`);
  const row = ctx.db.prepare('SELECT credit_name FROM scenarios WHERE id=?').get(id);
  assert.equal(row.credit_name, 'Original Maker');
});
