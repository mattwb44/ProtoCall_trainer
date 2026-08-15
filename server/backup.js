// Nightly on-volume database backups.
//
// Decision (docs/ai/decisions.md → Backups): the reliable baseline is an
// in-app nightly snapshot, not Railway volume snapshots. better-sqlite3's
// online `db.backup()` produces a point-in-time-consistent copy while the app
// is live; it's free on any Railway plan and testable. Railway volume
// snapshots (where available) are welcome defense-in-depth on top, not the
// primary mechanism.
//
// These land on the same volume as the live DB, so on their own they survive an
// app crash / bad deploy / accidental row deletion but NOT loss of the volume.
// That gap is closed by server/offsite.js: after each successful local
// snapshot the scheduler PUTs it to S3-compatible object storage (R2 / B2 /
// S3), enabled only when the BACKUP_S3_* env vars are fully set. The offsite
// copy is strictly defence-in-depth — an upload failure is logged and never
// aborts or degrades the local backup. `GET /api/admin/backup` remains the
// on-demand manual pull.

import fs from 'node:fs';
import path from 'node:path';
import { createOffsiteUploaderFromEnv } from './offsite.js';
import { createMailer } from './mailer.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const OFFSITE_STALE_MS = 2 * DAY_MS; // 48h
const ALERT_COOLDOWN_MS = DAY_MS; // at most one freshness alert per 24h
const FILE_RE = /^protocall-.*\.db$/;

function readMeta(db, key) {
  return db.prepare('SELECT value FROM app_meta WHERE key=?').get(key)?.value ?? null;
}
function writeMeta(db, key, value) {
  db.prepare(`INSERT INTO app_meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(key, value);
}

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

// Offsite is defence-in-depth on top of the local snapshot, but a silently
// broken uploader (bad/rotated secret, bucket deleted) defeats that — so once
// it's configured, staleness has to reach the operator. Runs after every
// upload attempt (success or failure) so a stale condition is caught even
// when this cycle's own upload just failed. Never throws: a mailer outage
// must not take down the backup cycle.
async function checkOffsiteFreshness(db, { now, log, mailer, alertEmail }) {
  if (!alertEmail) return;
  const lastOkRaw = readMeta(db, 'last_offsite_ok');
  const lastOk = lastOkRaw ? new Date(lastOkRaw).getTime() : null;
  const stale = lastOk === null || now().getTime() - lastOk >= OFFSITE_STALE_MS;
  if (!stale) return;

  const lastAlertRaw = readMeta(db, 'last_offsite_alert');
  const lastAlert = lastAlertRaw ? new Date(lastAlertRaw).getTime() : null;
  if (lastAlert !== null && now().getTime() - lastAlert < ALERT_COOLDOWN_MS) return;

  try {
    const body = lastOkRaw
      ? `Last successful offsite backup upload: ${lastOkRaw}. Offsite backups are meant to run daily — check BACKUP_S3_* credentials and the bucket.`
      : 'No successful offsite backup upload has ever been recorded. Check BACKUP_S3_* credentials and the bucket.';
    await mailer.sendAlert(alertEmail, 'ProtoCall offsite backup is stale', body);
  } catch (err) {
    log.error?.(`Offsite freshness alert FAILED: ${err?.message ?? 'unknown error'}`);
  }
  writeMeta(db, 'last_offsite_alert', now().toISOString());
}

// Start the recurring backup. Returns { stop, runOnce }. The interval is
// unref'd so it never keeps the process (or a test) alive on its own.
// `offsite` defaults to the env-configured uploader (null when the BACKUP_S3_*
// vars aren't set, which is the case in dev/test); pass `offsite: null` to force
// it off or an object with `.upload(path)` to inject one.
// `mailer`/`alertEmail` are the freshness-alert seams, same shape as `offsite`:
// `mailer` defaults to the env-configured Resend client (no-ops without
// RESEND_API_KEY); `alertEmail` defaults to ERROR_ALERT_EMAIL (the same
// operator address PR 6's error alerting uses) and the check is skipped
// entirely when it's unset, so dev/test stay silent.
export function startBackupScheduler(db, {
  dir, intervalMs = DAY_MS, keep = 14, now = () => new Date(), log = console,
  offsite = createOffsiteUploaderFromEnv({ log }),
  mailer = createMailer(), alertEmail = process.env.ERROR_ALERT_EMAIL,
} = {}) {
  // Serialize: a slow backup that outruns the interval (or the boot catch-up
  // overlapping the first tick) must not start a second concurrent snapshot.
  // The offsite upload runs inside the same in-flight promise, so uploads are
  // serialized with each other and with the snapshots.
  let inFlight = null;
  const runOnce = () => {
    if (inFlight) return inFlight;
    inFlight = runBackup(db, dir, { keep, now })
      .then(async dest => {
        log.log?.(`DB backup written: ${dest}`);
        // Defence-in-depth only: anything that goes wrong offsite is logged and
        // swallowed here so the local snapshot still counts as a success.
        if (offsite) {
          try {
            const res = await offsite.upload(dest);
            if (res?.ok) {
              log.log?.(`Offsite backup uploaded: ${res.key} (HTTP ${res.status})`);
              writeMeta(db, 'last_offsite_ok', now().toISOString());
            } else {
              const why = res?.error ? res.error : `HTTP ${res?.status}${res?.code ? ` ${res.code}` : ''}`;
              log.error?.(`Offsite backup FAILED for ${res?.key ?? path.basename(dest)}: ${why}`);
            }
          } catch (err) {
            log.error?.(`Offsite backup FAILED: ${err?.message ?? 'unknown error'}`);
          }
          await checkOffsiteFreshness(db, { now, log, mailer, alertEmail });
        }
        return dest;
      })
      .catch(err => { log.error?.(`DB backup failed: ${err.message}`); })
      .finally(() => { inFlight = null; });
    return inFlight;
  };
  if (isStale(dir, intervalMs, now)) runOnce();
  const timer = setInterval(runOnce, intervalMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer), runOnce };
}
