import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
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

export function buildServer({ dbFile } = {}) {
  const db = createDb(dbFile);
  seedIfEmpty(db);
  const rooms = new Rooms(db);

  const app = Fastify();
  app.register(fastifyStatic, { root: path.join(__dirname, '..', 'public') });

  const currentUser = req => userFromCookieHeader(db, req.headers.cookie);
  const requireUser = (req, reply) => {
    const user = currentUser(req);
    if (!user) reply.code(401).send({ error: 'login required' });
    return user;
  };

  // ── Auth ──
  app.post('/api/signup', (req, reply) => {
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

  app.post('/api/login', (req, reply) => {
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
    return user ? { id: user.id, email: user.email, display_name: user.display_name } : null;
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

  // ── Scenario library ──
  const canLaunch = (s, user) => s.visibility === 'public' || (user && s.author_id === user.id);

  app.get('/api/scenarios', req => {
    const user = currentUser(req);
    return db.prepare(
      `SELECT s.*, u.display_name AS author_name,
              (SELECT COUNT(*) FROM questions q WHERE q.scenario_id=s.id) AS question_count,
              (SELECT COUNT(*) FROM scenario_votes v WHERE v.scenario_id=s.id) AS votes
       FROM scenarios s LEFT JOIN users u ON u.id=s.author_id
       WHERE s.visibility='public' OR s.author_id=?
       ORDER BY (s.author_id=?) DESC, s.created_at DESC`)
      .all(user?.id ?? '', user?.id ?? '')
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
       WHERE s.visibility='public'`;
    const params = [user?.id ?? ''];
    if (category) { sql += ' AND s.category=?'; params.push(category); }
    if (subcategory) { sql += ' AND s.subcategory=?'; params.push(subcategory); }
    sql += ' ORDER BY votes DESC, s.created_at DESC';
    return db.prepare(sql).all(...params);
  });

  app.get('/api/scenarios/:id', (req, reply) => {
    const s = db.prepare('SELECT * FROM scenarios WHERE id=?').get(req.params.id);
    const user = currentUser(req);
    if (!s || (s.visibility !== 'public' && s.author_id !== user?.id))
      return reply.code(404).send({ error: 'not found' });
    const questions = db.prepare('SELECT * FROM questions WHERE scenario_id=? ORDER BY sort_order')
      .all(s.id).map(q => ({ ...q, choices: q.choices ? JSON.parse(q.choices) : null }));
    return { ...s, questions, mine: s.author_id === user?.id };
  });

  app.post('/api/scenarios', (req, reply) => {
    const user = requireUser(req, reply); if (!user) return;
    const { title, description = '', category, subcategory, image_url = '', visibility = 'private', questions = [] } = req.body ?? {};
    if (!title || !category || !subcategory) return reply.code(400).send({ error: 'title, category, subcategory required' });
    if (!['private', 'public'].includes(visibility)) return reply.code(400).send({ error: 'bad visibility' });
    const id = uuid();
    const tx = db.transaction(() => {
      db.prepare(`INSERT INTO scenarios (id, title, description, category, subcategory, image_url, visibility, author_id)
                  VALUES (?,?,?,?,?,?,?,?)`).run(id, title, description, category, subcategory, image_url, visibility, user.id);
      const ins = db.prepare(`INSERT INTO questions (id, scenario_id, prompt, kind, choices, instructor_answer, role_track, sort_order)
                              VALUES (?,?,?,?,?,?,?,?)`);
      questions.forEach((q, i) => ins.run(uuid(), id, q.prompt, q.kind ?? 'text',
        q.choices ? JSON.stringify(q.choices) : null, q.instructor_answer ?? '', q.role_track ?? '', i));
    });
    tx();
    reply.code(201);
    return { id };
  });

  app.post('/api/scenarios/:id/clone', (req, reply) => {
    const user = requireUser(req, reply); if (!user) return;
    const src = db.prepare('SELECT * FROM scenarios WHERE id=?').get(req.params.id);
    if (!src || (src.visibility !== 'public' && src.author_id !== user.id))
      return reply.code(404).send({ error: 'not found' });
    const id = uuid();
    const tx = db.transaction(() => {
      db.prepare(`INSERT INTO scenarios (id, title, description, category, subcategory, image_url, visibility, author_id, cloned_from)
                  VALUES (?,?,?,?,?,?,'private',?,?)`)
        .run(id, src.title, src.description, src.category, src.subcategory, src.image_url, user.id, src.id);
      const qs = db.prepare('SELECT * FROM questions WHERE scenario_id=? ORDER BY sort_order').all(src.id);
      const ins = db.prepare(`INSERT INTO questions (id, scenario_id, prompt, kind, choices, instructor_answer, role_track, sort_order)
                              VALUES (?,?,?,?,?,?,?,?)`);
      qs.forEach(q => ins.run(uuid(), id, q.prompt, q.kind, q.choices, q.instructor_answer, q.role_track, q.sort_order));
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

  app.get('/api/me/sessions/:id', (req, reply) => {
    const user = requireUser(req, reply); if (!user) return;
    const ls = db.prepare(
      `SELECT ls.*, sc.title, sc.description, sc.category, sc.subcategory, sc.image_url
       FROM live_sessions ls JOIN scenarios sc ON sc.id=ls.scenario_id WHERE ls.id=?`).get(req.params.id);
    const me = ls && db.prepare('SELECT * FROM participants WHERE session_id=? AND user_id=?').get(ls.id, user.id);
    if (!ls || (ls.host_id !== user.id && !me)) return reply.code(404).send({ error: 'not found' });
    const questions = db.prepare('SELECT * FROM questions WHERE scenario_id=? ORDER BY sort_order')
      .all(ls.scenario_id).map(q => ({ ...q, choices: q.choices ? JSON.parse(q.choices) : null }));
    const responses = db.prepare(
      `SELECT r.*, p.display_tag, p.user_id FROM responses r
       JOIN participants p ON p.id=r.participant_id WHERE r.session_id=?`).all(ls.id);
    const notes = me ? db.prepare('SELECT * FROM notes WHERE session_id=? AND participant_id=?').all(ls.id, me.id) : [];
    return { session: ls, questions, responses, notes, my_participant_id: me?.id ?? null };
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { app } = buildServer();
  const port = Number(process.env.PORT) || 3000;
  app.listen({ port, host: '0.0.0.0' }).then(() =>
    console.log(`ProtoCall Trainer running at http://localhost:${port}`));
}
