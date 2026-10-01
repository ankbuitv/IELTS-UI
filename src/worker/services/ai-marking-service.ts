import type { Env } from '../env';
import { ApiError } from '../lib/errors';
import { newId, nowIso } from '../lib/ids';
import { completeJson } from '../ai/providers';
import { setWritingScore } from './marking-service';
import { WRITING_CRITERIA, SPEAKING_CRITERIA } from '../../shared/ai-rubric';

/**
 * AI marking for Writing and Speaking.
 *
 * Honesty rules this module follows:
 *  - every band it produces is an ESTIMATE and is labelled as one everywhere it
 *    is shown (`provider`, model and rubric version are stored next to it);
 *  - a model is never allowed to mark an objective answer (reading/listening are
 *    marked deterministically against the protected key);
 *  - a Writing band produced here never overwrites a teacher's band: the AI
 *    result is stored as `scoring_source = 'AI'`, and a teacher can re-score the
 *    same submission at any time (which replaces it and is recorded);
 *  - Speaking is graded from the transcript the candidate produced. When no
 *    transcript exists the AI is told to refuse rather than invent one, and
 *    pronunciation is explicitly reported as not assessed.
 */

export interface AiCriterion {
  key: string;
  label: string;
  band: number | null;
  comment: string;
}

export interface AiCorrection {
  original: string;
  suggestion: string;
  reason: string;
}

export interface AiGradeResult {
  band: number | null;
  criteria: AiCriterion[];
  feedback: string;
  strengths: string[];
  improvements: string[];
  corrections: AiCorrection[];
  /** Caveats the UI must show verbatim (for example: pronunciation not assessed). */
  notes: string[];
  providerId: string;
  providerModel: string;
}

interface RawGrade {
  overallBand?: number | string | null;
  Feedback?: unknown;
  feedback?: unknown;
  band?: number | string | null;
  criteria?: unknown;
  strengths?: unknown;
  improvements?: unknown;
  corrections?: unknown;
  notes?: unknown;
}

const GRADE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['overallBand', 'criteria', 'feedback', 'strengths', 'improvements', 'corrections', 'notes'],
  properties: {
    overallBand: { type: 'number' },
    criteria: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'band', 'comment'],
        properties: {
          key: { type: 'string' },
          band: { type: 'number' },
          comment: { type: 'string' },
        },
      },
    },
    feedback: { type: 'string' },
    strengths: { type: 'array', items: { type: 'string' } },
    improvements: { type: 'array', items: { type: 'string' } },
    corrections: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['original', 'suggestion', 'reason'],
        properties: {
          original: { type: 'string' },
          suggestion: { type: 'string' },
          reason: { type: 'string' },
        },
      },
    },
    notes: { type: 'array', items: { type: 'string' } },
  },
} as const;

const SHARED_RULES = `You are an experienced English-exam examiner producing a FEEDBACK-ONLY estimate for a practice platform.

Non-negotiable rules:
1. This is an ESTIMATE for study feedback, never an official score. Say so once in "feedback".
2. Mark only what the candidate wrote or said. Never invent content, never rewrite the task for them.
3. Use half-band steps (0.5, 1.0, ... 9.0) for every band.
4. Be specific and actionable: quote the candidate's own words in every comment.
5. If the material is too short, off-topic or empty, give the lowest defensible band and explain why.
6. Return only the JSON object described below. No markdown, no preamble.`;

const WRITING_CRITERIA_TEXT = WRITING_CRITERIA.map(
  (criterion) => `- ${criterion.key}: ${criterion.description}`,
).join('\n');

const SPEAKING_CRITERIA_TEXT = SPEAKING_CRITERIA.map(
  (criterion) => `- ${criterion.key}: ${criterion.description}`,
).join('\n');

export interface WritingGradeInput {
  taskLabel: string;
  prompt: string;
  responseText: string;
  wordCount: number;
  minimumWords: number;
  providerId?: string;
}

/** Grades one Writing response against the four public Writing criteria. */
export async function gradeWriting(env: Env, input: WritingGradeInput): Promise<AiGradeResult> {
  if (!input.responseText.trim()) {
    throw new ApiError('VALIDATION_FAILED', 'There is nothing to mark yet: the response is empty.');
  }

  const user = `TASK (${input.taskLabel || 'Writing task'}):
${input.prompt || '(The task prompt was not stored with this response.)'}

WORD COUNT: ${input.wordCount} (minimum ${input.minimumWords})

CANDIDATE RESPONSE:
"""
${input.responseText.slice(0, 12_000)}
"""

Return JSON shaped exactly as:
{"overallBand": number,
 "criteria": [{"key": "TASK_ACHIEVEMENT|COHERENCE_COHESION|LEXICAL_RESOURCE|GRAMMATICAL_RANGE", "band": number, "comment": string}, ... four items, one per criterion],
 "feedback": "2-4 sentences addressed to the candidate",
 "strengths": ["...", "..."],
 "improvements": ["...", "..."],
 "corrections": [{"original": "their words", "suggestion": "better version", "reason": "why"}],
 "notes": ["..."]}

Criteria to score:
${WRITING_CRITERIA_TEXT}`;

  const { data, provider, usage } = await completeJson<RawGrade>(env, {
    ...(input.providerId ? { providerId: input.providerId } : {}),
    messages: [
      { role: 'system', content: `${SHARED_RULES}\n\nYou are marking an IELTS-style WRITING task.` },
      { role: 'user', content: user },
    ],
    temperature: 0.2,
    maxTokens: 2_000,
    jsonSchema: { name: 'ielts_writing_feedback', schema: GRADE_SCHEMA as unknown as Record<string, unknown> },
  });

  void usage;
  return normaliseGrade(data, provider.id, provider.model, WRITING_CRITERIA.map((criterion) => criterion.key));
}

export interface SpeakingGradeInput {
  topicTitle: string;
  parts: Array<{ part: number; prompt: string; transcript: string; durationSeconds: number }>;
  providerId?: string;
}

/** Grades a Speaking session from its transcripts. */
export async function gradeSpeaking(env: Env, input: SpeakingGradeInput): Promise<AiGradeResult> {
  const answers = input.parts
    .filter((part) => part.transcript.trim())
    .map(
      (part) =>
        `Part ${part.part} — ${part.prompt || input.topicTitle}\nDuration: ${Math.round(part.durationSeconds)}s\nTranscript:\n"""\n${part.transcript.slice(0, 6_000)}\n"""`,
    )
    .join('\n\n');

  if (!answers.trim()) {
    throw new ApiError(
      'VALIDATION_FAILED',
      'There is no transcript to mark. Record with the browser transcript enabled, or paste what you said.',
    );
  }

  const user = `TOPIC: ${input.topicTitle}

CANDIDATE ANSWERS (transcript of the spoken test):
${answers}

Return JSON shaped exactly as:
{"overallBand": number,
 "criteria": [{"key": "FLUENCY_COHERENCE|LEXICAL_RESOURCE|GRAMMATICAL_RANGE|PRONUNCIATION", "band": number, "comment": string}, ... four items],
 "feedback": "2-4 sentences addressed to the candidate",
 "strengths": ["..."],
 "improvements": ["..."],
 "corrections": [{"original": "their words", "suggestion": "better version", "reason": "why"}],
 "notes": ["..."]}

Criteria to score:
${SPEAKING_CRITERIA_TEXT}
Because you only have a transcript, score PRONUNCIATION as 0 and add a note that pronunciation was not assessed from the audio.`;

  const { data, provider } = await completeJson<RawGrade>(env, {
    ...(input.providerId ? { providerId: input.providerId } : {}),
    messages: [
      { role: 'system', content: `${SHARED_RULES}\n\nYou are marking an IELTS-style SPEAKING test from a transcript.` },
      { role: 'user', content: user },
    ],
    temperature: 0.2,
    maxTokens: 2_000,
    jsonSchema: { name: 'ielts_speaking_feedback', schema: GRADE_SCHEMA as unknown as Record<string, unknown> },
  });

  const grade = normaliseGrade(data, provider.id, provider.model, SPEAKING_CRITERIA.map((criterion) => criterion.key));
  return {
    ...grade,
    notes: [
      'Pronunciation cannot be measured from a transcript. Ask a teacher to listen to the recording for that criterion.',
      ...grade.notes,
    ],
  };
}

function normaliseGrade(
  raw: RawGrade,
  providerId: string,
  providerModel: string,
  expectedKeys: string[],
): AiGradeResult {
  const rawCriteria = Array.isArray(raw.criteria) ? raw.criteria : [];
  const byKey = new Map<string, { band: number | null; comment: string }>();
  for (const item of rawCriteria) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const key = String(record.key ?? '').trim().toUpperCase().replace(/[^A-Z_]/g, '_');
    const band = toBand(record.band);
    const comment = typeof record.comment === 'string' ? record.comment.trim() : '';
    if (key) byKey.set(key, { band, comment });
  }

  const criteria: AiCriterion[] = expectedKeys.map((key) => {
    const meta = [...WRITING_CRITERIA, ...SPEAKING_CRITERIA].find((criterion) => criterion.key === key);
    const found = byKey.get(key);
    // Pronunciation: never let a transcript-graded model pretend it heard audio.
    const band = key === 'PRONUNCIATION' && found?.band === 0 ? null : (found?.band ?? null);
    return {
      key,
      label: meta?.label ?? key.replace(/_/g, ' ').toLowerCase(),
      band,
      comment: found?.comment ?? 'Not commented on.',
    };
  });

  // The overall band is derived from the available criteria, not trusted blindly.
  const available = criteria.filter((criterion) => criterion.band !== null).map((criterion) => criterion.band as number);
  const derived = available.length > 0 ? roundHalf(available.reduce((sum, band) => sum + band, 0) / available.length) : null;
  const reported = toBand(raw.overallBand);
  const band = reported !== null && available.length >= 2 ? roundHalf((reported + (derived ?? reported)) / 2) : (reported ?? derived);

  return {
    band,
    criteria,
    feedback: firstString(raw.feedback) ?? 'No summary was returned by the AI provider.',
    strengths: toStringArray(raw.strengths),
    improvements: toStringArray(raw.improvements),
    corrections: Array.isArray(raw.corrections)
      ? raw.corrections
          .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
          .slice(0, 12)
          .map((item) => ({
            original: String(item.original ?? '').slice(0, 500),
            suggestion: String(item.suggestion ?? '').slice(0, 500),
            reason: String(item.reason ?? '').slice(0, 500),
          }))
          .filter((item) => item.original && item.suggestion)
      : [],
    notes: toStringArray(raw.notes),
    providerId,
    providerModel,
  };
}

function toBand(value: unknown): number | null {
  const number = typeof value === 'string' ? Number.parseFloat(value) : typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(9, roundHalf(number)));
}

export function roundHalf(value: number): number {
  return Math.round(value * 2) / 2;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string').slice(0, 12);
}

function firstString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  return null;
}

// -----------------------------------------------------------------------------
// Persistence
// -----------------------------------------------------------------------------

/**
 * Marks one stored Writing submission with the AI grader.
 *
 * A teacher's existing score is never silently replaced: the AI result is stored
 * as its own source, and a later teacher score overwrites it (the audit row in
 * `ai_scores` keeps the history of what the AI said).
 */
export async function scoreWritingSubmissionWithAi(
  env: Env,
  submissionId: string,
  options: { providerId?: string; actorUserId?: string | null } = {},
): Promise<AiGradeResult & { attemptId: string }> {
  const submission = await env.DB.prepare(
    `SELECT w.id, w.attempt_id, w.task_label, w.prompt_snapshot, w.response_text, w.word_count,
            q.config_json, g.config_json AS group_config_json
       FROM writing_submissions w
       LEFT JOIN questions q ON q.id = w.question_id
       LEFT JOIN question_groups g ON g.id = q.question_group_id
      WHERE w.id = ?`,
  )
    .bind(submissionId)
    .first<{
      id: string;
      attempt_id: string;
      task_label: string;
      prompt_snapshot: string;
      response_text: string;
      word_count: number;
      config_json: string | null;
      group_config_json: string | null;
    }>();
  if (!submission) throw ApiError.notFound('Writing submission not found.');

  const config = safeParse(submission.config_json) ?? safeParse(submission.group_config_json) ?? {};
  const minimumWords =
    typeof (config as Record<string, unknown>).minimumWords === 'number'
      ? ((config as Record<string, unknown>).minimumWords as number)
      : submission.task_label.includes('Task 2')
        ? 250
        : 150;

  const grade = await gradeWriting(env, {
    taskLabel: submission.task_label,
    prompt: submission.prompt_snapshot,
    responseText: submission.response_text,
    wordCount: submission.word_count,
    minimumWords,
    ...(options.providerId ? { providerId: options.providerId } : {}),
  });

  await setWritingScore(env, {
    writingSubmissionId: submissionId,
    band: grade.band,
    feedback: grade.feedback,
    criteria: Object.fromEntries(
      grade.criteria.map((criterion) => [criterion.key, criterion.band ?? 0]),
    ),
    source: 'AI',
    // `scored_by` is a user reference; the AI has none, so the audit row below
    // records the provider instead.
    scoredBy: options.actorUserId ?? (await systemUserId(env)),
  });

  await env.DB.prepare(
    `INSERT INTO ai_scores (id, user_id, entity_type, entity_id, kind, provider_id, provider_model, band,
                            criteria_json, feedback, raw_json, created_at)
     VALUES (?, ?, 'WRITING', ?, 'WRITING_TASK', ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      newId('ais'),
      options.actorUserId ?? null,
      submissionId,
      grade.providerId,
      grade.providerModel,
      grade.band,
      JSON.stringify({ criteria: grade.criteria, strengths: grade.strengths, improvements: grade.improvements, notes: grade.notes }),
      grade.feedback,
      JSON.stringify({ corrections: grade.corrections }),
      nowIso(),
    )
    .run();

  return { ...grade, attemptId: submission.attempt_id };
}

/** Marks a stored Speaking session (all parts) and persists the estimate. */
export async function scoreSpeakingSessionWithAi(
  env: Env,
  sessionId: string,
  options: { providerId?: string } = {},
): Promise<AiGradeResult> {
  const session = await env.DB.prepare(
    'SELECT id, user_id, topic_title, status FROM speaking_sessions WHERE id = ?',
  )
    .bind(sessionId)
    .first<{ id: string; user_id: string; topic_title: string; status: string }>();
  if (!session) throw ApiError.notFound('Speaking session not found.');

  const responses = await env.DB.prepare(
    'SELECT part, prompt_text, transcript, duration_seconds FROM speaking_responses WHERE session_id = ? ORDER BY part',
  )
    .bind(sessionId)
    .all<{ part: number; prompt_text: string; transcript: string; duration_seconds: number }>();

  const grade = await gradeSpeaking(env, {
    topicTitle: session.topic_title,
    parts: responses.results.map((row) => ({
      part: row.part,
      prompt: row.prompt_text,
      transcript: row.transcript,
      durationSeconds: row.duration_seconds,
    })),
    ...(options.providerId ? { providerId: options.providerId } : {}),
  });

  const timestamp = nowIso();
  await env.DB.prepare(
    `UPDATE speaking_sessions
        SET overall_band = ?, criteria_json = ?, feedback = ?, provider_id = ?, provider_model = ?,
            status = 'MARKED', marked_at = ?, updated_at = ?
      WHERE id = ?`,
  )
    .bind(
      grade.band,
      JSON.stringify({
        criteria: grade.criteria,
        strengths: grade.strengths,
        improvements: grade.improvements,
        corrections: grade.corrections,
        notes: grade.notes,
      }),
      grade.feedback,
      grade.providerId,
      grade.providerModel,
      timestamp,
      timestamp,
      sessionId,
    )
    .run();

  await env.DB.prepare(
    `INSERT INTO ai_scores (id, user_id, entity_type, entity_id, kind, provider_id, provider_model, band,
                            criteria_json, feedback, raw_json, created_at)
     VALUES (?, ?, 'SPEAKING', ?, 'SPEAKING_SESSION', ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      newId('ais'),
      session.user_id,
      sessionId,
      grade.providerId,
      grade.providerModel,
      grade.band,
      JSON.stringify({ criteria: grade.criteria, strengths: grade.strengths, improvements: grade.improvements, notes: grade.notes }),
      grade.feedback,
      JSON.stringify({ corrections: grade.corrections }),
      timestamp,
    )
    .run();

  return grade;
}

/** The stored AI score of a Speaking session, if any. */
export async function loadSpeakingScore(env: Env, sessionId: string): Promise<AiGradeResult | null> {
  const row = await env.DB.prepare(
    `SELECT band, criteria_json, feedback, provider_id, provider_model
       FROM speaking_sessions WHERE id = ? AND status = 'MARKED'`,
  )
    .bind(sessionId)
    .first<{ band: number | null; criteria_json: string; feedback: string; provider_id: string | null; provider_model: string | null }>();
  if (!row) return null;
  const parsed = safeParse(row.criteria_json) as
    | { criteria?: AiCriterion[]; strengths?: string[]; improvements?: string[]; corrections?: AiCorrection[]; notes?: string[] }
    | null;
  return {
    band: row.band,
    criteria: parsed?.criteria ?? [],
    feedback: row.feedback,
    strengths: parsed?.strengths ?? [],
    improvements: parsed?.improvements ?? [],
    corrections: parsed?.corrections ?? [],
    notes: parsed?.notes ?? [],
    providerId: row.provider_id ?? '',
    providerModel: row.provider_model ?? '',
  };
}

function safeParse(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** `writing_scores.scored_by` references users; fall back to the first admin. */
async function systemUserId(env: Env): Promise<string | null> {
  const row = await env.DB.prepare("SELECT id FROM users WHERE role = 'ADMIN' ORDER BY created_at LIMIT 1")
    .first<{ id: string }>()
    .catch(() => null);
  return row?.id ?? null;
}
