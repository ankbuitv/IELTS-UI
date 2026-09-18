/**
 * Built-in practice conversion tables.
 *
 * These are original estimates written for this platform so a fresh database
 * can report an "Estimated band" without an administrator creating a profile
 * first. They are not official IELTS tables.
 */
import type { ConversionRange, ScoringProfile } from './scoring';
import type { Skill, TestType } from './types';

export const DEFAULT_READING_PROFILE_ID = 'scp_default_reading';
export const DEFAULT_LISTENING_PROFILE_ID = 'scp_default_listening';

/** Academic-style 40-question reading conversion (practice estimate). */
export const DEFAULT_READING_RANGES: ConversionRange[] = [
  { rawMin: 0, rawMax: 9, band: 3.5 },
  { rawMin: 10, rawMax: 12, band: 4.0 },
  { rawMin: 13, rawMax: 14, band: 4.5 },
  { rawMin: 15, rawMax: 18, band: 5.0 },
  { rawMin: 19, rawMax: 22, band: 5.5 },
  { rawMin: 23, rawMax: 26, band: 6.0 },
  { rawMin: 27, rawMax: 29, band: 6.5 },
  { rawMin: 30, rawMax: 32, band: 7.0 },
  { rawMin: 33, rawMax: 34, band: 7.5 },
  { rawMin: 35, rawMax: 36, band: 8.0 },
  { rawMin: 37, rawMax: 38, band: 8.5 },
  { rawMin: 39, rawMax: 40, band: 9.0 },
];

/** Academic-style 40-question listening conversion (practice estimate). */
export const DEFAULT_LISTENING_RANGES: ConversionRange[] = [
  { rawMin: 0, rawMax: 9, band: 3.5 },
  { rawMin: 10, rawMax: 12, band: 4.0 },
  { rawMin: 13, rawMax: 15, band: 4.5 },
  { rawMin: 16, rawMax: 19, band: 5.0 },
  { rawMin: 20, rawMax: 22, band: 5.5 },
  { rawMin: 23, rawMax: 26, band: 6.0 },
  { rawMin: 27, rawMax: 29, band: 6.5 },
  { rawMin: 30, rawMax: 32, band: 7.0 },
  { rawMin: 33, rawMax: 34, band: 7.5 },
  { rawMin: 35, rawMax: 36, band: 8.0 },
  { rawMin: 37, rawMax: 38, band: 8.5 },
  { rawMin: 39, rawMax: 40, band: 9.0 },
];

export interface DefaultScoringProfileSeed {
  id: string;
  name: string;
  skill: Skill;
  testType: TestType;
  minQuestions: number;
  sourceNotes: string;
  ranges: ConversionRange[];
}

export const DEFAULT_SCORING_PROFILE_SEEDS: DefaultScoringProfileSeed[] = [
  {
    id: DEFAULT_READING_PROFILE_ID,
    name: 'Reading — default 40-question practice table',
    skill: 'READING',
    testType: 'READING',
    minQuestions: 40,
    sourceNotes:
      'Built-in practice conversion table. It is an estimate only, not an official IELTS band.',
    ranges: DEFAULT_READING_RANGES,
  },
  {
    id: DEFAULT_LISTENING_PROFILE_ID,
    name: 'Listening — default 40-question practice table',
    skill: 'LISTENING',
    testType: 'LISTENING',
    minQuestions: 40,
    sourceNotes:
      'Built-in practice conversion table. It is an estimate only, not an official IELTS band.',
    ranges: DEFAULT_LISTENING_RANGES,
  },
];

export function defaultProfileIdForSkill(skill: Skill): string | null {
  if (skill === 'READING') return DEFAULT_READING_PROFILE_ID;
  if (skill === 'LISTENING') return DEFAULT_LISTENING_PROFILE_ID;
  return null;
}

export function toScoringProfile(seed: DefaultScoringProfileSeed): ScoringProfile {
  return {
    id: seed.id,
    name: seed.name,
    skill: seed.skill,
    testType: seed.testType,
    version: 1,
    status: 'ACTIVE',
    minQuestions: seed.minQuestions,
    sourceNotes: seed.sourceNotes,
    ranges: seed.ranges,
  };
}
