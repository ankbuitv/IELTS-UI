/**
 * Answer keys and server-side marking.
 *
 * SECURITY: this module is imported by the Worker and unit tests only. It must
 * never be imported from `src/client`. The deterministic grading functions are
 * pure so that they can be unit tested and executed inside the Worker.
 */
import type { QuestionType } from './question-types';
import type { QuestionGroupConfig } from './question-types';

/** Candidate response as persisted in `attempt_answers.answer_json`. */
export interface ChoiceResponse {
  value: string;
}

export interface MultiChoiceResponse {
  values: string[];
}

export interface TextResponse {
  value: string;
}

export type CandidateResponse = ChoiceResponse | MultiChoiceResponse | TextResponse;

/** Server-only answer key as persisted in `answer_keys.answer_json`. */
export type AnswerKey =
  | {
      kind: 'CHOICE';
      /** Accepted option ids. Single-choice types expect exactly one. */
      values: string[];
      /** MCQ_MULTI only: award one point per correct selection (default true). */
      partialCredit?: boolean;
    }
  | {
      kind: 'TEXT';
      /** Every accepted wording, as supplied by the content author. */
      accept: string[];
      /** Treat the answer as a number (normalises "1,000" / "1000"). */
      numeric?: boolean;
      /** Strip a leading "a"/"an"/"the" from both key and response. */
      ignoreLeadingArticle?: boolean;
    }
  | {
      /** Writing tasks and any other manually assessed response. */
      kind: 'MANUAL';
    };

export interface GradeResult {
  /** All-or-nothing correctness used for reporting. */
  correct: boolean;
  /** Points awarded by the marker. */
  points: number;
  /** Maximum points this question can award. */
  maxPoints: number;
  /** Machine-readable reason, useful for admin diagnostics (never shown live). */
  reason: 'CORRECT' | 'PARTIAL' | 'INCORRECT' | 'BLANK' | 'MANUAL';
}

export interface NormalizeOptions {
  ignoreLeadingArticle?: boolean;
  numeric?: boolean;
}

/** Unicode-aware, whitespace-tolerant normalisation of a text answer. */
export function normalizeTextAnswer(input: string, options: NormalizeOptions = {}): string {
  let out = input
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u02BC]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

  out = out.replace(/^["'](.*)["']$/, '$1').trim();
  out = out.replace(/[.,;:!?]+$/g, '').trim();

  if (options.numeric) {
    out = out.replace(/,/g, '').replace(/^£|\$|€/g, '');
    // 4:30pm / 16:30 style answers keep their shape; plain numbers are canonicalised.
    if (/^-?\d+(\.\d+)?$/.test(out)) {
      const n = Number(out);
      if (Number.isFinite(n)) out = String(n);
    }
  }

  if (options.ignoreLeadingArticle) {
    out = out.replace(/^(a|an|the)\s+/, '');
  }

  return out;
}

/** Word count used for word-limit enforcement. Hyphenated tokens count as one. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

function asResponseValues(response: CandidateResponse | null | undefined): string[] {
  if (!response) return [];
  if ('values' in response) return Array.isArray(response.values) ? response.values : [];
  if ('value' in response && typeof response.value === 'string') return [response.value];
  return [];
}

function asResponseText(response: CandidateResponse | null | undefined): string {
  if (!response) return '';
  const values = asResponseValues(response);
  return values.join(' ').trim();
}

function isBlank(values: string[]): boolean {
  return values.length === 0 || values.every((v) => !String(v ?? '').trim());
}

/**
 * Grades one candidate response against a protected answer key.
 * Never trust a score computed in the browser: this is the authoritative path.
 */
export function gradeAnswer(
  type: QuestionType,
  key: AnswerKey,
  response: CandidateResponse | null | undefined,
  config: QuestionGroupConfig = {},
): GradeResult {
  if (key.kind === 'MANUAL') {
    return { correct: false, points: 0, maxPoints: 1, reason: 'MANUAL' };
  }

  const rawValues = asResponseValues(response);
  if (isBlank(rawValues)) {
    return { correct: false, points: 0, maxPoints: 1, reason: 'BLANK' };
  }

  if (key.kind === 'CHOICE') {
    const expected = key.values.map((v) => String(v).trim());
    const maxPoints = type === 'MCQ_MULTI' ? Math.max(1, expected.length) : 1;

    if (type === 'MCQ_MULTI' || rawValues.length > 1) {
      const selected = dedupe(rawValues.map((v) => String(v).trim()).filter(Boolean));
      const correctSelections = selected.filter((v) => expected.includes(v)).length;
      const wrongSelections = selected.length - correctSelections;
      const partial = key.partialCredit !== false;
      const points = partial
        ? Math.max(0, Math.min(correctSelections - wrongSelections, maxPoints))
        : selected.length === expected.length && correctSelections === expected.length
          ? maxPoints
          : 0;
      const correct = points === maxPoints;
      return {
        correct,
        points,
        maxPoints,
        reason: correct ? 'CORRECT' : points > 0 ? 'PARTIAL' : 'INCORRECT',
      };
    }

    const answer = String(rawValues[0] ?? '').trim();
    const correct = expected.some((v) => v.toLowerCase() === answer.toLowerCase());
    return { correct, points: correct ? 1 : 0, maxPoints: 1, reason: correct ? 'CORRECT' : 'INCORRECT' };
  }

  // TEXT key: variant matching only, plus word-limit enforcement.
  const text = asResponseText(response);
  const maxWords = config.wordLimit?.max;
  if (typeof maxWords === 'number' && maxWords > 0 && countWords(text) > maxWords) {
    return { correct: false, points: 0, maxPoints: 1, reason: 'INCORRECT' };
  }

  const normalizeOptions: NormalizeOptions = {
    ignoreLeadingArticle: key.ignoreLeadingArticle === true,
    numeric: key.numeric === true,
  };
  const candidate = normalizeTextAnswer(text, normalizeOptions);
  const accepted = key.accept.map((variant) => normalizeTextAnswer(variant, normalizeOptions));
  const correct = candidate.length > 0 && accepted.includes(candidate);

  return { correct, points: correct ? 1 : 0, maxPoints: 1, reason: correct ? 'CORRECT' : 'INCORRECT' };
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

export function isValidAnswerKeyShape(key: unknown): key is AnswerKey {
  if (!key || typeof key !== 'object') return false;
  const k = key as Record<string, unknown>;
  if (k.kind === 'MANUAL') return true;
  if (k.kind === 'CHOICE') {
    return Array.isArray(k.values) && k.values.every((v) => typeof v === 'string' && v.trim().length > 0);
  }
  if (k.kind === 'TEXT') {
    return Array.isArray(k.accept) && k.accept.every((v) => typeof v === 'string' && v.trim().length > 0);
  }
  return false;
}

/** Answer key for a question type when the source document supplied none. */
export const MISSING_KEY: AnswerKey = { kind: 'CHOICE', values: [] };
