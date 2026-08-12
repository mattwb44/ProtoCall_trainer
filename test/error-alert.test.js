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
