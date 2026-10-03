import type { Env } from '../env';
import { ApiError } from '../lib/errors';
import { newId, nowIso } from '../lib/ids';
import { completeJson } from '../ai/providers';
import { describeAiFailure } from '../ai/failure';
import { resolveJudges, withJudgeRetry, type Judge } from '../ai/judges';
import {
  buildSpeakingMessages,
  buildWritingMessages,
  MARKING_PROMPT_VERSION,
  type SpeakingPromptInput,
  type WritingPromptInput,
} from '../ai/marking-prompts';
import { setWritingScore } from './marking-service';
import { saveAiVocabulary } from './vocabulary-service';
import { WRITING_CRITERIA, SPEAKING_CRITERIA } from '../../shared/ai-rubric';
import { clampBand, meanBand, roundHalfBand } from '../../shared/bands';
import type {
  AiMarkView,
  JudgeCorrection,
  JudgeCriterion,
  JudgeLabel,
  JudgeOpinion,
  JudgeVocabulary,
} from '../../shared/judges';

/**
 * AI marking for Writing and Speaking, done by a two-judge panel.
 *
 * Honesty rules this module follows:
 *  - every band it produces is an ESTIMATE and is labelled as one everywhere it
 *    is shown;
 *  - a model is never allowed to mark an objective answer (reading/listening are
 *    marked deterministically against the protected key);
 *  - a Writing band produced here never overwrites a teacher's band: the AI
 *    result is stored as `scoring_source = 'AI'`, and a teacher can re-score the
 *    same submission at any time (which replaces it and is recorded);
 *  - Speaking is graded from the transcript the candidate produced. When no
 *    transcript exists the judges are never asked, and pronunciation is
 *    explicitly reported as not assessed;
 *  - the judges are anonymous: which model answered as Judge01 or Judge02 is
 *    stored in `ai_scores` for the audit trail but is never part of anything
 *    returned to a browser.
 */

export type AiCriterion = JudgeCriterion;
export type AiCorrection = JudgeCorrection;

/** One judge's grade of one response, before it is turned into an opinion. */
export interface AiGradeResult {
  band: number | null;
  criteria: AiCriterion[];
  feedback: string;
  feedbackVi: string;
  strengths: string[];
  improvements: string[];
  corrections: AiCorrection[];
  vocabulary: JudgeVocabulary[];
  /** Caveats the UI must show verbatim (for example: pronunciation not assessed). */
  notes: string[];
  /** INTERNAL: names the provider and model. Never serialise this into a response. */
  providerId: string;
  providerModel: string;
}

/**
 * What a model actually returns. Models drift from the requested shape (an object
 * map instead of an array, `score` instead of `band`, "Task Response" instead of
 * TASK_ACHIEVEMENT), so every field is read defensively in `normaliseGrade`.
 */
type RawGrade = Record<string, unknown>;

/**
 * Output budget for one grade. Reasoning models (gpt-oss, deepseek, …) spend
 * part of it thinking before they write the JSON, so 2,000 was routinely cut off
 * mid-object; the transport doubles it automatically if that still happens.
 */
const AI_MARKING_MAX_TOKENS = 6_000;
const AI_MARKING_TIMEOUT_MS = 110_000;

const GRADE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['overallBand', 'criteria', 'feedback', 'feedbackVi', 'strengths', 'improvements', 'corrections', 'vocabulary', 'notes'],
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
    feedbackVi: { type: 'string' },
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
    vocabulary: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['term', 'pos', 'meaning', 'meaningVi', 'example'],
        properties: {
          term: { type: 'string' },
          pos: { type: 'string' },
          meaning: { type: 'string' },
          meaningVi: { type: 'string' },
          example: { type: 'string' },
        },
      },
    },
    notes: { type: 'array', items: { type: 'string' } },
  },
} as const;

export interface WritingGradeInput extends WritingPromptInput {
  judge: Judge;
}

/** One judge grades one Writing response against the four public Writing criteria. */
export async function gradeWriting(env: Env, input: WritingGradeInput): Promise<AiGradeResult> {
  if (!input.responseText.trim()) {
    throw new ApiError('VALIDATION_FAILED', 'There is nothing to mark yet: the response is empty.');
  }
  const { data, provider } = await withJudgeRetry(() =>
    completeJson<RawGrade>(env, {
      providerId: input.judge.providerId,
      ...(input.judge.model ? { model: input.judge.model } : {}),
      messages: buildWritingMessages(input),
      temperature: 0.2,
      maxTokens: AI_MARKING_MAX_TOKENS,
      timeoutMs: AI_MARKING_TIMEOUT_MS,
      reasoningEffort: 'medium',
      jsonSchema: { name: 'ielts_writing_feedback', schema: GRADE_SCHEMA as unknown as Record<string, unknown> },
    }),
  );
  return normaliseGrade(data, provider.id, provider.model, WRITING_CRITERIA.map((criterion) => criterion.key));
}

export interface SpeakingGradeInput extends SpeakingPromptInput {
  judge: Judge;
}

/** One judge grades a Speaking session from its transcripts. */
export async function gradeSpeaking(env: Env, input: SpeakingGradeInput): Promise<AiGradeResult> {
  if (!input.parts.some((part) => part.transcript.trim())) {
    throw new ApiError(
      'VALIDATION_FAILED',
      'There is no transcript to mark. Record with the browser transcript enabled, or type what you said.',
    );
  }
  const { data, provider } = await withJudgeRetry(() =>
    completeJson<RawGrade>(env, {
      providerId: input.judge.providerId,
      ...(input.judge.model ? { model: input.judge.model } : {}),
      messages: buildSpeakingMessages(input),
      temperature: 0.2,
      maxTokens: AI_MARKING_MAX_TOKENS,
      timeoutMs: AI_MARKING_TIMEOUT_MS,
      reasoningEffort: 'medium',
      jsonSchema: { name: 'ielts_speaking_feedback', schema: GRADE_SCHEMA as unknown as Record<string, unknown> },
    }),
  );
  const grade = normaliseGrade(data, provider.id, provider.model, SPEAKING_CRITERIA.map((criterion) => criterion.key));
  return {
    ...grade,
    notes: [
      'Pronunciation cannot be measured from a transcript. Ask a teacher to listen to the recording for that criterion.',
      ...grade.notes.filter((note) => !/pronunciation/i.test(note)),
    ],
  };
}

// -----------------------------------------------------------------------------
// The panel's verdict
// -----------------------------------------------------------------------------

export function toOpinion(label: JudgeLabel, grade: AiGradeResult): JudgeOpinion {
  return {
    judge: label,
    band: grade.band,
    criteria: grade.criteria,
    feedback: grade.feedback,
    feedbackVi: grade.feedbackVi,
    strengths: grade.strengths,
    improvements: grade.improvements,
    corrections: grade.corrections,
    notes: grade.notes,
  };
}

function dedupe<T>(items: T[], keyOf: (item: T) => string, limit: number): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = keyOf(item).toLowerCase().replace(/\s+/g, ' ').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Combines the judges into one verdict: the mean of their bands (and, per
 * criterion, the mean of theirs), each rounded to the nearest half band. Judges
 * are ordered Judge01 first, so the lead summary is Judge01's whenever it exists.
 */
export function combineOpinions(
  opinions: JudgeOpinion[],
  expectedKeys: string[],
  unavailable: JudgeLabel[],
  createdAt: string,
): AiMarkView {
  const ordered = [...opinions].sort((a, b) => a.judge.localeCompare(b.judge));
  const criteria: JudgeCriterion[] = expectedKeys.map((key) => {
    const rows = ordered.map((opinion) => opinion.criteria.find((criterion) => criterion.key === key)).filter(Boolean) as JudgeCriterion[];
    const band = meanBand(rows.map((row) => row.band));
    return {
      key,
      label: rows[0]?.label ?? key.replace(/_/g, ' ').toLowerCase(),
      band,
      comment: rows.find((row) => row.comment && row.comment !== 'Not commented on.')?.comment ?? rows[0]?.comment ?? '',
    };
  });
  const bands = ordered.map((opinion) => opinion.band).filter((band): band is number => band !== null);
  return {
    status: unavailable.length > 0 ? 'PARTIAL' : 'DONE',
    band: meanBand(bands),
    criteria,
    feedback: ordered.find((opinion) => opinion.feedback)?.feedback ?? '',
    feedbackVi: ordered.find((opinion) => opinion.feedbackVi)?.feedbackVi ?? '',
    strengths: dedupe(ordered.flatMap((opinion) => opinion.strengths), (text) => text, 6),
    improvements: dedupe(ordered.flatMap((opinion) => opinion.improvements), (text) => text, 6),
    corrections: dedupe(ordered.flatMap((opinion) => opinion.corrections), (item) => item.original, 10),
    notes: dedupe(ordered.flatMap((opinion) => opinion.notes), (text) => text, 6),
    judges: ordered,
    spread: bands.length >= 2 ? roundHalfBand(Math.max(...bands) - Math.min(...bands)) : null,
    unavailable,
    createdAt,
  };
}

/** Which rubric criterion a model's label means, whatever it called it. */
export function canonicalCriterionKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const words = value.toLowerCase().replace(/[^a-z]+/g, ' ').trim();
  if (!words) return null;
  const has = (...needles: string[]) => needles.some((needle) => words.includes(needle));
  if (has('fluency')) return 'FLUENCY_COHERENCE';
  if (has('task')) return 'TASK_ACHIEVEMENT';
  if (has('coherence', 'cohesion')) return 'COHERENCE_COHESION';
  if (has('lexical', 'vocab')) return 'LEXICAL_RESOURCE';
  if (has('grammar', 'grammatical')) return 'GRAMMATICAL_RANGE';
  if (has('pronunc')) return 'PRONUNCIATION';
  // The bare abbreviations models like to use.
  const abbreviations: Record<string, string> = {
    ta: 'TASK_ACHIEVEMENT',
    tr: 'TASK_ACHIEVEMENT',
    cc: 'COHERENCE_COHESION',
    lr: 'LEXICAL_RESOURCE',
    gra: 'GRAMMATICAL_RANGE',
    gr: 'GRAMMATICAL_RANGE',
    fc: 'FLUENCY_COHERENCE',
    p: 'PRONUNCIATION',
  };
  return abbreviations[words] ?? null;
}

function pick(record: Record<string, unknown>, ...names: string[]): unknown {
  for (const name of names) {
    if (record[name] !== undefined && record[name] !== null) return record[name];
  }
  return undefined;
}

/** Reads `criteria` whether it is an array of rows or an object keyed by criterion. */
function readCriteria(raw: unknown): Array<{ key: string; band: number | null; comment: string }> {
  const rows: Array<{ label: unknown; value: unknown }> = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      rows.push({ label: pick(record, 'key', 'criterion', 'criteria', 'name', 'id', 'title', 'label'), value: record });
    }
  } else if (raw && typeof raw === 'object') {
    for (const [label, value] of Object.entries(raw as Record<string, unknown>)) rows.push({ label, value });
  }

  const result: Array<{ key: string; band: number | null; comment: string }> = [];
  for (const row of rows) {
    const key = canonicalCriterionKey(row.label);
    if (!key) continue;
    const record = row.value && typeof row.value === 'object' ? (row.value as Record<string, unknown>) : null;
    // `{"TASK_ACHIEVEMENT": 7}` has the band as the value itself.
    const band = toBand(record ? pick(record, 'band', 'score', 'value', 'rating', 'mark', 'grade') : row.value);
    const commentRaw = record ? pick(record, 'comment', 'feedback', 'explanation', 'reason', 'justification', 'rationale', 'notes', 'evidence') : undefined;
    result.push({ key, band, comment: typeof commentRaw === 'string' ? commentRaw.trim() : '' });
  }
  return result;
}

export function normaliseGrade(
  raw: RawGrade,
  providerId: string,
  providerModel: string,
  expectedKeys: string[],
): AiGradeResult {
  const byKey = new Map<string, { band: number | null; comment: string }>();
  for (const item of readCriteria(pick(raw, 'criteria', 'criteriaScores', 'criteria_scores', 'scores', 'bands', 'rubric'))) {
    // The first mention of a criterion wins; a repeat is usually a hallucinated duplicate.
    if (!byKey.has(item.key)) byKey.set(item.key, { band: item.band, comment: item.comment });
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
      comment: found?.comment || 'Not commented on.',
    };
  });

  // The overall band is derived from the available criteria, not trusted blindly.
  const available = criteria.filter((criterion) => criterion.band !== null).map((criterion) => criterion.band as number);
  const derived = available.length > 0 ? roundHalf(available.reduce((sum, band) => sum + band, 0) / available.length) : null;
  const reported = toBand(pick(raw, 'overallBand', 'overall_band', 'overall', 'overallScore', 'overall_score', 'band', 'score'));
  const band = reported !== null && available.length >= 2 ? roundHalf((reported + (derived ?? reported)) / 2) : (reported ?? derived);
  if (band === null) {
    throw new ApiError(
      'AI_UNAVAILABLE',
      'The judge answered without a usable band score, so nothing was saved. Please try again.',
    );
  }

  const feedbackRaw = pick(raw, 'feedback', 'Feedback', 'summary', 'overallFeedback', 'overall_feedback', 'comment', 'comments');
  const correctionsRaw = pick(raw, 'corrections', 'correction', 'errors', 'suggestions');

  return {
    band,
    criteria,
    feedback: firstString(feedbackRaw) ?? 'No summary was returned by the judge.',
    feedbackVi: firstString(pick(raw, 'feedbackVi', 'feedback_vi', 'vietnamese', 'tiengViet', 'summaryVi')) ?? '',
    strengths: toStringArray(pick(raw, 'strengths', 'positives', 'whatWentWell')),
    improvements: toStringArray(pick(raw, 'improvements', 'weaknesses', 'areasForImprovement', 'areas_for_improvement', 'tips')),
    corrections: Array.isArray(correctionsRaw)
      ? correctionsRaw
          .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
          .slice(0, 12)
          .map((item) => {
            const isActualErrorRaw = pick(item, 'isActualError', 'is_actual_error', 'actualError', 'isError');
            const confidenceRaw = pick(item, 'confidence', 'score');
            const confidence = typeof confidenceRaw === 'number' ? confidenceRaw : Number.parseFloat(String(confidenceRaw ?? ''));
            return {
              original: String(pick(item, 'original', 'from', 'text', 'error', 'incorrect', 'before') ?? '').slice(0, 500),
              suggestion: String(pick(item, 'suggestion', 'corrected', 'correction', 'better', 'improved', 'fix', 'after') ?? '').slice(0, 500),
              reason: String(pick(item, 'reason', 'explanation', 'why', 'note') ?? '').slice(0, 500),
              // Absent (older scores or a model that ignored the field) counts as a genuine error.
              isActualError: typeof isActualErrorRaw === 'boolean' ? isActualErrorRaw : true,
              category: String(pick(item, 'category', 'type', 'kind') ?? '').slice(0, 40) || undefined,
              confidence: Number.isFinite(confidence) ? confidence : undefined,
            };
          })
          .filter((item) => item.original && item.suggestion)
      : [],
    vocabulary: readVocabulary(pick(raw, 'vocabulary', 'vocab', 'words', 'suggestedVocabulary')),
    notes: toStringArray(pick(raw, 'notes', 'caveats')),
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

/** A list of short strings from `["a"]`, `[{"text": "a"}]` or a lone `"a"`. */
function toStringArray(value: unknown): string[] {
  const items = Array.isArray(value) ? value : typeof value === 'string' && value.trim() ? [value] : [];
  return items
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      if (item && typeof item === 'object') {
        const text = pick(item as Record<string, unknown>, 'text', 'point', 'description', 'comment', 'suggestion', 'tip');
        return typeof text === 'string' ? text.trim() : '';
      }
      return '';
    })
    .filter(Boolean)
    .slice(0, 12);
}

function firstString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}


/** Suggested words, whatever shape the model used for them. */
function readVocabulary(raw: unknown): JudgeVocabulary[] {
  if (!Array.isArray(raw)) return [];
  const words: JudgeVocabulary[] = [];
  for (const item of raw) {
    if (typeof item === 'string' && item.trim()) {
      words.push({ term: item.trim().slice(0, 80), pos: '', meaning: '', meaningVi: '', example: '' });
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const term = String(pick(record, 'term', 'word', 'phrase', 'lemma') ?? '').trim();
    if (!term || term.length > 80) continue;
    const text = (...names: string[]) => String(pick(record, ...names) ?? '').trim();
    words.push({
      term,
      pos: text('pos', 'partOfSpeech', 'type').slice(0, 24),
      meaning: text('meaning', 'definition', 'en').slice(0, 240),
      meaningVi: text('meaningVi', 'meaning_vi', 'vi', 'vietnamese').slice(0, 240),
      example: text('example', 'sentence').slice(0, 300),
    });
    if (words.length >= 6) break;
  }
  return words;
}


// -----------------------------------------------------------------------------
// Persistence: one `ai_scores` row per judge per marking
// -----------------------------------------------------------------------------

type EntityType = 'WRITING' | 'SPEAKING';

const JUDGE_KIND: Record<JudgeLabel, string> = { Judge01: 'JUDGE1', Judge02: 'JUDGE2' };

interface StoredScoreRow {
  entity_id: string;
  kind: string;
  band: number | null;
  criteria_json: string;
  feedback: string;
  raw_json: string;
  created_at: string;
}

/** Audit row for one judge. `provider_model` names the real model and never leaves the database. */
async function insertJudgeScore(
  env: Env,
  input: { userId: string | null; entityType: EntityType; entityId: string; opinion: JudgeOpinion; grade: AiGradeResult; createdAt: string },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO ai_scores (id, user_id, entity_type, entity_id, kind, provider_id, provider_model, band,
                            criteria_json, feedback, raw_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      newId('ais'),
      input.userId,
      input.entityType,
      input.entityId,
      `${input.entityType}_${JUDGE_KIND[input.opinion.judge]}`,
      input.grade.providerId,
      input.grade.providerModel,
      input.grade.band,
      JSON.stringify({
        judge: input.opinion.judge,
        promptVersion: MARKING_PROMPT_VERSION,
        criteria: input.grade.criteria,
        strengths: input.grade.strengths,
        improvements: input.grade.improvements,
        notes: input.grade.notes,
        feedbackVi: input.grade.feedbackVi,
        vocabulary: input.grade.vocabulary,
      }),
      input.grade.feedback,
      JSON.stringify({ corrections: input.grade.corrections }),
      input.createdAt,
    )
    .run();
}

function judgeFromRow(row: StoredScoreRow, parsed: { judge?: unknown } | null): JudgeLabel {
  if (parsed?.judge === 'Judge01' || parsed?.judge === 'Judge02') return parsed.judge;
  const match = /JUDGE(\d)$/.exec(row.kind);
  if (match?.[1] === '2') return 'Judge02';
  // Scores stored before the panel existed were a single model's: they become Judge01's.
  return 'Judge01';
}

function opinionFromRow(row: StoredScoreRow): { label: JudgeLabel; opinion: JudgeOpinion; createdAt: string } {
  const parsed = safeParse(row.criteria_json) as
    | {
        judge?: unknown;
        criteria?: JudgeCriterion[];
        strengths?: string[];
        improvements?: string[];
        notes?: string[];
        feedbackVi?: string;
      }
    | null;
  const raw = safeParse(row.raw_json) as { corrections?: JudgeCorrection[] } | null;
  const label = judgeFromRow(row, parsed);
  return {
    label,
    createdAt: row.created_at,
    opinion: {
      judge: label,
      band: row.band,
      criteria: Array.isArray(parsed?.criteria) ? parsed!.criteria! : [],
      feedback: row.feedback,
      feedbackVi: parsed?.feedbackVi ?? '',
      strengths: Array.isArray(parsed?.strengths) ? parsed!.strengths! : [],
      improvements: Array.isArray(parsed?.improvements) ? parsed!.improvements! : [],
      corrections: Array.isArray(raw?.corrections) ? raw!.corrections! : [],
      notes: Array.isArray(parsed?.notes) ? parsed!.notes! : [],
    },
  };
}

/** Newest opinion per judge for each entity. */
async function loadLatestOpinions(
  env: Env,
  entityType: EntityType,
  ids: string[],
): Promise<Map<string, Map<JudgeLabel, { opinion: JudgeOpinion; createdAt: string }>>> {
  const result = new Map<string, Map<JudgeLabel, { opinion: JudgeOpinion; createdAt: string }>>();
  for (let offset = 0; offset < ids.length; offset += 40) {
    const chunk = ids.slice(offset, offset + 40);
    const rows = await env.DB.prepare(
      `SELECT entity_id, kind, band, criteria_json, feedback, raw_json, created_at
         FROM ai_scores
        WHERE entity_type = ? AND entity_id IN (${chunk.map(() => '?').join(', ')})
        ORDER BY created_at DESC, rowid DESC`,
    )
      .bind(entityType, ...chunk)
      .all<StoredScoreRow>()
      // A database that predates `ai_scores` simply has no opinions yet.
      .catch((error: unknown) => {
        console.warn('ai_scores_unreadable', error instanceof Error ? error.message : error);
        return { results: [] as StoredScoreRow[] };
      });
    for (const row of rows.results ?? []) {
      const { label, opinion, createdAt } = opinionFromRow(row);
      const byJudge = result.get(row.entity_id) ?? new Map();
      if (!byJudge.has(label)) byJudge.set(label, { opinion, createdAt });
      result.set(row.entity_id, byJudge);
    }
  }
  return result;
}

/** Who should be on the panel right now (empty when AI is not configured). */
async function plannedPanel(env: Env): Promise<JudgeLabel[]> {
  try {
    return (await resolveJudges(env)).map((judge) => judge.label);
  } catch {
    return [];
  }
}

function criterionKeys(entityType: EntityType): string[] {
  return (entityType === 'WRITING' ? WRITING_CRITERIA : SPEAKING_CRITERIA).map((criterion) => criterion.key);
}

function viewFromOpinions(
  entityType: EntityType,
  byJudge: Map<JudgeLabel, { opinion: JudgeOpinion; createdAt: string }>,
  planned: JudgeLabel[],
): AiMarkView {
  const entries = [...byJudge.values()];
  const missing = planned.filter((label) => !byJudge.has(label));
  const createdAt = entries.map((entry) => entry.createdAt).sort().at(-1) ?? nowIso();
  return combineOpinions(entries.map((entry) => entry.opinion), criterionKeys(entityType), missing, createdAt);
}

/** The panel's stored verdict for each of the given Writing submissions. */
export async function loadWritingMarks(env: Env, submissionIds: string[]): Promise<Map<string, AiMarkView>> {
  const views = new Map<string, AiMarkView>();
  if (submissionIds.length === 0) return views;
  const [opinions, planned] = await Promise.all([loadLatestOpinions(env, 'WRITING', submissionIds), plannedPanel(env)]);
  for (const [id, byJudge] of opinions) views.set(id, viewFromOpinions('WRITING', byJudge, planned));
  return views;
}

/** The panel's stored verdict for a Speaking session. */
export async function loadSpeakingScore(env: Env, sessionId: string): Promise<AiMarkView | null> {
  const [opinions, planned] = await Promise.all([loadLatestOpinions(env, 'SPEAKING', [sessionId]), plannedPanel(env)]);
  const byJudge = opinions.get(sessionId);
  if (byJudge && byJudge.size > 0) return viewFromOpinions('SPEAKING', byJudge, planned);

  // Marked before the panel existed: the session row holds the single AI estimate.
  const row = await env.DB.prepare(
    `SELECT overall_band AS band, criteria_json, feedback, marked_at FROM speaking_sessions
      WHERE id = ? AND status = 'MARKED' AND (score_source IS NULL OR score_source = 'AI')`,
  )
    .bind(sessionId)
    .first<{ band: number | null; criteria_json: string; feedback: string; marked_at: string | null }>();
  if (!row) return null;
  const legacy = opinionFromRow({
    entity_id: sessionId,
    kind: 'SPEAKING_SESSION',
    band: row.band,
    criteria_json: row.criteria_json,
    feedback: row.feedback,
    raw_json: JSON.stringify({ corrections: (safeParse(row.criteria_json) as { corrections?: unknown } | null)?.corrections ?? [] }),
    created_at: row.marked_at ?? nowIso(),
  });
  return viewFromOpinions('SPEAKING', new Map([[legacy.label, legacy]]), planned);
}

// -----------------------------------------------------------------------------
// Orchestration
// -----------------------------------------------------------------------------

/**
 * Concurrent requests for the same response (a double-clicked button, a page
 * that mounted twice) share one marking run instead of paying for it twice.
 */
const inflight = new Map<string, Promise<unknown>>();
function coalesce<T>(key: string, run: () => Promise<T>): Promise<T> {
  const running = inflight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const started = run().finally(() => inflight.delete(key));
  inflight.set(key, started);
  return started;
}

/**
 * The candidate's recent overall estimate. It only pitches vocabulary
 * suggestions: it is never part of the marking prompt's scoring evidence.
 */
export async function levelHintForUser(env: Env, userId: string): Promise<number | null> {
  const rows = await env.DB.prepare(
    `SELECT s.estimated_band AS band
       FROM attempt_skill_sessions s JOIN attempts a ON a.id = s.attempt_id
      WHERE a.user_id = ? AND s.estimated_band IS NOT NULL
      ORDER BY s.updated_at DESC LIMIT 6`,
  )
    .bind(userId)
    .all<{ band: number }>()
    .catch(() => ({ results: [] as Array<{ band: number }> }));
  return meanBand((rows.results ?? []).map((row) => row.band));
}

export interface MarkOptions {
  actorUserId?: string | null;
  /** Ask every judge again, even those who already answered. */
  force?: boolean;
}

export interface MarkOutcome {
  view: AiMarkView;
  /** Judges that answered in THIS run. */
  asked: JudgeLabel[];
  failures: Array<{ judge: JudgeLabel; message: string }>;
}

/**
 * Marks one stored Writing submission with the panel.
 *
 * Judges that already answered are not asked again (so a retry only fills in the
 * judge that failed), unless `force` is set. A teacher's existing band is never
 * replaced: the AI band is stored as `scoring_source = 'AI'`.
 */
export async function markWritingSubmission(
  env: Env,
  submissionId: string,
  options: MarkOptions = {},
): Promise<MarkOutcome & { attemptId: string }> {
  return coalesce(`w:${submissionId}:${options.force ? 'force' : 'fill'}`, async () => {
    const submission = await env.DB.prepare(
      `SELECT w.id, w.attempt_id, w.task_label, w.prompt_snapshot, w.response_text, w.word_count,
              a.user_id, q.config_json, g.config_json AS group_config_json
         FROM writing_submissions w
         JOIN attempts a ON a.id = w.attempt_id
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
        user_id: string;
        config_json: string | null;
        group_config_json: string | null;
      }>();
    if (!submission) throw ApiError.notFound('Writing submission not found.');

    const config = (safeParse(submission.config_json) ?? safeParse(submission.group_config_json) ?? {}) as Record<string, unknown>;
    const minimumWords =
      typeof config.minimumWords === 'number' ? config.minimumWords : /task\s*2/i.test(submission.task_label) ? 250 : 150;

    const panel = await resolveJudges(env);
    const existing = (await loadLatestOpinions(env, 'WRITING', [submissionId])).get(submissionId) ?? new Map();
    const toAsk = options.force ? panel : panel.filter((judge) => !existing.has(judge.label));

    const failures: MarkOutcome['failures'] = [];
    const asked: JudgeLabel[] = [];
    const answers = new Map<JudgeLabel, { opinion: JudgeOpinion; createdAt: string }>(existing);

    if (toAsk.length > 0) {
      const levelHint = await levelHintForUser(env, submission.user_id);
      const settled = await Promise.allSettled(
        toAsk.map((judge) =>
          gradeWriting(env, {
            judge,
            taskLabel: submission.task_label,
            prompt: submission.prompt_snapshot,
            responseText: submission.response_text,
            wordCount: submission.word_count,
            minimumWords,
            levelHint,
          }),
        ),
      );
      const createdAt = nowIso();
      for (const [index, outcome] of settled.entries()) {
        const judge = toAsk[index]!;
        if (outcome.status === 'rejected') {
          failures.push({
            judge: judge.label,
            message: describeAiFailure(outcome.reason, { submissionId, judge: judge.label, userId: submission.user_id }).message,
          });
          continue;
        }
        const opinion = toOpinion(judge.label, outcome.value);
        await insertJudgeScore(env, {
          userId: submission.user_id,
          entityType: 'WRITING',
          entityId: submissionId,
          opinion,
          grade: outcome.value,
          createdAt,
        });
        answers.set(judge.label, { opinion, createdAt });
        asked.push(judge.label);
        void saveSuggestedWords(env, submission.user_id, outcome.value.vocabulary, 'Writing feedback');
      }
    }

    if (answers.size === 0) {
      throw new ApiError('AI_UNAVAILABLE', failures[0]?.message ?? 'The judges could not mark this response. Please try again.');
    }

    const view = viewFromOpinions('WRITING', answers, panel.map((judge) => judge.label));
    if (asked.length > 0) {
      await setWritingScore(env, {
        writingSubmissionId: submissionId,
        band: view.band,
        feedback: view.feedback,
        criteria: Object.fromEntries(view.criteria.map((criterion) => [criterion.key, criterion.band ?? 0])),
        source: 'AI',
        // `scored_by` is a user reference; the AI has none, so `ai_scores` is the audit trail.
        scoredBy: options.actorUserId ?? (await systemUserId(env)),
      });
    }
    return { view, asked, failures, attemptId: submission.attempt_id };
  });
}

/**
 * Backwards-compatible entry used by the teacher's "AI first pass" button: it
 * runs the same panel and returns the combined verdict.
 */
export async function scoreWritingSubmissionWithAi(
  env: Env,
  submissionId: string,
  options: MarkOptions = {},
): Promise<AiMarkView & { attemptId: string }> {
  const outcome = await markWritingSubmission(env, submissionId, options);
  return { ...outcome.view, attemptId: outcome.attemptId };
}

/** Marks a stored Speaking session (all parts) with the panel and persists the estimate. */
export async function markSpeakingSession(env: Env, sessionId: string, options: MarkOptions = {}): Promise<MarkOutcome> {
  return coalesce(`s:${sessionId}:${options.force ? 'force' : 'fill'}`, async () => {
    const session = await env.DB.prepare(
      'SELECT id, user_id, topic_title, status, score_source FROM speaking_sessions WHERE id = ?',
    )
      .bind(sessionId)
      .first<{ id: string; user_id: string; topic_title: string; status: string; score_source: string | null }>();
    if (!session) throw ApiError.notFound('Speaking session not found.');
    // Same rule as Writing: an AI estimate never replaces a band a person gave.
    if (session.score_source && session.score_source !== 'AI') {
      throw ApiError.conflict('A teacher has already marked this speaking session, so the AI estimate was not applied.');
    }

    const responses = await env.DB.prepare(
      'SELECT part, prompt_text, transcript, duration_seconds FROM speaking_responses WHERE session_id = ? ORDER BY part',
    )
      .bind(sessionId)
      .all<{ part: number; prompt_text: string; transcript: string; duration_seconds: number }>();

    const panel = await resolveJudges(env);
    const existing = (await loadLatestOpinions(env, 'SPEAKING', [sessionId])).get(sessionId) ?? new Map();
    const toAsk = options.force ? panel : panel.filter((judge) => !existing.has(judge.label));

    const failures: MarkOutcome['failures'] = [];
    const asked: JudgeLabel[] = [];
    const answers = new Map<JudgeLabel, { opinion: JudgeOpinion; createdAt: string }>(existing);

    if (toAsk.length > 0) {
      const levelHint = await levelHintForUser(env, session.user_id);
      const parts = responses.results.map((row) => ({
        part: row.part,
        prompt: row.prompt_text,
        transcript: row.transcript,
        durationSeconds: row.duration_seconds,
      }));
      const settled = await Promise.allSettled(
        toAsk.map((judge) => gradeSpeaking(env, { judge, topicTitle: session.topic_title, parts, levelHint })),
      );
      const createdAt = nowIso();
      for (const [index, outcome] of settled.entries()) {
        const judge = toAsk[index]!;
        if (outcome.status === 'rejected') {
          failures.push({
            judge: judge.label,
            message: describeAiFailure(outcome.reason, { sessionId, judge: judge.label, userId: session.user_id }).message,
          });
          continue;
        }
        const opinion = toOpinion(judge.label, outcome.value);
        await insertJudgeScore(env, {
          userId: session.user_id,
          entityType: 'SPEAKING',
          entityId: sessionId,
          opinion,
          grade: outcome.value,
          createdAt,
        });
        answers.set(judge.label, { opinion, createdAt });
        asked.push(judge.label);
        void saveSuggestedWords(env, session.user_id, outcome.value.vocabulary, 'Speaking feedback');
      }
    }

    if (answers.size === 0) {
      throw new ApiError('AI_UNAVAILABLE', failures[0]?.message ?? 'The judges could not mark this session. Please try again.');
    }

    const view = viewFromOpinions('SPEAKING', answers, panel.map((judge) => judge.label));
    if (asked.length > 0 || session.status !== 'MARKED') {
      const timestamp = nowIso();
      await env.DB.prepare(
        `UPDATE speaking_sessions
            SET overall_band = ?, criteria_json = ?, feedback = ?, provider_id = 'panel', provider_model = ?,
                score_source = 'AI', scored_at = ?, status = 'MARKED', marked_at = ?, updated_at = ?
          WHERE id = ?`,
      )
        .bind(
          view.band,
          JSON.stringify({
            criteria: view.criteria,
            strengths: view.strengths,
            improvements: view.improvements,
            corrections: view.corrections,
            notes: view.notes,
          }),
          view.feedback,
          // Labels only: the real models are in `ai_scores`, readable by the database owner alone.
          view.judges.map((judge) => judge.judge).join(' + '),
          timestamp,
          timestamp,
          timestamp,
          sessionId,
        )
        .run();
    }
    return { view, asked, failures };
  });
}

/** Kept for existing callers: runs the panel and returns the combined verdict. */
export async function scoreSpeakingSessionWithAi(env: Env, sessionId: string, options: MarkOptions = {}): Promise<AiMarkView> {
  return (await markSpeakingSession(env, sessionId, options)).view;
}

/** Suggested words go into the candidate's notebook. Best effort: marking never fails because of it. */
async function saveSuggestedWords(env: Env, userId: string, words: JudgeVocabulary[], source: string): Promise<void> {
  try {
    if (words.length > 0) await saveAiVocabulary(env, userId, words, source);
  } catch (error) {
    console.warn('ai_vocabulary_save_failed', error instanceof Error ? error.message : error);
  }
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

// Re-exported so callers and tests can reach the arithmetic without a second import.
export { clampBand };
