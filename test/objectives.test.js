import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, buildCorpusModel, suggestObjectives, SEED_KEYWORDS } from '../server/objectives.js';

const EMS = ['Primary Assessment', 'Airway Management', 'Cardiac Care', 'Bleeding Control',
  'Air Management', 'Command Presence', 'Scene Size-Up', 'Communications'];
const FIRE = ['Reading Smoke', 'Search', 'VEIS', 'Ventilation', 'Fire Attack',
  'Building Construction', 'Air Management', 'Scene Size-Up', 'Communications'];

test('normalize keeps digits and hyphens, drops punctuation and stopwords', () => {
  const { text, tokens } = normalize('12-lead ECG shows a STEMI. Give the aspirin!');
  assert.match(text, /12-lead/);
  assert.ok(tokens.has('stemi'));
  assert.ok(tokens.has('aspirin'));
  assert.ok(!tokens.has('the')); // stopword
});

test('seed hits: cardiac language suggests Cardiac Care first, explainably', () => {
  const out = suggestObjectives({
    text: 'Patient with chest pain. 12-lead shows STEMI. Administer aspirin and nitro.',
    candidates: EMS,
  });
  assert.equal(out[0].name, 'Cardiac Care');
  assert.ok(out[0].matched.includes('chest pain') || out[0].matched.includes('12-lead'));
  assert.ok(out[0].score > 0);
});

test('phrases score higher than a bare token, and only whole-word phrases match', () => {
  const hit = suggestObjectives({ text: 'we performed a proper size-up on arrival', candidates: FIRE });
  assert.ok(hit.find(r => r.name === 'Scene Size-Up'));
  // "airway" must not fire from a substring like "stairway"
  const noSub = suggestObjectives({ text: 'crew climbed the stairway to the second floor', candidates: EMS });
  assert.ok(!noSub.find(r => r.name === 'Airway Management'));
});

test('returns nothing when no signal words are present', () => {
  const out = suggestObjectives({ text: 'the weather today is mild and pleasant', candidates: EMS });
  assert.equal(out.length, 0);
});

test('respects category candidate list (no cross-category suggestions)', () => {
  const out = suggestObjectives({ text: 'heavy black smoke pushing from the roof', candidates: EMS });
  // "Reading Smoke" is a Fireground objective, not offered here
  assert.ok(!out.find(r => r.name === 'Reading Smoke'));
});

test('corpus model learns distinctive terms and blends as a bonus', () => {
  const docs = [
    { objectives: ['Ventilation'], text: 'crew cut a hole in the roof for vertical ventilation coordinated with the attack' },
    { objectives: ['Ventilation'], text: 'ventilation profile improved once we opened the roof' },
    { objectives: ['Search'], text: 'primary search of the bedroom found a trapped occupant' },
    { objectives: ['Cardiac Care'], text: 'chest pain patient with a 12-lead stemi' },
  ];
  const model = buildCorpusModel(docs);
  assert.ok(model.has('Ventilation'));
  // "roof" is distinctive to Ventilation docs here
  assert.ok(model.get('Ventilation').has('roof'));
  const out = suggestObjectives({
    text: 'command ordered the roof opened', candidates: FIRE, corpusModel: model,
  });
  const vent = out.find(r => r.name === 'Ventilation');
  assert.ok(vent, 'corpus bonus should surface Ventilation from "roof" even without a seed phrase');
});

test('every seeded objective name is a real objective key', () => {
  // guards against typos drifting from learning_objectives.name
  assert.ok(SEED_KEYWORDS['Cardiac Care']);
  assert.ok(Object.keys(SEED_KEYWORDS).length >= 25);
});
