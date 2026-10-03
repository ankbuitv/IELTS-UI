/**
 * Building a study plan.
 *
 * Pure on purpose. The route from where a learner is to the band they want is a
 * scheduling problem with no I/O in it, and the only way to know it is right is
 * to test it: same input, same days, same lessons. The worker runs this, stores
 * the result, and the client only ever reads stored rows.
 *
 * How a plan is laid out
 *   - The horizon runs from today to the exam date, clamped to a sane window,
 *     because an exam in two years is not a plan and an exam tomorrow still
 *     needs one.
 *   - Minutes per day become lessons per day at about five minutes a lesson.
 *   - The ladder from the learner's band to their target is spread evenly across
 *     the horizon, so they arrive at the target band near the end rather than
 *     sprinting to it in week one and then coasting.
 *   - Every third day adds a review, because the notebook is where forgotten
 *     words go and a plan that never revisits them wastes the earlier days.
 *   - Every seventh day is a mock test instead of lessons, labelled with the
 *     skill the learner is weakest in.
 *   - Lessons are taken from the catalogue band by band and, when a band runs
 *     out, the plan moves up a rung rather than repeating itself.
 *   - A catalogue thinner than the exam date (four lessons a band against a
 *     two-month plan) is refilled from the start once the ladder is exhausted,
 *     and those days say "revisit" so nobody is told twice that a lesson is new.
 *     Refills are capped: past three passes a day is a review, not a rerun.
 */
import {
  LEARN_BANDS,
  LEARN_BAND_LABELS,
  bandIndex,
  stretchBand,
  type LearnBand,
} from './learn';

export type PlanSkill = 'READING' | 'LISTENING' | 'WRITING' | 'OVERALL';

export interface PlanBandSupply {
  band: LearnBand;
  /** Lesson ids available at that band, in path order. */
  lessonIds: string[];
}

export interface PlanInput {
  /** The learner's local day, `YYYY-MM-DD`. */
  startDay: string;
  /** The exam day, or null when they have not booked one. */
  examDay: string | null;
  /** Where the learner is now. */
  currentBand: LearnBand;
  /** Where they want to be. */
  targetBand: LearnBand;
  minutesPerDay: number;
  /** The catalogue, grouped by band. */
  supply: PlanBandSupply[];
  /** The skill with the lowest estimated band, if the learner has taken a test. */
  weakestSkill?: PlanSkill | null;
}

export interface PlanItemDraft {
  day: string;
  slot: number;
  kind: 'LESSON' | 'REVIEW' | 'MOCK_TEST';
  lessonId: string | null;
  label: string;
  band: LearnBand | null;
  skill: PlanSkill | null;
}

/** A lesson runs about five minutes, which is what the path's own copy says. */
const MINUTES_PER_LESSON = 5;
export const MIN_PLAN_DAYS = 7;
export const MAX_PLAN_DAYS = 90;
/** No exam booked: a month is long enough to make progress and short enough to finish. */
export const DEFAULT_PLAN_DAYS = 28;
const REVIEW_EVERY = 3;
const MOCK_EVERY = 7;
/** How many times one lesson may appear in a plan: once new, twice revisited. */
const MAX_PASSES = 3;

const DAY_MS = 86_400_000;

function dayNumber(day: string): number {
  return Math.floor(Date.parse(`${day}T00:00:00Z`) / DAY_MS);
}

function dayFromNumber(value: number): string {
  return new Date(value * DAY_MS).toISOString().slice(0, 10);
}

export function shiftDay(day: string, offset: number): string {
  return dayFromNumber(dayNumber(day) + offset);
}

/** How many days the plan covers, including the first one. */
export function planHorizonDays(startDay: string, examDay: string | null): number {
  if (!examDay) return DEFAULT_PLAN_DAYS;
  const span = dayNumber(examDay) - dayNumber(startDay) + 1;
  if (!Number.isFinite(span)) return DEFAULT_PLAN_DAYS;
  return Math.min(MAX_PLAN_DAYS, Math.max(MIN_PLAN_DAYS, span));
}

/** Lessons that fit in the daily budget, at about five minutes each. */
export function lessonsPerDay(minutesPerDay: number): number {
  const minutes = Number.isFinite(minutesPerDay) ? minutesPerDay : 30;
  return Math.min(6, Math.max(1, Math.round(minutes / MINUTES_PER_LESSON)));
}

/**
 * The bands a plan climbs through, from the learner's own rung upwards.
 *
 * Aiming at or below where you already are still gets one rung of stretch: a
 * plan that only repeats what you know teaches nothing, and one that jumps two
 * rungs is out of reach.
 */
export function planBands(currentBand: LearnBand, targetBand: LearnBand): LearnBand[] {
  const start = bandIndex(currentBand);
  const target = bandIndex(targetBand);
  const top = Math.min(target > start ? target : bandIndex(stretchBand(currentBand)), LEARN_BANDS.length - 1);
  const bands: LearnBand[] = [];
  for (let index = start; index <= top; index += 1) bands.push(LEARN_BANDS[index]!);
  return bands;
}

/**
 * The plan, as a flat list of dated items.
 *
 * Returns an empty list when the catalogue has nothing to offer, so the caller
 * can say "there are no lessons yet" rather than showing an empty calendar.
 */
export function buildPlanItems(input: PlanInput): PlanItemDraft[] {
  const days = planHorizonDays(input.startDay, input.examDay);
  const perDay = lessonsPerDay(input.minutesPerDay);
  const bands = planBands(input.currentBand, input.targetBand);

  // A queue per band, consumed in order, so a band's lessons are never repeated
  // and the plan moves up when one runs dry.
  const refill = () =>
    new Map<LearnBand, string[]>(
      bands.map((band) => {
        const supply = input.supply.find((entry) => entry.band === band);
        return [band, supply ? [...supply.lessonIds] : []];
      }),
    );
  const queues = refill();
  if (bands.every((band) => (queues.get(band)?.length ?? 0) === 0)) return [];
  let pass = 0;

  const items: PlanItemDraft[] = [];
  for (let dayIndex = 0; dayIndex < days; dayIndex += 1) {
    const day = shiftDay(input.startDay, dayIndex);
    let slot = 0;
    const push = (item: Omit<PlanItemDraft, 'day' | 'slot'>) => {
      items.push({ ...item, day, slot: slot++ });
    };

    // Every seventh day is a test, not a lesson: a plan of only lessons never
    // finds out whether any of it worked.
    if (dayIndex > 0 && dayIndex % MOCK_EVERY === MOCK_EVERY - 1) {
      push({
        kind: 'MOCK_TEST',
        lessonId: null,
        label:
          input.weakestSkill && input.weakestSkill !== 'OVERALL'
            ? `Mock test · focus on ${input.weakestSkill.toLowerCase()}`
            : 'Full mock test',
        band: null,
        skill: input.weakestSkill ?? 'OVERALL',
      });
      // Nothing else that day: a mock test is the whole sitting, and a day that
      // asked for a test and four lessons would just be skipped.
      continue;
    }

    // Which rung this day sits on: the ladder spread evenly across the horizon,
    // skipping rungs that are already empty and falling back to the last one
    // that had lessons.
    const rung = Math.min(bands.length - 1, Math.floor((dayIndex * bands.length) / days));
    let bandIndexUsed = rung;
    while (bandIndexUsed < bands.length && (queues.get(bands[bandIndexUsed]!)?.length ?? 0) === 0) bandIndexUsed += 1;
    if (bandIndexUsed >= bands.length) {
      for (let index = rung; index >= 0 && (queues.get(bands[index]!)?.length ?? 0) === 0; index -= 1) bandIndexUsed = index;
    }
    // The rung for this day can be dry even though the plan is not: the ladder
    // ran out long before the exam did. Go round again from the bottom, up to
    // MAX_PASSES times, and keep the label honest that it is a revisit.
    if ((queues.get(bands[bandIndexUsed] ?? bands[bands.length - 1]!)?.length ?? 0) === 0 && pass + 1 < MAX_PASSES) {
      pass += 1;
      for (const [key, ids] of refill()) queues.set(key, ids);
      bandIndexUsed = 0;
      while (bandIndexUsed < bands.length && (queues.get(bands[bandIndexUsed]!)?.length ?? 0) === 0) bandIndexUsed += 1;
    }
    const band = bands[Math.min(bandIndexUsed, bands.length - 1)]!;
    const queue = queues.get(band)!;
    for (let taken = 0; taken < perDay && queue.length > 0; taken += 1) {
      const lessonId = queue.shift()!;
      push({
        kind: 'LESSON',
        lessonId,
        label: `${pass > 0 ? 'Revisit' : 'Lesson'} · band ${band.toFixed(1)} ${LEARN_BAND_LABELS[band]}`,
        band,
        skill: null,
      });
    }

    // A review on every third day, and also whenever the catalogue ran dry: the
    // notebook always has something in it, so no day on the plan is ever blank.
    if (dayIndex % REVIEW_EVERY === REVIEW_EVERY - 1 || slot === 0) {
      push({ kind: 'REVIEW', lessonId: null, label: 'Review the words you missed', band: null, skill: null });
    }
  }

  return items;
}
