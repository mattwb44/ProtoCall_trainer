// v9 account settings: display-name change + password change.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../server/index.js';
import { signup, authed } from './helpers.js';

let ctx, base, cookie;

before(async () => {
  ctx = await buildServer({ dbFile: ':memory:', authRateMax: 1000 });
  await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${ctx.app.server.address().port}`;
  ({ cookie } = await signup(base, { email: 'acct@t.test', password: 'originalpw1', display_name: 'Original Name' }));
});

after(async () => {
  ctx.io.close();
  await ctx.app.close();
});

test('display name can be changed; blank rejected; anonymous rejected', async () => {
  const ok = await fetch(`${base}/api/me`, {
    method: 'PUT', headers: authed(cookie), body: JSON.stringify({ display_name: 'New Name' }),
  });
  assert.equal(ok.status, 200);
  const me = await fetch(`${base}/api/me`, { headers: { cookie } }).then(r => r.json());
  assert.equal(me.display_name, 'New Name');

  assert.equal((await fetch(`${base}/api/me`, {
    method: 'PUT', headers: authed(cookie), body: JSON.stringify({ display_name: '  ' }),
  })).status, 400);
  assert.equal((await fetch(`${base}/api/me`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ display_name: 'X' }),
  })).status, 401);
});

test('password change requires the correct current password and 8+ new chars', async () => {
  const wrong = await fetch(`${base}/api/me/password`, {
    method: 'POST', headers: authed(cookie),
    body: JSON.stringify({ current_password: 'notit', new_password: 'brandnewpw2' }),
  });
  assert.equal(wrong.status, 403);

  const short = await fetch(`${base}/api/me/password`, {
    method: 'POST', headers: authed(cookie),
    body: JSON.stringify({ current_password: 'originalpw1', new_password: 'short' }),
  });
  assert.equal(short.status, 400);

  const ok = await fetch(`${base}/api/me/password`, {
    method: 'POST', headers: authed(cookie),
    body: JSON.stringify({ current_password: 'originalpw1', new_password: 'brandnewpw2' }),
  });
  assert.equal(ok.status, 200);

  // old password no longer works, new one does
  const oldLogin = await fetch(`${base}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'acct@t.test', password: 'originalpw1' }),
  });
  assert.equal(oldLogin.status, 401);
  const newLogin = await fetch(`${base}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'acct@t.test', password: 'brandnewpw2' }),
  });
  assert.equal(newLogin.status, 200);
});
