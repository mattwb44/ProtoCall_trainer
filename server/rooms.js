import { uuid } from './db.js';

const CODE_WORDS = ['FIRE', 'CREW', 'PUMP', 'LINE', 'VENT', 'CALL'];
function makeCode() {
  const word = CODE_WORDS[Math.floor(Math.random() * CODE_WORDS.length)];
  return `${word}-${Math.floor(1000 + Math.random() * 9000)}`;
}

// Live room orchestration: in-memory index over rows that are always
// written through to SQLite, so a restart can rehydrate any live room.
export class Rooms {
  constructor(db) {
    this.db = db;
  }

  createSession(scenarioId, hostId) {
    const scenario = this.db.prepare('SELECT * FROM scenarios WHERE id=?').get(scenarioId);
    if (!scenario) return null;
    let code;
    do { code = makeCode(); }
    while (this.db.prepare('SELECT 1 FROM live_sessions WHERE room_code=?').get(code));
    const id = uuid();
    this.db.prepare('INSERT INTO live_sessions (id, room_code, scenario_id, host_id) VALUES (?,?,?,?)')
      .run(id, code, scenarioId, hostId);
    return this.getByCode(code);
  }

  getByCode(code) {
    const session = this.db.prepare(
      `SELECT s.*, sc.title, sc.description, sc.category, sc.subcategory, sc.image_url
       FROM live_sessions s JOIN scenarios sc ON sc.id = s.scenario_id
       WHERE s.room_code = ?`).get(code?.toUpperCase());
    if (!session) return null;
    const questions = this.db.prepare(
      'SELECT * FROM questions WHERE scenario_id=? AND deleted=0 ORDER BY sort_order').all(session.scenario_id)
      .map(q => ({ ...q, choices: q.choices ? JSON.parse(q.choices) : null }));
    const media = this.db.prepare(
      'SELECT id, kind, url, sort_order FROM scenario_media WHERE scenario_id=? ORDER BY sort_order')
      .all(session.scenario_id);
    return { session, questions, media };
  }

  join(sessionId, token, userId = null) {
    let p = this.db.prepare('SELECT * FROM participants WHERE session_id=? AND token=?')
      .get(sessionId, token);
    if (!p) {
      const n = this.db.prepare('SELECT COUNT(*) n FROM participants WHERE session_id=?')
        .get(sessionId).n;
      p = { id: uuid(), session_id: sessionId, token, display_tag: `P${n + 1}`, user_id: userId };
      this.db.prepare('INSERT INTO participants (id, session_id, token, display_tag, user_id) VALUES (?,?,?,?,?)')
        .run(p.id, p.session_id, p.token, p.display_tag, p.user_id);
    } else if (userId && !p.user_id) {
      this.db.prepare('UPDATE participants SET user_id=? WHERE id=?').run(userId, p.id);
      p.user_id = userId;
    }
    return p;
  }

  submitResponse(sessionId, questionId, participantId, body) {
    const id = uuid();
    this.db.prepare(
      'INSERT INTO responses (id, session_id, question_id, participant_id, body) VALUES (?,?,?,?,?)')
      .run(id, sessionId, questionId, participantId, body);
    return this.db.prepare(
      `SELECT r.*, p.display_tag FROM responses r
       JOIN participants p ON p.id = r.participant_id WHERE r.id=?`).get(id);
  }

  pushAnswer(responseId) {
    this.db.prepare('UPDATE responses SET is_pushed=1 WHERE id=?').run(responseId);
    return this.db.prepare(
      `SELECT r.*, p.display_tag FROM responses r
       JOIN participants p ON p.id = r.participant_id WHERE r.id=?`).get(responseId);
  }

  saveNote(sessionId, questionId, participantId, body) {
    const existing = this.db.prepare(
      'SELECT id FROM notes WHERE session_id=? AND question_id IS ? AND participant_id=?')
      .get(sessionId, questionId, participantId);
    if (existing) {
      this.db.prepare("UPDATE notes SET body=?, updated_at=datetime('now') WHERE id=?")
        .run(body, existing.id);
      return existing.id;
    }
    const id = uuid();
    this.db.prepare('INSERT INTO notes (id, session_id, question_id, participant_id, body) VALUES (?,?,?,?,?)')
      .run(id, sessionId, questionId, participantId, body);
    return id;
  }

  endSession(sessionId) {
    this.db.prepare("UPDATE live_sessions SET status='ended', ended_at=datetime('now') WHERE id=?")
      .run(sessionId);
  }

  // Full state for (re)joining clients: responses grouped by question.
  roomState(code, { includeAnswers = false } = {}) {
    const room = this.getByCode(code);
    if (!room) return null;
    const responses = this.db.prepare(
      `SELECT r.id, r.question_id, r.body, r.is_pushed, r.participant_id, p.display_tag
       FROM responses r JOIN participants p ON p.id = r.participant_id
       WHERE r.session_id=? ORDER BY r.submitted_at`).all(room.session.id);
    const questions = room.questions.map(q =>
      includeAnswers ? q : { ...q, instructor_answer: undefined });
    return {
      session: {
        id: room.session.id, room_code: room.session.room_code, host_id: room.session.host_id,
        status: room.session.status, title: room.session.title,
        description: room.session.description, category: room.session.category,
        subcategory: room.session.subcategory, image_url: room.session.image_url,
      },
      questions,
      media: room.media,
      responses,
    };
  }
}
