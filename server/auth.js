import { scryptSync, timingSafeEqual, randomBytes } from 'node:crypto';

const COOKIE = 'pc_session';
const THIRTY_DAYS_S = 30 * 24 * 60 * 60;

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false; // e.g. the system user's unusable '!' hash
  const candidate = scryptSync(password, salt, 64);
  return timingSafeEqual(candidate, Buffer.from(hash, 'hex'));
}

export function createAuthSession(db, userId) {
  const token = randomBytes(32).toString('hex');
  db.prepare(`INSERT INTO auth_sessions (token, user_id, expires_at)
              VALUES (?, ?, datetime('now', '+30 days'))`).run(token, userId);
  return token;
}

export function destroyAuthSession(db, token) {
  if (token) db.prepare('DELETE FROM auth_sessions WHERE token=?').run(token);
}

export function tokenFromCookieHeader(cookieHeader) {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [k, v] = part.trim().split('=');
    if (k === COOKIE) return v;
  }
  return null;
}

// Rolling 30-day expiry: every authenticated lookup extends the session.
export function userFromCookieHeader(db, cookieHeader) {
  const token = tokenFromCookieHeader(cookieHeader);
  if (!token) return null;
  const row = db.prepare(
    `SELECT u.id, u.email, u.display_name, u.role, u.department_id, s.token FROM auth_sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token=? AND s.expires_at > datetime('now')`).get(token);
  if (!row) return null;
  db.prepare(`UPDATE auth_sessions SET expires_at=datetime('now','+30 days') WHERE token=?`)
    .run(token);
  return { id: row.id, email: row.email, display_name: row.display_name,
           role: row.role, department_id: row.department_id, token: row.token };
}

export function setCookieValue(token) {
  const secure = process.env.RAILWAY_ENVIRONMENT ? '; Secure' : '';
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${THIRTY_DAYS_S}${secure}`;
}

export function clearCookieValue() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
