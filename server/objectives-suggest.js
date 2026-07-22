// Track C — rule-based, corpus-seeded, local, explainable objective suggester.
//
// Decision (docs/ai/decisions.md → Objectives architecture): assisted tagging is
// keyword-based, runs locally with no external AI/API, and every suggestion is
// explainable (it reports which words triggered it) so the author stays in the
// loop. This is deliberately simple and greppable — the corpus below is seeded
// from fire-service domain vocabulary and extended as the keyword suggester
// visibly misses (embeddings/local-LLM stay deferred).

// objective name -> trigger phrases (lowercased, matched on word boundaries).
export const OBJECTIVE_KEYWORDS = {
  // Fireground
  'Reading Smoke': ['smoke', 'smoke condition', 'reading smoke', 'velocity', 'turbulent', 'laminar', 'color of smoke', 'pushing smoke'],
  'Water Application': ['water', 'gpm', 'flow', 'nozzle', 'hose stream', 'transitional attack', 'flow rate', 'reset the fire'],
  'Search': ['search', 'primary search', 'secondary search', 'victim', 'trapped', 'occupant', 'rescue', 'oriented search'],
  'VEIS': ['veis', 'vent enter', 'vent-enter', 'isolate', 'window entry', 'take the window'],
  'Ventilation': ['ventilation', 'ventilate', 'vertical vent', 'horizontal vent', 'ppv', 'positive pressure', 'roof', 'cut the roof', 'flow path'],
  'Fire Attack': ['fire attack', 'attack line', 'knock down', 'knockdown', 'interior attack', 'offensive', 'stretch a line', 'seat of the fire'],
  'Apparatus Placement': ['apparatus', 'engine', 'ladder', 'rig placement', 'spot the', 'staging', 'positioning', 'hydrant'],
  'Building Construction': ['construction', 'balloon frame', 'lightweight', 'truss', 'ordinary construction', 'wood frame', 'taxpayer', 'occupancy type'],
  'Fire Dynamics': ['flashover', 'backdraft', 'rollover', 'fire behavior', 'thermal', 'ventilation-limited', 'flow path', 'fire dynamics'],
  // EMS
  'Primary Assessment': ['primary assessment', 'abc', 'airway breathing circulation', 'general impression', 'level of consciousness', 'avpu', 'primary survey'],
  'Airway Management': ['airway', 'intubation', 'bvm', 'bag valve', 'suction', 'opa', 'npa', 'supraglottic', 'ventilate'],
  'Triage (START)': ['triage', 'start triage', 'mci', 'mass casualty', 'immediate delayed', 'walking wounded', 'tag'],
  'Patient Handoff': ['handoff', 'hand-off', 'report to', 'transfer of care', 'sbar', 'bedside report', 'give report'],
  'Refusal Documentation': ['refusal', 'ama', 'against medical advice', 'declines transport', 'capacity to refuse', 'informed refusal'],
  'Cardiac Care': ['cardiac', 'chest pain', 'mi', 'stemi', '12-lead', 'ecg', 'ekg', 'cardiac arrest', 'acls', 'defibrillation'],
  'Medication Administration': ['medication', 'dose', 'administer', 'epinephrine', 'nitro', 'aspirin', 'narcan', 'naloxone', 'route', 'contraindication'],
  'Bleeding Control': ['bleeding', 'hemorrhage', 'tourniquet', 'wound packing', 'direct pressure', 'blood loss', 'exsanguination'],
  // Motor Vehicle Accidents
  'Extrication Priorities': ['extrication', 'extricate', 'entrapment', 'cut', 'spreader', 'ram', 'roof removal', 'dash roll'],
  'Traffic Incident Management': ['traffic', 'lane', 'blocking', 'flares', 'cones', 'work zone', 'oncoming traffic', 'tim'],
  'Vehicle Stabilization': ['stabilize', 'stabilization', 'cribbing', 'step chocks', 'strut', 'vehicle on its side', 'chock'],
  'Hazard Control': ['hazard', 'fuel leak', 'fire hazard', 'downed line', 'airbag', 'battery disconnect', 'leaking'],
  'Patient-Centered Extrication': ['patient-centered', 'medic in the car', 'space and time', 'inside medic', 'c-spine', 'packaging'],
  // General
  'Air Management': ['air management', 'scba', 'low air', 'air supply', 'rule of air', 'point of no return', 'bottle'],
  'Command Presence': ['command', 'incident command', 'ics', 'command presence', 'span of control', 'transfer of command', 'ic'],
  'Resource Management': ['resource', 'mutual aid', 'additional alarm', 'call for', 'second alarm', 'staffing', 'assignments'],
  'Scene Size-Up': ['size-up', 'size up', '360', 'walk around', 'on arrival', 'initial report', 'conditions actions needs'],
  'Communications': ['radio', 'communication', 'mayday', 'par', 'transmit', 'dispatch update', 'benchmark', 'clear text'],
};

// Suggest objectives for `text`, restricted to `allowedNames` (the category's
// offered objectives). Returns [{ objective, matches: [phrase,...] }] ranked by
// distinct hits, then name. Only objectives with at least one hit are returned.
export function suggestObjectives(text, allowedNames = null) {
  const hay = ` ${String(text ?? '').toLowerCase()} `;
  const allow = allowedNames ? new Set(allowedNames) : null;
  const out = [];
  for (const [objective, phrases] of Object.entries(OBJECTIVE_KEYWORDS)) {
    if (allow && !allow.has(objective)) continue;
    const matches = [];
    for (const p of phrases) {
      // word-boundary match so "par" doesn't fire inside "apparatus"
      const re = new RegExp(`(?<![a-z0-9])${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`, 'i');
      if (re.test(hay)) matches.push(p);
    }
    if (matches.length) out.push({ objective, matches });
  }
  out.sort((a, b) => b.matches.length - a.matches.length || a.objective.localeCompare(b.objective));
  return out;
}
