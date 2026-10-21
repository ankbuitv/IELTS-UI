import { describe, expect, it } from 'vitest';
import { buildActionPlan, weakestCriterion, type ActionPlanInput } from '../../src/worker/services/action-plan-service';
import { planWeekStart } from '../../src/shared/action-plan';

const empty: ActionPlanInput = {
  writingCriteria: [],
  speakingCriteria: [],
  wordsDue: 0,
  attemptsSubmitted: 0,
  writingSubmitted: 0,
  speakingSubmitted: 0,
  averageBand: null,
};

describe('planWeekStart', () => {
  it('returns the Monday of the week in UTC', () => {
    expect(planWeekStart(new Date('2026-10-19T09:00:00.000Z'))).toBe('2026-10-19');
    expect(planWeekStart(new Date('2026-10-25T23:59:00.000Z'))).toBe('2026-10-19');
    expect(planWeekStart(new Date('2026-10-21T00:00:00.000Z'))).toBe('2026-10-19');
  });

  it('treats Sunday as the last day of the previous week', () => {
    expect(planWeekStart(new Date('2026-10-18T12:00:00.000Z'))).toBe('2026-10-12');
  });
});

describe('weakestCriterion', () => {
  it('picks the lowest criterion across writing and speaking', () => {
    const focus = weakestCriterion({
      ...empty,
      writingCriteria: [{ TA: 6, CC: 5.5, LR: 7, GRA: 6 }],
      speakingCriteria: [{ FC: 6.5, P: 5, LR: 6 }],
    });
    expect(focus).toMatchObject({ label: 'Pronunciation', skill: 'SPEAKING', band: 5 });
  });

  it('ignores criteria with no numeric band', () => {
    expect(weakestCriterion({ ...empty, writingCriteria: [{ TA: 0, CC: 6.5 }] })).toMatchObject({
      label: 'Coherence & cohesion',
      band: 6.5,
    });
  });
});

describe('buildActionPlan', () => {
  it('always gives exactly three tasks', () => {
    expect(buildActionPlan(empty).tasks).toHaveLength(3);
    expect(
      buildActionPlan({
        ...empty,
        writingCriteria: [{ TA: 6, CC: 5, LR: 6, GRA: 6 }],
        wordsDue: 12,
        attemptsSubmitted: 4,
        writingSubmitted: 2,
      }).tasks,
    ).toHaveLength(3);
  });

  it('starts with the weakest criterion and includes vocabulary that is due', () => {
    const plan = buildActionPlan({
      ...empty,
      writingCriteria: [{ TA: 6, CC: 5, LR: 6, GRA: 6 }],
      wordsDue: 9,
      attemptsSubmitted: 2,
      writingSubmitted: 1,
    });
    expect(plan.tasks[0]?.id).toBe('focus');
    expect(plan.tasks[0]?.title).toContain('Coherence & cohesion');
    expect(plan.tasks.some((task) => task.id === 'vocab' && task.title.includes('9'))).toBe(true);
    expect(plan.focus?.band).toBe(5);
    expect(plan.summary).toContain('Coherence & cohesion');
  });

  it('falls back to a starter plan without inventing a weakness', () => {
    const plan = buildActionPlan(empty);
    expect(plan.focus).toBeNull();
    expect(plan.summary).toContain('chẩn đoán');
    expect(plan.tasks.map((task) => task.skill)).toContain('WRITING');
    expect(plan.tasks.every((task) => task.done === false)).toBe(true);
  });
});
