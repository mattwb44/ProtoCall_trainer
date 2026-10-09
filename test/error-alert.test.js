import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../server/index.js';

let ctx, base;

before(async () => {
  ctx = await buildServer({
    dbFile: ':memory:',
    reportError: () => { throw new Error('reporter is broken'); },
  });
  ctx.app.get('/__boom', () => { throw new Error('route exploded'); });
  await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${ctx.app.server.address().port}`;
});
after(async () => { ctx.io.close(); await ctx.app.close(); });

test('setErrorHandler swallows a throwing reporter and still returns the normal error response', async () => {
  const res = await fetch(`${base}/__boom`);
  assert.equal(res.status, 500);
  const body = await res.json();
  assert.deepEqual(body, { error: 'internal server error' });
});

test('only 5xx errors are reported; client errors (400, 429) are not', async () => {
  const reported = [];
  const c = await buildServer({ dbFile: ':memory:', authRateMax: 1, reportError: e => reported.push(e) });
  c.app.get('/__boom', () => { throw new Error('route exploded'); });
  await c.app.listen({ port: 0, host: '127.0.0.1' });
  const url = `http://127.0.0.1:${c.app.server.address().port}`;
  try {
    // Empty body with a JSON content-type → Fastify 400.
    const empty = await fetch(`${url}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    assert.equal(empty.status, 400);
    // authRateMax is 1, so the next auth call is rate-limited → 429.
    const limited = await fetch(`${url}/api/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    assert.equal(limited.status, 429);
    assert.equal(reported.length, 0);
    const boom = await fetch(`${url}/__boom`);
    assert.equal(boom.status, 500);
    assert.equal(reported.length, 1);
    assert.equal(reported[0].message, 'route exploded');
  } finally { c.io.close(); await c.app.close(); }
});
