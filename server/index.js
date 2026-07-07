import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { Server as SocketServer } from 'socket.io';
import QRCode from 'qrcode';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb, seedIfEmpty, uuid } from './db.js';
import { Rooms } from './rooms.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function buildServer({ dbFile } = {}) {
  const db = createDb(dbFile);
  seedIfEmpty(db);
  const rooms = new Rooms(db);

  const app = Fastify();
  app.register(fastifyStatic, { root: path.join(__dirname, '..', 'public') });

  // ── REST: scenario library ──
  app.get('/api/scenarios', () =>
    db.prepare(`SELECT s.*, (SELECT COUNT(*) FROM questions q WHERE q.scenario_id=s.id) AS question_count
                FROM scenarios s ORDER BY created_at DESC`).all());

  app.get('/api/scenarios/:id', (req, reply) => {
    const s = db.prepare('SELECT * FROM scenarios WHERE id=?').get(req.params.id);
    if (!s) return reply.code(404).send({ error: 'not found' });
    const questions = db.prepare('SELECT * FROM questions WHERE scenario_id=? ORDER BY sort_order')
      .all(s.id).map(q => ({ ...q, choices: q.choices ? JSON.parse(q.choices) : null }));
    return { ...s, questions };
  });

  app.post('/api/scenarios', (req, reply) => {
    const { title, description = '', category, subcategory, image_url = '', visibility = 'private', questions = [] } = req.body ?? {};
    if (!title || !category || !subcategory) return reply.code(400).send({ error: 'title, category, subcategory required' });
    const id = uuid();
    const tx = db.transaction(() => {
      db.prepare(`INSERT INTO scenarios (id, title, description, category, subcategory, image_url, visibility)
                  VALUES (?,?,?,?,?,?,?)`).run(id, title, description, category, subcategory, image_url, visibility);
      const ins = db.prepare(`INSERT INTO questions (id, scenario_id, prompt, kind, choices, instructor_answer, role_track, sort_order)
                              VALUES (?,?,?,?,?,?,?,?)`);
      questions.forEach((q, i) => ins.run(uuid(), id, q.prompt, q.kind ?? 'text',
        q.choices ? JSON.stringify(q.choices) : null, q.instructor_answer ?? '', q.role_track ?? '', i));
    });
    tx();
    reply.code(201);
    return { id };
  });

  // ── REST: sessions ──
  app.post('/api/sessions', (req, reply) => {
    const room = rooms.createSession(req.body?.scenario_id);
    if (!room) return reply.code(404).send({ error: 'scenario not found' });
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
    socket.on('join_room', ({ code, token, role }, ack) => {
      const room = rooms.getByCode(code);
      if (!room) return ack?.({ error: 'Room not found' });
      code = room.session.room_code;
      socket.data = { code, role, sessionId: room.session.id };
      socket.join(`room:${code}`);

      let participant = null;
      if (role === 'host') {
        socket.join(`room:${code}:host`);
      } else {
        participant = rooms.join(room.session.id, token || uuid());
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
