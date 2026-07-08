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
} from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function buildServer({ dbFile, mediaDir, authRateMax = 10, globalRateMax = 300 } = {}) {
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
    reply.header('set-cookie', setCookieValue(createAuthSession(db, id)));
    reply.code(201);
    return { id, email, display_name: display_name.trim(), claimed_sessions: claimed };
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
    return { id: user.id, email: user.email, display_name: user.display_name,
             role: user.role, department: dept };
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
    return { id };
  });

  app.post('/api/departments/join', (req, reply) => {
    const user = requireUser(req, reply); if (!user) return;
    if (user.department_id) return reply.code(409).send({ error: 'you already belong to a department' });
    const dept = db.prepare('SELECT * FROM departments WHERE join_code=?')
      .get((req.body?.code ?? '').trim().toUpperCase());
    if (!dept) return reply.code(404).send({ error: 'invalid join code' });
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
    const s = db.prepare('SELECT * FROM scenarios WHERE id=?').get(req.params.id);
    const user = currentUser(req);
    if (!s || !canSee(s, user) || (s.deleted_at && s.author_id !== user?.id))
      return reply.code(404).send({ error: 'not found' });
    const questions = db.prepare('SELECT * FROM questions WHERE scenario_id=? AND deleted=0 ORDER BY sort_order')
      .all(s.id).map(q => ({ ...q, choices: q.choices ? JSON.parse(q.choices) : null }));
    return { ...s, questions, media: mediaFor(s.id), mine: s.author_id === user?.id };
  });

  app.post('/api/scenarios', (req, reply) => {
    const user = requireUser(req, reply); if (!user) return;
    const { title, description = '', category, subcategory, image_url = '', visibility = 'private', questions = [] } = req.body ?? {};
    if (!title || !category || !subcategory) return reply.code(400).send({ error: 'title, category, subcategory required' });
    if (!['private', 'department', 'public'].includes(visibility)) return reply.code(400).send({ error: 'bad visibility' });
    if (visibility === 'department' && !user.department_id)
      return reply.code(400).send({ error: 'join a department first' });
    const id = uuid();
    const tx = db.transaction(() => {
      db.prepare(`INSERT INTO scenarios (id, title, description, category, subcategory, image_url, visibility, author_id, department_id)
                  VALUES (?,?,?,?,?,?,?,?,?)`).run(id, title, description, category, subcategory, image_url, visibility, user.id,
                    visibility === 'department' ? user.department_id : null);
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
    const existing = db.prepare('SELECT id FROM questions WHERE scenario_id=? AND deleted=0').all(s.id).map(q => q.id);
    const keptIds = new Set(questions.filter(q => q.id).map(q => q.id));
    const tx = db.transaction(() => {
      // leaving department scope clears the department link and any official badge
      db.prepare(`UPDATE scenarios SET title=?, description=?, category=?, subcategory=?, image_url=?, visibility=?,
                  department_id=?, is_official=CASE WHEN ?='department' THEN is_official ELSE 0 END WHERE id=?`)
        .run(title, description, category, subcategory, image_url, visibility,
             visibility === 'department' ? user.department_id : null, visibility, s.id);
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
      `SELECT DISTINCT ls.id, ls.room_code, ls.status, ls.started_at, ls.ended_at,
              sc.title, sc.category, sc.subcategory,
              (ls.host_id=?) AS hosted
       FROM live_sessions ls
       JOIN scenarios sc ON sc.id=ls.scenario_id
       LEFT JOIN participants p ON p.session_id=ls.id AND p.user_id=?
       WHERE ls.host_id=? OR p.id IS NOT NULL
       ORDER BY ls.started_at DESC`).all(user.id, user.id, user.id);
  });

  // Shared by the JSON detail view and the PDF download. Returns null if not permitted.
  function sessionDetailFor(user, sessionId) {
    const ls = db.prepare(
      `SELECT ls.*, sc.title, sc.description, sc.category, sc.subcategory, sc.image_url
       FROM live_sessions ls JOIN scenarios sc ON sc.id=ls.scenario_id WHERE ls.id=?`).get(sessionId);
    const me = ls && db.prepare('SELECT * FROM participants WHERE session_id=? AND user_id=?').get(ls.id, user.id);
    if (!ls || (ls.host_id !== user.id && !me)) return null;
    // Include soft-deleted questions: the session happened with them.
    const questions = db.prepare('SELECT * FROM questions WHERE scenario_id=? ORDER BY sort_order')
      .all(ls.scenario_id).map(q => ({ ...q, choices: q.choices ? JSON.parse(q.choices) : null }));
    const responses = db.prepare(
      `SELECT r.*, p.display_tag, p.user_id FROM responses r
       JOIN participants p ON p.id=r.participant_id WHERE r.session_id=?`).all(ls.id);
    const notes = me ? db.prepare('SELECT * FROM notes WHERE session_id=? AND participant_id=?').all(ls.id, me.id) : [];
    return { session: ls, questions, responses, notes, media: mediaFor(ls.scenario_id), my_participant_id: me?.id ?? null };
  }

  app.get('/api/me/sessions/:id', (req, reply) => {
    const user = requireUser(req, reply); if (!user) return;
    const detail = sessionDetailFor(user, req.params.id);
    if (!detail) return reply.code(404).send({ error: 'not found' });
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

    socket.on('join_room', ({ code, token, role }, ack) => {
      const room = rooms.getByCode(code);
      if (!room) return ack?.({ error: 'Room not found' });
      if (role === 'host' && (!socketUser || room.session.host_id !== socketUser.id))
        return ack?.({ error: 'Only the session host can open the control room' });
      code = room.session.room_code;
      socket.data = { code, role, sessionId: room.session.id };
      socket.join(`room:${code}`);

      let participant = null;
      if (role === 'host') {
        socket.join(`room:${code}:host`);
      } else {
        participant = rooms.join(room.session.id, token || uuid(), socketUser?.id ?? null);
        socket.data.participantId = participant.id;
      }

      const state = rooms.roomState(code, { includeAnswers: role === 'host' });
      if (role !== 'host') {
        // reveal instructor answers only for questions this participant already answered
        const answered = new Set(state.responses
          .filter(r => r.participant_id === participant.id).map(r => r.question_id));
        state.questions = state.questions.map(q => answered.has(q.id)
          ? { ...q, instructor_answer: room.questions.find(x => x.id === q.id).instructor_answer }
          : q);
      }
      io.to(`room:${code}`).emit('participant_count', counts(code));
      ack?.({ state, participant });
    });

    socket.on('submit_response', ({ question_id, body }, ack) => {
      const { sessionId, participantId, code } = socket.data ?? {};
      if (!sessionId || !participantId || !body?.trim()) return ack?.({ error: 'invalid' });
      const resp = rooms.submitResponse(sessionId, question_id, participantId, body.trim());
      io.to(`room:${code}:host`).emit('response_incoming', resp);
      const q = rooms.getByCode(code).questions.find(x => x.id === question_id);
      ack?.({ ok: true, official_answer: q?.instructor_answer ?? '' });
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
