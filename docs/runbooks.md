# Runbooks

Exact steps for the five operational situations that come up in production.
Follow them in order; don't improvise mid-incident. Background/history lives
in `docs/ops-log.md`; standing deploy rules live in `docs/execution-plan.md`
("Deployment rules"). This doc assumes you're logged into the Railway
dashboard for the `ProtoCall_trainer` project and have `sqlite3` available
locally.

---

## 1. Normal deploy (no schema change)

Use when the PR touches server logic, frontend, or config only — no new
column, no new table, no one-shot migration flag in `server/db.js`.

1. Confirm CI is green on the PR/branch. **Never deploy with CI red.**
2. Check for a live session: in the Railway shell (or via `sqlite3` against a
   fresh manual backup, see step 3) run:
   ```sql
   SELECT COUNT(*) FROM live_sessions WHERE status='live';
   ```
   If non-zero, wait for it to end or deploy in a low-usage window.
3. Take a manual backup as a checkpoint (cheap insurance, not strictly
   required for a non-migration deploy — do it anyway):
   - Log in as the `site_admin` account in prod.
   - `GET /api/admin/backup` (visit the URL directly while logged in, or
     `curl -b <session-cookie> https://<domain>/api/admin/backup -o backup.db`).
   - Save the downloaded `.db` file somewhere durable.
4. Merge to `main`. Railway auto-deploys on push (or click **Deploy** in the
   Railway dashboard if auto-deploy is off).
5. Watch the deploy log in the Railway dashboard until it shows the
   healthcheck passing (`/healthz` returning 200).
6. **Post-deploy check (2 min, every time):**
   - `curl https://<domain>/healthz` → `{ ok: true, ... }`.
   - Log in in a browser.
   - Open a scenario, make a trivial edit, save it, confirm it persists on
     reload.
7. If any check fails, go to **Runbook 3 — Rollback** immediately. Investigate
   after rolling back, not before.

---

## 2. Migration deploy (new column, new table, or a flag-guarded one-shot)

Use when `server/db.js` `migrate()` gains a new `addColumn(...)` line, a new
`CREATE TABLE`, or a one-shot data rewrite guarded by `app_meta` (the pattern
used by PR 9's response dedupe).

1. Confirm CI is green.
2. **Mandatory backup before any migration-bearing deploy** — do not skip:
   - `GET /api/admin/backup` as `site_admin`, save the file locally with a
     clear name, e.g. `protocall-pre-migration-2026-08-15.db`.
   - Additionally grab the latest offsite snapshot's key so you know exactly
     which R2 object predates the migration (see Runbook 5, step 1, for how
     to list/fetch it).
3. Confirm no live session (`SELECT COUNT(*) FROM live_sessions WHERE
   status='live';`). Migrations run at boot before the healthcheck passes, but
   a schema-heavy release is still safer in a quiet window.
4. Re-read the migration code path being shipped and confirm it obeys the
   standing rules:
   - Additive only — new columns have defaults (`addColumn` pattern).
   - Any data rewrite is one-shot and gated in `app_meta` (`hasRun`/`markRun`
     pattern at `server/db.js:180-186`) so a redeploy can't re-run it.
   - No `DROP`, no `RENAME`, no column meaning changed.
   - Old request/response shapes still work (e.g. PR 7's versionless-PUT
     back-compat).
5. Merge to `main`, let Railway deploy.
6. Watch the deploy log specifically for the migration's own log line (each
   one-shot in this codebase logs what it did — e.g. PR 9 logs how many
   duplicate rows it removed). Confirm the healthcheck then passes.
7. Run the standard **post-deploy check** (Runbook 1, step 6).
8. Spot-check the migration's actual effect with a direct query. Example for
   PR 9 (response dedupe), run against a fresh admin-backup download, never
   directly against the prod file:
   ```sql
   SELECT session_id, participant_id, question_id, COUNT(*) c
   FROM responses
   GROUP BY session_id, participant_id, question_id
   HAVING c > 1;
   ```
   Expect zero rows after the migration.
9. Record the result in `docs/ops-log.md` (new dated entry: what migrated,
   row counts affected, pass/fail).
10. If anything looks wrong, go to **Runbook 3 — Rollback**. A stuck or
    partially-applied migration is exactly why step 2's backup exists.

---

## 3. Rollback

Use immediately on: failing healthcheck, broken login, a save returning 5xx,
`SQLITE_` errors in the deploy log, or the backup-scheduler log line
(`DB backup written: ...`) missing after the deploy window it should have run
in.

1. Railway dashboard → the service → **Deployments** tab.
2. Find the last deployment that was healthy (before the one you're rolling
   back).
3. Click it → **Redeploy** (this re-runs that exact build/image against the
   *current* volume — it does not touch the database).
4. Watch the deploy log until the healthcheck passes.
5. Run the standard **post-deploy check** (Runbook 1, step 6).
6. If the bad deploy was migration-bearing (Runbook 2) and it partially
   applied a schema change:
   - Additive changes (new column/table) are harmless to leave in place —
     older code simply ignores them. Do not attempt to drop them under
     pressure.
   - If a one-shot data rewrite ran and produced bad data, restore from the
     pre-migration backup taken in Runbook 2 step 2 using the local-restore
     procedure in Runbook 5, then replay any writes that happened between the
     backup and the rollback by hand if feasible, or accept the data loss
     window and communicate it.
7. Once stable, investigate the root cause offline (not in prod). Fix,
   re-test, re-deploy following Runbook 1 or 2 as appropriate.
8. Add a dated entry to `docs/ops-log.md`: what broke, how it was caught,
   what the rollback did, root cause if known.

---

## 4. Missing user data ("my scenario/session is gone")

Use when a user reports a scenario, question, or session they expect to see
is missing. Most "missing" reports are soft-deletes, not actual data loss —
check that first.

1. Get the user's email and, if they have it, the scenario/session title or
   room code.
2. Pull a fresh admin backup and query it locally (never query prod directly
   for anything beyond a quick lookup — prefer the backup copy so you can't
   accidentally write):
   ```bash
   curl -b "<site_admin session cookie>" https://<domain>/api/admin/backup -o /tmp/check.db
   sqlite3 /tmp/check.db
   ```
3. Find the user's id:
   ```sql
   SELECT id, email, display_name, role, department_id FROM users WHERE email='<their email>' COLLATE NOCASE;
   ```
4. List **all** their scenarios, including soft-deleted and drafts — this is
   the query that finds "missing" data that's actually just hidden:
   ```sql
   SELECT id, title, visibility, shared_department, shared_public,
          is_draft, review_status, deleted_at, created_at
   FROM scenarios
   WHERE author_id='<user id>'
   ORDER BY created_at DESC;
   ```
   - `deleted_at` non-null → soft-deleted (by the user or a moderation
     action). The row still exists; nothing was destroyed.
   - `is_draft=1` → still a draft, only visible to the author — check the
     user is looking at the right filter/tab in the UI.
   - `review_status` not `'approved'` and `shared_public=0` → not visible to
     others yet, expected.
5. If they're asking about a live session they hosted or joined:
   ```sql
   SELECT id, room_code, scenario_id, status, started_at, ended_at, deleted_at, host_id
   FROM live_sessions
   WHERE host_id='<user id>'
   ORDER BY started_at DESC;
   ```
6. If they're a participant looking for their answers/notes from a session:
   ```sql
   SELECT p.id, p.session_id, p.display_tag, p.booted_at
   FROM participants p
   JOIN live_sessions s ON s.id = p.session_id
   WHERE p.user_id='<user id>'
   ORDER BY p.id DESC;
   ```
   Then pull their responses/notes for the session id found above:
   ```sql
   SELECT * FROM responses WHERE participant_id='<participant id>';
   SELECT * FROM notes WHERE participant_id='<participant id>';
   ```
7. If the row genuinely does not exist anywhere in the current backup (not
   soft-deleted, not filtered, not under a different account via a typo'd
   email), it may predate the earliest local/offsite backup or was hard-
   deleted by a bug. Check older offsite snapshots (Runbook 5, step 1) for
   the same query, working backwards until you find it or exhaust retention
   (14 local snapshots; check R2 bucket lifecycle for offsite retention).
8. Report back to the user with the specific finding (soft-deleted on
   `<date>`, still a draft, not visible due to review status, or genuinely
   not found as of `<backup timestamp>`). Do not restore/undelete data by
   hand-editing the live database — soft-deletes should be reversed through
   the app's own undelete path if one exists; if none exists and reversal is
   warranted, that's a product gap to fix, not a job for a raw `UPDATE` on
   production.

---

## 5. Outage / restore from offsite backup

Use when the volume is lost, corrupted, or you need to stand up a known-good
copy of the database (e.g. to investigate Runbook 4 against an older
snapshot, or after catastrophic data loss).

### Step 1 — Fetch the offsite snapshot

Offsite backups are uploaded to the bucket/prefix configured by
`BACKUP_S3_*` (see `server/offsite.js`). Object keys are
`<BACKUP_S3_PREFIX>/<filename>` (no prefix set → just `<filename>` at the
bucket root), where `<filename>` matches the local snapshot naming from
`server/backup.js`: `protocall-<ISO timestamp with `:`/`.` replaced by `-`,
truncated to seconds>.db`, e.g. `protocall-2026-08-09T20-56-14.db`.

To list and fetch objects:

- **Cloudflare R2 dashboard** (fastest, no credentials needed beyond
  dashboard access): R2 → the configured bucket → browse to the prefix
  (if any) → objects are named by timestamp, newest last when sorted
  alphabetically (the timestamp format sorts chronologically as a string) →
  download the one you want.
- **CLI**, if you have an R2/S3-compatible client configured with the
  `BACKUP_S3_*` credentials (e.g. `aws s3` pointed at the R2 endpoint, or
  `rclone`):
  ```bash
  aws s3 ls s3://<BACKUP_S3_BUCKET>/<BACKUP_S3_PREFIX>/ --endpoint-url <BACKUP_S3_ENDPOINT>
  aws s3 cp s3://<BACKUP_S3_BUCKET>/<BACKUP_S3_PREFIX>/protocall-<timestamp>.db /tmp/restore.db --endpoint-url <BACKUP_S3_ENDPOINT>
  ```

If R2 is unreachable or credentials are gone, fall back to the local
on-volume snapshots at `BACKUP_DIR` (default: `backups/` next to the DB file,
i.e. `/data/backups/` in prod). These live on the deployed container's volume,
so you must run **inside the container** — use `railway ssh` (or the Railway
dashboard → the service → **Shell**), **not** `railway run` (which executes the
command on *your local machine* with Railway's env injected and never touches
the volume):
```bash
railway ssh --service <service>          # opens a shell ON the container
ls /data/backups                         # then, inside that shell:
```
To pull a snapshot down to your machine for the local verification in Step 2,
copy it out of the container. If your `railway` CLI has no scp-style copy, the
reliable path is to fetch from R2 instead (above); or, from inside the
`railway ssh` shell, re-upload the chosen local snapshot to R2 with the
`BACKUP_S3_*` creds and download it normally.

### Step 2 — Verify the snapshot locally (rehearsal / sanity check)

This is the exact procedure already proven in `docs/ops-log.md`
(2026-08-10 restore rehearsal) — run it before trusting the snapshot:

```bash
DB_PATH=/tmp/restore.db npm start
```

Then in a browser at `http://localhost:3000`:
1. Log in with a real account known to exist in that snapshot.
2. Confirm the scenario library loads and question content is intact.
3. If checking a specific user's data (Runbook 4), query it directly instead:
   ```bash
   sqlite3 /tmp/restore.db "SELECT id, title, deleted_at FROM scenarios WHERE author_id='<user id>';"
   ```
4. Stop the local server (`Ctrl-C`) when done. This never touched production.

### Step 3 — Full restore into production (only after Step 2 passes)

Only do this after exhausting Runbook 3 (rollback) as an option — a full
restore loses every write made after the snapshot's timestamp.

1. Put the app in a known-quiet state if possible (communicate downtime to
   users first — this is destructive to recent writes).
2. Take one more `GET /api/admin/backup` of the *current* (bad) state first,
   even though it's bad — so the pre-restore state isn't unrecoverable if the
   restore itself was a mistake.
3. Get the verified snapshot onto the container's volume and copy it over the
   live path (`DB_PATH`, typically `/data/protocall.db`). This must run **inside
   the container** via `railway ssh --service <service>` (or dashboard → the
   service → **Shell**) — `railway run` would only rewrite a file on your laptop.
   The simplest reliable route is to pull straight from R2 into the container
   so the bytes land on the volume directly:
   ```bash
   railway ssh --service <service>        # open a shell ON the container, then:
   # fetch the known-good snapshot from R2 to a scratch path on the volume
   aws s3 cp s3://<BACKUP_S3_BUCKET>/<BACKUP_S3_PREFIX>/protocall-<timestamp>.db \
     /data/restore.db --endpoint-url <BACKUP_S3_ENDPOINT>
   # remove the live DB AND its WAL/shm sidecars, then move the snapshot in.
   # Leaving a stale -wal/-shm behind can partially roll the restore back or
   # corrupt it — delete all three.
   rm -f /data/protocall.db /data/protocall.db-wal /data/protocall.db-shm
   mv /data/restore.db /data/protocall.db
   ```
   (If you can't reach R2, copy the verified `/tmp/restore.db` from Step 2 into
   the container by whatever transfer your `railway` CLI supports, or re-upload
   it to R2 and pull it as above. Never edit the live volume from `railway run`.)
4. Redeploy (Railway dashboard → **Redeploy**) so the app reopens the file
   fresh. (The `rm` in step 3 already cleared the old WAL/shm; a clean boot
   opens the restored file with no leftover journal state.)
5. Run the standard **post-deploy check** (Runbook 1, step 6).
6. Record the incident and the restore in `docs/ops-log.md`: what triggered
   it, which snapshot was used, the time window of data loss (snapshot
   timestamp → incident time), and communication sent to affected users.
