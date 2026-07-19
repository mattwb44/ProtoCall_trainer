// Nightly on-volume database backups.
//
// Decision (docs/ai/decisions.md → Backups): the reliable baseline is an
// in-app nightly snapshot, not Railway volume snapshots. better-sqlite3's
// online `db.backup()` produces a point-in-time-consistent copy while the app
// is live; it's free on any Railway plan and testable. Railway volume
// snapshots (where available) are welcome defense-in-depth on top, not the
// primary mechanism.
//
// Caveat kept honest: these land on the same volume as the live DB, so they
// survive an app crash / bad deploy / accidental row deletion but NOT loss of
// the volume itself. The offsite copy is the existing on-demand pull
// (`GET /api/admin/backup`); an automated offsite sync is a later ops task.

import fs from 'node:fs';
import path from 'node:path';

const DAY_MS = 24 * 60 * 60 * 1000;
const FILE_RE = /^protocall-.*\.db$/;

// Sorts chronologically because the timestamp is a fixed-width ISO prefix.
function listBackups(dir) {
  try {
    return fs.readdirSync(dir).filter(f => FILE_RE.test(f)).sort();
  } catch {
    return [];
  }
}

// Keep the newest `keep` snapshots; delete the rest.
function rotate(dir, keep) {
  const files = listBackups(dir);
  for (const f of files.slice(0, Math.max(0, files.length - keep))) {
    fs.rmSync(path.join(dir, f), { force: true });
  }
}

// Write one consistent snapshot into `dir`, then rotate. Returns the path.
export async function runBackup(db, dir, { keep = 14, now = () => new Date() } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const stamp = now().toISOString().replace(/[:.]/g, '-').slice(0, 19); // 2026-07-19T02-30-00
  const dest = path.join(dir, `protocall-${stamp}.db`);
  await db.backup(dest);
  rotate(dir, keep);
  return dest;
}

// True when there's no snapshot yet, or the newest one is at least one interval
// old. Lets the app catch up after downtime without spamming a backup on every
// redeploy.
function isStale(dir, intervalMs, now) {
  const files = listBackups(dir);
  if (!files.length) return true;
  try {
    const newest = path.join(dir, files[files.length - 1]);
    return now().getTime() - fs.statSync(newest).mtimeMs >= intervalMs;
  } catch {
    return true;
  }
}

// Start the recurring backup. Returns { stop, runOnce }. The interval is
// unref'd so it never keeps the process (or a test) alive on its own.
export function startBackupScheduler(db, {
  dir, intervalMs = DAY_MS, keep = 14, now = () => new Date(), log = console,
} = {}) {
  // Serialize: a slow backup that outruns the interval (or the boot catch-up
  // overlapping the first tick) must not start a second concurrent snapshot.
  let inFlight = null;
  const runOnce = () => {
    if (inFlight) return inFlight;
    inFlight = runBackup(db, dir, { keep, now })
      .then(dest => { log.log?.(`DB backup written: ${dest}`); return dest; })
      .catch(err => { log.error?.(`DB backup failed: ${err.message}`); })
      .finally(() => { inFlight = null; });
    return inFlight;
  };
  if (isStale(dir, intervalMs, now)) runOnce();
  const timer = setInterval(runOnce, intervalMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer), runOnce };
}
