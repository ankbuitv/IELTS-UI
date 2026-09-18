import { describe, expect, it } from 'vitest';
import {
  ESTIMATE_DISCLAIMER,
  estimateBand,
  formatBand,
  percentage,
  skillSupportsBandEstimation,
  validateConversionRanges,
  type ScoringProfile,
} from '../../src/shared/scoring';

function profile(overrides: Partial<ScoringProfile> = {}): ScoringProfile {
  return {
    id: 'scp_test',
    name: 'Reading 40-question table',
    skill: 'READING',
    testType: 'READING',
    version: 1,
    status: 'ACTIVE',
    minQuestions: 40,
    sourceNotes: 'Test fixture table.',
    ranges: [
      { rawMin: 39, rawMax: 40, band: 9 },
      { rawMin: 37, rawMax: 38, band: 8.5 },
      { rawMin: 35, rawMax: 36, band: 8 },
      { rawMin: 33, rawMax: 34, band: 7.5 },
      { rawMin: 30, rawMax: 32, band: 7 },
      { rawMin: 27, rawMax: 29, band: 6.5 },
      { rawMin: 23, rawMax: 26, band: 6 },
      { rawMin: 19, rawMax: 22, band: 5.5 },
      { rawMin: 15, rawMax: 18, band: 5 },
      { rawMin: 13, rawMax: 14, band: 4.5 },
      { rawMin: 10, rawMax: 12, band: 4 },
    ],
    ...overrides,
  };
}

describe('estimateBand', () => {
  it('converts a complete test through the profile', () => {
    const result = estimateBand({ profile: profile(), skill: 'READING', rawScore: 30, totalQuestions: 40, isCompleteTest: true });
    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.band).toBe(7);
      expect(result.label).toBe('Estimated band');
      expect(result.note).toContain('Estimated band');
    }
  });

  it('refuses to estimate from a short practice set', () => {
    const result = estimateBand({ profile: profile(), skill: 'READING', rawScore: 9, totalQuestions: 13, isCompleteTest: false });
    expect(result.available).toBe(false);
    if (!result.available) {
      expect(result.reason).toBe('INCOMPLETE_TEST');
      expect(result.message).toContain('at least 40 questions');
    }
  });

  it('refuses when the test is flagged incomplete even with enough questions', () => {
    const result = estimateBand({ profile: profile(), skill: 'READING', rawScore: 30, totalQuestions: 40, isCompleteTest: false });
    expect(result.available).toBe(false);
  });

  it('never estimates a band for Writing', () => {
    const result = estimateBand({
      profile: profile({ skill: 'WRITING', testType: 'WRITING' }),
      skill: 'WRITING',
      rawScore: 5,
      totalQuestions: 5,
      isCompleteTest: true,
    });
    expect(result.available).toBe(false);
    if (!result.available) expect(result.reason).toBe('WRITING_NOT_AUTO_SCORED');
  });

  it('reports NO_PROFILE when the test has no profile configured', () => {
    const result = estimateBand({ profile: null, skill: 'LISTENING', rawScore: 30, totalQuestions: 40, isCompleteTest: true });
    expect(result.available).toBe(false);
    if (!result.available) expect(result.reason).toBe('NO_PROFILE');
  });

  it('ignores inactive profiles', () => {
    const result = estimateBand({
      profile: profile({ status: 'INACTIVE' }),
      skill: 'READING',
      rawScore: 30,
      totalQuestions: 40,
      isCompleteTest: true,
    });
    expect(result.available).toBe(false);
    if (!result.available) expect(result.reason).toBe('PROFILE_INACTIVE');
  });

  it('reports scores outside the conversion table instead of guessing', () => {
    const result = estimateBand({ profile: profile(), skill: 'READING', rawScore: 2, totalQuestions: 40, isCompleteTest: true });
    expect(result.available).toBe(false);
    if (!result.available) expect(result.reason).toBe('SCORE_OUT_OF_RANGE');
  });

  it('requires a marked score', () => {
    const result = estimateBand({ profile: profile(), skill: 'READING', rawScore: null, totalQuestions: 40, isCompleteTest: true });
    expect(result.available).toBe(false);
    if (!result.available) expect(result.reason).toBe('NO_SCORE');
  });

  it('always carries the non-affiliation disclaimer text', () => {
    expect(ESTIMATE_DISCLAIMER).toContain('Estimated band');
    expect(ESTIMATE_DISCLAIMER).toContain('not an official IELTS result');
    expect(ESTIMATE_DISCLAIMER.toLowerCase()).toContain('not affiliated');
  });
});

describe('skillSupportsBandEstimation', () => {
  it('only converts objective skills', () => {
    expect(skillSupportsBandEstimation('READING')).toBe(true);
    expect(skillSupportsBandEstimation('LISTENING')).toBe(true);
    expect(skillSupportsBandEstimation('WRITING')).toBe(false);
  });
});

describe('formatBand', () => {
  it('renders half bands and hides missing values', () => {
    expect(formatBand(6.5)).toBe('6.5');
    expect(formatBand(7)).toBe('7.0');
    expect(formatBand(null)).toBe('—');
    expect(formatBand(undefined)).toBe('—');
  });
});

describe('percentage', () => {
  it('computes a percentage and guards against zero totals', () => {
    expect(percentage(30, 40)).toBe(75);
    expect(percentage(0, 0)).toBeNull();
    expect(percentage(null, 40)).toBeNull();
  });
});

describe('validateConversionRanges', () => {
  it('accepts a contiguous, non-overlapping table', () => {
    const result = validateConversionRanges(
      [
        { rawMin: 0, rawMax: 4, band: 3 },
        { rawMin: 5, rawMax: 9, band: 4 },
      ],
      10,
    );
    expect(result.errors).toHaveLength(0);
  });

  it('rejects overlapping ranges', () => {
    const result = validateConversionRanges(
      [
        { rawMin: 0, rawMax: 5, band: 3 },
        { rawMin: 5, rawMax: 9, band: 4 },
      ],
      10,
    );
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects inverted ranges', () => {
    const result = validateConversionRanges([{ rawMin: 8, rawMax: 3, band: 4 }], 10);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('warns when the table cannot cover the whole test', () => {
    const result = validateConversionRanges([{ rawMin: 0, rawMax: 3, band: 3 }], 10);
    expect(result.warnings.length + result.errors.length).toBeGreaterThan(0);
  });
});
