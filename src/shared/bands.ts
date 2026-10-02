/**
 * Band arithmetic shared by the Worker and the browser.
 *
 * Every number produced here is an ESTIMATE for study feedback. Nothing in this
 * module touches the network or the database, so it is cheap to unit test.
 */
import type { Skill } from './types';

/** The four IELTS skills. Speaking is practised outside the exam engine, so it is not a `Skill`. */
export type EstimateSkill = Skill | 'SPEAKING';

/** IELTS rounds an average to the nearest half band: x.25 → x.5 and x.75 → (x+1).0. */
export function roundHalfBand(value: number): number {
  return Math.round(value * 2) / 2;
}

export function clampBand(value: number): number {
  return Math.max(0, Math.min(9, value));
}

export function meanBand(values: Array<number | null | undefined>): number | null {
  const bands = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (bands.length === 0) return null;
  return clampBand(roundHalfBand(bands.reduce((sum, band) => sum + band, 0) / bands.length));
}

/**
 * Scales a score on a short set to the length of a full paper, so a 13-question
 * practice reading can still be placed on the 40-question conversion table.
 */
export function projectRawScore(raw: number, total: number, fullLength: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(fullLength, Math.round((raw / total) * fullLength)));
}

/** Fewer questions than this say too little to place a band on. */
export const MIN_QUESTIONS_FOR_PROJECTION = 8;

export type BandBasis =
  /** Converted from a complete paper with the configured table. */
  | 'FULL'
  /** Converted from a short set scaled to a full paper. Less reliable. */
  | 'PROJECTED'
  /** Produced by the AI judging panel (Writing / Speaking). */
  | 'AI'
  /** Given by a teacher or administrator. */
  | 'TEACHER';

export const BAND_BASIS_LABELS: Record<BandBasis, string> = {
  FULL: 'Complete test',
  PROJECTED: 'Projected from a short set',
  AI: 'AI judges',
  TEACHER: 'Teacher',
};

export interface SkillEstimate {
  skill: EstimateSkill;
  /** Mean of the latest few estimates (half-rounded) or null when there are none. */
  band: number | null;
  latest: number | null;
  /** Latest minus the one before it. */
  change: number | null;
  /** How many estimates the number is built from. */
  samples: number;
  basis: BandBasis | null;
  /** True when at least one input was projected from a short set or came from the AI. */
  provisional: boolean;
}

export interface BandEstimates {
  skills: SkillEstimate[];
  overall: {
    band: number | null;
    /** COMPLETE = all four skills contribute; PROVISIONAL = some are still missing. */
    kind: 'COMPLETE' | 'PROVISIONAL' | null;
    covered: EstimateSkill[];
    missing: EstimateSkill[];
  };
}

export interface EstimateInput {
  skill: EstimateSkill;
  band: number | null;
  basis: BandBasis;
  /** ISO timestamp; newest first once sorted. */
  at: string;
}

export const CORE_SKILLS: EstimateSkill[] = ['LISTENING', 'READING', 'WRITING', 'SPEAKING'];
/** The newest few attempts describe current ability better than a lifetime average. */
const RECENT_WINDOW = 3;

export function summariseEstimates(inputs: EstimateInput[]): BandEstimates {
  const skills: SkillEstimate[] = CORE_SKILLS.map((skill) => {
    const rows = inputs
      .filter((row) => row.skill === skill && row.band !== null)
      .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    const recent = rows.slice(0, RECENT_WINDOW);
    const latest = rows[0]?.band ?? null;
    const previous = rows[1]?.band ?? null;
    return {
      skill,
      band: meanBand(recent.map((row) => row.band)),
      latest,
      change: latest !== null && previous !== null ? roundHalfBand(latest - previous) : null,
      samples: recent.length,
      basis: rows[0]?.basis ?? null,
      provisional: recent.some((row) => row.basis === 'PROJECTED' || row.basis === 'AI'),
    };
  });

  const covered = skills.filter((entry) => entry.band !== null).map((entry) => entry.skill);
  const missing = CORE_SKILLS.filter((skill) => !covered.includes(skill));
  const overall = meanBand(skills.map((entry) => entry.band));
  return {
    skills,
    overall: {
      band: overall,
      kind: overall === null ? null : missing.length === 0 ? 'COMPLETE' : 'PROVISIONAL',
      covered,
      missing,
    },
  };
}
