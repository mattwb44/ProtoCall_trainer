// PR 3: fatal boot guard. On Railway (RAILWAY_ENVIRONMENT set) an unset DB_PATH
// (createDb, server/db.js) or MEDIA_DIR (createMediaStore, server/media.js) would
// fall back to ephemeral container disk and lose data on every deploy, so the
// entrypoint refuses to boot. Local dev and tests never set the flag, so they
// keep the fallbacks / ':memory:'.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { railwayBootError } from '../server/index.js';

const entry = fileURLToPath(new URL('../server/index.js', import.meta.url));

test('railwayBootError fires on Railway when DB_PATH or MEDIA_DIR is missing', () => {
  // Dangerous combinations: on Railway, missing either volume-backed path.
  assert.match(railwayBootError({ RAILWAY_ENVIRONMENT: '1' }), /DB_PATH and MEDIA_DIR/);
  assert.match(railwayBootError({ RAILWAY_ENVIRONMENT: '1', MEDIA_DIR: '/data/media' }), /DB_PATH/);
  assert.match(railwayBootError({ RAILWAY_ENVIRONMENT: '1', DB_PATH: '/data/protocall.db' }), /MEDIA_DIR/);
  // Safe: Railway with both explicit volume paths.
  assert.equal(railwayBootError({ RAILWAY_ENVIRONMENT: '1', DB_PATH: '/data/protocall.db', MEDIA_DIR: '/data/media' }), null);
  // Safe: local dev / tests (no RAILWAY_ENVIRONMENT), with or without the paths.
  assert.equal(railwayBootError({}), null);
  assert.equal(railwayBootError({ DB_PATH: '/tmp/x.db' }), null);
});

test('the entrypoint exits non-zero and never boots when Railway lacks DB_PATH', () => {
  const env = { ...process.env };
  delete env.DB_PATH;              // simulate the misconfiguration
  delete env.MEDIA_DIR;
  env.RAILWAY_ENVIRONMENT = '1';   // ...on Railway
  const r = spawnSync(process.execPath, [entry], { env, encoding: 'utf8', timeout: 10000 });
  assert.notEqual(r.status, 0);    // refused to boot (never reached app.listen)
  assert.match(r.stderr, /DB_PATH/); // printed a clear fatal message
});
