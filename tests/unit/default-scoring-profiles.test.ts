import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LISTENING_RANGES,
  DEFAULT_READING_RANGES,
  DEFAULT_SCORING_PROFILE_SEEDS,
  defaultProfileIdForSkill,
  toScoringProfile,
} from '../../src/shared/default-scoring-profiles';
import { estimateBand, validateConversionRanges } from '../../src/shared/scoring';

describe('default scoring profiles', () => {
  it('covers a complete 40-question reading test without gaps', () => {
    const check = validateConversionRanges(DEFAULT_READING_RANGES, 40);
    expect(check.errors).toHaveLength(0);
  });

  it('covers a complete 40-question listening test without gaps', () => {
    const check = validateConversionRanges(DEFAULT_LISTENING_RANGES, 40);
    expect(check.errors).toHaveLength(0);
  });

  it('converts a mid-table reading score to band 7.0', () => {
    const reading = DEFAULT_SCORING_PROFILE_SEEDS.find((seed) => seed.skill === 'READING');
    expect(reading).toBeTruthy();
    const result = estimateBand({
      profile: toScoringProfile(reading!),
      skill: 'READING',
      rawScore: 30,
      totalQuestions: 40,
      isCompleteTest: true,
    });
    expect(result.available).toBe(true);
    if (result.available) expect(result.band).toBe(7);
  });

  it('still refuses to auto-score writing', () => {
    expect(defaultProfileIdForSkill('WRITING')).toBeNull();
  });
});
