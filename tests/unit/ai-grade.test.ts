import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { describeAiFailure } from '../../src/worker/ai/failure';
import { ApiError } from '../../src/worker/lib/errors';
import { canonicalCriterionKey, combineOpinions, normaliseGrade, roundHalf, unhelpfulBandAdvice, unsupportedQuotedEvidence } from '../../src/worker/services/ai-marking-service';
import { AI_NOT_CONFIGURED_MESSAGE } from '../../src/worker/ai/judges';
import type { JudgeOpinion } from '../../src/shared/judges';

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
    expect(grade.corrections).toEqual([{ original: 'peoples is', suggestion: 'people are', reason: 'agreement', isActualError: true }]);
    expect(grade.providerModel).toBe('gpt-oss:120b');
  });

  it('keeps a stylistic alternative flagged as not an actual error', () => {
    const grade = normaliseGrade(
      {
        overallBand: 7,
        criteria: WRITING.map((key) => ({ key, band: 7, comment: 'ok' })),
        feedback: 'Strong.',
        corrections: [
          { original: 'programs which can foster', suggestion: 'programs that can foster', reason: 'restrictive clause', isActualError: false, category: 'STYLE', confidence: 0.7 },
        ],
        notes: [],
      },
      'p1',
      'gpt-oss:120b',
      WRITING,
    );
    expect(grade.corrections[0]).toMatchObject({ isActualError: false, category: 'STYLE', confidence: 0.7 });
  });

  it('demotes low-confidence corrections and drops originals not found verbatim in the response', () => {
    const grade = normaliseGrade(
      {
        criteria: WRITING.map((key) => ({ key, band: 6, comment: '' })),
        corrections: [
          { original: 'peoples is', suggestion: 'people are', reason: 'agreement', isActualError: true, confidence: 0.42 },
          { original: 'invented phrase', suggestion: 'clear phrase', reason: 'word choice', confidence: 0.99 },
          { original: 'clear idea', suggestion: 'a clear idea', reason: 'article', confidence: 0.95 },
        ],
      },
      'p',
      'm',
      WRITING,
      'peoples is unclear, but it is a clear idea.',
    );
    expect(grade.corrections).toHaveLength(2);
    expect(grade.corrections[0]).toMatchObject({ original: 'peoples is', isActualError: false, confidence: 0.42 });
    expect(grade.corrections[1]?.original).toBe('clear idea');
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
        criteria: WRITING.map((key) => ({ key, band: 5.5, comment: '' })),
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

  it('derives each judge’s overall only from its criterion bands, with quarter-band ties rounded up', () => {
    const criteria = WRITING.map((key) => ({ key, band: 6, comment: '' }));
    expect(normaliseGrade({ criteria }, 'p', 'm', WRITING).band).toBe(6);
    // A conflicting reported overall is ignored: the four criterion bands are the source of truth.
    expect(normaliseGrade({ overallBand: 8, criteria }, 'p', 'm', WRITING).band).toBe(6);
    const quarterTie = WRITING.map((key, index) => ({ key, band: index === 0 ? 7 : 6, comment: '' }));
    expect(normaliseGrade({ criteria: quarterTie }, 'p', 'm', WRITING).band).toBe(6.5);
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

  it('clamps criterion bands to 0-9 in half-band steps before deriving the overall', () => {
    const criteria = WRITING.map((key, index) => ({ key, band: index === 0 ? 6.3 : 11.2, comment: '' }));
    const grade = normaliseGrade({ overallBand: 1, criteria }, 'p', 'm', WRITING);
    expect(grade.band).toBe(8.5);
    expect(grade.criteria[0]!.band).toBe(6.5);
    expect(grade.criteria[1]!.band).toBe(9);
    expect(roundHalf(6.24)).toBe(6);
  });
});

describe('marking quality guards', () => {
  const criterion = { key: 'TASK_ACHIEVEMENT', label: 'Task achievement', band: 6, comment: 'The phrase “clear idea” is relevant.' };

  it('checks quoted candidate evidence as an exact, case-sensitive substring', () => {
    const grade = {
      feedback: 'You clearly state a “clear idea”.',
      criteria: [criterion],
      strengths: [],
      improvements: [],
      notes: [],
      corrections: [{ original: 'clear idea', suggestion: 'a clear idea', reason: 'article' }],
    };
    expect(unsupportedQuotedEvidence(grade, 'This is a clear idea.')).toEqual([]);
    expect(unsupportedQuotedEvidence(grade, 'This is a clear opinion.')).toEqual(['clear idea']);
  });

  it('filters advice that treats research citations or fancy vocabulary as a band booster', () => {
    expect(unhelpfulBandAdvice('Add statistics from a named study to strengthen the essay.')).toBe(true);
    expect(unhelpfulBandAdvice('Use more sophisticated vocabulary to sound academic.')).toBe(true);
    expect(unhelpfulBandAdvice('Develop the example by explaining how it supports your point.')).toBe(false);
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

  it('never lets a provider, a model or a URL reach the candidate', () => {
    const rejected = describeAiFailure(
      new ApiError('AI_UNAVAILABLE', 'The AI provider “Ollama Cloud (gpt-oss:120b)” at https://ollama.com rejected the API key (status 401).'),
    );
    expect(rejected.message).toBe(AI_NOT_CONFIGURED_MESSAGE);
    for (const text of [
      rejected.message,
      describeAiFailure(new ApiError('AI_UNAVAILABLE', 'Provider “X” timed out talking to gemma4:31b')).message,
      describeAiFailure(new ApiError('VALIDATION_FAILED', 'gemma4:31b returned http://127.0.0.1:9911/v1 nonsense')).message,
      describeAiFailure(new ApiError('RATE_LIMITED', 'ollama is busy')).message,
    ]) {
      expect(text).not.toMatch(/gpt-oss|gemma|ollama|https?:|127\.0\.0\.1|provider “/i);
    }
  });

  it('says the judges are busy for a rate limit and keeps the work-is-saved promise', () => {
    const failure = describeAiFailure(new ApiError('RATE_LIMITED', 'too many'));
    expect(failure.message).toMatch(/busy/);
    expect(failure.message).toMatch(/saved/);
  });

  it('explains a stale-schema CHECK failure instead of blaming the provider', () => {
    const failure = describeAiFailure(new Error('D1_ERROR: CHECK constraint failed: scoring_source IN (...): SQLITE_CONSTRAINT'));
    expect(failure.code).toBe('AI_STORAGE');
    expect(failure.message).toMatch(/database could not store the score/);
    expect(failure.message).not.toMatch(/AI provider could not mark/);
  });

  it('explains a missing table and an unreadable reply', () => {
    expect(describeAiFailure(new Error('D1_ERROR: no such table: ai_scores')).message).toMatch(/missing a table/);
    expect(describeAiFailure(new SyntaxError('Unexpected token')).message).toMatch(/could not finish marking/);
  });

  it('logs the real error and names its type for anything else', () => {
    const failure = describeAiFailure(new TypeError('x is not a function'), { attemptId: 'a1' });
    expect(failure.message).toMatch(/failed unexpectedly \(TypeError\)/);
    expect(console.error).toHaveBeenCalled();
  });
});


function opinion(judge: 'Judge01' | 'Judge02', band: number | null, overrides: Partial<JudgeOpinion> = {}): JudgeOpinion {
  return {
    judge,
    band,
    criteria: WRITING.map((key, index) => ({ key, label: key, band: band === null ? null : band + (index === 0 ? 0.5 : 0), comment: `${judge} on ${key}` })),
    feedback: `${judge} feedback`,
    feedbackVi: `${judge} tiếng Việt`,
    strengths: ['Clear position'],
    improvements: ['Develop the second paragraph'],
    corrections: [{ original: 'peoples is', suggestion: 'people are', reason: 'agreement' }],
    notes: [],
    ...overrides,
  };
}

describe('combineOpinions (the two-judge panel)', () => {
  const at = '2026-10-02T00:00:00.000Z';

  it('averages the judges and rounds to a half band', () => {
    const view = combineOpinions([opinion('Judge02', 6), opinion('Judge01', 6.5)], WRITING, [], at);
    expect(view.status).toBe('DONE');
    expect(view.band).toBe(6.5); // mean 6.25 rounds up to 6.5
    expect(view.spread).toBe(0.5);
    expect(view.judges.map((judge) => judge.judge)).toEqual(['Judge01', 'Judge02']);
    expect(view.criteria.map((criterion) => criterion.key)).toEqual(WRITING);
    // 7 and 6 -> mean 6.5; 6.5 and 5.5 -> 6.0
    const wide = combineOpinions([opinion('Judge01', 7), opinion('Judge02', 5.5)], WRITING, [], at);
    expect(wide.band).toBe(6.5);
    expect(wide.spread).toBe(1.5);
  });

  it('synthesizes a neutral panel summary and merges lists without presenting Judge01 as consensus', () => {
    const view = combineOpinions([opinion('Judge02', 6), opinion('Judge01', 6.5)], WRITING, [], at);
    expect(view.feedback).toMatch(/Panel summary:.*average to 6.5/);
    expect(view.feedback).not.toBe('Judge01 feedback');
    expect(view.feedbackVi).toMatch(/Tóm tắt hội đồng/);
    expect(view.strengths).toEqual(['Clear position']);
    expect(view.corrections).toHaveLength(1);
    expect(view.criterionSplits).toEqual([]);
  });

  it('flags a criterion split at 1.5 bands while keeping the overall panel mean', () => {
    const first = opinion('Judge01', 6.5);
    const second = opinion('Judge02', 6);
    first.criteria[0]!.band = 7.5;
    second.criteria[0]!.band = 6;
    const view = combineOpinions([first, second], WRITING, [], at);
    expect(view.criterionSplits).toEqual(['TASK_ACHIEVEMENT']);
    expect(view.criteria[0]?.band).toBe(7);
    expect(view.band).toBe(6.5);
  });

  it('is PARTIAL when a judge was unavailable and then uses the one band it has', () => {
    const view = combineOpinions([opinion('Judge01', 7)], WRITING, ['Judge02'], at);
    expect(view.status).toBe('PARTIAL');
    expect(view.unavailable).toEqual(['Judge02']);
    expect(view.band).toBe(7);
    expect(view.spread).toBeNull();
  });

  it('only ever names judges by their anonymous labels', () => {
    const view = combineOpinions([opinion('Judge01', 6.5), opinion('Judge02', 6)], WRITING, [], at);
    expect(JSON.stringify(view)).not.toMatch(/gpt-oss|gemma|ollama|openai|provider/i);
  });
});
