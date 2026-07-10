import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io as ioc } from 'socket.io-client';
import { buildServer } from '../server/index.js';
import { signup, authed, emit } from './helpers.js';

// Mock analyzer: deterministic structured result derived from the real session data,
// so tests validate the full wire-through without any network call.
let analyzeCalls = 0;
const mockAnalyzer = {
  async analyzeSession({ responses, participants }) {
    analyzeCalls++;
    return {
      assessments: responses.map((r, i) => ({
        response_id: r.id,
        classification: i === 0 ? 'review' : 'aligned',
        rationale: i === 0 ? 'review this — possible safety concern' : 'matches model answer intent',
      })),
      participant_debriefs: participants.map(p => ({
        participant_id: p.id,
        debrief: `Good drill, ${p.display_tag}. Solid decision-making overall.`,
      })),
      crew_summary: 'Crew was broadly aligned; one answer flagged for instructor review.',
    };
  },
};

let ctx, base;

async function runSession(hostCookie, guestToken = `tok-${Math.random()}`) {
  const [{ id: scenarioId }] = await fetch(`${base}/api/scenarios`).then(r => r.json());
  const { room_code, session_id } = await fetch(`${base}/api/sessions`, {
    method: 'POST', headers: authed(hostCookie), body: JSON.stringify({ scenario_id: scenarioId }),
  }).then(r => r.json());
  const guest = ioc(base);
  const host = ioc(base, { extraHeaders: { cookie: hostCookie } });
  try {
    await emit(host, 'join_room', { code: room_code, token: 'host-tok', role: 'host' });
    const j = await emit(guest, 'join_room', { code: room_code, token: guestToken, role: 'participant' });
    await emit(guest, 'submit_response', { question_id: j.state.questions[0].id, body: 'push straight in through the front door' });
    await emit(guest, 'submit_response', { question_id: j.state.questions[1].id, body: '1¾-inch handline' });
    await emit(host, 'end_session', {});
    // background analysis is fire-and-forget; give it a beat
    await new Promise(r => setTimeout(r, 50));
  } finally { guest.close(); host.close(); }
  return { session_id, guestToken };
}

before(async () => {
  ctx = await buildServer({ dbFile: ':memory:', authRateMax: 1000, analyzer: mockAnalyzer });
  await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${ctx.app.server.address().port}`;
});
after(async () => { ctx.io.close(); await ctx.app.close(); });

test('session end auto-generates analysis; host sees drafts, generation is cached', async () => {
  const { cookie: hostCookie } = await signup(base, { email: 'aihost@dept.test' });
  const { session_id, guestToken } = await runSession(hostCookie);

  const detail = await fetch(`${base}/api/me/sessions/${session_id}`, { headers: { cookie: hostCookie } }).then(r => r.json());
  assert.equal(detail.analysis_available, true);
  assert.ok(detail.analysis, 'analysis generated in background on session end');
  assert.match(detail.analysis.crew_summary, /aligned/);
  assert.equal(detail.analysis.assessments[0].classification, 'review');
  assert.equal(detail.analysis.debriefs.length, 1);
  assert.equal(detail.analysis.debriefs[0].shared_at, null);

  // explicit re-generate is idempotent — no second model call
  const callsBefore = analyzeCalls;
  const again = await fetch(`${base}/api/me/sessions/${session_id}/analysis`, {
    method: 'POST', headers: { cookie: hostCookie } });
  assert.equal(again.status, 200);
  assert.equal(analyzeCalls, callsBefore);

  // participant claiming the session sees no draft
  const { cookie: partCookie } = await signup(base, { email: 'aipart@dept.test', guest_token: guestToken });
  const pDetail = await fetch(`${base}/api/me/sessions/${session_id}`, { headers: { cookie: partCookie } }).then(r => r.json());
  assert.equal(pDetail.my_debrief, undefined);
  assert.equal(pDetail.analysis, undefined, 'participants never see the instructor analysis');

  // host edits the draft, then shares; participant now sees the edited text
  const debriefId = detail.analysis.debriefs[0].id;
  const edit = await fetch(`${base}/api/me/sessions/${session_id}/debriefs/${debriefId}`, {
    method: 'PUT', headers: authed(hostCookie), body: JSON.stringify({ body: 'Edited by the instructor: nice work.' }),
  });
  assert.equal(edit.status, 200);
  const share = await fetch(`${base}/api/me/sessions/${session_id}/debriefs/share`, {
    method: 'POST', headers: authed(hostCookie), body: JSON.stringify({}),
  }).then(r => r.json());
  assert.equal(share.shared, 1);

  const pAfter = await fetch(`${base}/api/me/sessions/${session_id}`, { headers: { cookie: partCookie } }).then(r => r.json());
  assert.equal(pAfter.my_debrief.body, 'Edited by the instructor: nice work.');
  assert.ok(pAfter.my_debrief.shared_at);
});

test('access control: non-host 404s on analysis and share endpoints', async () => {
  const { cookie: hostCookie } = await signup(base, { email: 'aihost2@dept.test' });
  const { cookie: strangerCookie } = await signup(base, { email: 'aistranger@dept.test' });
  const { session_id } = await runSession(hostCookie);

  for (const [method, path, body] of [
    ['POST', `/api/me/sessions/${session_id}/analysis`, JSON.stringify({})],
    ['PUT', `/api/me/sessions/${session_id}/debriefs/xyz`, JSON.stringify({ body: 'x' })],
    ['POST', `/api/me/sessions/${session_id}/debriefs/share`, JSON.stringify({})],
  ]) {
    const res = await fetch(`${base}${path}`, { method, headers: authed(strangerCookie), body });
    assert.equal(res.status, 404, `${method} ${path}`);
  }
});

test('analysis failure degrades cleanly: session detail still works, endpoint reports 502', async () => {
  const failing = { analyzeSession: async () => { throw new Error('provider down'); } };
  const fctx = await buildServer({ dbFile: ':memory:', authRateMax: 1000, analyzer: failing });
  await fctx.app.listen({ port: 0, host: '127.0.0.1' });
  const fbase = `http://127.0.0.1:${fctx.app.server.address().port}`;
  try {
    const { cookie } = await signup(fbase, { email: 'failhost@dept.test' });
    const [{ id: scenarioId }] = await fetch(`${fbase}/api/scenarios`).then(r => r.json());
    const { room_code, session_id } = await fetch(`${fbase}/api/sessions`, {
      method: 'POST', headers: authed(cookie), body: JSON.stringify({ scenario_id: scenarioId }),
    }).then(r => r.json());
    const host = ioc(fbase, { extraHeaders: { cookie } }); const guest = ioc(fbase);
    try {
      await emit(host, 'join_room', { code: room_code, token: 'h', role: 'host' });
      const j = await emit(guest, 'join_room', { code: room_code, token: 'g', role: 'participant' });
      await emit(guest, 'submit_response', { question_id: j.state.questions[0].id, body: 'vent early' });
      await emit(host, 'end_session', {}); // background failure must not break anything
      await new Promise(r => setTimeout(r, 50));
    } finally { host.close(); guest.close(); }

    const detail = await fetch(`${fbase}/api/me/sessions/${session_id}`, { headers: { cookie } }).then(r => r.json());
    assert.equal(detail.session.status, 'ended');
    assert.equal(detail.analysis, null);

    const res = await fetch(`${fbase}/api/me/sessions/${session_id}/analysis`, { method: 'POST', headers: { cookie } });
    assert.equal(res.status, 502);
  } finally { fctx.io.close(); await fctx.app.close(); }
});

test('with no analyzer (no API key) the feature is dormant', async () => {
  const nctx = await buildServer({ dbFile: ':memory:', authRateMax: 1000, analyzer: null });
  await nctx.app.listen({ port: 0, host: '127.0.0.1' });
  const nbase = `http://127.0.0.1:${nctx.app.server.address().port}`;
  try {
    const { cookie } = await signup(nbase, { email: 'nokey@dept.test' });
    const [{ id: scenarioId }] = await fetch(`${nbase}/api/scenarios`).then(r => r.json());
    const { room_code, session_id } = await fetch(`${nbase}/api/sessions`, {
      method: 'POST', headers: authed(cookie), body: JSON.stringify({ scenario_id: scenarioId }),
    }).then(r => r.json());
    const host = ioc(nbase, { extraHeaders: { cookie } });
    try {
      await emit(host, 'join_room', { code: room_code, token: 'h', role: 'host' });
      await emit(host, 'end_session', {});
    } finally { host.close(); }

    const detail = await fetch(`${nbase}/api/me/sessions/${session_id}`, { headers: { cookie } }).then(r => r.json());
    assert.equal(detail.analysis_available, false);
    assert.equal(detail.analysis, null);
    const res = await fetch(`${nbase}/api/me/sessions/${session_id}/analysis`, { method: 'POST', headers: { cookie } });
    assert.equal(res.status, 503);
  } finally { nctx.io.close(); await nctx.app.close(); }
});
