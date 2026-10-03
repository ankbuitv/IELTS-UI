import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PLAN_DAYS,
  MAX_PLAN_DAYS,
  MIN_PLAN_DAYS,
  buildPlanItems,
  lessonsPerDay,
  planBands,
  planHorizonDays,
  shiftDay,
  type PlanBandSupply,
  type PlanInput,
} from '../../src/shared/learn-plan';
import { LEARN_BANDS, type LearnBand } from '../../src/shared/learn';

/**
 * The planner, tested as the pure function it is.
 *
 * A study plan is the one part of Learn whose mistakes are invisible in the app:
 * a lesson on the wrong day, or the same lesson twice, only shows up weeks later
 * when the learner notices they are being taught the same thing again. So the
 * properties that matter are written down here rather than checked by eye.
 */

const START = '2026-10-03';

function supplyFor(bands: LearnBand[], perBand: number): PlanBandSupply[] {
  return bands.map((band) => ({
    band,
    lessonIds: Array.from({ length: perBand }, (_, index) => `${band.toFixed(1)}-l${index}`),
  }));
}

function baseInput(overrides: Partial<PlanInput> = {}): PlanInput {
  return {
    startDay: START,
    examDay: null,
    currentBand: 6,
    targetBand: 7,
    minutesPerDay: 30,
    supply: supplyFor([6, 6.5, 7], 40),
    weakestSkill: null,
    ...overrides,
  };
}

describe('shiftDay', () => {
  it('moves across a month boundary and back', () => {
    expect(shiftDay('2026-10-30', 3)).toBe('2026-11-02');
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftDay('2024-03-01', -1)).toBe('2024-02-29');
    expect(shiftDay(START, 0)).toBe(START);
  });
});

describe('planHorizonDays', () => {
  it('uses a month when no exam is booked', () => {
    expect(planHorizonDays(START, null)).toBe(DEFAULT_PLAN_DAYS);
  });

  it('counts the exam day itself', () => {
    expect(planHorizonDays(START, '2026-10-10')).toBe(8);
  });

  it('keeps a plan inside the window it can actually serve', () => {
    // An exam tomorrow still needs a week, and an exam in two years is not a plan.
    expect(planHorizonDays(START, '2026-10-01')).toBe(MIN_PLAN_DAYS);
    expect(planHorizonDays(START, '2030-01-01')).toBe(MAX_PLAN_DAYS);
  });

  it('falls back to a month rather than producing nothing', () => {
    expect(planHorizonDays(START, 'not-a-day')).toBe(DEFAULT_PLAN_DAYS);
  });
});

describe('lessonsPerDay', () => {
  it('prices a lesson at about five minutes', () => {
    expect(lessonsPerDay(15)).toBe(3);
    expect(lessonsPerDay(30)).toBe(6);
  });

  it('never asks for nothing and never asks for more than six', () => {
    expect(lessonsPerDay(2)).toBe(1);
    expect(lessonsPerDay(60)).toBe(6);
    expect(lessonsPerDay(600)).toBe(6);
  });

  it('survives a nonsense budget', () => {
    expect(lessonsPerDay(Number.NaN)).toBe(6);
  });
});

describe('planBands', () => {
  it('climbs from where the learner is to where they want to be', () => {
    expect(planBands(6, 7)).toEqual([6, 6.5, 7]);
    expect(planBands(4, 5.5)).toEqual([4, 4.5, 5, 5.5]);
  });

  it('still stretches one rung when the target is at or below the current band', () => {
    // A plan that only repeated what you already know would teach nothing.
    expect(planBands(7, 7)).toEqual([7, 7.5]);
    expect(planBands(6.5, 5)).toEqual([6.5, 7]);
  });

  it('stops at the top of the ladder', () => {
    expect(planBands(8, 8)).toEqual([8]);
    expect(planBands(8, 4)).toEqual([8]);
  });
});

describe('buildPlanItems', () => {
  it('returns nothing when the catalogue has no lessons to offer', () => {
    expect(buildPlanItems(baseInput({ supply: [] }))).toEqual([]);
    expect(buildPlanItems(baseInput({ supply: supplyFor([6, 6.5, 7], 0) }))).toEqual([]);
  });

  it('is deterministic: the same input gives the same plan', () => {
    const input = baseInput();
    expect(buildPlanItems(input)).toEqual(buildPlanItems(input));
  });

  it('starts on the learner’s own day and runs to the horizon', () => {
    const items = buildPlanItems(baseInput());
    const days = [...new Set(items.map((item) => item.day))];
    expect(days[0]).toBe(START);
    expect(days.length).toBe(DEFAULT_PLAN_DAYS);
    expect(days[days.length - 1]).toBe(shiftDay(START, DEFAULT_PLAN_DAYS - 1));
  });

  it('shortens to match an exam that is close', () => {
    const items = buildPlanItems(baseInput({ examDay: '2026-10-12' }));
    expect([...new Set(items.map((item) => item.day))].length).toBe(10);
  });

  it('spends the whole catalogue before repeating anything', () => {
    const input = baseInput();
    const lessons = buildPlanItems(input).filter((item) => item.kind === 'LESSON');
    const supplySize = input.supply.reduce((total, entry) => total + entry.lessonIds.length, 0);
    expect(supplySize).toBe(120);
    // The first pass covers every lesson once, in order, and calls each new.
    const firstPass = lessons.slice(0, supplySize);
    expect(new Set(firstPass.map((item) => item.lessonId)).size).toBe(supplySize);
    expect(firstPass.every((item) => item.label.startsWith('Lesson'))).toBe(true);
    // 24 lesson days at six a day needs 144 slots, so the tail is a revisit.
    expect(lessons.length).toBeGreaterThan(supplySize);
    expect(lessons.slice(supplySize).every((item) => item.label.startsWith('Revisit'))).toBe(true);
  });

  it('revisits rather than leaving a long plan empty, and says so', () => {
    // Four lessons a band against a two-month horizon: the ladder runs out.
    const input = baseInput({ supply: supplyFor([6, 6.5, 7], 4), minutesPerDay: 30 });
    const items = buildPlanItems(input);
    const lessons = items.filter((item) => item.kind === 'LESSON');
    expect(lessons.length).toBeGreaterThan(12);
    expect(lessons.filter((item) => item.label.startsWith('Revisit')).length).toBeGreaterThan(0);
    // Three passes at most: one new, two revisits, then the days are reviews.
    const counts = new Map<string, number>();
    for (const item of lessons) counts.set(item.lessonId!, (counts.get(item.lessonId!) ?? 0) + 1);
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(3);
    // The first twelve are still the twelve real lessons, each once.
    expect(new Set(lessons.slice(0, 12).map((item) => item.lessonId)).size).toBe(12);
  });

  it('only ever schedules lessons from bands on the ladder', () => {
    const input = baseInput();
    const allowed = new Set(planBands(input.currentBand, input.targetBand));
    for (const item of buildPlanItems(input)) {
      if (item.kind !== 'LESSON') continue;
      expect(allowed.has(item.band as LearnBand)).toBe(true);
    }
  });

  it('arrives at the target band near the end rather than in week one', () => {
    const items = buildPlanItems(baseInput());
    const targetDays = items.filter((item) => item.band === 7).map((item) => item.day);
    expect(targetDays.length).toBeGreaterThan(0);
    // The top rung starts in the final third of the horizon.
    expect(targetDays[0]! >= shiftDay(START, Math.floor(DEFAULT_PLAN_DAYS / 2))).toBe(true);
  });

  it('keeps to the one rung the catalogue can supply', () => {
    const input = baseInput({ supply: supplyFor([6], 3) });
    const items = buildPlanItems(input);
    expect(items.length).toBeGreaterThan(0);
    const lessons = items.filter((item) => item.kind === 'LESSON');
    // Three lessons exist, so three passes of them and no invented fourth.
    expect(new Set(lessons.map((item) => item.lessonId)).size).toBe(3);
    expect(lessons).toHaveLength(9);
    expect(lessons.every((item) => item.band === 6)).toBe(true);
    expect(items.some((item) => item.kind === 'REVIEW')).toBe(true);
  });

  it('puts a mock test on every seventh day and nothing else', () => {
    const items = buildPlanItems(baseInput());
    const mocks = items.filter((item) => item.kind === 'MOCK_TEST');
    expect(mocks.map((item) => item.day)).toEqual([
      shiftDay(START, 6),
      shiftDay(START, 13),
      shiftDay(START, 20),
      shiftDay(START, 27),
    ]);
    for (const mock of mocks) {
      expect(mock.lessonId).toBeNull();
      expect(mock.day).not.toBe(START);
      expect(items.filter((item) => item.day === mock.day)).toHaveLength(1);
    }
  });

  it('labels the mock test with the weakest skill when there is one', () => {
    const focused = buildPlanItems(baseInput({ weakestSkill: 'WRITING' }));
    expect(focused.find((item) => item.kind === 'MOCK_TEST')?.label).toBe('Mock test · focus on writing');
    const plain = buildPlanItems(baseInput());
    expect(plain.find((item) => item.kind === 'MOCK_TEST')?.label).toBe('Full mock test');
  });

  it('reviews the notebook every third day, and never leaves a day empty', () => {
    const items = buildPlanItems(baseInput());
    const offsetOf = (day: string) =>
      Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${START}T00:00:00Z`)) / 86_400_000);

    const reviews = items.filter((item) => item.kind === 'REVIEW');
    expect(reviews.length).toBeGreaterThan(5);
    for (const review of reviews) {
      const onSchedule = (offsetOf(review.day) + 1) % 3 === 0;
      // Off-schedule reviews only exist because that day had no lesson left.
      const emptyDay = !items.some((item) => item.day === review.day && item.kind === 'LESSON');
      expect(onSchedule || emptyDay).toBe(true);
      expect(review.lessonId).toBeNull();
    }

    for (const day of new Set(items.map((item) => item.day))) {
      const isMockDay = items.some((item) => item.day === day && item.kind === 'MOCK_TEST');
      // A mock day is the whole sitting, so the review schedule yields to it.
      if (!isMockDay && offsetOf(day) > 0 && (offsetOf(day) + 1) % 3 === 0) {
        expect(items.some((item) => item.day === day && item.kind === 'REVIEW')).toBe(true);
      }
    }
  });

  it('numbers the slots inside a day from zero, with no gaps', () => {
    for (const item of buildPlanItems(baseInput())) {
      const sameDay = buildPlanItems(baseInput()).filter((entry) => entry.day === item.day);
      const slots = sameDay.map((entry) => entry.slot).sort((a, b) => a - b);
      expect(slots).toEqual(slots.map((_, index) => index));
    }
  });

  it('fills each day up to the daily budget, no more', () => {
    const input = baseInput({ minutesPerDay: 15 });
    const items = buildPlanItems(input);
    expect(lessonsPerDay(15)).toBe(3);
    for (const day of new Set(items.map((item) => item.day))) {
      expect(items.filter((item) => item.day === day && item.kind === 'LESSON').length).toBeLessThanOrEqual(3);
    }
  });

  it('only offers bands the catalogue can actually supply', () => {
    // The catalogue has 4.0 and 8.0 content only; the ladder still runs 6.0→7.0,
    // so the plan should have nothing to give and say so rather than inventing days.
    const items = buildPlanItems(baseInput({ supply: supplyFor([4, 8], 20) }));
    expect(items).toEqual([]);
    // Adding one rung of real supply is enough to build a plan again.
    expect(buildPlanItems(baseInput({ supply: supplyFor([6.5], 20) })).length).toBeGreaterThan(0);
  });

  it('never asks for a band outside the ladder', () => {
    for (const band of LEARN_BANDS) {
      expect(planBands(band, band).every((value) => value >= band)).toBe(true);
    }
  });
});
