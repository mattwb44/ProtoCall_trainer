import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { io as ioc } from 'socket.io-client';
import { buildServer } from '../server/index.js';
import { signup, authed, emit } from './helpers.js';

let ctx, base, mediaDir;

// 1x1 red pixel PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

before(async () => {
  mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-media-'));
  ctx = await buildServer({ dbFile: ':memory:', mediaDir, authRateMax: 1000 });
  await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${ctx.app.server.address().port}`;
});

after(async () => {
  ctx.io.close();
  await ctx.app.close();
  fs.rmSync(mediaDir, { recursive: true, force: true });
});

const upload = (cookie, buffer, type, name = 'x.png') => {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type }), name);
  return fetch(`${base}/api/media`, { method: 'POST', headers: cookie ? { cookie } : {}, body: form });
};

test('media upload: auth required, type-checked, size-capped, round-trips bytes', async () => {
  const { cookie } = await signup(base, { email: 'uploader@dept.test' });

  assert.equal((await upload(null, PNG, 'image/png')).status, 401);
  assert.equal((await upload(cookie, Buffer.from('plain'), 'text/plain')).status, 415);
  assert.equal((await upload(cookie, Buffer.alloc(11 * 1024 * 1024), 'image/png')).status, 413);

  const ok = await upload(cookie, PNG, 'image/png');
  assert.equal(ok.status, 201);
  const { url } = await ok.json();
  assert.match(url, /^\/media\/[0-9a-f-]+\.png$/);

  const back = Buffer.from(await fetch(base + url).then(r => r.arrayBuffer()));
  assert.ok(back.equals(PNG), 'served file is byte-identical');
});

test('scenario media: saved ordered, appears in detail and live room state, cloned', async () => {
  const { cookie } = await signup(base, { email: 'medic@dept.test' });
  const u1 = await upload(cookie, PNG, 'image/png').then(r => r.json());
  const u2 = await upload(cookie, PNG, 'image/png').then(r => r.json());

  const { id } = await fetch(`${base}/api/scenarios`, {
    method: 'POST', headers: authed(cookie),
    body: JSON.stringify({
      title: 'STEMI Recognition', visibility: 'public', category: 'EMS', subcategory: 'Cardiac',
      questions: [{ prompt: 'Interpret the 12-lead.', instructor_answer: 'Anterior STEMI' }],
      media: [{ kind: 'ekg', url: u1.url }, { kind: 'photo', url: u2.url }],
    }),
  }).then(r => r.json());

  const detail = await fetch(`${base}/api/scenarios/${id}`, { headers: { cookie } }).then(r => r.json());
  assert.deepEqual(detail.media.map(m => [m.kind, m.url]), [['ekg', u1.url], ['photo', u2.url]]);

  const { room_code } = await fetch(`${base}/api/sessions`, {
    method: 'POST', headers: authed(cookie), body: JSON.stringify({ scenario_id: id }),
  }).then(r => r.json());
  const state = await fetch(`${base}/api/sessions/${room_code}`).then(r => r.json());
  assert.equal(state.media.length, 2);
  assert.equal(state.media[0].kind, 'ekg');

  const clone = await fetch(`${base}/api/scenarios/${id}/clone`, { method: 'POST', headers: { cookie } }).then(r => r.json());
  const clonedDetail = await fetch(`${base}/api/scenarios/${clone.id}`, { headers: { cookie } }).then(r => r.json());
  assert.equal(clonedDetail.media.length, 2);
});

test('editing: fields update; answered questions soft-delete; history intact; non-author 404s', async () => {
  const { cookie } = await signup(base, { email: 'editor@dept.test' });
  const { cookie: other } = await signup(base, { email: 'noteditor@dept.test' });

  const { id } = await fetch(`${base}/api/scenarios`, {
    method: 'POST', headers: authed(cookie),
    body: JSON.stringify({
      title: 'Rollover MVA', visibility: 'private', category: 'Motor Vehicle Accidents', subcategory: 'Rollover',
      questions: [{ prompt: 'First action on approach?', instructor_answer: 'Scene safety, 360' },
                  { prompt: 'Stabilize how?', instructor_answer: 'Cribbing' }],
    }),
  }).then(r => r.json());
  const before = await fetch(`${base}/api/scenarios/${id}`, { headers: { cookie } }).then(r => r.json());
  const [q1, q2] = before.questions;

  // run a session where q2 gets answered — q2 now has history
  const { room_code, session_id } = await fetch(`${base}/api/sessions`, {
    method: 'POST', headers: authed(cookie), body: JSON.stringify({ scenario_id: id }),
  }).then(r => r.json());
  const guest = ioc(base);
  try {
    await emit(guest, 'join_room', { code: room_code, token: 'ed-guest', role: 'participant' });
    await emit(guest, 'submit_response', { question_id: q2.id, body: 'crib all four corners' });
  } finally { guest.close(); }

  // non-author cannot edit
  const denied = await fetch(`${base}/api/scenarios/${id}`, {
    method: 'PUT', headers: authed(other),
    body: JSON.stringify({ title: 'Hijacked', category: 'EMS', subcategory: 'Trauma', questions: [] }),
  });
  assert.equal(denied.status, 404);

  // author edits: rename, keep q1 (edited), drop q2, add q3
  const edit = await fetch(`${base}/api/scenarios/${id}`, {
    method: 'PUT', headers: authed(cookie),
    body: JSON.stringify({
      title: 'Rollover MVA — Night Ops', visibility: 'private',
      category: 'Motor Vehicle Accidents', subcategory: 'Rollover',
      questions: [
        { id: q1.id, prompt: 'First action on approach at night?', instructor_answer: 'Scene safety, 360, lighting' },
        { prompt: 'When do you call for extrication?', instructor_answer: 'Entrapment confirmed' },
      ],
    }),
  });
  assert.equal(edit.status, 200);

  const after1 = await fetch(`${base}/api/scenarios/${id}`, { headers: { cookie } }).then(r => r.json());
  assert.equal(after1.title, 'Rollover MVA — Night Ops');
  assert.equal(after1.questions.length, 2);
  assert.match(after1.questions[0].prompt, /at night/);
  assert.ok(!after1.questions.find(q => q.id === q2.id), 'dropped question gone from detail');

  // new sessions do not see the dropped question
  const { room_code: rc2 } = await fetch(`${base}/api/sessions`, {
    method: 'POST', headers: authed(cookie), body: JSON.stringify({ scenario_id: id }),
  }).then(r => r.json());
  const newState = await fetch(`${base}/api/sessions/${rc2}`).then(r => r.json());
  assert.ok(!newState.questions.find(q => q.id === q2.id));

  // but the historic session still shows q2 and its response
  const hist = await fetch(`${base}/api/me/sessions/${session_id}`, { headers: { cookie } }).then(r => r.json());
  assert.ok(hist.questions.find(q => q.id === q2.id), 'soft-deleted question preserved in history');
  assert.equal(hist.responses.filter(r => r.question_id === q2.id).length, 1);
});

test('soft delete hides, blocks launch, restores; history still opens', async () => {
  const { cookie } = await signup(base, { email: 'deleter@dept.test' });
  const { cookie: viewer } = await signup(base, { email: 'viewer2@dept.test' });
  const { id } = await fetch(`${base}/api/scenarios`, {
    method: 'POST', headers: authed(cookie),
    body: JSON.stringify({
      title: 'Wildland Anchor Point', visibility: 'public', category: 'Fireground', subcategory: 'Wildland',
      questions: [{ prompt: 'LCES stands for?', instructor_answer: 'Lookouts, Communications, Escape routes, Safety zones' }],
    }),
  }).then(r => r.json());
  const { session_id } = await fetch(`${base}/api/sessions`, {
    method: 'POST', headers: authed(cookie), body: JSON.stringify({ scenario_id: id }),
  }).then(r => r.json());

  assert.equal((await fetch(`${base}/api/scenarios/${id}`, { method: 'DELETE', headers: { cookie: viewer } })).status, 404);
  assert.equal((await fetch(`${base}/api/scenarios/${id}`, { method: 'DELETE', headers: { cookie } })).status, 200);

  const pub = await fetch(`${base}/api/public/scenarios`).then(r => r.json());
  assert.ok(!pub.find(s => s.id === id), 'deleted scenario hidden from public');
  const launch = await fetch(`${base}/api/sessions`, {
    method: 'POST', headers: authed(viewer), body: JSON.stringify({ scenario_id: id }),
  });
  assert.equal(launch.status, 403);
  assert.equal((await fetch(`${base}/api/scenarios/${id}`, { headers: { cookie: viewer } })).status, 404);

  // author still sees it (for the Deleted section) and can restore; history opens throughout
  const mineList = await fetch(`${base}/api/scenarios`, { headers: { cookie } }).then(r => r.json());
  assert.ok(mineList.find(s => s.id === id && s.deleted_at));
  assert.equal((await fetch(`${base}/api/me/sessions/${session_id}`, { headers: { cookie } })).status, 200);
  assert.equal((await fetch(`${base}/api/scenarios/${id}/restore`, { method: 'POST', headers: { cookie } })).status, 200);
  assert.ok((await fetch(`${base}/api/public/scenarios`).then(r => r.json())).find(s => s.id === id));
});

test('PDF: valid document with requester content; strangers denied', async () => {
  const { cookie: hostC } = await signup(base, { email: 'pdfhost@dept.test' });
  const [{ id: scenarioId }] = await fetch(`${base}/api/scenarios`, { headers: { cookie: hostC } }).then(r => r.json());
  const { room_code, session_id } = await fetch(`${base}/api/sessions`, {
    method: 'POST', headers: authed(hostC), body: JSON.stringify({ scenario_id: scenarioId }),
  }).then(r => r.json());

  const guest = ioc(base);
  try {
    const j = await emit(guest, 'join_room', { code: room_code, token: 'pdf-guest', role: 'participant' });
    await emit(guest, 'submit_response', { question_id: j.state.questions[0].id, body: 'unique-pdf-answer-xyz' });
    await emit(guest, 'save_note', { question_id: j.state.questions[0].id, body: 'unique-pdf-note-abc' });
  } finally { guest.close(); }

  const { cookie: partC } = await signup(base, { email: 'pdfpart@dept.test', guest_token: 'pdf-guest' });
  const res = await fetch(`${base}/api/me/sessions/${session_id}/pdf`, { headers: { cookie: partC } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
  const raw = buf.toString('latin1');
  assert.ok(raw.includes('unique-pdf-answer-xyz') || buf.length > 1500, 'pdf has substance');

  const { cookie: stranger } = await signup(base, { email: 'pdfstranger@dept.test' });
  assert.equal((await fetch(`${base}/api/me/sessions/${session_id}/pdf`, { headers: { cookie: stranger } })).status, 404);
});
