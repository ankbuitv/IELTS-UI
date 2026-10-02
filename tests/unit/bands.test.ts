import { describe, expect, it } from 'vitest';
import {
  BAND_BASIS_LABELS,
  MIN_QUESTIONS_FOR_PROJECTION,
  meanBand,
  projectRawScore,
  roundHalfBand,
  summariseEstimates,
  type EstimateInput,
} from '../../src/shared/bands';
import { JUDGE_SPLIT_THRESHOLD, judgesAgree } from '../../src/shared/judges';

describe('band arithmetic', () => {
  it('rounds to the nearest half band the way IELTS averages do', () => {
    expect(roundHalfBand(6.25)).toBe(6.5);
    expect(roundHalfBand(6.75)).toBe(7);
    expect(roundHalfBand(6.1)).toBe(6);
    expect(roundHalfBand(6.24)).toBe(6);
    expect(roundHalfBand(8.9)).toBe(9);
  });

  it('averages only real numbers and clamps to 0-9', () => {
    expect(meanBand([6, 7])).toBe(6.5);
    expect(meanBand([6, null, undefined, 7.5])).toBe(7);
    expect(meanBand([])).toBeNull();
    expect(meanBand([null])).toBeNull();
    expect(meanBand([9, 9.5])).toBe(9);
  });

  it('scales a short set to the length of a full paper', () => {
    expect(projectRawScore(9, 13, 40)).toBe(28);
    expect(projectRawScore(13, 13, 40)).toBe(40);
    expect(projectRawScore(0, 13, 40)).toBe(0);
    expect(projectRawScore(5, 0, 40)).toBe(0);
    expect(projectRawScore(50, 40, 40)).toBe(40); // never above the full paper
    expect(MIN_QUESTIONS_FOR_PROJECTION).toBe(8);
  });

  it('describes each kind of band honestly', () => {
    expect(BAND_BASIS_LABELS.FULL).toBe('Complete test');
    expect(BAND_BASIS_LABELS.PROJECTED).toMatch(/short set/);
    expect(BAND_BASIS_LABELS.AI).toBe('AI judges');
    expect(BAND_BASIS_LABELS.TEACHER).toBe('Teacher');
  });
});

describe('summariseEstimates', () => {
  const input = (skill: EstimateInput['skill'], band: number | null, basis: EstimateInput['basis'], at: string): EstimateInput => ({ skill, band, basis, at });

  it('is empty before anything is marked', () => {
    const result = summariseEstimates([]);
    expect(result.overall).toEqual({ band: null, kind: null, covered: [], missing: ['LISTENING', 'READING', 'WRITING', 'SPEAKING'] });
    expect(result.skills.every((skill) => skill.band === null && skill.samples === 0)).toBe(true);
  });

  it('is provisional until all four skills contribute, and then complete', () => {
    const partial = summariseEstimates([input('READING', 6.5, 'FULL', '2026-10-01'), input('WRITING', 6, 'AI', '2026-10-01')]);
    expect(partial.overall.kind).toBe('PROVISIONAL');
    expect(partial.overall.band).toBe(6.5); // mean of 6.5 and 6.0 = 6.25 -> 6.5
    expect(partial.overall.missing).toEqual(['LISTENING', 'SPEAKING']);

    const whole = summariseEstimates([
      input('LISTENING', 7, 'FULL', '2026-10-01'),
      input('READING', 6.5, 'FULL', '2026-10-01'),
      input('WRITING', 6, 'AI', '2026-10-01'),
      input('SPEAKING', 6, 'AI', '2026-10-01'),
    ]);
    expect(whole.overall.kind).toBe('COMPLETE');
    expect(whole.overall.band).toBe(6.5);
    expect(whole.overall.missing).toEqual([]);
  });

  it('uses the newest three attempts per skill, reports the change and flags provisional inputs', () => {
    const result = summariseEstimates([
      input('READING', 5, 'FULL', '2026-09-01'), // too old: outside the newest three
      input('READING', 6, 'FULL', '2026-09-10'),
      input('READING', 6.5, 'PROJECTED', '2026-09-20'),
      input('READING', 7, 'FULL', '2026-09-30'),
    ]);
    const reading = result.skills.find((skill) => skill.skill === 'READING')!;
    expect(reading.samples).toBe(3);
    expect(reading.latest).toBe(7);
    expect(reading.change).toBe(0.5);
    expect(reading.band).toBe(6.5); // mean(7, 6.5, 6) = 6.5
    expect(reading.basis).toBe('FULL');
    expect(reading.provisional).toBe(true); // one input was projected
  });

  it('ignores missing bands', () => {
    const result = summariseEstimates([input('SPEAKING', null, 'AI', '2026-10-01')]);
    expect(result.skills.find((skill) => skill.skill === 'SPEAKING')!.band).toBeNull();
    expect(result.overall.band).toBeNull();
  });
});

describe('judges agreeing', () => {
  it('calls a spread of a whole band or more a split', () => {
    expect(JUDGE_SPLIT_THRESHOLD).toBe(1);
    expect(judgesAgree({ spread: null })).toBe(true);
    expect(judgesAgree({ spread: 0.5 })).toBe(true);
    expect(judgesAgree({ spread: 1 })).toBe(false);
    expect(judgesAgree({ spread: 2 })).toBe(false);
  });
});
