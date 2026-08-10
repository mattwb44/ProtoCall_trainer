# Ops Log

A dated record of operational events: production config changes, backup/restore
rehearsals, incidents, and deploy-safety verifications. This is history, not
instructions — for step-by-step procedures, see `docs/runbooks.md`.

Newest entries first.

---

## 2026-08-10 — Restore rehearsal (pass)

Downloaded the offsite snapshot `protocall-2026-08-09T20-56-14.db` from the
R2 bucket. Ran the app locally against it (`DB_PATH=<snapshot path> npm start`),
logged in with a real account, and confirmed the scenario library and question
content loaded correctly.

**Result:** Pass. Backups are restorable, not just theoretical.
**Next rehearsal due:** before any schema-heavy release, or within ~30 days
if no such release happens sooner.

## 2026-08-10 — Uptime monitoring verified

Configured UptimeRobot against `https://protocalltrainer.com/healthz`
(5 min interval, free tier). Used the monitor's built-in test-notification
feature to confirm the alert contact actually receives notifications.

**Result:** Pass. Notification channel confirmed working.
**Note:** free-tier check interval is 5 min and typically requires 2
consecutive failed checks before alerting — a real outage shorter than
~10 min may not trigger a page. Acceptable for current scale; revisit
interval/threshold if usage grows.

## 2026-08-10 — Offsite backups (Cloudflare R2) enabled

Set `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY_ID`,
`BACKUP_S3_SECRET_ACCESS_KEY`, `BACKUP_S3_PREFIX` on Railway, scoped to a
dedicated R2 bucket via a bucket-scoped API token (object read/write only,
not account-wide). Redeployed; confirmed "Offsite backup sync enabled" in
boot logs.

Forced an immediate backup+upload from the production shell (bypassing the
24h staleness check) to verify the path end-to-end without waiting for the
nightly cycle. Confirmed `HTTP 200` in logs and confirmed the object
physically present in the R2 bucket via the Cloudflare dashboard.

**Result:** Pass. Nightly local snapshots now replicate offsite automatically.

## 2026-08-10 — Railway production config verified

Confirmed the persistent volume is mounted and `DB_PATH=/data/protocall.db`
points at it (survives redeploys — data does not live on ephemeral container
disk). Confirmed `/healthz` returns `{ ok: true }` at the production domain.

**Result:** Pass. This closes the one unrecoverable-mistake risk identified
in the production readiness audit (wrong `DB_PATH` / missing volume wiping
data on every deploy).

---

<!--
Entry template — copy this for new entries:

## YYYY-MM-DD — Short title

What happened, what was checked, what the result was. Include exact
env vars / commands / log lines where useful for future reference —
this doubles as evidence, not just a note.

**Result:** Pass / Fail / Partial — say which, and what follow-up (if any)
is needed.
-->
