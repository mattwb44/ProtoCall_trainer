#!/usr/bin/env node
// Seed approved content drafts into a running ProtoCall instance via the API.
//
// Usage:
//   SEED_EMAIL=you@example.com SEED_PASSWORD=... node scripts/seed-content.js [--dry-run] [--base URL] [--submit] [dir]
//
// --submit: after creating each scenario, submit it for official review so it
// lands in the in-app review queue (#/review) — the PRD-v8 content-intake flow.
//
// Defaults: dir = content/approved, base = http://localhost:3000.
// Parses the draft markdown format defined in
// ~/engineering-os/knowledge/fire-service/scenario-authoring-template.md:
//   front matter between --- lines, `## Stage: NAME` headings, questions as
//   `N. [track] (kind) prompt...` with `> Model answer: ...` blocks.
// Scenarios are created public. Idempotence: a scenario whose title already
// exists on the server (any visibility you can see) is skipped.

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const submit = args.includes('--submit');
const update = args.includes('--update');
const baseIx = args.indexOf('--base');
const BASE = baseIx >= 0 ? args[baseIx + 1] : 'http://localhost:3000';
const dir = args.filter(a => !a.startsWith('--') && a !== BASE).pop() ?? 'content/approved';

function parseDraft(file) {
  const text = fs.readFileSync(file, 'utf8');
  const fm = text.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) throw new Error(`${file}: missing front matter`);
  const meta = {};
  for (const line of fm[1].split('\n')) {
    const m = line.match(/^(\w+):\s*(.*)$/);
    if (m) meta[m[1]] = m[2].trim();
  }
  for (const req of ['title', 'category', 'subcategory']) {
    if (!meta[req]) throw new Error(`${file}: front matter missing ${req}`);
  }

  const body = text.slice(fm[0].length);
  const questions = [];
  let stage = '';
  let current = null;
  // Intro prose between the front matter and the first stage/question is the
  // dispatch description (drafts write it as body text, not a front-matter key).
  const introLines = [];
  let introDone = false;
  const flush = () => { if (current) { questions.push(current); current = null; } };

  for (const raw of body.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    const stageM = line.match(/^## Stage:\s*(.+)$/);
    if (stageM) { introDone = true; flush(); stage = stageM[1].trim(); continue; }
    const qM = line.match(/^\d+\.\s+\[(\w*)\]\s+\((\w+)\)\s+(.*)$/);
    if (qM) {
      introDone = true;
      flush();
      current = {
        stage,
        role_track: qM[1].toLowerCase() === 'common' ? '' : qM[1],
        kind: qM[2],
        promptLines: [qM[3]],
        answerLines: [],
        inAnswer: false,
      };
      continue;
    }
    if (!current) {
      if (!introDone && line.trim()) introLines.push(line.trim());
      continue;
    }
    const ansM = line.match(/^\s*>\s?(.*)$/);
    if (ansM) {
      current.inAnswer = true;
      current.answerLines.push(ansM[1].replace(/^Model answer:\s*/, ''));
    } else if (line.trim() === '') {
      // blank line ends nothing; question blocks are separated by the next marker
    } else if (!current.inAnswer) {
      current.promptLines.push(line.trim());
    }
  }
  flush();

  const qs = questions.map(q => ({
    prompt: q.promptLines.join(' ').trim(),
    kind: q.kind,
    instructor_answer: q.answerLines.join(' ').trim(),
    role_track: q.role_track,
    stage: q.stage,
  }));
  if (qs.length === 0) throw new Error(`${file}: no questions parsed`);

  return {
    title: meta.title,
    description: meta.description ?? introLines.join(' ').trim(),
    category: meta.category,
    subcategory: meta.subcategory,
    visibility: process.env.SEED_VISIBILITY ?? 'private', // review first, publish after approval

    objective_primary: meta.objective_primary ?? '',
    objective_secondary: meta.objective_secondary ?? '',
    difficulty: meta.difficulty ?? '',
    duration_min: meta.duration_min ? Number(meta.duration_min) : null,
    building_type: meta.building_type ?? '',
    questions: qs,
  };
}

async function main() {
  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.md') && f !== 'README.md')
    .sort()
    .map(f => path.join(dir, f));
  if (files.length === 0) { console.log(`nothing to seed in ${dir}`); return; }

  const drafts = files.map(f => ({ file: f, data: parseDraft(f) }));
  for (const d of drafts) {
    console.log(`${d.file}: "${d.data.title}" — ${d.data.questions.length} questions, ` +
      `${new Set(d.data.questions.map(q => q.stage)).size} stages, ` +
      `tracks: ${[...new Set(d.data.questions.map(q => q.role_track || 'common'))].join('/')}, ` +
      `desc: ${d.data.description ? d.data.description.length + ' chars' : 'MISSING'}`);
  }
  if (dryRun) { console.log('\n--dry-run: no requests made'); return; }

  const email = process.env.SEED_EMAIL, password = process.env.SEED_PASSWORD;
  if (!email || !password) { console.error('SEED_EMAIL and SEED_PASSWORD required'); process.exit(1); }

  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!login.ok) { console.error(`login failed: ${login.status} ${await login.text()}`); process.exit(1); }
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
  if (!cookie) { console.error('no session cookie returned'); process.exit(1); }

  const existing = await (await fetch(`${BASE}/api/scenarios`, { headers: { cookie } })).json();
  const byTitle = new Map((Array.isArray(existing) ? existing : existing.scenarios ?? [])
    .filter(s => s.mine !== false)
    .map(s => [s.title, s.id]));

  for (const d of drafts) {
    const existingId = byTitle.get(d.data.title);
    if (existingId && !update) { console.log(`skip (exists): ${d.data.title}`); continue; }
    // --update: PUT the parsed content over the existing scenario (overwrites
    // questions too — re-run only before you've hand-edited in the app).
    const res = existingId
      ? await fetch(`${BASE}/api/scenarios/${existingId}`, {
          method: 'PUT', headers: { 'content-type': 'application/json', cookie },
          body: JSON.stringify(d.data),
        })
      : await fetch(`${BASE}/api/scenarios`, {
          method: 'POST', headers: { 'content-type': 'application/json', cookie },
          body: JSON.stringify(d.data),
        });
    if (!res.ok) { console.error(`FAILED ${d.file}: ${res.status} ${await res.text()}`); continue; }
    if (existingId) { console.log(`updated: ${d.data.title}`); continue; }
    const { id } = await res.json();
    if (submit) {
      const sub = await fetch(`${BASE}/api/scenarios/${id}/submit-review`, { method: 'POST', headers: { cookie } });
      console.log(sub.ok ? `seeded + submitted for review: ${d.data.title}`
        : `seeded (submit failed ${sub.status}): ${d.data.title}`);
    } else console.log(`seeded: ${d.data.title}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
