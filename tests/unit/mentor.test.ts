import { describe, expect, it } from 'vitest';
import {
  MENTOR_SESSION_STATUSES,
  MENTOR_SPECIALTIES,
  MENTOR_SPECIALTY_LABELS,
  SLOT_MINUTES,
  formatMinuteOfDay,
  mentorRatingLabel,
} from '../../src/shared/mentor';

describe('mentor shared vocabulary', () => {
  it('labels every specialty', () => {
    for (const specialty of MENTOR_SPECIALTIES) {
      expect(MENTOR_SPECIALTY_LABELS[specialty]).toBeTruthy();
    }
  });

  it('covers the session lifecycle', () => {
    expect([...MENTOR_SESSION_STATUSES]).toEqual([
      'REQUESTED',
      'SCHEDULED',
      'ACTIVE',
      'COMPLETED',
      'CANCELLED',
      'NO_SHOW',
    ]);
  });

  it('formats minutes of day as 24-hour clock', () => {
    expect(formatMinuteOfDay(0)).toBe('00:00');
    expect(formatMinuteOfDay(9 * 60 + 5)).toBe('09:05');
    expect(formatMinuteOfDay(17 * 60 + 30)).toBe('17:30');
    expect(formatMinuteOfDay(23 * 60 + 59)).toBe('23:59');
  });

  it('reads ratings the way the directory does', () => {
    expect(mentorRatingLabel(4.9)).toBe('Outstanding');
    expect(mentorRatingLabel(4.5)).toBe('Excellent');
    expect(mentorRatingLabel(3.9)).toBe('Very good');
    expect(mentorRatingLabel(3)).toBe('Good');
    expect(mentorRatingLabel(0)).toBe('New mentor');
  });

  it('books in half-hour slots', () => {
    expect(SLOT_MINUTES).toBe(30);
    expect(60 % SLOT_MINUTES).toBe(0);
  });
});
