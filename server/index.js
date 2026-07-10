import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyMultipart from '@fastify/multipart';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fs from 'node:fs';
import os from 'node:os';
import { createMediaStore, MAX_UPLOAD_BYTES } from './media.js';
import { sessionPdf } from './pdf.js';
import { Server as SocketServer } from 'socket.io';
import QRCode from 'qrcode';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb, seedIfEmpty, uuid } from './db.js';
import { Rooms } from './rooms.js';
import {
  hashPassword, verifyPassword, createAuthSession, destroyAuthSession,
  userFromCookieHeader, tokenFromCookieHeader, setCookieValue, clearCookieValue,
  createAuthToken, consumeAuthToken,
} from './auth.js';
import { createMailer } from './mailer.js';
import { createAnalyzer } from './analysis.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function buildServer({ dbFile, mediaDir, authRateMax = 10, globalRateMax = 300, mailer = createMailer(), analyzer = createAnalyzer() } = {}) {
  const db = createDb(dbFile);
  seedIfEmpty(db);
  // Operator bootstrap: promote the configured account to site_admin on boot (idempotent).
  if (process.env.SITE_ADMIN_EMAIL) {
    const r = db.prepare("UPDATE users SET role='site_admin' WHERE email=? AND role!='site_admin'")
      .run(process.env.SITE_ADMIN_EMAIL);
    if (r.changes) console.log(`Promoted ${process.env.SITE_ADMIN_EMAIL} to site_admin`);
  }
  const rooms = new Rooms(db);
  const media = createMediaStore(mediaDir);

  // trustProxy: behind Railway's edge, the client IP and protocol live in x-forwarded-*;
  // without it rate limits key on the proxy IP and QR URLs come out http.
  const app = Fastify({ trustProxy: true });
  // CSP off deliberately: the frontend uses CDN scripts and inline JS by design.
  // Awaited so the rate-limit onRoute hook exists before routes are defined below.
  await app.register(fastifyHelmet, { contentSecurityPolicy: false, crossOriginEmbedderPolicy: false });
  await app.register(fastifyRateLimit, { max: globalRateMax, timeWindow: '1 minute' });
  const authLimited = { config: { rateLimit: { max: authRateMax, timeWindow: '1 minute' } } };
  app.register(fastifyStatic, { root: path.join(__dirname, '..', 'public') });
  app.register(fastifyStatic, {
    root: media.dir, prefix: '/media/', decorateReply: false,
    cacheControl: true, maxAge: '365d', immutable: true, // filenames are content-unique UUIDs
  });
  app.register(fastifyMultipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });

  // Base URL for email links. APP_URL pins it in prod; otherwise derive from the request
  // (req.protocol is https behind Railway thanks to trustProxy).
  const baseUrl = req => process.env.APP_URL || `${req.protocol}://${req.headers.host}`;

  const currentUser = req => userFromCookieHeader(db, req.headers.cookie);
  const requireUser = (req, reply) => {
    const user = currentUser(req);
    if (!user) reply.code(401).send({ error: 'login required' });
    return user;
  };

  // ── Auth ──
  app.get('/healthz', () => {
    db.prepare('SELECT 1').get();
    return { ok: true, uptime_s: Math.floor(process.uptime()) };
  });

  // Consistent online snapshot of the live database, for offsite backups.
  app.get('/api/admin/backup', async (req, reply) => {
    const user = currentUser(req);
    if (!user || user.role !== 'site_admin') return reply.code(403).send({ error: 'site admin only' });
    const tmp = path.join(os.tmpdir(), `protocall-backup-${Date.now()}.db`);
    await db.backup(tmp);
    const stream = fs.createReadStream(tmp);
    stream.on('close', () => fs.unlink(tmp, () => {}));
    reply.type('application/vnd.sqlite3')
      .header('content-disposition', `attachment; filename="protocall-${new Date().toISOString().slice(0, 10)}.db"`);
    return reply.send(stream);
  });

  app.post('/api/signup', authLimited, (req, reply) => {
    const { email, password, display_name, guest_token } = req.body ?? {};
    if (!email?.includes('@') || !password || password.length < 8 || !display_name?.trim())
      return reply.code(400).send({ error: 'valid email, display name, and password (8+ chars) required' });
    if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email))
      return reply.code(409).send({ error: 'an account with that email already exists' });
    const id = uuid();
    db.prepare('INSERT INTO users (id, email, password_hash, display_name) VALUES (?,?,?,?)')
      .run(id, email, hashPassword(password), display_name.trim());
    const claimed = guest_token ? claimGuest(id, guest_token) : 0;
    // Fire-and-forget the verification email so a slow/failing mail provider never blocks signup.
    const vtoken = createAuthToken(db, id, 'verify', 24);
    mailer.sendVerification(email, display_name.trim(), `${baseUrl(req)}/#/verify/${vtoken}`)
      .catch(err => req.log.error({ err }, 'verification email failed'));
    reply.header('set-cookie', setCookieValue(createAuthSession(db, id)));
    reply.code(201);
    return { id, email, display_name: display_name.trim(), claimed_sessions: claimed, email_verified: false };
  });

  app.post('/api/login', authLimited, (req, reply) => {
    const { email, password, guest_token } = req.body ?? {};
    const user = db.prepare('SELECT * FROM users WHERE email=?').get(email ?? '');
    if (!user || !verifyPassword(password ?? '', user.password_hash))
      return reply.code(401).send({ error: 'invalid email or password' });
    const claimed = guest_token ? claimGuest(user.id, guest_token) : 0;
    reply.header('set-cookie', setCookieValue(createAuthSession(db, user.id)));
    return { id: user.id, email: user.email, display_name: user.display_name, claimed_sessions: claimed };
  });

  app.post('/api/logout', (req, reply) => {
    destroyAuthSession(db, tokenFromCookieHeader(req.headers.cookie));
    reply.header('set-cookie', clearCookieValue());
    return { ok: true };
  });

  app.get('/api/me', req => {
    const user = currentUser(req);
    if (!user) return null;
    const dept = user.department_id
      ? db.prepare('SELECT id, name, verified_at FROM departments WHERE id=?').get(user.department_id)
      : null;
    const { email_verified_at } = db.prepare('SELECT email_verified_at FROM users WHERE id=?').get(user.id);
    return { id: user.id, email: user.email, display_name: user.display_name,
             role: user.role, department: dept, email_verified: !!email_verified_at };
  });

  // ── Email verification & password reset ──
  // Resend the verification email to the logged-in user (no-op if already verified).
  app.post('/api/auth/verify/request', authLimited, (req, reply) => {
    const user = requireUser(req, reply); if (!user) return;
    const { email_verified_at } = db.prepare('SELECT email_verified_at FROM users WHERE id=?').get(user.id);
    if (email_verified_at) return { ok: true, already_verified: true };
    const t = createAuthToken(db, user.id, 'verify', 24);
    mailer.sendVerification(user.email, user.display_name, `${baseUrl(req)}/#/verify/${t}`)
      .catch(err => req.log.error({ err }, 'verification email failed'));
    return { ok: true };
  });

  // Consume a verification token and mark the address confirmed. Public: the link is the proof.
  app.post('/api/auth/verify', authLimited, (req, reply) => {
    const userId = consumeAuthToken(db, req.body?.token, 'verify');
    if (!userId) return reply.code(400).send({ error: 'this verification link is invalid or has expired' });
    db.prepare("UPDATE users SET email_verified_at=datetime('now') WHERE id=?").run(userId);
    const u = db.prepare('SELECT display_name FROM users WHERE id=?').get(userId);
    return { ok: true, display_name: u.display_name };
  });

  // Request a reset link. Always 200 with no hint about whether the account exists.
  app.post('/api/auth/reset/request', authLimited, (req, reply) => {
    const email = (req.body?.email ?? '').trim();
    const user = email ? db.prepare('SELECT * FROM users WHERE email=?').get(email) : null;
    if (user && user.password_hash !== '!') { // never the seed 'system' account
      const t = createAuthToken(db, user.id, 'reset', 1);
      mailer.sendReset(user.email, user.display_name, `${baseUrl(req)}/#/reset/${t}`)
        .catch(err => req.log.error({ err }, 'reset email failed'));
    }
    return { ok: true };
  });

  // Consume a reset token, set the new password, and log the user in on a fresh session while
  // revoking every existing session (a reset should boot anyone holding a stolen cookie).
  app.post('/api/auth/reset', authLimited, (req, reply) => {
    const { token, password } = req.body ?? {};
    if (!password || password.length < 8)
      return reply.code(400).send({ error: 'password must be at least 8 characters' });
    const userId = consumeAuthToken(db, token, 'reset');
    if (!userId) return reply.code(400).send({ error: 'this reset link is invalid or has expired' });
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(password), userId);
    db.prepare('DELETE FROM auth_sessions WHERE user_id=?').run(userId);
    const u = db.prepare('SELECT id, email, display_name FROM users WHERE id=?').get(userId);
    reply.header('set-cookie', setCookieValue(createAuthSession(db, userId)));
    return { id: u.id, email: u.email, display_name: u.display_name };
  });

  // Link every unclaimed participant row carrying this browser token, across all sessions.
  function claimGuest(userId, guestToken) {
    return db.prepare('UPDATE participants SET user_id=? WHERE token=? AND user_id IS NULL')
      .run(userId, guestToken).changes;
  }

  app.post('/api/claim', (req, reply) => {
    const user = requireUser(req, reply); if (!user) return;
    const { guest_token } = req.body ?? {};
    if (!guest_token) return reply.code(400).send({ error: 'guest_token required' });
    return { claimed_sessions: claimGuest(user.id, guest_token) };
  });

  // ── Departments ──
  const deptCode = () => {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no lookalikes
    let c;
    do { c = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join(''); }
    while (db.prepare('SELECT 1 FROM departments WHERE join_code=?').get(c));
    return c;
  };
  const isChiefOf = (user, deptId) =>
    user.role === 'dept_admin' && user.department_id && user.department_id === deptId;
  const deptVerified = deptId =>
    !!(deptId && db.prepare('SELECT verified_at FROM departments WHERE id=?').get(deptId)?.verified_at);

  app.post('/api/departments', (req, reply) => {
    const user = requireUser(req, reply); if (!user) return;
    if (user.department_id) return reply.code(409).send({ error: 'you already belong to a department' });
    const name = req.body?.name?.trim();
    if (!name) return reply.code(400).send({ error: 'name required' });
    const id = uuid();
    const tx = db.transaction(() => {
      db.prepare('INSERT INTO departments (id, name, join_code) VALUES (?,?,?)').run(id, name, deptCode());
      db.prepare("UPDATE users SET department_id=?, role='dept_admin' WHERE id=?").run(id, user.id);
    });
    tx();
    reply.code(201);
    return { id, pending: true };
  });

  app.post('/api/departments/join', (req, reply) => {
    const user = requireUser(req, reply); if (!user) return;
    if (user.department_id) return reply.code(409).send({ error: 'you already belong to a department' });
    const dept = db.prepare('SELECT * FROM departments WHERE join_code=?')
      .get((req.body?.code ?? '').trim().toUpperCase());
    if (!dept) return reply.code(404).send({ error: 'invalid join code' });
    if (!dept.verified_at) return reply.code(403).send({ error: 'this department is awaiting site approval' });
    db.prepare("UPDATE users SET department_id=?, role='standard' WHERE id=?").run(dept.id, user.id);
    return { id: dept.id, name: dept.name };
  });

  app.post('/api/departments/leave', (req, reply) => {
    const user = requireUser(req, reply); if (!user) return;
    if (!user.department_id) return reply.code(400).send({ error: 'not in a department' });
    if (user.role === 'dept_admin') {
      const members = db.prepare("SELECT COUNT(*) n FROM users WHERE department_id=? AND id!=?")
        .get(user.department_id, user.id).n;
      if (members > 0) return reply.code(409).send({ error: 'remove members before leaving — a department cannot be orphaned' });
    }
    db.prepare("UPDATE users SET department_id=NULL, role='standard' WHERE id=? AND role!='site_admin'").run(user.id);
    db.prepare("UPDATE users SET department_id=NULL WHERE id=? AND role='site_admin'").run(user.id);
    return { ok: true };
  });

  app.get('/api/departments/mine', (req, reply) => {
    const user = requireUser(req, reply); if (!user) return;
    if (!user.department_id) return { department: null };
    const dept = db.prepare('SELECT * FROM departments WHERE id=?').get(user.department_id);
    const chief = isChiefOf(user, dept.id);
    const members = db.prepare(
      'SELECT id, display_name, role FROM users WHERE department_id=? ORDER BY role DESC, display_name').all(dept.id);
    return {
      department: { id: dept.id, name: dept.name, verified_at: dept.verified_at,
                    join_code: chief ? dept.join_code : undefined },
      members, chief,
    };
  });

  app.post('/api/departments/regenerate-code', (req, reply) => {
    const user = requireUser(req, reply); if (!user) return;
    if (!isChiefOf(user, user.department_id)) return reply.code(403).send({ error: 'chief only' });
    const code = deptCode();
    db.prepare('UPDATE departments SET join_code=? WHERE id=?').run(code, user.department_id);
    return { join_code: code };
  });

  app.post('/api/departments/remove-member', (req, reply) => {
    const user = requireUser(req, reply); if (!user) return;
    if (!isChiefOf(user, user.department_id)) return reply.code(403).send({ error: 'chief only' });
    const target = db.prepare('SELECT * FROM users WHERE id=? AND department_id=?')
      .get(req.body?.user_id ?? '', user.department_id);
    if (!target || target.id === user.id) return reply.code(404).send({ error: 'member not found' });
    db.prepare("UPDATE users SET department_id=NULL, role=CASE WHEN role='site_admin' THEN role ELSE 'standard' END WHERE id=?")
      .run(target.id);
    return { ok: true };
  });

  app.post('/api/scenarios/:id/official', (req, reply) => {
    const user = requireUser(req, reply); if (!user) return;
    const s = db.prepare('SELECT * FROM scenarios WHERE id=? AND deleted_at IS NULL').get(req.params.id);
    if (!s || s.visibility !== 'department' || !isChiefOf(user, s.department_id))
      return reply.code(403).send({ error: 'only the department chief can badge department scenarios' });
    if (!deptVerified(s.department_id))
      return reply.code(403).send({ error: 'department awaiting site approval' });
    const official = req.body?.official ? 1 : 0;
    db.prepare('UPDATE scenarios SET is_official=? WHERE id=?').run(official, s.id);
    return { is_official: official };
  });

  app.get('/api/departments/mine/analytics', (req, reply) => {
    const user = requireUser(req, reply); if (!user) return;
    if (!isChiefOf(user, user.department_id)) return reply.code(403).send({ error: 'chief only' });
    const sessions = db.prepare(
      `SELECT ls.id, ls.room_code, ls.status, ls.started_at, sc.title,
              hu.display_name AS host_name,
              (SELECT COUNT(*) FROM participants p WHERE p.session_id=ls.id) AS participant_count,
              (SELECT COUNT(*) FROM responses r WHERE r.session_id=ls.id) AS response_count,
              (SELECT COUNT(*) FROM questions q WHERE q.scenario_id=ls.scenario_id AND q.deleted=0) AS question_count
       FROM live_sessions ls
       JOIN users hu ON hu.id=ls.host_id
       JOIN scenarios sc ON sc.id=ls.scenario_id
       WHERE hu.department_id=?
       ORDER BY ls.started_at DESC`).all(user.department_id);
    const trained = db.prepare(
      `SELECT COUNT(DISTINCT p.user_id) n FROM participants p
       JOIN live_sessions ls ON ls.id=p.session_id
       JOIN users hu ON hu.id=ls.host_id
       WHERE hu.department_id=? AND p.user_id IN (SELECT id FROM users WHERE department_id=?)`)
      .get(user.department_id, user.department_id).n;
    return {
      totals: {
        sessions: sessions.length,
        members_trained: trained,
        responses: sessions.reduce((a, s) => a + s.response_count, 0),
      },
      sessions: sessions.map(s => ({
        ...s,
        response_rate: s.participant_count && s.question_count
          ? Math.round(100 * s.response_count / (s.participant_count * s.question_count)) : 0,
      })),
    };
  });

  // ── Reporting & moderation ──
  app.post('/api/scenarios/:id/report', (req, reply) => {
    const user = requireUser(req, reply); if (!user) return;
    const s = db.prepare("SELECT id FROM scenarios WHERE id=? AND visibility='public' AND deleted_at IS NULL")
      .get(req.params.id);
    if (!s) return reply.code(404).send({ error: 'not found' });
    const reason = req.body?.reason?.trim();
    if (!reason) return reply.code(400).send({ error: 'reason required' });
    const open = db.prepare(
      'SELECT 1 FROM reports WHERE scenario_id=? AND reporter_id=? AND resolved_at IS NULL').get(s.id, user.id);
    if (open) return reply.code(409).send({ error: 'you already have an open report on this scenario' });
    db.prepare('INSERT INTO reports (id, scenario_id, reporter_id, reason) VALUES (?,?,?,?)')
      .run(uuid(), s.id, user.id, reason);
    reply.code(201);
    return { ok: true };
  });

  const requireSiteAdmin = (req, reply) => {
    const user = requireUser(req, reply); if (!user) return null;
    if (user.role !== 'site_admin') { reply.code(403).send({ error: 'site admin only' }); return null; }
    return user;
  };

  app.get('/api/moderation/departments', (req, reply) => {
    if (!requireSiteAdmin(req, reply)) return;
    return db.prepare(
      `SELECT d.id, d.name, d.created_at, u.display_name AS creator_name, u.email AS creator_email,
              (SELECT COUNT(*) FROM users m WHERE m.department_id=d.id) AS member_count
       FROM departments d
       LEFT JOIN users u ON u.department_id=d.id AND u.role='dept_admin'
       WHERE d.verified_at IS NULL
       ORDER BY d.created_at`).all();
  });

  app.post('/api/moderation/departments/:id/approve', (req, reply) => {
    if (!requireSiteAdmin(req, reply)) return;
    const r = db.prepare("UPDATE departments SET verified_at=datetime('now') WHERE id=? AND verified_at IS NULL")
      .run(req.params.id);
    if (!r.changes) return reply.code(404).send({ error: 'pending department not found' });
    return { ok: true };
  });

  app.post('/api/moderation/departments/:id/reject', (req, reply) => {
    if (!requireSiteAdmin(req, reply)) return;
    const dept = db.prepare('SELECT id FROM departments WHERE id=? AND verified_at IS NULL').get(req.params.id);
    if (!dept) return reply.code(404).send({ error: 'pending department not found' });
    const tx = db.transaction(() => {
      db.prepare(`UPDATE users SET department_id=NULL,
                  role=CASE WHEN role='dept_admin' THEN 'standard' ELSE role END
                  WHERE department_id=?`).run(dept.id);
      db.prepare("UPDATE scenarios SET visibility='private', department_id=NULL, is_official=0 WHERE department_id=?")
        .run(dept.id);
      db.prepare('DELETE FROM departments WHERE id=?').run(dept.id);
    });
    tx();
    return { ok: true };
  });

  app.get('/api/moderation/reports', (req, reply) => {
    if (!requireSiteAdmin(req, reply)) return;
    return db.prepare(
      `SELECT r.id, r.reason, r.created_at, s.id AS scenario_id, s.title, s.visibility,
              u.display_name AS author_name,
              (SELECT COUNT(*) FROM reports r2 WHERE r2.scenario_id=s.id AND r2.resolved_at IS NULL) AS open_reports
       FROM reports r
       JOIN scenarios s ON s.id=r.scenario_id
       LEFT JOIN users u ON u.id=s.author_id
       WHERE r.resolved_at IS NULL
       ORDER BY r.created_at`).all();
  });

  app.post('/api/moderation/reports/:id/resolve', (req, reply) => {
    if (!requireSiteAdmin(req, reply)) return;
    const report = db.prepare('SELECT * FROM reports WHERE id=? AND resolved_at IS NULL').get(req.params.id);
    if (!report) return reply.code(404).send({ error: 'report not found' });
    const action = req.body?.action;
    if (!['dismiss', 'unlist'].includes(action)) return reply.code(400).send({ error: 'action must be dismiss or unlist' });
    const tx = db.transaction(() => {
      if (action === 'unlist') {
        db.prepare("UPDATE scenarios SET visibility='private', is_official=0 WHERE id=?").run(report.scenario_id);
        // unlisting resolves every open report on that scenario
        db.prepare("UPDATE reports SET resolved_at=datetime('now'), resolution='unlisted' WHERE scenario_id=? AND resolved_at IS NULL")
          .run(report.scenario_id);
      } else {
        db.prepare("UPDATE reports SET resolved_at=datetime('now'), resolution='dismissed' WHERE id=?").run(report.id);
      }
    });
    tx();
    return { ok: true };
  });

  // ── Media ──
  app.post('/api/media', async (req, reply) => {
    const user = requireUser(req, reply); if (!user) return;
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: 'no file' });
    let buffer;
    try { buffer = await file.toBuffer(); }
    catch { return reply.code(413).send({ error: `file exceeds ${MAX_UPLOAD_BYTES / 1024 / 1024} MB limit` }); }
    const url = await media.save(buffer, file.mimetype);
    if (!url) return reply.code(415).send({ error: 'only png, jpeg, webp, or gif images are accepted' });
    reply.code(201);
    return { url };
  });

  // ── Scenario library ──
  const canSee = (s, user) =>
    s.visibility === 'public'
    || (user && s.author_id === user.id)
    || (s.visibility === 'department' && user?.department_id && s.department_id === user.department_id);
  const canLaunch = (s, user) => !s.deleted_at && canSee(s, user);

  const mediaFor = id => db.prepare(
    'SELECT id, kind, url, sort_order FROM scenario_media WHERE scenario_id=? ORDER BY sort_order').all(id);

  const replaceMedia = (scenarioId, list) => {
    db.prepare('DELETE FROM scenario_media WHERE scenario_id=?').run(scenarioId);
    const ins = db.prepare('INSERT INTO scenario_media (id, scenario_id, kind, url, sort_order) VALUES (?,?,?,?,?)');
    (list ?? []).forEach((m, i) => {
      if (m?.url && ['photo', 'ekg', 'map'].includes(m.kind ?? 'photo'))
        ins.run(uuid(), scenarioId, m.kind ?? 'photo', m.url, i);
    });
  };

  app.get('/api/scenarios', req => {
    const user = currentUser(req);
    return db.prepare(
      `SELECT s.*, u.display_name AS author_name,
              (SELECT COUNT(*) FROM questions q WHERE q.scenario_id=s.id) AS question_count,
              (SELECT COUNT(*) FROM scenario_votes v WHERE v.scenario_id=s.id) AS votes
       FROM scenarios s LEFT JOIN users u ON u.id=s.author_id
       WHERE (s.visibility='public' AND s.deleted_at IS NULL) OR s.author_id=?
          OR (s.visibility='department' AND s.department_id=? AND s.deleted_at IS NULL)
       ORDER BY s.is_official DESC, (s.author_id=?) DESC, s.created_at DESC`)
      .all(user?.id ?? '', user?.department_id ?? '', user?.id ?? '')
      .map(s => ({ ...s, mine: !!user && s.author_id === user.id }));
  });

  app.get('/api/public/scenarios', req => {
    const user = currentUser(req);
    const { category, subcategory } = req.query;
    let sql =
      `SELECT s.*, u.display_name AS author_name,
              (SELECT COUNT(*) FROM questions q WHERE q.scenario_id=s.id) AS question_count,
              (SELECT COUNT(*) FROM scenario_votes v WHERE v.scenario_id=s.id) AS votes,
              (SELECT COUNT(*) FROM scenario_votes v WHERE v.scenario_id=s.id AND v.user_id=?) AS my_vote
       FROM scenarios s LEFT JOIN users u ON u.id=s.author_id
       WHERE s.visibility='public' AND s.deleted_at IS NULL`;
    const params = [user?.id ?? ''];
    if (category) { sql += ' AND s.category=?'; params.push(category); }
    if (subcategory) { sql += ' AND s.subcategory=?'; params.push(subcategory); }
    sql += ' ORDER BY votes DESC, s.created_at DESC';
    return db.prepare(sql).all(...params);
  });

  app.get('/api/scenarios/:id', (req, reply) => {
    const s = db.prepare(
      `SELECT s.*, u.display_name AS author_name FROM scenarios s
       LEFT JOIN users u ON u.id=s.author_id WHERE s.id=?`).get(req.params.id);
    const user = currentUser(req);
    if (!s || !canSee(s, user) || (s.deleted_at && s.author_id !== user?.id))
      return reply.code(404).send({ error: 'not found' });
    const mine = s.author_id === user?.id;
    // PRD-v7: model answers are gated on full submission — only the author
    // (who needs them to edit) gets instructor_answer over REST.
    const questions = db.prepare('SELECT * FROM questions WHERE scenario_id=? AND deleted=0 ORDER BY sort_order')
      .all(s.id).map(q => ({
        ...q,
        choices: q.choices ? JSON.parse(q.choices) : null,
        instructor_answer: mine ? q.instructor_answer : undefined,
      }));
    return { ...s, questions, media: mediaFor(s.id), mine };
  });

  // ── v7 taxonomy: controlled learning objectives + filter labels ──
  const DIFFICULTIES = ['Introductory', 'Standard', 'Advanced'];
  const objectiveNames = () =>
    db.prepare('SELECT name FROM learning_objectives ORDER BY name').all().map(o => o.name);

  // Extracts and validates the taxonomy fields; returns {error} or {values}.
  const taxonomyOf = (body = {}) => {
    const t = {
      objective_primary: body.objective_primary ?? '',
      objective_secondary: body.objective_secondary ?? '',
      difficulty: body.difficulty ?? '',
      duration_min: body.duration_min ?? null,
      building_type: body.building_type ?? '',
    };
    const list = objectiveNames();
    if (t.objective_primary && !list.includes(t.objective_primary)) return { error: 'unknown primary objective' };
    if (t.objective_secondary && !list.includes(t.objective_secondary)) return { error: 'unknown secondary objective' };
    if (t.objective_secondary && !t.objective_primary) return { error: 'secondary objective requires a primary' };
    if (t.objective_secondary && t.objective_secondary === t.objective_primary) return { error: 'objectives must differ' };
    if (t.difficulty && !DIFFICULTIES.includes(t.difficulty)) return { error: 'unknown difficulty' };
    if (t.duration_min != null && !(Number.isInteger(t.duration_min) && t.duration_min > 0))
      return { error: 'duration_min must be a positive integer' };
    return { values: t };
  };

  app.get('/api/objectives', () => objectiveNames());

  app.post('/api/objectives', (req, reply) => {
    if (!requireSiteAdmin(req, reply)) return;
    const name = req.body?.name?.trim();
    if (!name) return reply.code(400).send({ error: 'name required' });
    db.prepare('INSERT OR IGNORE INTO learning_objectives (id, name) VALUES (?,?)').run(uuid(), name);
    reply.code(201);
    return { name };
  });

  // Coverage grid: objectives × categories over the public library — the
  // "measurable curriculum, visible gaps" view from the PRD.
  app.get('/api/coverage', () => {
    const objectives = objectiveNames();
    const rows = db.prepare(
      `SELECT category, objective_primary, objective_secondary FROM scenarios
       WHERE visibility='public' AND deleted_at IS NULL`).all();
    const categories = [...new Set(rows.map(r => r.category))].sort();
    const grid = Object.fromEntries(objectives.map(o => [o, Object.fromEntries(categories.map(c => [c, 0]))]));
    for (const r of rows) for (const o of [r.objective_primary, r.objective_secondary])
      if (o && grid[o]) grid[o][r.category] += 1;
    return { objectives, categories, grid };
  });

  app.post('/api/scenarios', (req, reply) => {
    const user = requireUser(req, reply); if (!user) return;
    const { title, description = '', category, subcategory, image_url = '', visibility = 'private', questions = [] } = req.body ?? {};
    if (!title || !category || !subcategory) return reply.code(400).send({ error: 'title, category, subcategory required' });
    if (!['private', 'department', 'public'].includes(visibility)) return reply.code(400).send({ error: 'bad visibility' });
    if (visibility === 'department' && !user.department_id)
      return reply.code(400).send({ error: 'join a department first' });
    if (visibility === 'department' && !deptVerified(user.department_id))
      return reply.code(400).send({ error: 'your department is awaiting site approval' });
    const tax = taxonomyOf(req.body);
    if (tax.error) return reply.code(400).send({ error: tax.error });
    const t = tax.values;
    const id = uuid();
    const tx = db.transaction(() => {
      db.prepare(`INSERT INTO scenarios (id, title, description, category, subcategory, image_url, visibility, author_id, department_id,
                    objective_primary, objective_secondary, difficulty, duration_min, building_type)
                  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, title, description, category, subcategory, image_url, visibility, user.id,
                    visibility === 'department' ? user.department_id : null,
                    t.objective_primary, t.objective_secondary, t.difficulty, t.duration_min, t.building_type);
      const ins = db.prepare(`INSERT INTO questions (id, scenario_id, prompt, kind, choices, instructor_answer, role_track, sort_order)
                              VALUES (?,?,?,?,?,?,?,?)`);
      questions.forEach((q, i) => ins.run(uuid(), id, q.prompt, q.kind ?? 'text',
        q.choices ? JSON.stringify(q.choices) : null, q.instructor_answer ?? '', q.role_track ?? '', i));
      replaceMedia(id, req.body.media);
    });
    tx();
    reply.code(201);
    return { id };
  });

  app.put('/api/scenarios/:id', (req, reply) => {
    const user = requireUser(req, reply); if (!user) return;
    const s = db.prepare('SELECT * FROM scenarios WHERE id=?').get(req.params.id);
    if (!s || s.author_id !== user.id) return reply.code(404).send({ error: 'not found' });
    const { title, description = '', category, subcategory, image_url = '', visibility = 'private', questions = [], media: mediaList } = req.body ?? {};
    if (!title || !category || !subcategory) return reply.code(400).send({ error: 'title, category, subcategory required' });
    if (!['private', 'department', 'public'].includes(visibility)) return reply.code(400).send({ error: 'bad visibility' });
    if (visibility === 'department' && !user.department_id)
      return reply.code(400).send({ error: 'join a department first' });
    if (visibility === 'department' && !deptVerified(user.department_id))
      return reply.code(400).send({ error: 'your department is awaiting site approval' });
    const tax = taxonomyOf(req.body);
    if (tax.error) return reply.code(400).send({ error: tax.error });
    const t = tax.values;
    const existing = db.prepare('SELECT id FROM questions WHERE scenario_id=? AND deleted=0').all(s.id).map(q => q.id);
    const keptIds = new Set(questions.filter(q => q.id).map(q => q.id));
    const tx = db.transaction(() => {
      // leaving department scope clears the department link and any official badge
      db.prepare(`UPDATE scenarios SET title=?, description=?, category=?, subcategory=?, image_url=?, visibility=?,
                  department_id=?, is_official=CASE WHEN ?='department' THEN is_official ELSE 0 END,
                  objective_primary=?, objective_secondary=?, difficulty=?, duration_min=?, building_type=? WHERE id=?`)
        .run(title, description, category, subcategory, image_url, visibility,
             visibility === 'department' ? user.department_id : null, visibility,
             t.objective_primary, t.objective_secondary, t.difficulty, t.duration_min, t.building_type, s.id);
      // Reconcile questions: update kept, insert new, soft-delete removed (responses may reference them).
      const upd = db.prepare(`UPDATE questions SET prompt=?, kind=?, choices=?, instructor_answer=?, role_track=?, sort_order=? WHERE id=? AND scenario_id=?`);
      const ins = db.prepare(`INSERT INTO questions (id, scenario_id, prompt, kind, choices, instructor_answer, role_track, sort_order)
                              VALUES (?,?,?,?,?,?,?,?)`);
      questions.forEach((q, i) => {
        const choices = q.choices ? JSON.stringify(q.choices) : null;
        if (q.id && existing.includes(q.id))
          upd.run(q.prompt, q.kind ?? 'text', choices, q.instructor_answer ?? '', q.role_track ?? '', i, q.id, s.id);
        else
          ins.run(uuid(), s.id, q.prompt, q.kind ?? 'text', choices, q.instructor_answer ?? '', q.role_track ?? '', i);
      });
      const gone = existing.filter(id => !keptIds.has(id));
      if (gone.length) {
        const del = db.prepare('UPDATE questions SET deleted=1 WHERE id=?');
        gone.forEach(id => del.run(id));
      }
      if (mediaList !== undefined) replaceMedia(s.id, mediaList);
    });
    tx();
    return { id: s.id };
  });

  app.delete('/api/scenarios/:id', (req, reply) => {
    const user = requireUser(req, reply); if (!user) return;
    const r = db.prepare(`UPDATE scenarios SET deleted_at=datetime('now') WHERE id=? AND author_id=? AND deleted_at IS NULL`)
      .run(req.params.id, user.id);
    if (!r.changes) return reply.code(404).send({ error: 'not found' });
    return { ok: true };
  });

  app.post('/api/scenarios/:id/restore', (req, reply) => {
    const user = requireUser(req, reply); if (!user) return;
    const r = db.prepare('UPDATE scenarios SET deleted_at=NULL WHERE id=? AND author_id=? AND deleted_at IS NOT NULL')
      .run(req.params.id, user.id);
    if (!r.changes) return reply.code(404).send({ error: 'not found' });
    return { ok: true };
  });

  app.post('/api/scenarios/:id/clone', (req, reply) => {
    const user = requireUser(req, reply); if (!user) return;
    const src = db.prepare('SELECT * FROM scenarios WHERE id=?').get(req.params.id);
    if (!src || !canSee(src, user)) return reply.code(404).send({ error: 'not found' });
    const id = uuid();
    const tx = db.transaction(() => {
      db.prepare(`INSERT INTO scenarios (id, title, description, category, subcategory, image_url, visibility, author_id, cloned_from)
                  VALUES (?,?,?,?,?,?,'private',?,?)`)
        .run(id, src.title, src.description, src.category, src.subcategory, src.image_url, user.id, src.id);
      const qs = db.prepare('SELECT * FROM questions WHERE scenario_id=? AND deleted=0 ORDER BY sort_order').all(src.id);
      const ins = db.prepare(`INSERT INTO questions (id, scenario_id, prompt, kind, choices, instructor_answer, role_track, sort_order)
                              VALUES (?,?,?,?,?,?,?,?)`);
      qs.forEach(q => ins.run(uuid(), id, q.prompt, q.kind, q.choices, q.instructor_answer, q.role_track, q.sort_order));
      replaceMedia(id, mediaFor(src.id));
    });
    tx();
    reply.code(201);
    return { id };
  });

  app.post('/api/scenarios/:id/vote', (req, reply) => {
    const user = requireUser(req, reply); if (!user) return;
    const s = db.prepare("SELECT id FROM scenarios WHERE id=? AND visibility='public'").get(req.params.id);
    if (!s) return reply.code(404).send({ error: 'not found' });
    const existing = db.prepare('SELECT 1 FROM scenario_votes WHERE user_id=? AND scenario_id=?').get(user.id, s.id);
    if (existing) db.prepare('DELETE FROM scenario_votes WHERE user_id=? AND scenario_id=?').run(user.id, s.id);
    else db.prepare('INSERT INTO scenario_votes (user_id, scenario_id) VALUES (?,?)').run(user.id, s.id);
    const votes = db.prepare('SELECT COUNT(*) n FROM scenario_votes WHERE scenario_id=?').get(s.id).n;
    return { voted: !existing, votes };
  });

  // ── Completed library ──
  app.get('/api/me/sessions', (req, reply) => {
    const user = requireUser(req, reply); if (!user) return;
    return db.prepare(
      `SELECT DISTINCT ls.id, ls.room_code, ls.status, ls.started_at, ls.ended_at, ls.mode,
              sc.title, sc.category, sc.subcategory,
              COALESCE(ls.host_id=?, 0) AS hosted
       FROM live_sessions ls
       JOIN scenarios sc ON sc.id=ls.scenario_id
       LEFT JOIN participants p ON p.session_id=ls.id AND p.user_id=?
       WHERE ls.host_id=? OR p.id IS NOT NULL
       ORDER BY ls.started_at DESC`).all(user.id, user.id, user.id);
  });

  // ── v7: solo runs (PRD-v7) ──
  // Solo play reuses the session/response model with mode='solo': no room
  // code flow, no sockets, no host. Guests run statelessly via solo-reveal;
  // signed-in players' runs persist to their library.
  const trackQuestions = (scenarioId, roleTrack = '') =>
    db.prepare(`SELECT * FROM questions WHERE scenario_id=? AND deleted=0
                ${roleTrack ? "AND (role_track='' OR role_track=?)" : ''} ORDER BY sort_order`)
      .all(...(roleTrack ? [scenarioId, roleTrack] : [scenarioId]))
      .map(q => ({ ...q, choices: q.choices ? JSON.parse(q.choices) : null }));

  const officialFor = qs => Object.fromEntries(qs.map(q => [q.id, q.instructor_answer ?? '']));

  // Guest (or any) stateless solo run: submit every answer at once, get every
  // model answer back. Nothing is stored — "won't be saved" is literal.
  app.post('/api/scenarios/:id/solo-reveal', (req, reply) => {
    const s = db.prepare('SELECT * FROM scenarios WHERE id=?').get(req.params.id);
    const user = currentUser(req);
    if (!s || !canSee(s, user) || s.deleted_at) return reply.code(404).send({ error: 'not found' });
    const { answers = {}, role_track = '' } = req.body ?? {};
    const qs = trackQuestions(s.id, role_track);
    if (!qs.length) return reply.code(400).send({ error: 'no questions for this role' });
    const missing = qs.filter(q => !String(answers[q.id] ?? '').trim()).length;
    if (missing) return reply.code(400).send({ error: 'answer every question first', missing });
    return { official_answers: officialFor(qs) };
  });

  app.post('/api/solo/runs', (req, reply) => {
    const user = requireUser(req, reply); if (!user) return;
    const { scenario_id, role_track = '' } = req.body ?? {};
    const s = scenario_id && db.prepare('SELECT * FROM scenarios WHERE id=?').get(scenario_id);
    if (!s || !canLaunch(s, user)) return reply.code(404).send({ error: 'not found' });
    const qs = trackQuestions(s.id, role_track);
    if (!qs.length) return reply.code(400).send({ error: 'no questions for this role' });
    const id = uuid();
    db.transaction(() => {
      db.prepare(`INSERT INTO live_sessions (id, room_code, scenario_id, host_id, mode)
                  VALUES (?,?,?,NULL,'solo')`).run(id, 'SOLO-' + id, s.id);
      db.prepare(`INSERT INTO participants (id, session_id, token, display_tag, user_id, role_track)
                  VALUES (?,?,?,?,?,?)`).run(uuid(), id, uuid(), 'You', user.id, role_track);
    })();
    reply.code(201);
    return { run_id: id, questions: qs.map(q => ({ ...q, instructor_answer: undefined })) };
  });

  app.post('/api/solo/runs/:id/answers', (req, reply) => {
    const user = requireUser(req, reply); if (!user) return;
    const ls = db.prepare(`SELECT * FROM live_sessions WHERE id=? AND mode='solo'`).get(req.params.id);
    const me = ls && db.prepare('SELECT * FROM participants WHERE session_id=? AND user_id=?').get(ls.id, user.id);
    if (!ls || !me) return reply.code(404).send({ error: 'not found' });
    if (ls.status !== 'live') return reply.code(400).send({ error: 'run already submitted' });
    const { question_id, body } = req.body ?? {};
    const qs = trackQuestions(ls.scenario_id, me.role_track);
    if (!body?.trim() || !qs.some(q => q.id === question_id))
      return reply.code(400).send({ error: 'invalid question or empty answer' });
    if (db.prepare('SELECT 1 FROM responses WHERE session_id=? AND participant_id=? AND question_id=?')
      .get(ls.id, me.id, question_id))
      return reply.code(409).send({ error: 'already answered' });
    rooms.submitResponse(ls.id, question_id, me.id, body.trim());
    const done = db.prepare(
      'SELECT COUNT(DISTINCT question_id) n FROM responses WHERE session_id=? AND participant_id=?')
      .get(ls.id, me.id).n;
    if (done < qs.length) return { ok: true, complete: false };
    rooms.endSession(ls.id); // full submission = the run's debrief moment
    return { ok: true, complete: true, official_answers: officialFor(qs) };
  });

  // Shared by the JSON detail view and the PDF download. Returns null if not permitted.
  function sessionDetailFor(user, sessionId) {
    const ls = db.prepare(
      `SELECT ls.*, sc.title, sc.description, sc.category, sc.subcategory, sc.image_url
       FROM live_sessions ls JOIN scenarios sc ON sc.id=ls.scenario_id WHERE ls.id=?`).get(sessionId);
    const me = ls && db.prepare('SELECT * FROM participants WHERE session_id=? AND user_id=?').get(ls.id, user.id);
    if (!ls || (ls.host_id !== user.id && !me)) return null;
    // PRD-v7 gating: the host always sees model answers; a participant once
    // they answered every question — or once the session has ended (debrief).
    const revealAnswers = ls.host_id === user.id || ls.status !== 'live'
      || (me && rooms.hasAnsweredAll(ls.id, me.id));
    // Include soft-deleted questions: the session happened with them.
    // A participant who played a role only ever saw common + role questions;
    // the host's archive keeps every track.
    const filterTrack = me?.role_track && ls.host_id !== user.id;
    const questions = db.prepare('SELECT * FROM questions WHERE scenario_id=? ORDER BY sort_order')
      .all(ls.scenario_id)
      .filter(q => !filterTrack || !q.role_track || q.role_track === me.role_track)
      .map(q => ({
        ...q,
        choices: q.choices ? JSON.parse(q.choices) : null,
        instructor_answer: revealAnswers ? q.instructor_answer : undefined,
      }));
    const responses = db.prepare(
      `SELECT r.*, p.display_tag, p.user_id, p.role_track FROM responses r
       JOIN participants p ON p.id=r.participant_id WHERE r.session_id=?`).all(ls.id);
    const notes = me ? db.prepare('SELECT * FROM notes WHERE session_id=? AND participant_id=?').all(ls.id, me.id) : [];
    return { session: ls, questions, responses, notes, media: mediaFor(ls.scenario_id), my_participant_id: me?.id ?? null };
  }

  // ── v6: AI after-action analysis (PRD-v6, Layer 1) ──
  // Generates once per session, best-effort: any failure logs and leaves the session
  // exactly as it is today. Debriefs start as drafts only the host sees; the host
  // edits and shares them — the AI never speaks to the crew unreviewed.
  async function generateAnalysis(sessionId) {
    if (!analyzer) return null; // no ANTHROPIC_API_KEY — feature dormant
    const existing = db.prepare('SELECT * FROM session_analyses WHERE session_id=?').get(sessionId);
    if (existing) return existing; // cached — never re-bill
    const ls = db.prepare(
      `SELECT ls.*, sc.title, sc.description FROM live_sessions ls
       JOIN scenarios sc ON sc.id=ls.scenario_id WHERE ls.id=?`).get(sessionId);
    if (!ls) return null;
    const responses = db.prepare('SELECT * FROM responses WHERE session_id=?').all(sessionId);
    if (!responses.length) return null; // nothing to analyze
    const questions = db.prepare('SELECT * FROM questions WHERE scenario_id=? ORDER BY sort_order').all(ls.scenario_id);
    const participants = db.prepare('SELECT id, display_tag FROM participants WHERE session_id=?').all(sessionId);
    const result = await analyzer.analyzeSession({ session: ls, questions, responses, participants });
    // Persist atomically; tolerate a concurrent generation having won the race.
    const validIds = new Set(participants.map(p => p.id));
    db.transaction(() => {
      db.prepare(`INSERT OR IGNORE INTO session_analyses (session_id, crew_summary, assessments)
                  VALUES (?,?,?)`).run(sessionId, result.crew_summary, JSON.stringify(result.assessments));
      const ins = db.prepare(`INSERT OR IGNORE INTO participant_debriefs (id, session_id, participant_id, body)
                              VALUES (?,?,?,?)`);
      for (const d of result.participant_debriefs) {
        if (validIds.has(d.participant_id)) ins.run(uuid(), sessionId, d.participant_id, d.debrief);
      }
    })();
    return db.prepare('SELECT * FROM session_analyses WHERE session_id=?').get(sessionId);
  }

  const isHostOf = (user, sessionId) =>
    !!db.prepare('SELECT 1 FROM live_sessions WHERE id=? AND host_id=?').get(sessionId, user.id);

  // Host: generate (idempotent) and fetch the full analysis with draft debriefs.
  app.post('/api/me/sessions/:id/analysis', async (req, reply) => {
    const user = requireUser(req, reply); if (!user) return;
    if (!isHostOf(user, req.params.id)) return reply.code(404).send({ error: 'not found' });
    if (!analyzer) return reply.code(503).send({ error: 'AI analysis is not enabled on this server' });
    try {
      const analysis = await generateAnalysis(req.params.id);
      if (!analysis) return reply.code(409).send({ error: 'no responses to analyze' });
      return analysisFor(req.params.id, true);
    } catch (err) {
      req.log.error({ err }, 'analysis generation failed');
      return reply.code(502).send({ error: 'analysis failed — the session is unaffected; try again later' });
    }
  });

  function analysisFor(sessionId, includeDrafts) {
    const analysis = db.prepare('SELECT * FROM session_analyses WHERE session_id=?').get(sessionId);
    if (!analysis) return null;
    const debriefs = db.prepare(
      `SELECT d.*, p.display_tag FROM participant_debriefs d
       JOIN participants p ON p.id=d.participant_id
       WHERE d.session_id=? ${includeDrafts ? '' : 'AND d.shared_at IS NOT NULL'}`).all(sessionId);
    return { crew_summary: analysis.crew_summary, assessments: JSON.parse(analysis.assessments),
             created_at: analysis.created_at, debriefs };
  }

  // Host edits a draft debrief; the edited text is what the participant will see.
  app.put('/api/me/sessions/:id/debriefs/:debriefId', (req, reply) => {
    const user = requireUser(req, reply); if (!user) return;
    if (!isHostOf(user, req.params.id)) return reply.code(404).send({ error: 'not found' });
    const body = req.body?.body?.trim();
    if (!body) return reply.code(400).send({ error: 'debrief body required' });
    const r = db.prepare('UPDATE participant_debriefs SET body=? WHERE id=? AND session_id=?')
      .run(body, req.params.debriefId, req.params.id);
    if (!r.changes) return reply.code(404).send({ error: 'debrief not found' });
    return { ok: true };
  });

  // Host shares all (or one) debriefs, making them visible to their participants.
  app.post('/api/me/sessions/:id/debriefs/share', (req, reply) => {
    const user = requireUser(req, reply); if (!user) return;
    if (!isHostOf(user, req.params.id)) return reply.code(404).send({ error: 'not found' });
    const one = req.body?.debrief_id;
    const r = one
      ? db.prepare("UPDATE participant_debriefs SET shared_at=datetime('now') WHERE id=? AND session_id=? AND shared_at IS NULL")
          .run(one, req.params.id)
      : db.prepare("UPDATE participant_debriefs SET shared_at=datetime('now') WHERE session_id=? AND shared_at IS NULL")
          .run(req.params.id);
    return { shared: r.changes };
  });

  app.get('/api/me/sessions/:id', (req, reply) => {
    const user = requireUser(req, reply); if (!user) return;
    const detail = sessionDetailFor(user, req.params.id);
    if (!detail) return reply.code(404).send({ error: 'not found' });
    // v6: host sees the full analysis incl. drafts; a participant sees only their own
    // shared debrief. Absent analysis (or no key) leaves the payload as before.
    const isHost = detail.session.host_id === user.id;
    if (isHost) {
      detail.analysis = analysisFor(req.params.id, true);
      detail.analysis_available = !!analyzer;
    } else if (detail.my_participant_id) {
      const d = db.prepare(
        `SELECT body, shared_at FROM participant_debriefs
         WHERE session_id=? AND participant_id=? AND shared_at IS NOT NULL`)
        .get(req.params.id, detail.my_participant_id);
      if (d) detail.my_debrief = d;
    }
    return detail;
  });

  app.get('/api/me/sessions/:id/pdf', (req, reply) => {
    const user = requireUser(req, reply); if (!user) return;
    const detail = sessionDetailFor(user, req.params.id);
    if (!detail) return reply.code(404).send({ error: 'not found' });
    const safe = detail.session.title.replace(/[^\w\- ]+/g, '').trim().replace(/ +/g, '_') || 'session';
    reply.type('application/pdf')
      .header('content-disposition', `attachment; filename="${safe}_${detail.session.room_code}.pdf"`);
    return reply.send(sessionPdf(detail));
  });

  // ── Live sessions ──
  app.post('/api/sessions', (req, reply) => {
    const user = requireUser(req, reply); if (!user) return;
    const s = db.prepare('SELECT * FROM scenarios WHERE id=?').get(req.body?.scenario_id ?? '');
    if (!s) return reply.code(404).send({ error: 'scenario not found' });
    if (!canLaunch(s, user)) return reply.code(403).send({ error: 'not launchable' });
    const room = rooms.createSession(s.id, user.id);
    return { room_code: room.session.room_code, session_id: room.session.id };
  });

  app.get('/api/sessions/:code/qr.svg', async (req, reply) => {
    const state = rooms.roomState(req.params.code);
    if (!state) return reply.code(404).send({ error: 'room not found' });
    const url = `${req.protocol}://${req.headers.host}/#/join/${state.session.room_code}`;
    const svg = await QRCode.toString(url, { type: 'svg', margin: 1, width: 320 });
    reply.type('image/svg+xml').send(svg);
  });

  app.get('/api/sessions/:code', (req, reply) => {
    const state = rooms.roomState(req.params.code);
    if (!state) return reply.code(404).send({ error: 'room not found' });
    return state;
  });

  // ── Socket.IO ──
  const io = new SocketServer(app.server);

  const counts = code => io.sockets.adapter.rooms.get(`room:${code}`)?.size ?? 0;

  io.on('connection', socket => {
    const socketUser = userFromCookieHeader(db, socket.handshake.headers.cookie);

    socket.on('join_room', ({ code, token, role, role_track }, ack) => {
      const room = rooms.getByCode(code);
      if (!room || room.session.mode === 'solo') return ack?.({ error: 'Room not found' });
      if (role === 'host' && (!socketUser || room.session.host_id !== socketUser.id))
        return ack?.({ error: 'Only the session host can open the control room' });
      code = room.session.room_code;
      socket.data = { code, role, sessionId: room.session.id };
      socket.join(`room:${code}`);

      let participant = null;
      if (role === 'host') {
        socket.join(`room:${code}:host`);
      } else {
        participant = rooms.join(room.session.id, token || uuid(), socketUser?.id ?? null,
          typeof role_track === 'string' ? role_track : '');
        socket.data.participantId = participant.id;
        socket.data.roleTrack = participant.role_track;
      }

      const state = rooms.roomState(code, { includeAnswers: role === 'host' });
      // Role tracks present in this scenario — the client's role-pick options.
      state.tracks = [...new Set(room.questions.map(q => q.role_track).filter(Boolean))];
      if (role !== 'host') {
        // v7 role overlay: a participant with a role sees common + role questions.
        if (participant.role_track)
          state.questions = state.questions.filter(q => !q.role_track || q.role_track === participant.role_track);
        // PRD-v7: no partial reveals — instructor answers appear only once
        // this participant has answered every question in their track (or the
        // session has ended and everyone moves to debrief), then all at once.
        const revealed = room.session.status !== 'live'
          || rooms.hasAnsweredAll(room.session.id, participant.id);
        if (revealed) {
          const answers = rooms.officialAnswers(room.session.id, participant.role_track);
          state.questions = state.questions.map(q => ({ ...q, instructor_answer: answers[q.id] }));
        }
        state.answers_revealed = revealed;
      }
      io.to(`room:${code}`).emit('participant_count', counts(code));
      ack?.({ state, participant });
    });

    socket.on('submit_response', ({ question_id, body }, ack) => {
      const { sessionId, participantId, code, roleTrack } = socket.data ?? {};
      if (!sessionId || !participantId || !body?.trim()) return ack?.({ error: 'invalid' });
      const q = rooms.getByCode(code)?.questions.find(x => x.id === question_id);
      if (!q || (roleTrack && q.role_track && q.role_track !== roleTrack))
        return ack?.({ error: 'invalid' }); // not this participant's track
      const resp = rooms.submitResponse(sessionId, question_id, participantId, body.trim());
      io.to(`room:${code}:host`).emit('response_incoming', resp);
      // PRD-v7: answers reveal only when this submission completes the track set.
      const complete = rooms.hasAnsweredAll(sessionId, participantId);
      ack?.(complete
        ? { ok: true, complete, official_answers: rooms.officialAnswers(sessionId, roleTrack) }
        : { ok: true, complete });
    });

    socket.on('push_answer', ({ response_id }) => {
      const { code, role } = socket.data ?? {};
      if (role !== 'host' || !code) return;
      const resp = rooms.pushAnswer(response_id);
      if (resp) io.to(`room:${code}`).emit('answer_pushed', resp);
    });

    socket.on('save_note', ({ question_id, body }, ack) => {
      const { sessionId, participantId } = socket.data ?? {};
      if (!sessionId || !participantId) return ack?.({ error: 'invalid' });
      rooms.saveNote(sessionId, question_id ?? null, participantId, body ?? '');
      ack?.({ ok: true });
    });

    socket.on('end_session', (_payload, ack) => {
      const { code, role, sessionId } = socket.data ?? {};
      if (role !== 'host' || !code) return ack?.({ error: 'host only' });
      rooms.endSession(sessionId);
      io.to(`room:${code}`).emit('session_ended');
      // v6: kick off the after-action draft in the background — never blocks the
      // live loop; a failure just means the host generates on demand later.
      if (analyzer) generateAnalysis(sessionId)
        .catch(err => app.log.error({ err }, 'post-session analysis failed'));
      ack?.({ ok: true });
    });

    socket.on('disconnect', () => {
      const { code } = socket.data ?? {};
      if (code) io.to(`room:${code}`).emit('participant_count', counts(code));
    });
  });

  return { app, io, db };
}

// Multi-node fan-out is one env var away: set REDIS_URL and the adapter loads.
async function attachRedisAdapter(io) {
  if (!process.env.REDIS_URL) return;
  const { createAdapter } = await import('@socket.io/redis-adapter');
  const { createClient } = await import('redis');
  const pub = createClient({ url: process.env.REDIS_URL });
  const sub = pub.duplicate();
  await Promise.all([pub.connect(), sub.connect()]);
  io.adapter(createAdapter(pub, sub));
  console.log('Socket.IO Redis adapter attached');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { app, io } = await buildServer();
  const port = Number(process.env.PORT) || 3000;
  attachRedisAdapter(io)
    .catch(err => console.error('Redis adapter failed, continuing single-node:', err.message))
    .then(() => app.listen({ port, host: '0.0.0.0' }))
    .then(() => console.log(`ProtoCall Trainer running at http://localhost:${port}`));

  // Graceful shutdown so redeploys don't drop mid-session events.
  let shuttingDown = false;
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`${sig} received — closing`);
      io.close();
      app.close().then(() => process.exit(0));
      setTimeout(() => process.exit(0), 5000).unref();
    });
  }
}
