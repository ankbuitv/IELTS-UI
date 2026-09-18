/**
 * Band estimation from versioned scoring profiles.
 *
 * A raw score is a fact; a band is an *estimate* produced by a configured
 * conversion table. The platform never labels an estimate as an official band
 * and never estimates from short practice sets unless a profile explicitly
 * allows it (via `minQuestions`).
 */
import type { Skill, TestType } from './types';

export interface ConversionRange {
  rawMin: number;
  rawMax: number;
  band: number;
}

export interface ScoringProfile {
  id: string;
  name: string;
  skill: Skill;
  testType: TestType;
  version: number;
  status: 'ACTIVE' | 'INACTIVE';
  minQuestions: number;
  sourceNotes: string;
  ranges: ConversionRange[];
}

export type BandEstimate =
  | {
      available: true;
      band: number;
      profileId: string;
      profileName: string;
      profileVersion: number;
      label: 'Estimated band';
      note: string;
    }
  | { available: false; reason: BandUnavailableReason; message: string };

export type BandUnavailableReason =
  | 'NO_PROFILE'
  | 'PROFILE_INACTIVE'
  | 'SKILL_NOT_SUPPORTED'
  | 'INCOMPLETE_TEST'
  | 'SCORE_OUT_OF_RANGE'
  | 'WRITING_NOT_AUTO_SCORED'
  | 'NO_SCORE'
  | 'PLATFORM_DISABLED';

export const ESTIMATE_DISCLAIMER =
  'Estimated band — a practice indication from a configured conversion table, not an official IELTS result and not affiliated with IELTS, the British Council, IDP or Cambridge.';

/** Only objective skills are convertible by lookup table. */
export function skillSupportsBandEstimation(skill: Skill): boolean {
  return skill === 'READING' || skill === 'LISTENING';
}

export function estimateBand(input: {
  profile: ScoringProfile | null;
  skill: Skill;
  rawScore: number | null | undefined;
  totalQuestions: number | null | undefined;
  isCompleteTest: boolean;
}): BandEstimate {
  const { profile, skill, rawScore, totalQuestions, isCompleteTest } = input;

  if (skill === 'WRITING') {
    return {
      available: false,
      reason: 'WRITING_NOT_AUTO_SCORED',
      message: 'Writing is marked by a teacher or administrator; no automatic band is produced.',
    };
  }
  if (rawScore === null || rawScore === undefined || totalQuestions === null || totalQuestions === undefined) {
    return { available: false, reason: 'NO_SCORE', message: 'No marked score is available for this attempt yet.' };
  }
  if (!profile) {
    return {
      available: false,
      reason: 'NO_PROFILE',
      message: 'No scoring profile is configured for this test, so only the raw score is reported.',
    };
  }
  if (profile.status !== 'ACTIVE') {
    return {
      available: false,
      reason: 'PROFILE_INACTIVE',
      message: 'The scoring profile for this test is inactive, so only the raw score is reported.',
    };
  }
  if (profile.skill !== skill) {
    return {
      available: false,
      reason: 'SKILL_NOT_SUPPORTED',
      message: 'The configured scoring profile does not cover this skill.',
    };
  }
  if (!skillSupportsBandEstimation(skill)) {
    return { available: false, reason: 'SKILL_NOT_SUPPORTED', message: 'This skill is not converted automatically.' };
  }
  if (!isCompleteTest || totalQuestions < profile.minQuestions) {
    return {
      available: false,
      reason: 'INCOMPLETE_TEST',
      message: `Estimated bands require a complete test of at least ${profile.minQuestions} questions. This is a shorter practice set, so the raw score is reported instead.`,
    };
  }

  const range = profile.ranges.find((r) => rawScore >= r.rawMin && rawScore <= r.rawMax);
  if (!range) {
    return {
      available: false,
      reason: 'SCORE_OUT_OF_RANGE',
      message: 'The raw score falls outside the configured conversion table.',
    };
  }

  return {
    available: true,
    band: range.band,
    profileId: profile.id,
    profileName: profile.name,
    profileVersion: profile.version,
    label: 'Estimated band',
    note: ESTIMATE_DISCLAIMER,
  };
}

export function formatBand(band: number | null | undefined): string {
  if (band === null || band === undefined || Number.isNaN(band)) return '—';
  return Number.isInteger(band) ? `${band}.0` : band.toFixed(1);
}

export function percentage(raw: number | null | undefined, total: number | null | undefined): number | null {
  if (raw === null || raw === undefined || !total) return null;
  return Math.round((raw / total) * 1000) / 10;
}

/** Validates a conversion table for overlapping or gapped ranges. */
export function validateConversionRanges(
  ranges: ConversionRange[],
  minQuestions: number,
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const sorted = [...ranges].sort((a, b) => a.rawMin - b.rawMin);

  if (sorted.length === 0) errors.push('The conversion table has no ranges.');

  sorted.forEach((range, index) => {
    if (range.rawMin > range.rawMax) {
      errors.push(`Range ${range.rawMin}-${range.rawMax} is inverted.`);
    }
    if (range.rawMin < 0 || range.rawMax > minQuestions) {
      errors.push(`Range ${range.rawMin}-${range.rawMax} falls outside 0-${minQuestions}.`);
    }
    if (range.band < 0 || range.band > 9) {
      errors.push(`Band ${range.band} is outside the 0-9 range.`);
    }
    const previous = sorted[index - 1];
    if (previous) {
      if (range.rawMin <= previous.rawMax) {
        errors.push(`Ranges ${previous.rawMin}-${previous.rawMax} and ${range.rawMin}-${range.rawMax} overlap.`);
      } else if (range.rawMin > previous.rawMax + 1) {
        warnings.push(`Gap between raw ${previous.rawMax} and ${range.rawMin}: some raw scores map to no band.`);
      }
    }
  });

  if (sorted.length > 0 && sorted[0]!.rawMin !== 0) {
    warnings.push(`Conversion table starts at raw ${sorted[0]!.rawMin} rather than 0.`);
  }
  const last = sorted[sorted.length - 1];
  if (last && last.rawMax !== minQuestions) {
    warnings.push(`Conversion table ends at raw ${last.rawMax} rather than ${minQuestions}.`);
  }

  return { errors, warnings };
}
