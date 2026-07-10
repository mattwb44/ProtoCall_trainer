import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../server/index.js';
import { signup, authed } from './helpers.js';

// Capturing mailer: records every send and hands back the link so tests can "click" it.
const sent = [];
const capturingMailer = {
  sendVerification: (to, name, link) => { sent.push({ kind: 'verify', to, name, link }); return Promise.resolve({ ok: true }); },
  sendReset: (to, name, link) => { sent.push({ kind: 'reset', to, name, link }); return Promise.resolve({ ok: true }); },
};
const linkToken = link => link.split('/').pop();
const post = (base, path, body, cookie) => fetch(`${base}${path}`, {
  method: 'POST', headers: authed(cookie ?? ''), body: JSON.stringify(body),
});

let ctx, base;

before(async () => {
  ctx = await buildServer({ dbFile: ':memory:', authRateMax: 1000, mailer: capturingMailer });
  await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${ctx.app.server.address().port}`;
});
after(async () => { ctx.io.close(); await ctx.app.close(); });
beforeEach(() => { sent.length = 0; });

test('signup sends a verification email; the link verifies once and only once', async () => {
  const { body, cookie } = await signup(base, { email: 'verify@dept.test', display_name: 'Vera' });
  assert.equal(body.email_verified, false);

  const mail = sent.find(m => m.kind === 'verify' && m.to === 'verify@dept.test');
  assert.ok(mail, 'a verification email was queued');
  assert.match(mail.link, /#\/verify\//);

  const me = await fetch(`${base}/api/me`, { headers: { cookie } }).then(r => r.json());
  assert.equal(me.email_verified, false);

  const ok = await post(base, '/api/auth/verify', { token: linkToken(mail.link) });
  assert.equal(ok.status, 200);
  const meAfter = await fetch(`${base}/api/me`, { headers: { cookie } }).then(r => r.json());
  assert.equal(meAfter.email_verified, true);

  // single-use: replaying the same token now fails
  const replay = await post(base, '/api/auth/verify', { token: linkToken(mail.link) });
  assert.equal(replay.status, 400);
});

test('a bogus verification token is rejected', async () => {
  const res = await post(base, '/api/auth/verify', { token: 'not-a-real-token' });
  assert.equal(res.status, 400);
});

test('reset: request is silent about existence, link changes password and revokes old sessions', async () => {
  const { cookie: oldCookie } = await signup(base, { email: 'reset@dept.test', password: 'originalpw1', display_name: 'Reed' });

  // unknown email: still 200, but nothing sent (no account-existence leak)
  const unknown = await post(base, '/api/auth/reset/request', { email: 'ghost@dept.test' });
  assert.equal(unknown.status, 200);
  assert.equal(sent.filter(m => m.kind === 'reset').length, 0);

  // real email: 200 and a reset link is queued
  const req = await post(base, '/api/auth/reset/request', { email: 'reset@dept.test' });
  assert.equal(req.status, 200);
  const mail = sent.find(m => m.kind === 'reset' && m.to === 'reset@dept.test');
  assert.ok(mail, 'a reset email was queued');

  // consume the link → new password, fresh session cookie, old session revoked
  const done = await post(base, '/api/auth/reset', { token: linkToken(mail.link), password: 'brandnewpw2' });
  assert.equal(done.status, 200);
  const newCookie = done.headers.get('set-cookie')?.split(';')[0];
  assert.ok(newCookie);
  assert.equal((await fetch(`${base}/api/me`, { headers: { cookie: oldCookie } }).then(r => r.json())), null);
  assert.equal((await fetch(`${base}/api/me`, { headers: { cookie: newCookie } }).then(r => r.json())).email, 'reset@dept.test');

  // old password no longer works; new one does
  const oldLogin = await post(base, '/api/login', { email: 'reset@dept.test', password: 'originalpw1' });
  assert.equal(oldLogin.status, 401);
  const newLogin = await post(base, '/api/login', { email: 'reset@dept.test', password: 'brandnewpw2' });
  assert.equal(newLogin.status, 200);

  // reset token is single-use and short passwords are rejected
  const replay = await post(base, '/api/auth/reset', { token: linkToken(mail.link), password: 'anotherpw3' });
  assert.equal(replay.status, 400);
});

test('reset rejects a too-short password before consuming the token', async () => {
  const { } = await signup(base, { email: 'shortpw@dept.test', display_name: 'Sam' });
  await post(base, '/api/auth/reset/request', { email: 'shortpw@dept.test' });
  const mail = sent.find(m => m.kind === 'reset' && m.to === 'shortpw@dept.test');
  const weak = await post(base, '/api/auth/reset', { token: linkToken(mail.link), password: 'short' });
  assert.equal(weak.status, 400);
  // token still usable afterward since it was rejected before consumption
  const ok = await post(base, '/api/auth/reset', { token: linkToken(mail.link), password: 'longenough9' });
  assert.equal(ok.status, 200);
});

test('resend verification for a logged-in user; no-op once verified', async () => {
  const { cookie } = await signup(base, { email: 'resend@dept.test', display_name: 'Ren' });
  sent.length = 0;
  const r1 = await fetch(`${base}/api/auth/verify/request`, { method: 'POST', headers: { cookie } }).then(r => r.json());
  assert.equal(r1.ok, true);
  const mail = sent.find(m => m.kind === 'verify' && m.to === 'resend@dept.test');
  assert.ok(mail);

  await post(base, '/api/auth/verify', { token: linkToken(mail.link) });
  sent.length = 0;
  const r2 = await fetch(`${base}/api/auth/verify/request`, { method: 'POST', headers: { cookie } }).then(r => r.json());
  assert.equal(r2.already_verified, true);
  assert.equal(sent.length, 0);

  // request without auth is rejected
  const anon = await fetch(`${base}/api/auth/verify/request`, { method: 'POST' });
  assert.equal(anon.status, 401);
});
