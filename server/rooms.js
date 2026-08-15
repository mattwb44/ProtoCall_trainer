import { uuid } from './db.js';
import { parseRoles, serializeRoles, rolesMatch, rolesMatchSql, withRoleFields } from './roles.js';

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
      .map(q => withRoleFields({ ...q, choices: q.choices ? JSON.parse(q.choices) : null }));
    const media = this.db.prepare(
      'SELECT id, kind, url, sort_order FROM scenario_media WHERE scenario_id=? ORDER BY sort_order')
      .all(session.scenario_id);
    return { session, questions, media };
  }

  join(sessionId, token, userId = null, roles = []) {
    const rolesJson = serializeRoles(roles);
    let p = this.db.prepare('SELECT * FROM participants WHERE session_id=? AND token=?')
      .get(sessionId, token);
    // Phase 3: a booted token is dead — refuse it rather than resurrecting the
    // participant. The caller turns null into a "you were removed" rejection.
    if (p?.booted_at) return null;
    if (!p) {
      const n = this.db.prepare('SELECT COUNT(*) n FROM participants WHERE session_id=?')
        .get(sessionId).n;
      p = { id: uuid(), session_id: sessionId, token, display_tag: `P${n + 1}`, user_id: userId, roles: rolesJson, shift_label: '' };
      this.db.prepare('INSERT INTO participants (id, session_id, token, display_tag, user_id, roles) VALUES (?,?,?,?,?,?)')
        .run(p.id, p.session_id, p.token, p.display_tag, p.user_id, p.roles);
      return withRoleFields(p);
    }
    if (userId && !p.user_id) {
      this.db.prepare('UPDATE participants SET user_id=? WHERE id=?').run(userId, p.id);
      p.user_id = userId;
    }
    // A role set can be picked once, and only before any answer lands — changing
    // roles mid-run would corrupt the completeness math behind answer reveal.
    if (parseRoles(roles).length && !parseRoles(p.roles).length) {
      const answered = this.db.prepare(
        'SELECT COUNT(*) n FROM responses WHERE session_id=? AND participant_id=?').get(sessionId, p.id).n;
      if (!answered) {
        this.db.prepare('UPDATE participants SET roles=? WHERE id=?').run(rolesJson, p.id);
        p.roles = rolesJson;
      }
    }
    return withRoleFields(p);
  }

  submitResponse(sessionId, questionId, participantId, body) {
    const id = uuid();
    // PR 9: a unique index on (session_id, participant_id, question_id) makes a
    // duplicate insert a no-op instead of a constraint crash, so a socket
    // double-fire (offline-queue flush, timed-out re-emit) still acks normally.
    // On an ignore, return the row already stored for that natural key.
    const info = this.db.prepare(
      'INSERT OR IGNORE INTO responses (id, session_id, question_id, participant_id, body) VALUES (?,?,?,?,?)')
      .run(id, sessionId, questionId, participantId, body);
    const rowId = info.changes
      ? id
      : this.db.prepare(
          'SELECT id FROM responses WHERE session_id=? AND participant_id=? AND question_id=?')
          .get(sessionId, participantId, questionId).id;
    return withRoleFields(this.db.prepare(
      `SELECT r.*, p.display_tag, p.roles, p.shift_label FROM responses r
       JOIN participants p ON p.id = r.participant_id WHERE r.id=?`).get(rowId));
  }

  // F4: a participant sets/changes their shift label freely until their first
  // answer lands, then it locks (so the host's tagged matrix stays stable).
  // Returns the stored value, or null when locked. '' clears an unset choice.
  setShift(sessionId, participantId, shift) {
    const answered = this.db.prepare(
      'SELECT COUNT(*) n FROM responses WHERE session_id=? AND participant_id=?').get(sessionId, participantId).n;
    if (answered) return null;
    this.db.prepare('UPDATE participants SET shift_label=? WHERE id=?').run(shift, participantId);
    return shift;
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

  // v7 stages: resolve each question's stage in place (a blank stage inherits
  // the previous question's) and return the ordered stage names. An empty
  // array means the scenario is stageless and behaves exactly as before.
  // Questions before the first named stage resolve to '' and count as part
  // of the first stage for visibility and reveal.
  resolveStages(questions) {
    let cur = '';
    const names = [];
    for (const q of questions) {
      if (q.stage) cur = q.stage;
      q.stage = cur;
      if (cur && !names.includes(cur)) names.push(cur);
    }
    return names;
  }

  stageIndexOf(q, names) {
    const i = names.indexOf(q.stage);
    return i < 0 ? 0 : i;
  }

  // Per-stage reveal (owner decision 2026-07-10): finishing all of a stage's
  // questions (in the participant's track) unlocks that stage's model answers.
  // Stageless scenarios keep whole-scenario gating. Session end unlocks all.
  // Returns { answers, complete } — answers is question_id → instructor_answer
  // for every stage this participant has earned; complete = the whole set.
  revealedAnswers(sessionId, participantId) {
    const session = this.db.prepare('SELECT * FROM live_sessions WHERE id=?').get(sessionId);
    const roles = parseRoles(this.db.prepare('SELECT roles FROM participants WHERE id=?')
      .get(participantId)?.roles);
    const all = this.db.prepare(
      'SELECT * FROM questions WHERE scenario_id=? AND deleted=0 ORDER BY sort_order').all(session.scenario_id);
    const names = this.resolveStages(all); // resolve on the full list so blanks inherit across tracks
    const qs = roles.length ? all.filter(q => rolesMatch(q.roles, roles)) : all;
    const answered = new Set(this.db.prepare(
      'SELECT DISTINCT question_id FROM responses WHERE session_id=? AND participant_id=?')
      .all(sessionId, participantId).map(r => r.question_id));
    const ended = session.status !== 'live';
    const answers = {};
    const reveal = group => group.forEach(q => { answers[q.id] = q.instructor_answer ?? ''; });
    let complete = qs.length > 0;
    if (!names.length) {
      complete = complete && qs.every(q => answered.has(q.id));
      if (complete || ended) reveal(qs);
      return { answers, complete };
    }
    for (let i = 0; i < names.length; i++) {
      const group = qs.filter(q => this.stageIndexOf(q, names) === i);
      if (!group.length) continue; // this track has no questions in the stage
      const done = group.every(q => answered.has(q.id));
      if (done || ended) reveal(group);
      if (!done) complete = false;
    }
    return { answers, complete };
  }

  advanceStage(sessionId) {
    const session = this.db.prepare('SELECT * FROM live_sessions WHERE id=?').get(sessionId);
    if (!session) return null;
    const qs = this.db.prepare(
      'SELECT * FROM questions WHERE scenario_id=? AND deleted=0 ORDER BY sort_order').all(session.scenario_id);
    const names = this.resolveStages(qs);
    const next = Math.min(session.stage_index + 1, Math.max(names.length - 1, 0));
    this.db.prepare('UPDATE live_sessions SET stage_index=? WHERE id=?').run(next, sessionId);
    return next;
  }

  // PRD-v7: model answers are gated on full submission — these two power
  // the "has this participant earned the reveal yet?" checks everywhere.
  // A participant's question set is every question whose role set is empty or
  // intersects theirs (an empty participant set matches everything, which is
  // also the untracked-scenario case).
  hasAnsweredAll(sessionId, participantId) {
    const roles = this.db.prepare('SELECT roles FROM participants WHERE id=?')
      .get(participantId)?.roles ?? '[]';
    const trackSql = `AND ${rolesMatchSql('q.roles', '@roles')}`;
    const total = this.db.prepare(
      `SELECT COUNT(*) n FROM questions q
       JOIN live_sessions ls ON ls.scenario_id = q.scenario_id
       WHERE ls.id=@sid AND q.deleted=0 ${trackSql}`).get({ sid: sessionId, roles }).n;
    if (!total) return false;
    const mine = this.db.prepare(
      `SELECT COUNT(DISTINCT r.question_id) n FROM responses r
       JOIN questions q ON q.id = r.question_id AND q.deleted=0 ${trackSql}
       WHERE r.session_id=@sid AND r.participant_id=@pid`)
      .get({ sid: sessionId, pid: participantId, roles }).n;
    return mine >= total;
  }

  officialAnswers(sessionId, roles = []) {
    const trackSql = `AND ${rolesMatchSql('q.roles', '@roles')}`;
    const rows = this.db.prepare(
      `SELECT q.id, q.instructor_answer FROM questions q
       JOIN live_sessions ls ON ls.scenario_id = q.scenario_id
       WHERE ls.id=@sid AND q.deleted=0 ${trackSql}`)
      .all({ sid: sessionId, roles: serializeRoles(roles) });
    return Object.fromEntries(rows.map(q => [q.id, q.instructor_answer ?? '']));
  }

  endSession(sessionId) {
    this.db.prepare("UPDATE live_sessions SET status='ended', ended_at=datetime('now') WHERE id=?")
      .run(sessionId);
  }

  // Phase 3 host live view: the named crew roster with per-participant, per-stage
  // completion. Each participant's "visible" set is the questions whose role set
  // is empty or intersects theirs (role intersection); done counts their distinct
  // answers within that set. `connectedIds` (socket-derived) flags live presence.
  // Booted participants are excluded. Solo runs have a single "You" participant.
  roster(sessionId, connectedIds = new Set()) {
    const session = this.db.prepare('SELECT * FROM live_sessions WHERE id=?').get(sessionId);
    if (!session) return [];
    const parts = this.db.prepare(
      `SELECT p.*, u.display_name FROM participants p
       LEFT JOIN users u ON u.id = p.user_id
       WHERE p.session_id=? AND p.booted_at IS NULL
       ORDER BY p.display_tag`).all(sessionId);
    const all = this.db.prepare(
      'SELECT * FROM questions WHERE scenario_id=? AND deleted=0 ORDER BY sort_order').all(session.scenario_id);
    const names = this.resolveStages(all);
    return parts.map(p => {
      const roles = parseRoles(p.roles);
      const visible = roles.length ? all.filter(q => rolesMatch(q.roles, roles)) : all;
      const answered = new Set(this.db.prepare(
        'SELECT DISTINCT question_id FROM responses WHERE session_id=? AND participant_id=?')
        .all(sessionId, p.id).map(r => r.question_id));
      const doneOf = qs => qs.filter(q => answered.has(q.id)).length;
      const stages = names.length
        ? names.map((name, i) => {
            const g = visible.filter(q => this.stageIndexOf(q, names) === i);
            return { stage: name, done: doneOf(g), total: g.length };
          })
        : [{ stage: '', done: doneOf(visible), total: visible.length }];
      return {
        id: p.id,
        name: p.display_name || p.display_tag,
        display_tag: p.display_tag,
        roles,
        shift_label: p.shift_label,
        connected: connectedIds.has(p.id),
        done: doneOf(visible),
        total: visible.length,
        stages,
      };
    });
  }

  // Boot a participant: invalidate their token (booted_at) so a rejoin is
  // refused. Returns the participant row (caller drops their live sockets), or
  // null if already gone. Responses are left intact for the archive.
  boot(sessionId, participantId) {
    const p = this.db.prepare('SELECT * FROM participants WHERE id=? AND session_id=? AND booted_at IS NULL')
      .get(participantId, sessionId);
    if (!p) return null;
    this.db.prepare("UPDATE participants SET booted_at=datetime('now') WHERE id=?").run(p.id);
    return p;
  }

  // Full state for (re)joining clients: responses grouped by question.
  roomState(code, { includeAnswers = false } = {}) {
    const room = this.getByCode(code);
    if (!room) return null;
    const responses = this.db.prepare(
      `SELECT r.id, r.question_id, r.body, r.is_pushed, r.participant_id, p.display_tag, p.roles, p.shift_label
       FROM responses r JOIN participants p ON p.id = r.participant_id
       WHERE r.session_id=? ORDER BY r.submitted_at`).all(room.session.id).map(withRoleFields);
    const stages = this.resolveStages(room.questions);
    const questions = room.questions.map(q =>
      includeAnswers ? q : { ...q, instructor_answer: undefined });
    return {
      session: {
        id: room.session.id, room_code: room.session.room_code, host_id: room.session.host_id,
        status: room.session.status, title: room.session.title,
        stages, stage_index: room.session.stage_index,
        description: room.session.description, category: room.session.category,
        subcategory: room.session.subcategory, image_url: room.session.image_url,
      },
      questions,
      media: room.media,
      responses,
    };
  }
}
