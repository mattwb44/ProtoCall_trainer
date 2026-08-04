// Phase 3 — roles-as-sets. A question and a participant each carry a SET of
// roles, stored as a JSON array of trimmed strings ('[]' = the empty set).
// A participant sees a question when either set is empty or the two sets
// intersect. This supersedes the single-string `role_track`, which lives on as
// a legacy DB column and a scalar mirror in API output until the frontend
// speaks sets. Fixes the firefighter-medic case: one participant, two tracks.
// Custom free-text roles are fully supported — roles are per-scenario flavor,
// never a controlled vocabulary.

const clean = arr => [...new Set(arr.map(r => String(r).trim()).filter(Boolean))];

// Coerce any stored or inbound value to a clean array of role strings.
// Accepts a JS array, a JSON-array string, a legacy scalar string, or null.
export function parseRoles(value) {
  if (Array.isArray(value)) return clean(value);
  if (value == null || value === '') return [];
  if (typeof value === 'string') {
    const s = value.trim();
    if (s[0] === '[') {
      try { const a = JSON.parse(s); if (Array.isArray(a)) return clean(a); } catch { /* legacy scalar */ }
    }
    return clean([s]); // legacy single-string role_track
  }
  return [];
}

// Canonical storage form: a JSON array string, deduped and trimmed.
export function serializeRoles(value) {
  return JSON.stringify(parseRoles(value));
}

// Scalar mirror for the legacy `role_track` field in API output: first role, ''.
export function primaryRole(value) {
  return parseRoles(value)[0] ?? '';
}

// Attach client-facing role fields to any DB row carrying a `roles` column:
// `roles` becomes a parsed array and `role_track` a scalar mirror (back-compat
// for a frontend that hasn't learned sets yet). Non-mutating.
export function withRoleFields(row) {
  const roles = parseRoles(row.roles);
  return { ...row, roles, role_track: roles[0] ?? '' };
}

// Intersection match: visible if either set is empty, or they share a role.
export function rolesMatch(questionRoles, participantRoles) {
  const q = parseRoles(questionRoles), p = parseRoles(participantRoles);
  return !q.length || !p.length || q.some(r => p.includes(r));
}

// SQL fragment (JSON1) for the same predicate inside a query. `qExpr`/`pExpr`
// are SQL expressions yielding JSON-array text — a column like `q.roles`, or a
// bound `@param` holding a serialized array. Empty either side ⇒ match; else a
// non-empty intersection. Both expressions must be valid JSON-array text (use
// COALESCE(col,'[]') for a nullable column from an OUTER JOIN).
export function rolesMatchSql(qExpr, pExpr) {
  return `(
    json_array_length(${qExpr})=0 OR json_array_length(${pExpr})=0
    OR EXISTS (SELECT 1 FROM json_each(${qExpr}) _qr
               JOIN json_each(${pExpr}) _pr ON _pr.value=_qr.value)
  )`;
}
