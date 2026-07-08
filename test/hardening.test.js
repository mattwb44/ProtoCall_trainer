import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../server/index.js';
import { signup } from './helpers.js';

let ctx, base;

before(async () => {
  // default (production) rate limits on purpose — that's what this file tests
  ctx = await buildServer({ dbFile: ':memory:' });
  await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${ctx.app.server.address().port}`;
});

after(async () => {
  ctx.io.close();
  await ctx.app.close();
});

test('healthz returns 200 with a real db read', async () => {
  const res = await fetch(`${base}/healthz`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(typeof body.uptime_s, 'number');
});

test('security headers present; PWA assets served with correct types', async () => {
  const res = await fetch(`${base}/`);
  assert.ok(res.headers.get('x-content-type-options'), 'helmet headers set');
  const manifest = await fetch(`${base}/manifest.json`);
  assert.equal(manifest.status, 200);
  assert.equal((await manifest.json()).name, 'ProtoCall Trainer');
  const sw = await fetch(`${base}/sw.js`);
  assert.equal(sw.status, 200);
  assert.match(sw.headers.get('content-type'), /javascript/);
  const icon = await fetch(`${base}/icon.svg`);
  assert.match(icon.headers.get('content-type'), /svg/);
});

test('login is rate-limited: 11th attempt in a minute gets 429', async () => {
  let last;
  for (let i = 0; i < 11; i++) {
    last = await fetch(`${base}/api/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'bruteforce@x.test', password: 'guess' + i }),
    });
  }
  assert.equal(last.status, 429);
});

test('backup: site_admin only, streams a valid sqlite snapshot', async () => {
  const { cookie } = await signup(base, { email: 'notadmin@x.test' });
  assert.equal((await fetch(`${base}/api/admin/backup`, { headers: { cookie } })).status, 403);
  assert.equal((await fetch(`${base}/api/admin/backup`)).status, 403);

  const { cookie: adminCookie } = await signup(base, { email: 'admin@x.test' });
  ctx.db.prepare("UPDATE users SET role='site_admin' WHERE email='admin@x.test'").run();

  const res = await fetch(`${base}/api/admin/backup`, { headers: { cookie: adminCookie } });
  assert.equal(res.status, 200);
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.subarray(0, 16).toString('latin1'), 'SQLite format 3\x00');
  assert.ok(buf.length > 4096, 'snapshot has real content');
});
