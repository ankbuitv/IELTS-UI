import { describe, expect, it } from 'vitest';
import { weekKeyFor, weekStartFor } from '../../src/worker/services/digest-service';

/**
 * The weekly digest must key weeks to Monday 00:00 UTC — the cron runs Monday
 * 01:00 UTC, and a local-timezone key would send two recaps (or none).
 */
describe('weekly digest week keys', () => {
  it('starts the week on Monday at midnight UTC', () => {
    const wednesday = new Date('2026-10-21T15:42:00.000Z');
    expect(weekStartFor(wednesday).toISOString()).toBe('2026-10-19T00:00:00.000Z');
    expect(weekKeyFor(wednesday)).toBe('2026-10-19');
  });

  it('keeps a Monday on its own week', () => {
    const monday = new Date('2026-10-19T00:00:00.000Z');
    expect(weekKeyFor(monday)).toBe('2026-10-19');
    expect(weekKeyFor(new Date('2026-10-19T23:59:59.999Z'))).toBe('2026-10-19');
  });

  it('sends Sunday to the week that just ended, not the next one', () => {
    const sunday = new Date('2026-10-25T23:00:00.000Z');
    expect(weekKeyFor(sunday)).toBe('2026-10-19');
  });
});
