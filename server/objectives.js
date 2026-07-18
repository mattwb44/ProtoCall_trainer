// Track C: rule-based, local, explainable objective suggester.
//
// Two signals, blended:
//   1. A hand-curated seed of high-signal terms per objective (below). This is
//      what makes suggestions useful while the tagged corpus is still small.
//   2. Corpus-learned terms: words that distinguish scenarios already tagged
//      with an objective from the rest (a smoothed log-odds over the library).
//      This sharpens automatically as the library grows.
//
// No external AI. Suggestions are explainable: every hit carries the exact
// words that triggered it.

// Hand seed. Keys must match learning_objectives.name exactly. Multi-word / and
// hyphenated entries are matched as phrases (higher weight — more specific).
export const SEED_KEYWORDS = {
  // Fireground
  'Reading Smoke': ['smoke', 'smoke color', 'velocity', 'turbulent', 'laminar', 'smoke volume', 'black smoke', 'brown smoke', 'pushing smoke', 'neutral plane'],
  'Water Application': ['gpm', 'flow', 'nozzle', 'straight stream', 'smooth bore', 'fog', 'gallons', 'water on the fire', 'reset', 'hoseline'],
  'Search': ['search', 'victim', 'trapped', 'primary search', 'secondary search', 'oriented search', 'right-hand search', 'occupant', 'sweep'],
  'VEIS': ['veis', 'vent enter isolate', 'isolate', 'close the door', 'take the window', 'window entry', 'oriented to the victim'],
  'Ventilation': ['ventilation', 'vent', 'ppv', 'positive pressure', 'vertical ventilation', 'horizontal ventilation', 'cut the roof', 'hydraulic ventilation', 'flow path'],
  'Fire Attack': ['fire attack', 'attack line', 'advance the line', 'interior attack', 'offensive', 'transitional attack', 'knock the fire', 'stretch', 'handline'],
  'Apparatus Placement': ['apparatus placement', 'spot the engine', 'engine placement', 'ladder placement', 'position the apparatus', 'hydrant', 'supply line', 'spotting'],
  'Building Construction': ['building construction', 'lightweight', 'truss', 'balloon frame', 'platform frame', 'ordinary construction', 'taxpayer', 'parapet', 'collapse', 'occupancy type'],
  'Fire Dynamics': ['flashover', 'backdraft', 'rollover', 'flow path', 'thermal', 'ventilation-limited', 'fuel-limited', 'decay', 'neutral plane'],
  // EMS
  'Primary Assessment': ['primary assessment', 'abc', 'airway breathing circulation', 'avpu', 'general impression', 'level of consciousness', 'loc', 'xabc'],
  'Airway Management': ['airway', 'opa', 'npa', 'intubation', 'supraglottic', 'bvm', 'bag valve mask', 'suction', 'obstruction', 'gag reflex'],
  'Triage (START)': ['triage', 'start triage', 'mci', 'mass casualty', 'walking wounded', 'red tag', 'immediate', 'delayed', 'expectant'],
  'Patient Handoff': ['handoff', 'hand off', 'sbar', 'transfer of care', 'bedside report', 'transport report', 'give report'],
  'Refusal Documentation': ['refusal', 'ama', 'against medical advice', 'capacity', 'competent', 'decline transport', 'document the refusal'],
  'Cardiac Care': ['cardiac', 'chest pain', '12-lead', 'ecg', 'ekg', 'stemi', 'mi', 'nitro', 'aspirin', 'acs', 'arrhythmia', 'cardiac arrest', 'cpr', 'aed', 'defibrillate'],
  'Medication Administration': ['medication', 'dose', 'administer', 'epinephrine', 'epi', 'narcan', 'naloxone', 'albuterol', 'route', 'contraindication', 'mg'],
  'Bleeding Control': ['bleeding', 'hemorrhage', 'tourniquet', 'wound packing', 'hemostatic', 'direct pressure', 'exsanguination', 'blood loss'],
  // Motor Vehicle Accidents
  'Extrication Priorities': ['extrication', 'entrapment', 'entrapped', 'spreaders', 'cutters', 'ram', 'roof removal', 'dash lift', 'access the patient', 'jaws'],
  'Traffic Incident Management': ['traffic', 'blocking', 'lane closure', 'cones', 'flares', 'oncoming', 'struck-by', 'work zone', 'block with the apparatus'],
  'Vehicle Stabilization': ['stabilize', 'stabilization', 'cribbing', 'step chocks', 'struts', 'airbag', 'chock the wheels', 'secure the vehicle'],
  'Hazard Control': ['fuel leak', 'leaking fluids', 'battery disconnect', 'undeployed airbag', 'fire risk', 'downed lines', 'spill', 'hazard'],
  'Patient-Centered Extrication': ['patient-centered', 'work around the patient', 'spinal', 'backboard', 'medic in the car', 'path of least resistance', 'patient care'],
  // General — offered under every category
  'Air Management': ['air management', 'low air', 'scba', 'cylinder', 'rule of air', 'point of no return', 'air supply', 'low-air alarm'],
  'Command Presence': ['incident command', 'establish command', 'span of control', 'radio discipline', 'on-scene report', 'command post', 'ic'],
  'Resource Management': ['mutual aid', 'staffing', 'second alarm', 'request additional', 'tactical reserve', 'rit', 'resources', 'call for'],
  'Scene Size-Up': ['size-up', 'size up', '360', 'walk around', 'on-scene report', 'arrival report', 'conditions actions needs', 'cover the six'],
  'Communications': ['communications', 'radio', 'mayday', 'par', 'portable', 'clear text', 'benchmark', 'progress report'],
};

const STOPWORDS = new Set(('a an the and or but if of to in on at for with as by from is are was were be been being this that these those you your we our they their it its i he she his her them do does what which who how why when where your first next then are can could should would will shall may might must not no yes into out over under up down off about after before during while each any all some more most other than very just so').split(' '));

// Lowercase, keep digits + intra-word hyphens (12-lead, size-up), drop other
// punctuation. Returns { text, tokens } — text (space-padded) for phrase
// matching, tokens (a Set) for single-word matching.
export function normalize(raw) {
  const text = ' ' + String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9\-\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() + ' ';
  const tokens = new Set(text.split(' ').filter(t => t.length >= 2 && !STOPWORDS.has(t)));
  return { text, tokens };
}

const isPhrase = term => /[\s]/.test(term);

// Which seed terms for an objective appear in the draft. norm.text is space-
// padded and single-spaced, so a whole-word phrase reads as ` phrase `.
function seedHits(terms, norm) {
  const hits = [];
  for (const term of terms) {
    if (isPhrase(term)) {
      if (norm.text.includes(' ' + term + ' ')) hits.push({ term, phrase: true });
    } else if (norm.tokens.has(term)) {
      hits.push({ term, phrase: false });
    }
  }
  return hits;
}

// Build the corpus model from already-tagged docs.
// docs: [{ objectives: string[], text: string }]
// Returns Map<objective, Map<term, weight>> with only positive, distinctive terms.
export function buildCorpusModel(docs) {
  const total = docs.length;
  const model = new Map();
  if (!total) return model;
  const normed = docs.map(d => ({ objectives: d.objectives.filter(Boolean), tokens: normalize(d.text).tokens }));
  // global doc frequency
  const globalDf = new Map();
  for (const d of normed) for (const t of d.tokens) globalDf.set(t, (globalDf.get(t) || 0) + 1);
  const objectives = new Set(normed.flatMap(d => d.objectives));
  for (const obj of objectives) {
    const objDocs = normed.filter(d => d.objectives.includes(obj));
    const oc = objDocs.length;
    const objDf = new Map();
    for (const d of objDocs) for (const t of d.tokens) objDf.set(t, (objDf.get(t) || 0) + 1);
    const weights = new Map();
    for (const [term, of_] of objDf) {
      if (term.length < 3 || of_ < 1) continue;
      const nc = total - oc;
      const nf = (globalDf.get(term) || 0) - of_;
      const pO = (of_ + 0.5) / (oc + 1);
      const pN = (nf + 0.5) / (nc + 1);
      const w = Math.log(pO / pN);
      if (w > 0.25) weights.set(term, w);
    }
    // keep the 20 most distinctive
    const top = [...weights.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
    if (top.length) model.set(obj, new Map(top));
  }
  return model;
}

// Rank objectives for a draft. `candidates` limits scoring to the category's
// objectives (name list). Returns [{ name, score, matched: string[] }], top N.
export function suggestObjectives({ text, candidates, corpusModel = new Map(), limit = 3 }) {
  const norm = normalize(text);
  const results = [];
  for (const name of candidates) {
    const seed = SEED_KEYWORDS[name] || [];
    const hits = seedHits(seed, norm);
    let score = 0;
    const matched = [];
    for (const h of hits) { score += h.phrase ? 1.6 : 1.0; matched.push(h.term); }
    // corpus bonus: distinctive learned terms present in the draft
    const cm = corpusModel.get(name);
    if (cm) {
      const corpusMatched = [];
      for (const t of norm.tokens) {
        const w = cm.get(t);
        if (w) { score += 0.5 * w; corpusMatched.push(t); }
      }
      // surface a couple of learned terms the seed didn't already name
      for (const t of corpusMatched) {
        if (matched.length >= 6) break;
        if (!matched.some(m => m === t || m.includes(t))) matched.push(t);
      }
    }
    if (score > 0) results.push({ name, score: Number(score.toFixed(3)), matched: matched.slice(0, 6) });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}
