import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../server/index.js';
import { signup, authed } from './helpers.js';

// Track C: objectives move to the question level (optional, inheriting the
// scenario's primary). A scenario's objective set is the union of its
// primary/secondary and its questions' objectives — lifting the old two-cap so
// multi-topic scenarios tag (and count toward coverage under) every objective
// they actually train.

let ctx, base;
before(async () => {
  ctx = await buildServer({ dbFile: ':memory:', authRateMax: 1000 });
  await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${ctx.app.server.address().port}`;
});
after(async () => { ctx.io.close(); await ctx.app.close(); });

const body = extra => JSON.stringify({
  title: 'Multi-topic', description: 'd', category: 'Fire', subcategory: 'Structure',
  visibility: 'public', objective_primary: 'Reading Smoke', objective_secondary: 'Fire Attack',
  questions: [{ prompt: 'Q?', kind: 'text', instructor_answer: 'A' }],
  ...extra,
});

test('per-question objectives roll up into the scenario objective union', async () => {
  const { cookie } = await signup(base, { email: 'pq@obj.test' });
  const res = await fetch(`${base}/api/scenarios`, {
    method: 'POST', headers: authed(cookie),
    body: body({
      questions: [
        { prompt: 'Smoke?', kind: 'text', instructor_answer: 'A', objective: 'Reading Smoke' },
        { prompt: 'Vent?', kind: 'text', instructor_answer: 'A', objective: 'Ventilation' },
        { prompt: 'Search?', kind: 'text', instructor_answer: 'A', objective: 'Search' },
        { prompt: 'General?', kind: 'text', instructor_answer: 'A' }, // blank → inherits primary
      ],
    }),
  });
  assert.equal(res.status, 201);
  const { id } = await res.json();
  const detail = await fetch(`${base}/api/scenarios/${id}`, { headers: { cookie } }).then(r => r.json());

  // union = primary, secondary, then distinct question objectives (blank adds nothing)
  assert.deepEqual(detail.objectives, ['Reading Smoke', 'Fire Attack', 'Ventilation', 'Search']);
  // each question round-trips its own objective; blank stays blank (inherits at read time)
  assert.equal(detail.questions.find(q => q.prompt === 'Vent?').objective, 'Ventilation');
  assert.equal(detail.questions.find(q => q.prompt === 'General?').objective, '');
});

test('unknown per-question objective is rejected on create and update', async () => {
  const { cookie } = await signup(base, { email: 'bad@obj.test' });
  const create = await fetch(`${base}/api/scenarios`, {
    method: 'POST', headers: authed(cookie),
    body: body({ questions: [{ prompt: 'Q?', kind: 'text', objective: 'Totally Made Up' }] }),
  });
  assert.equal(create.status, 400);

  const ok = await fetch(`${base}/api/scenarios`, { method: 'POST', headers: authed(cookie), body: body() });
  const { id } = await ok.json();
  const upd = await fetch(`${base}/api/scenarios/${id}`, {
    method: 'PUT', headers: authed(cookie),
    body: body({ questions: [{ prompt: 'Q?', kind: 'text', objective: 'Nonsense' }] }),
  });
  assert.equal(upd.status, 400);
});

test('coverage counts a scenario under every objective in its union', async () => {
  const { cookie } = await signup(base, { email: 'cov2@obj.test' });
  const cell = (cov, o) => cov.grid[o]?.['Fire'] ?? 0;
  const before = await fetch(`${base}/api/coverage`).then(r => r.json());
  // One scenario, three distinct topics: primary + two per-question objectives.
  await fetch(`${base}/api/scenarios`, {
    method: 'POST', headers: authed(cookie),
    body: body({
      objective_primary: 'Reading Smoke', objective_secondary: '',
      questions: [
        { prompt: 'A?', kind: 'text', objective: 'Ventilation' },
        { prompt: 'B?', kind: 'text', objective: 'Search' },
      ],
    }),
  });
  const after = await fetch(`${base}/api/coverage`).then(r => r.json());
  // the single new scenario lifts all three objectives it trains by exactly one
  for (const o of ['Reading Smoke', 'Ventilation', 'Search'])
    assert.equal(cell(after, o) - cell(before, o), 1, `${o} +1`);
});
