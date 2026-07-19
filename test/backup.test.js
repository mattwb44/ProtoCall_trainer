import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDb } from '../server/db.js';
import { runBackup, startBackupScheduler } from '../server/backup.js';

const dirs = [];
const freshDir = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'protocall-bak-'));
  dirs.push(d);
  return d;
};
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

test('runBackup writes a valid, openable sqlite snapshot', async () => {
  const dir = freshDir();
  const db = createDb(':memory:');
  const dest = await runBackup(db, dir);
  const buf = fs.readFileSync(dest);
  assert.equal(buf.subarray(0, 16).toString('latin1'), 'SQLite format 3\x00');
  // The snapshot opens as a real DB and carries the seeded controlled vocabulary.
  const snap = createDb(dest);
  assert.ok(snap.prepare('SELECT COUNT(*) n FROM learning_objectives').get().n > 0);
  snap.close();
  db.close();
});

test('rotation keeps only the newest `keep` snapshots', async () => {
  const dir = freshDir();
  const db = createDb(':memory:');
  // Distinct timestamps so filenames sort and rotation is deterministic.
  const base = Date.UTC(2026, 0, 1);
  for (let i = 0; i < 5; i++) {
    await runBackup(db, dir, { keep: 3, now: () => new Date(base + i * 86400000) });
  }
  const files = fs.readdirSync(dir).filter(f => /^protocall-.*\.db$/.test(f)).sort();
  assert.equal(files.length, 3, 'only 3 retained');
  assert.match(files[0], /2026-01-03/, 'oldest retained is day 3, not day 1');
  db.close();
});

test('scheduler catches up on boot when no snapshot exists, then stops cleanly', async () => {
  const fresh = freshDir();
  const db = createDb(':memory:');
  const sched = startBackupScheduler(db, { dir: fresh, intervalMs: 60_000, log: {} });
  await sched.runOnce(); // in-flight guard means this awaits the boot-time backup
  assert.ok(fs.readdirSync(fresh).some(f => /^protocall-.*\.db$/.test(f)), 'a snapshot was written');
  sched.stop();
  db.close();
});
