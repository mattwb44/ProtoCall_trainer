import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io as ioc } from 'socket.io-client';
import { buildServer } from '../server/index.js';
import { signup, authed, emit, once } from './helpers.js';

// Phase 3 host live view: the host gets a named crew roster with per-participant,
// per-stage completion (measured against each participant's role-intersection
// visible set), pushed live on join/answer/shift/boot; and can boot a
// participant, invalidating their token (a rejoin is refused, not just dropped).

let ctx, base;

before(async () => {
  ctx = await buildServer({ dbFile: ':memory:', authRateMax: 1000 });
  await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${ctx.app.server.address().port}`;
});
after(async () => { ctx.io.close(); await ctx.app.close(); });

// Two stages; a Firefighter sees Common + FF (both in Size-Up), a Medic sees
// Common (Size-Up) + Medic (Attack).
async function hostedRoom() {
  const { cookie } = await signup(base, { email: `host${Math.random()}@roster.test`, display_name: 'Cap Ahab' });
  const { id } = await fetch(`${base}/api/scenarios`, {
    method: 'POST', headers: authed(cookie),
    body: JSON.stringify({
      title: 'Roster fixture', description: 'd', category: 'Fire', subcategory: 'Structure', visibility: 'public',
      objective_primary: 'Scene Size-Up',
      questions: [
        { prompt: 'Common?', kind: 'text', instructor_answer: 'CA', stage: 'Size-Up' },
        { prompt: 'FF?', kind: 'text', instructor_answer: 'FA', roles: ['Firefighter'] },
        { prompt: 'Medic?', kind: 'text', instructor_answer: 'MA', roles: ['Medic'], stage: 'Attack' },
      ],
    }),
  }).then(r => r.json());
  const { room_code } = await fetch(`${base}/api/sessions`, {
    method: 'POST', headers: authed(cookie), body: JSON.stringify({ scenario_id: id }),
  }).then(r => r.json());
  return { room_code, hostCookie: cookie };
}

test('host roster: named entry, role-intersection totals, per-stage breakdown', async () => {
  const { room_code, hostCookie } = await hostedRoom();
  const host = ioc(base, { extraHeaders: { cookie: hostCookie } });
  const crew = ioc(base, { extraHeaders: { cookie: hostCookie } }); // signed-in crew → named
  try {
    await emit(host, 'join_room', { code: room_code, role: 'host' });
    const rosterP = once(host, 'roster');
    await emit(crew, 'join_room', { code: room_code, token: 'ff-tok', role: 'participant', roles: ['Firefighter'] });
    const roster = await rosterP;
    assert.equal(roster.length, 1);
    const [p] = roster;
    assert.equal(p.name, 'Cap Ahab');          // signed-in → display_name
    assert.deepEqual(p.roles, ['Firefighter']);
    assert.equal(p.total, 2);                    // Common + FF, not the Medic question
    assert.equal(p.done, 0);
    assert.equal(p.connected, true);
    // stages: Size-Up has both visible questions, Attack has none for a firefighter
    const sizeUp = p.stages.find(s => s.stage === 'Size-Up');
    const attack = p.stages.find(s => s.stage === 'Attack');
    assert.deepEqual([sizeUp.total, sizeUp.done], [2, 0]);
    assert.deepEqual([attack.total, attack.done], [0, 0]);
  } finally { host.close(); crew.close(); }
});

test('roster is pushed to the host as completion advances', async () => {
  const { room_code, hostCookie } = await hostedRoom();
  const host = ioc(base, { extraHeaders: { cookie: hostCookie } });
  const crew = ioc(base);
  try {
    await emit(host, 'join_room', { code: room_code, role: 'host' });
    const j = await emit(crew, 'join_room', { code: room_code, token: 'p1', role: 'participant', roles: ['Firefighter'] });
    assert.equal(j.participant.display_tag, 'P1');
    const rosterP = once(host, 'roster');
    await emit(crew, 'submit_response', { question_id: j.state.questions[0].id, body: 'x' });
    const roster = await rosterP;
    assert.equal(roster[0].name, 'P1'); // guest → display_tag as the roster name
    assert.equal(roster[0].done, 1);
    assert.equal(roster[0].total, 2);
  } finally { host.close(); crew.close(); }
});

test('boot: token invalidated (rejoin refused), participant dropped and removed from roster', async () => {
  const { room_code, hostCookie } = await hostedRoom();
  const host = ioc(base, { extraHeaders: { cookie: hostCookie } });
  const crew = ioc(base);
  try {
    await emit(host, 'join_room', { code: room_code, role: 'host' });
    const rosterJoin = once(host, 'roster');
    const j = await emit(crew, 'join_room', { code: room_code, token: 'boot-me', role: 'participant', roles: ['Firefighter'] });
    await rosterJoin;
    const pid = j.participant.id;

    const bootedSignal = once(crew, 'booted');
    const rosterAfter = once(host, 'roster');
    const res = await emit(host, 'boot_participant', { participant_id: pid });
    assert.equal(res.ok, true);
    await bootedSignal;                 // the booted client is told
    const roster = await rosterAfter;
    assert.equal(roster.length, 0);     // gone from the roster

    // a rejoin with the same (now-dead) token is refused
    const crew2 = ioc(base);
    try {
      const rejoin = await emit(crew2, 'join_room', { code: room_code, token: 'boot-me', role: 'participant', roles: ['Firefighter'] });
      assert.match(rejoin.error, /removed/i);
    } finally { crew2.close(); }
  } finally { host.close(); crew.close(); }
});

test('only the host can boot', async () => {
  const { room_code } = await hostedRoom();
  const a = ioc(base), b = ioc(base);
  try {
    const ja = await emit(a, 'join_room', { code: room_code, token: 'a', role: 'participant' });
    await emit(b, 'join_room', { code: room_code, token: 'b', role: 'participant' });
    const res = await emit(b, 'boot_participant', { participant_id: ja.participant.id });
    assert.equal(res.error, 'host only');
  } finally { a.close(); b.close(); }
});
