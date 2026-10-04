/**
 * Combo milestones — the rule behind the banner a long run earns.
 *
 * The lesson player fires it and `ComboMilestone` draws it, so the only thing
 * that can silently break is the trigger: a run of five that draws nothing, or a
 * banner that fires on an ordinary answer and turns every question into a
 * celebration. The rule is a pure function, which is what makes it testable
 * without a browser or a `requestAnimationFrame`.
 */
import { describe, expect, it } from 'vitest';
import { comboMilestone } from '../../src/client/components/learn/Effects';

describe('combo milestones', () => {
  it('does not fire before five, between milestones, or on nonsense', () => {
    for (const combo of [0, 1, 2, 3, 4, 6, 7, 8, 9, 11, 14, 19, 21, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(comboMilestone(combo), `combo ${combo}`).toBeNull();
    }
  });

  it('fires on every fifth first-try answer, for a lesson of any length', () => {
    for (let combo = 5; combo <= 50; combo += 5) {
      expect(comboMilestone(combo), `combo ${combo}`).not.toBeNull();
    }
  });

  it('climbs a tier at ten and again at fifteen, and stays there', () => {
    expect(comboMilestone(5)?.tier).toBe(1);
    expect(comboMilestone(10)?.tier).toBe(2);
    expect(comboMilestone(15)?.tier).toBe(3);
    expect(comboMilestone(20)?.tier).toBe(3);
    expect(comboMilestone(100)?.tier).toBe(3);
  });

  it('gives each tier its own words, so the banner says something new', () => {
    const first = comboMilestone(5);
    const second = comboMilestone(10);
    const third = comboMilestone(15);
    expect(first?.title).toBeTruthy();
    expect(new Set([first?.title, second?.title, third?.title]).size).toBe(3);
    expect(new Set([first?.note, second?.note, third?.note]).size).toBe(3);
    for (const info of [first, second, third]) {
      expect(info!.title.trim().length).toBeGreaterThan(0);
      expect(info!.note.trim().length).toBeGreaterThan(0);
    }
  });
});
