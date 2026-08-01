// Offsite replication of the nightly DB snapshot to S3-compatible storage
// (Cloudflare R2, Backblaze B2, AWS S3).
//
// Why hand-rolled: this needs exactly one operation — a single authenticated
// PUT of one file — so `@aws-sdk/client-s3` (dozens of transitive packages) is
// not worth the deploy weight. AWS Signature V4 for a single-chunk PUT is a
// small, well-specified signing case; it is implemented below against the
// documented canonical-request rules and nothing else.
//
// Security posture:
//   - Credentials live only in env and in the Authorization header we send.
//     They are never logged, never put into an Error message, and every string
//     that leaves this module (result.error, result.code) is run through a
//     scrubber as defence in depth.
//   - HTTPS only. A non-https endpoint is rejected outright rather than
//     silently downgraded — the Authorization header is a bearer-equivalent
//     credential over the wire.
//   - The object key is rebuilt from a strict per-segment allowlist, so a
//     crafted snapshot filename cannot climb out of the configured prefix.
//   - Failure is always reported as a value ({ ok: false, ... }); `upload()`
//     does not throw, because the caller (server/backup.js) must never let an
//     offsite problem break the local backup.
//
// Test seam: `fetchImpl` is injectable so tests can drive a local node:http
// server without relaxing the production https rule (the module still signs
// and addresses an https URL; the test's fetchImpl is what redirects it).

import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const ALGORITHM = 'AWS4-HMAC-SHA256';
const SERVICE = 's3';
const REQUIRED_ENV = [
  'BACKUP_S3_ENDPOINT',
  'BACKUP_S3_BUCKET',
  'BACKUP_S3_ACCESS_KEY_ID',
  'BACKUP_S3_SECRET_ACCESS_KEY',
];
// Below this we read the file once into memory (simplest, most compatible
// path); above it we make two passes over the file — one to hash, one to
// stream the body — so a large DB never has to fit in the heap.
const BUFFER_LIMIT_BYTES = 64 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
// One key segment: no '/', no '..', no control characters, no leading dot.
const SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const BUCKET_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{1,62}$/;
const REGION_RE = /^[A-Za-z0-9-]{1,32}$/;

const sha256hex = data => crypto.createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data, 'utf8').digest();

// RFC 3986 encoding, which is what SigV4 canonicalization wants (stricter than
// encodeURIComponent, which leaves !'()* alone).
const uriEncode = s =>
  encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());

// Build the object key from the configured prefix plus the snapshot's own file
// name. Every segment must match the allowlist, so '../', absolute paths,
// embedded NULs and Windows separators are rejected outright rather than
// normalized — there is no legitimate snapshot name that needs them, and
// rejecting is louder than silently rewriting a hostile name into a valid one.
export function normalizeObjectKey(prefix, filename) {
  const name = String(filename ?? '');
  if (!SEGMENT_RE.test(name)) throw new Error('unsafe backup file name for object key');
  const segments = String(prefix ?? '').split('/').filter(Boolean);
  for (const seg of segments) {
    if (!SEGMENT_RE.test(seg)) throw new Error('BACKUP_S3_PREFIX has an unsupported path segment');
  }
  return [...segments, name].join('/');
}

// Redacts credential material from anything we are about to log or return.
// Nothing in this module deliberately puts a secret in a string; this exists so
// that a surprise (an SDK error echoing a header, an S3 error body quoting the
// access key id) still cannot reach the log.
function makeScrubber({ accessKeyId, secretAccessKey }) {
  const secrets = [secretAccessKey, accessKeyId].filter(s => typeof s === 'string' && s.length >= 8);
  return text => {
    let out = String(text ?? '');
    for (const s of secrets) out = out.split(s).join('[redacted]');
    return out;
  };
}

// --- AWS Signature V4 (single chunk, header-based auth) ---------------------
//
// Canonical request:
//   METHOD \n CanonicalURI \n CanonicalQuery \n CanonicalHeaders \n
//   SignedHeaders \n HexSha256(payload)
// Header names are lowercased and sorted; values are trimmed; each header line
// ends in \n and the block is followed by a blank line (i.e. the join already
// leaves a trailing \n).
export function signV4({ method, url, headers, payloadHash, accessKeyId, secretAccessKey, region, service = SERVICE, date }) {
  const amzDate = date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); // 20260731T023000Z
  const dateStamp = amzDate.slice(0, 8);
  const u = new URL(url);

  // `host` and `x-amz-date` are always signed; everything else the caller wants
  // covered (for S3: x-amz-content-sha256) comes in via `headers`.
  const all = { ...headers, host: u.host, 'x-amz-date': amzDate };
  const canonical = Object.entries(all)
    .map(([k, v]) => [k.toLowerCase().trim(), String(v).trim().replace(/\s+/g, ' ')])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const signedHeaders = canonical.map(([k]) => k).join(';');
  const canonicalHeaders = canonical.map(([k, v]) => `${k}:${v}\n`).join('');

  // The path is already built from encoded segments; keep '/' as the separator.
  const canonicalUri = u.pathname || '/';
  // A plain PUT object carries no query string, but canonicalizing it properly
  // (sorted by name then value, RFC 3986 encoded) keeps the implementation
  // honest against the published SigV4 test vectors.
  const canonicalQuery = [...u.searchParams]
    .map(([k, v]) => [uriEncode(k), uriEncode(v)])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [ALGORITHM, amzDate, scope, sha256hex(canonicalRequest)].join('\n');

  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  return {
    amzDate,
    signedHeaders,
    authorization: `${ALGORITHM} Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

// --- Configuration ----------------------------------------------------------

// Returns one of:
//   { state: 'off' }                       nothing configured — stay silent
//   { state: 'incomplete', missing: [...] } half-configured — warn loudly, a
//                                           silently-off offsite copy is a
//                                           false sense of safety
//   { state: 'invalid', message }           configured but unusable
//   { state: 'on', config }
export function offsiteConfigFromEnv(env = process.env) {
  const get = k => (typeof env[k] === 'string' ? env[k].trim() : '');
  const present = REQUIRED_ENV.filter(k => get(k) !== '');
  if (present.length === 0) return { state: 'off' };
  if (present.length < REQUIRED_ENV.length) {
    return { state: 'incomplete', missing: REQUIRED_ENV.filter(k => get(k) === '') };
  }

  const endpoint = get('BACKUP_S3_ENDPOINT');
  const bucket = get('BACKUP_S3_BUCKET');
  const region = get('BACKUP_S3_REGION') || 'auto';
  const prefix = get('BACKUP_S3_PREFIX');

  let u;
  try {
    u = new URL(endpoint);
  } catch {
    return { state: 'invalid', message: 'BACKUP_S3_ENDPOINT is not a valid URL' };
  }
  if (u.protocol !== 'https:') {
    return { state: 'invalid', message: 'BACKUP_S3_ENDPOINT must use https (refusing to send credentials in clear text)' };
  }
  if (u.username || u.password) {
    return { state: 'invalid', message: 'BACKUP_S3_ENDPOINT must not embed credentials' };
  }
  if ((u.pathname && u.pathname !== '/') || u.search || u.hash) {
    return { state: 'invalid', message: 'BACKUP_S3_ENDPOINT must be the bare service origin, e.g. https://<account>.r2.cloudflarestorage.com (no bucket, no path)' };
  }
  if (!BUCKET_RE.test(bucket)) return { state: 'invalid', message: 'BACKUP_S3_BUCKET is not a valid bucket name' };
  if (!REGION_RE.test(region)) return { state: 'invalid', message: 'BACKUP_S3_REGION is not a valid region' };
  try {
    normalizeObjectKey(prefix, 'probe.db');
  } catch (err) {
    return { state: 'invalid', message: err.message };
  }

  return {
    state: 'on',
    config: {
      endpoint: u.origin,
      bucket,
      region,
      prefix,
      accessKeyId: get('BACKUP_S3_ACCESS_KEY_ID'),
      secretAccessKey: get('BACKUP_S3_SECRET_ACCESS_KEY'),
    },
  };
}

// --- Uploader ---------------------------------------------------------------

async function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(filePath), hash);
  return hash.digest('hex');
}

// Pulls the S3 <Code> element (e.g. "AccessDenied", "SignatureDoesNotMatch")
// out of an error body. Deliberately narrow: S3 error bodies can echo the
// access key id and the canonical request, so we never surface the raw body.
function errorCodeFrom(text) {
  const m = /<Code>([A-Za-z0-9._-]{1,64})<\/Code>/.exec(text || '');
  return m ? m[1] : null;
}

// `config` is the validated shape from offsiteConfigFromEnv().config.
// Returns { upload(filePath) -> Promise<result> } where result is
//   { ok: true,  key, status, bytes }
//   { ok: false, key, status, code?, error? }   (never throws)
export function createOffsiteUploader(config, {
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  now = () => new Date(),
  bufferLimitBytes = BUFFER_LIMIT_BYTES, // lowered by tests to exercise the streaming path
} = {}) {
  const scrub = makeScrubber(config);
  const target = `${new URL(config.endpoint).host}/${config.bucket}${config.prefix ? `/${config.prefix}` : ''}`;

  async function upload(filePath) {
    let key = null;
    try {
      key = normalizeObjectKey(config.prefix, path.basename(filePath));
      const { size } = await fsp.stat(filePath);

      // One pass over the file when it comfortably fits in memory; two passes
      // (hash, then stream) when it does not. Either way the bytes are never
      // held twice.
      let body;
      let payloadHash;
      if (size <= bufferLimitBytes) {
        const buf = await fsp.readFile(filePath);
        payloadHash = sha256hex(buf);
        body = buf;
      } else {
        payloadHash = await hashFile(filePath);
        body = Readable.toWeb(fs.createReadStream(filePath));
      }

      const encodedKey = key.split('/').map(uriEncode).join('/');
      const url = `${config.endpoint}/${uriEncode(config.bucket)}/${encodedKey}`;
      // Signed set: these three plus host and x-amz-date (added by signV4).
      // x-amz-content-sha256 is mandatory for S3; signing content-length binds
      // the declared size too.
      const headers = {
        'content-type': 'application/octet-stream',
        'content-length': String(size),
        'x-amz-content-sha256': payloadHash,
      };
      const { amzDate, authorization } = signV4({
        method: 'PUT',
        url,
        headers,
        payloadHash,
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        region: config.region,
        date: now(),
      });

      const res = await fetchImpl(url, {
        method: 'PUT',
        headers: { ...headers, 'x-amz-date': amzDate, authorization },
        body,
        duplex: 'half', // required by fetch for a streamed request body
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!res.ok) {
        let code = null;
        try {
          code = errorCodeFrom((await res.text()).slice(0, 2048));
        } catch { /* body unreadable — status alone is enough to act on */ }
        return { ok: false, key, status: res.status, code: code ? scrub(code) : null };
      }
      return { ok: true, key, status: res.status, bytes: size };
    } catch (err) {
      // Errors from fetch/undici can carry a `cause`; keep the message short
      // and scrubbed. Never attach the config or the request headers.
      const detail = err?.cause?.message ? `${err.message}: ${err.cause.message}` : err?.message || String(err);
      return { ok: false, key, status: 0, error: scrub(detail) };
    }
  }

  return { upload, target };
}

// Convenience wrapper used by the backup scheduler: returns an uploader, or
// null when offsite sync is off / unusable. Logs at most one line at startup
// and never logs credential values (env var *names* only).
export function createOffsiteUploaderFromEnv({ env = process.env, log = console, fetchImpl, timeoutMs } = {}) {
  const res = offsiteConfigFromEnv(env);
  if (res.state === 'off') return null;
  if (res.state === 'incomplete') {
    log.warn?.(`Offsite backup sync DISABLED — missing env: ${res.missing.join(', ')}`);
    return null;
  }
  if (res.state === 'invalid') {
    log.error?.(`Offsite backup sync DISABLED — ${res.message}`);
    return null;
  }
  const uploader = createOffsiteUploader(res.config, { fetchImpl, timeoutMs });
  log.log?.(`Offsite backup sync enabled → ${uploader.target}`);
  return uploader;
}
