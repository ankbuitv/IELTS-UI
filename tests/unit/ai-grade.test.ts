import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { describeAiFailure } from '../../src/worker/ai/failure';
import { ApiError } from '../../src/worker/lib/errors';
import { canonicalCriterionKey, normaliseGrade, roundHalf } from '../../src/worker/services/ai-marking-service';

const WRITING = ['TASK_ACHIEVEMENT', 'COHERENCE_COHESION', 'LEXICAL_RESOURCE', 'GRAMMATICAL_RANGE'];
const SPEAKING = ['FLUENCY_COHERENCE', 'LEXICAL_RESOURCE', 'GRAMMATICAL_RANGE', 'PRONUNCIATION'];

/**
 * Models do not follow the requested shape faithfully. These tests pin the
 * variations seen in practice so a reply that is merely shaped differently is
 * still graded instead of being thrown away as "could not mark".
 */
describe('normaliseGrade', () => {
  it('reads the documented shape', () => {
    const grade = normaliseGrade(
      {
        overallBand: 6.5,
        criteria: WRITING.map((key, index) => ({ key, band: 6 + (index % 2) * 0.5, comment: `Comment ${key}` })),
        feedback: 'Solid attempt.',
        strengths: ['Clear position'],
        improvements: ['Develop ideas'],
        corrections: [{ original: 'peoples is', suggestion: 'people are', reason: 'agreement' }],
        notes: [],
      },
      'p1',
      'gpt-oss:120b',
      WRITING,
    );
    expect(grade.band).toBe(6.5);
    expect(grade.criteria.map((criterion) => criterion.key)).toEqual(WRITING);
    expect(grade.criteria[0]).toMatchObject({ label: 'Task achievement', band: 6, comment: 'Comment TASK_ACHIEVEMENT' });
    expect(grade.corrections).toEqual([{ original: 'peoples is', suggestion: 'people are', reason: 'agreement' }]);
    expect(grade.providerModel).toBe('gpt-oss:120b');
  });

  it('accepts criteria as an object keyed by the model’s own labels', () => {
    const grade = normaliseGrade(
      {
        overall_band: '7',
        criteria: {
          'Task Response': { score: 7, feedback: 'Answers every part.' },
          'Coherence and Cohesion': { band: '6.5', comment: 'Good linking.' },
          'Lexical Resource': 7,
          'Grammatical Range & Accuracy': { rating: 6.5, explanation: 'Few slips.' },
        },
        summary: 'Well done.',
      },
      'p1',
      'm',
      WRITING,
    );
    expect(grade.criteria.map((criterion) => criterion.band)).toEqual([7, 6.5, 7, 6.5]);
    expect(grade.criteria[0]!.comment).toBe('Answers every part.');
    expect(grade.feedback).toBe('Well done.');
    expect(grade.band).toBe(7);
  });

  it('accepts an array whose rows use criterion/score instead of key/band', () => {
    const grade = normaliseGrade(
      {
        overallBand: 6,
        criteria: [
          { criterion: 'TA', score: 6, comment: 'ok' },
          { name: 'Coherence & Cohesion', score: 6, comment: 'ok' },
          { criterion: 'Vocabulary', score: 6, comment: 'ok' },
          { criterion: 'Grammar', score: 6, comment: 'ok' },
        ],
        feedback: 'Fine.',
      },
      'p',
      'm',
      WRITING,
    );
    expect(grade.criteria.every((criterion) => criterion.band === 6)).toBe(true);
  });

  it('accepts strengths and improvements given as objects or a lone string', () => {
    const grade = normaliseGrade(
      {
        overallBand: 5.5,
        criteria: [],
        feedback: 'x',
        strengths: [{ text: 'Good opening' }, 'Clear stance', { nothing: 1 }],
        improvements: 'Use more linking words',
      },
      'p',
      'm',
      WRITING,
    );
    expect(grade.strengths).toEqual(['Good opening', 'Clear stance']);
    expect(grade.improvements).toEqual(['Use more linking words']);
  });

  it('derives the overall band when the model omits it, and blends it when both exist', () => {
    const criteria = WRITING.map((key) => ({ key, band: 6, comment: '' }));
    expect(normaliseGrade({ criteria }, 'p', 'm', WRITING).band).toBe(6);
    // Reported 8 but every criterion says 6: the overall is pulled back to the evidence.
    expect(normaliseGrade({ overallBand: 8, criteria }, 'p', 'm', WRITING).band).toBe(7);
  });

  it('refuses to store a score when no band can be found anywhere', () => {
    expect(() => normaliseGrade({ feedback: 'Nice essay!' }, 'p', 'm', WRITING)).toThrow(/without a usable band/);
  });

  it('never lets a transcript-only grade claim to have heard pronunciation', () => {
    const grade = normaliseGrade(
      {
        overallBand: 6,
        criteria: [
          { key: 'FLUENCY_COHERENCE', band: 6, comment: '' },
          { key: 'LEXICAL_RESOURCE', band: 6, comment: '' },
          { key: 'GRAMMATICAL_RANGE', band: 6, comment: '' },
          { key: 'PRONUNCIATION', band: 0, comment: 'Not assessed' },
        ],
        feedback: 'x',
      },
      'p',
      'm',
      SPEAKING,
    );
    expect(grade.criteria.find((criterion) => criterion.key === 'PRONUNCIATION')?.band).toBeNull();
    expect(grade.band).toBe(6);
  });

  it('clamps bands to 0-9 in half-band steps', () => {
    const grade = normaliseGrade({ overallBand: 11.2, criteria: [{ key: 'TASK_ACHIEVEMENT', band: 6.3 }] }, 'p', 'm', WRITING);
    expect(grade.band).toBe(9);
    expect(grade.criteria[0]!.band).toBe(6.5);
    expect(roundHalf(6.24)).toBe(6);
  });
});

describe('canonicalCriterionKey', () => {
  it('maps the names models use onto the rubric keys', () => {
    expect(canonicalCriterionKey('Task Response')).toBe('TASK_ACHIEVEMENT');
    expect(canonicalCriterionKey('task_achievement')).toBe('TASK_ACHIEVEMENT');
    expect(canonicalCriterionKey('Coherence & Cohesion')).toBe('COHERENCE_COHESION');
    expect(canonicalCriterionKey('Fluency and Coherence')).toBe('FLUENCY_COHERENCE');
    expect(canonicalCriterionKey('Lexical Resource')).toBe('LEXICAL_RESOURCE');
    expect(canonicalCriterionKey('vocabulary')).toBe('LEXICAL_RESOURCE');
    expect(canonicalCriterionKey('Grammatical Range and Accuracy')).toBe('GRAMMATICAL_RANGE');
    expect(canonicalCriterionKey('Pronunciation')).toBe('PRONUNCIATION');
    expect(canonicalCriterionKey('GRA')).toBe('GRAMMATICAL_RANGE');
    expect(canonicalCriterionKey('nonsense')).toBeNull();
    expect(canonicalCriterionKey(42)).toBeNull();
  });
});

describe('describeAiFailure', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('passes an ApiError message through untouched', () => {
    const failure = describeAiFailure(new ApiError('AI_UNAVAILABLE', 'The AI provider “X” rejected the API key (status 401).'));
    expect(failure.message).toBe('The AI provider “X” rejected the API key (status 401).');
  });

  it('explains a stale-schema CHECK failure instead of blaming the provider', () => {
    const failure = describeAiFailure(new Error('D1_ERROR: CHECK constraint failed: scoring_source IN (...): SQLITE_CONSTRAINT'));
    expect(failure.code).toBe('AI_STORAGE');
    expect(failure.message).toMatch(/database could not store the score/);
    expect(failure.message).not.toMatch(/AI provider could not mark/);
  });

  it('explains a missing table and an unreadable reply', () => {
    expect(describeAiFailure(new Error('D1_ERROR: no such table: ai_scores')).message).toMatch(/missing a table/);
    expect(describeAiFailure(new SyntaxError('Unexpected token')).message).toMatch(/format the platform could not read/);
  });

  it('logs the real error and names its type for anything else', () => {
    const failure = describeAiFailure(new TypeError('x is not a function'), { attemptId: 'a1' });
    expect(failure.message).toMatch(/failed unexpectedly \(TypeError\)/);
    expect(console.error).toHaveBeenCalled();
  });
});
