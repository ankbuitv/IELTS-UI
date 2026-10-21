import { describe, expect, it } from 'vitest';
import { projectBand } from '../../src/shared/projection';

const day = 86_400_000;
const start = new Date('2026-01-01T00:00:00Z').getTime();
const iso = (offsetDays: number) => new Date(start + offsetDays * day).toISOString();

describe('projectBand', () => {
  it('extrapolates a rising trend to the exam date', () => {
    const projection = projectBand(
      [
        { at: iso(0), band: 5.5 },
        { at: iso(7), band: 6 },
        { at: iso(14), band: 6.5 },
        { at: iso(21), band: 6.5 },
        { at: iso(28), band: 7 },
      ],
      iso(56),
    );
    expect(projection.current).toBe(7);
    expect(projection.projected).toBe(7.5);
    expect(projection.slopePerWeek).toBeGreaterThan(0);
    expect(projection.confidence).toBe('HIGH');
  });

  it('caps the slope so one lucky mock cannot promise a 9', () => {
    const projection = projectBand(
      [
        { at: iso(0), band: 5 },
        { at: iso(1), band: 8 },
      ],
      iso(100),
    );
    expect(projection.slopePerWeek).toBeLessThanOrEqual(0.5);
    expect(projection.projected).toBeLessThanOrEqual(9);
  });

  it('returns the current band when there is only one sample', () => {
    const projection = projectBand([{ at: iso(3), band: 6 }], iso(30));
    expect(projection).toMatchObject({ current: 6, projected: 6, samples: 1, confidence: 'LOW' });
  });

  it('handles no samples', () => {
    expect(projectBand([], iso(10)).projected).toBeNull();
  });

  it('does not go negative or above 9', () => {
    const down = projectBand(
      [
        { at: iso(0), band: 7 },
        { at: iso(7), band: 6 },
        { at: iso(14), band: 5 },
      ],
      iso(500),
    );
    expect(down.projected).toBeGreaterThanOrEqual(0);
    expect(down.projected).toBeLessThanOrEqual(9);
  });
});
