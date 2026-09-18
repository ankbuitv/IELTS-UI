import { describe, expect, it } from 'vitest';
import { countWords, gradeAnswer, isValidAnswerKeyShape, normalizeTextAnswer } from '../../src/shared/answer-key';

describe('normalizeTextAnswer', () => {
  it('trims, lowercases and collapses whitespace', () => {
    expect(normalizeTextAnswer('  The   Thames ')).toBe('the thames');
  });

  it('drops a leading article when asked', () => {
    expect(normalizeTextAnswer('a bicycle', { ignoreLeadingArticle: true })).toBe('bicycle');
    expect(normalizeTextAnswer('the bicycle', { ignoreLeadingArticle: true })).toBe('bicycle');
    expect(normalizeTextAnswer('bicycle', { ignoreLeadingArticle: true })).toBe('bicycle');
  });

  it('normalises numeric answers, including commas and currency noise', () => {
    expect(normalizeTextAnswer('1,200', { numeric: true })).toBe('1200');
    expect(normalizeTextAnswer(' 12.50 ', { numeric: true })).toBe('12.5');
  });
});

describe('countWords', () => {
  it('counts words rather than characters', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   ')).toBe(0);
    expect(countWords('one two three')).toBe(3);
  });

  it('counts punctuation-separated tokens as single words', () => {
    expect(countWords('well-known example, again')).toBe(3);
  });
});

describe('gradeAnswer — TEXT keys', () => {
  const key = { kind: 'TEXT' as const, accept: ['Bicycle', 'bike'] };

  it('marks an accepted variant correct regardless of case', () => {
    expect(gradeAnswer('SHORT_ANSWER', key, { value: 'BIKE' }).correct).toBe(true);
    expect(gradeAnswer('SHORT_ANSWER', key, { value: ' bicycle ' }).correct).toBe(true);
  });

  it('marks an unaccepted answer incorrect with a reason', () => {
    const result = gradeAnswer('SHORT_ANSWER', key, { value: 'car' });
    expect(result.correct).toBe(false);
    expect(result.points).toBe(0);
    expect(result.reason).toBe('INCORRECT');
  });

  it('marks a blank answer as BLANK, never correct', () => {
    expect(gradeAnswer('SHORT_ANSWER', key, null).reason).toBe('BLANK');
    expect(gradeAnswer('SHORT_ANSWER', key, { value: '   ' }).reason).toBe('BLANK');
  });

  it('enforces the word limit from the group config', () => {
    const limited = { kind: 'TEXT' as const, accept: ['red bicycle'] };
    expect(gradeAnswer('SENTENCE_COMPLETION', limited, { value: 'red bicycle' }, { wordLimit: { max: 2 } }).correct).toBe(true);
    expect(gradeAnswer('SENTENCE_COMPLETION', limited, { value: 'red bicycle' }, { wordLimit: { max: 1 } }).correct).toBe(false);
  });

  it('treats a MANUAL key as unmarked rather than guessed', () => {
    const result = gradeAnswer('WRITING_TASK_1', { kind: 'MANUAL' }, { value: 'essay text' });
    expect(result.reason).toBe('MANUAL');
    expect(result.correct).toBe(false);
  });
});

describe('gradeAnswer — CHOICE keys', () => {
  it('accepts a single correct option case-insensitively', () => {
    const key = { kind: 'CHOICE' as const, values: ['B'] };
    expect(gradeAnswer('MCQ_SINGLE', key, { value: 'b' }).correct).toBe(true);
    expect(gradeAnswer('MCQ_SINGLE', key, { value: 'B' }).correct).toBe(true);
    expect(gradeAnswer('MCQ_SINGLE', key, { value: 'C' }).correct).toBe(false);
  });

  it('awards partial credit for multi-select answers and penalises wrong picks', () => {
    const key = { kind: 'CHOICE' as const, values: ['A', 'C', 'D'] };
    const twoOfThree = gradeAnswer('MCQ_MULTI', key, { values: ['A', 'C'] }, { selectCount: 3 });
    expect(twoOfThree.points).toBe(2);
    expect(twoOfThree.correct).toBe(false);
    expect(twoOfThree.reason).toBe('PARTIAL');

    const withWrongPick = gradeAnswer('MCQ_MULTI', key, { values: ['A', 'B'] }, { selectCount: 3 });
    expect(withWrongPick.points).toBe(0);

    const full = gradeAnswer('MCQ_MULTI', key, { values: ['A', 'C', 'D'] }, { selectCount: 3 });
    expect(full.correct).toBe(true);
    expect(full.points).toBe(3);
  });

  it('never awards more points than possible when duplicates are submitted', () => {
    const key = { kind: 'CHOICE' as const, values: ['A', 'B'] };
    const result = gradeAnswer('MCQ_MULTI', key, { values: ['A', 'A', 'B'] }, { selectCount: 2 });
    expect(result.points).toBeLessThanOrEqual(result.maxPoints);
  });

  it('can be made all-or-nothing when partial credit is disabled', () => {
    const key = { kind: 'CHOICE' as const, values: ['A', 'B', 'C'], partialCredit: false };
    expect(gradeAnswer('MCQ_MULTI', key, { values: ['A', 'B'] }).points).toBe(0);
    expect(gradeAnswer('MCQ_MULTI', key, { values: ['A', 'B', 'C'] }).points).toBe(3);
  });
});

describe('isValidAnswerKeyShape', () => {
  it('accepts the three key shapes and rejects malformed ones', () => {
    expect(isValidAnswerKeyShape({ kind: 'MANUAL' })).toBe(true);
    expect(isValidAnswerKeyShape({ kind: 'CHOICE', values: ['A'] })).toBe(true);
    expect(isValidAnswerKeyShape({ kind: 'TEXT', accept: ['x'] })).toBe(true);
    // An empty key list is shape-valid but semantically incomplete: the
    // deterministic validator reports EMPTY_ANSWER_KEY so it cannot be published.
    expect(isValidAnswerKeyShape({ kind: 'CHOICE', values: [] })).toBe(true);
    expect(isValidAnswerKeyShape({ kind: 'CHOICE', values: ['A', ''] })).toBe(false);
    expect(isValidAnswerKeyShape({ kind: 'TEXT', accept: 'x' })).toBe(false);
    expect(isValidAnswerKeyShape(null)).toBe(false);
    expect(isValidAnswerKeyShape({ kind: 'GUESS' })).toBe(false);
  });
});
