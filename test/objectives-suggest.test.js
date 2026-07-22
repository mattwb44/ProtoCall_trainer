import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../server/index.js';
import { signup, authed } from './helpers.js';
import { suggestObjectives } from '../server/objectives-suggest.js';

// Track C: the rule-based, corpus-seeded objective suggester — local, no
// external AI, and explainable (it reports the words that triggered each hit).

test('suggester matches domain vocabulary and ranks by hit count', () => {
  const text = 'Heavy turbulent smoke pushing from the eaves; stretch an attack line for an interior fire attack and knock down the seat of the fire.';
  const sugg = suggestObjectives(text);
  const names = sugg.map(s => s.objective);
  assert.ok(names.includes('Reading Smoke'), 'reads smoke keywords');
  assert.ok(names.includes('Fire Attack'), 'reads fire-attack keywords');
  // explainable: every suggestion carries the phrases that matched
  const fa = sugg.find(s => s.objective === 'Fire Attack');
  assert.ok(fa.matches.length >= 1 && fa.matches.every(m => text.toLowerCase().includes(m)));
  // ranked by distinct hits, descending
  for (let i = 1; i < sugg.length; i++) assert.ok(sugg[i - 1].matches.length >= sugg[i].matches.length);
});

test('word-boundary matching avoids false hits', () => {
  // "par" (a Communications keyword) must not fire inside "apparatus"
  const sugg = suggestObjectives('Apparatus placement on arrival.');
  const comms = sugg.find(s => s.objective === 'Communications');
  assert.ok(!comms || !comms.matches.includes('par'), 'no substring false-positive');
  assert.ok(sugg.some(s => s.objective === 'Apparatus Placement'), 'real keyword still matches');
});

test('allowedNames scopes suggestions to a category', () => {
  const text = 'chest pain, 12-lead shows a STEMI; also heavy smoke showing.';
  const all = suggestObjectives(text).map(s => s.objective);
  assert.ok(all.includes('Cardiac Care') && all.includes('Reading Smoke'));
  const emsOnly = suggestObjectives(text, ['Cardiac Care', 'Airway Management']).map(s => s.objective);
  assert.deepEqual(emsOnly, ['Cardiac Care'], 'only allowed names returned');
});

let ctx, base;
before(async () => {
  ctx = await buildServer({ dbFile: ':memory:', authRateMax: 1000 });
  await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${ctx.app.server.address().port}`;
});
after(async () => { ctx.io.close(); await ctx.app.close(); });

test('suggest endpoint requires auth and scopes to the category', async () => {
  const anon = await fetch(`${base}/api/objectives/suggest`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'smoke' }),
  });
  assert.equal(anon.status, 401);

  const { cookie } = await signup(base, { email: 'sugg@obj.test' });
  const res = await fetch(`${base}/api/objectives/suggest`, {
    method: 'POST', headers: authed(cookie),
    body: JSON.stringify({ text: 'primary search for a trapped victim; coordinated ventilation', category: 'Fireground' }),
  }).then(r => r.json());
  const names = res.suggestions.map(s => s.objective);
  assert.ok(names.includes('Search') && names.includes('Ventilation'));
  // category scoping: an EMS-only objective never appears for a Fireground draft
  assert.ok(!names.includes('Airway Management'));
});
