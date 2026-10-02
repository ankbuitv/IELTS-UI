import { describe, expect, it } from 'vitest';
import { niceScale } from '../../src/client/components/charts';

describe('niceScale (axis ticks people can read)', () => {
  it('uses whole steps on a 0-9 band axis instead of 2.25 increments', () => {
    const scale = niceScale(0, 9, 4, true);
    expect(scale.max).toBe(9);
    expect(scale.ticks).toEqual([0, 3, 6, 9]);
  });

  it('keeps a fixed 0-100 percentage axis on round numbers', () => {
    const scale = niceScale(0, 100, 4, true);
    expect(scale.max).toBe(100);
    expect(scale.ticks[0]).toBe(0);
    expect(scale.ticks.at(-1)).toBe(100);
    for (const tick of scale.ticks) expect(Number.isInteger(tick)).toBe(true);
  });

  it('rounds a free axis up to the next tick so no data sits above the top line', () => {
    const scale = niceScale(0, 4.2, 4, false);
    expect(scale.max).toBeGreaterThanOrEqual(4.2);
    expect(scale.ticks.at(-1)).toBe(scale.max);
    for (const tick of scale.ticks) expect(Number.isInteger(tick)).toBe(true);
    const bands = niceScale(0, 7.15, 4, false);
    expect(bands.ticks).toEqual([0, 2, 4, 6, 8]);
  });

  it('never produces fractional counts for small data and survives an empty range', () => {
    expect(niceScale(0, 3, 4, false).ticks.every(Number.isInteger)).toBe(true);
    const flat = niceScale(0, 0, 4, false);
    expect(flat.ticks.length).toBeGreaterThanOrEqual(2);
    expect(flat.max).toBeGreaterThan(0);
  });
});
