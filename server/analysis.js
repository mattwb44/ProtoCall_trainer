// v6 Decision Intelligence — AI after-action analysis (PRD-v6, Layer 1).
// Scores free-text crew answers against the instructor's stored model answer via the
// Anthropic Messages API (raw fetch, structured JSON output — same no-SDK pattern as
// mailer.js). Env-gated: with no ANTHROPIC_API_KEY, createAnalyzer() returns null and
// the app behaves exactly as before — no analysis routes' AI calls, no cost.
// The analyzer is injectable into buildServer({ analyzer }) so tests use a mock.
const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.ANALYSIS_MODEL || 'claude-opus-4-8';

// Structured output schema: one assessment per response + a crew-level summary.
// classification is advisory — the instructor decides; 'review' flags possible
// safety-critical errors for human attention, never an authoritative verdict.
const SCHEMA = {
  type: 'object',
  properties: {
    assessments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          response_id: { type: 'string' },
          classification: { type: 'string', enum: ['aligned', 'divergent', 'review'] },
          rationale: { type: 'string' },
        },
        required: ['response_id', 'classification', 'rationale'],
        additionalProperties: false,
      },
    },
    participant_debriefs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          participant_id: { type: 'string' },
          debrief: { type: 'string' },
        },
        required: ['participant_id', 'debrief'],
        additionalProperties: false,
      },
    },
    crew_summary: { type: 'string' },
  },
  required: ['assessments', 'participant_debriefs', 'crew_summary'],
  additionalProperties: false,
};

const SYSTEM = `You are an assistant to a fire/EMS training instructor reviewing a completed
tactical scenario drill. For each crew answer, compare it to the instructor's model answer
(the subject-matter-expert ground truth) in the context of the scenario and question.

Classify each answer:
- "aligned": consistent with the model answer's intent, even if worded differently.
- "divergent": a defensible but different approach, or partially correct.
- "review": possibly contradicts the model answer on a safety-critical dimension
  (crew survivability, air management, risk assessment, fire behavior). Phrase the
  rationale as "review this — possible safety concern", never as a verdict.

For questions with no model answer, classify as "divergent" and summarize instead of scoring.

Write a short debrief for each participant (2-4 sentences, constructive coaching voice
appropriate to the fire service — direct, specific, encouraging; reference their actual
answers). Write a brief crew-level summary for the instructor (3-5 sentences: overall
alignment, common gaps, anything flagged for review).

You are advisory only. The human instructor reviews and edits everything before crew see it.`;

// Renders the session into a compact prompt document.
function promptFor(detail) {
  const { session, questions, responses, participants } = detail;
  const qById = new Map(questions.map(q => [q.id, q]));
  const lines = [
    `SCENARIO: ${session.title}`,
    session.description ? `DESCRIPTION: ${session.description}` : '',
    '',
    'QUESTIONS AND MODEL ANSWERS:',
    ...questions.map(q =>
      `- [${q.id}] (${q.role_track || 'All'}) ${q.prompt}\n  MODEL ANSWER: ${q.instructor_answer || '(none provided)'}`),
    '',
    'PARTICIPANTS:',
    ...participants.map(p => `- [${p.id}] ${p.display_tag}`),
    '',
    'CREW ANSWERS:',
    ...responses.map(r => {
      const q = qById.get(r.question_id);
      return `- response_id=${r.id} participant_id=${r.participant_id} question=[${r.question_id}] "${q?.prompt ?? ''}"\n  ANSWER: ${r.body}`;
    }),
  ];
  return lines.filter(Boolean).join('\n');
}

export function createAnalyzer({ apiKey = process.env.ANTHROPIC_API_KEY } = {}) {
  if (!apiKey) return null; // feature dormant — byte-for-byte current behavior

  // Returns the parsed structured result, or throws. Callers treat failures as
  // best-effort (log + degrade), never as a broken session.
  async function analyzeSession(detail) {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 8192,
        system: SYSTEM,
        output_config: { format: { type: 'json_schema', schema: SCHEMA } },
        messages: [{ role: 'user', content: promptFor(detail) }],
      }),
    });
    if (!res.ok) throw new Error(`analysis API ${res.status}: ${await res.text().catch(() => '')}`);
    const body = await res.json();
    if (body.stop_reason === 'refusal') throw new Error('analysis refused by model');
    const text = body.content?.find(b => b.type === 'text')?.text;
    if (!text) throw new Error('analysis returned no text content');
    return JSON.parse(text);
  }

  return { analyzeSession };
}
