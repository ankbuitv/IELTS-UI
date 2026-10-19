import { describe, expect, it } from 'vitest';
import {
  ROOM_MAX_BREAK,
  ROOM_MAX_FOCUS,
  formatPomodoro,
  normaliseBreakMinutes,
  normaliseRoomMinutes,
  nextPhase,
  phaseHint,
  phaseLabel,
  phaseRemaining,
} from '../../src/shared/study';

describe('pomodoro helpers', () => {
  it('formats minutes and seconds with padding', () => {
    expect(formatPomodoro(0)).toBe('00:00');
    expect(formatPomodoro(65)).toBe('01:05');
    expect(formatPomodoro(1500)).toBe('25:00');
    expect(formatPomodoro(-4)).toBe('00:00');
  });

  it('measures the remaining time against the server clock', () => {
    const now = Date.parse('2026-10-19T10:00:00.000Z');
    expect(phaseRemaining('FOCUS', '2026-10-19T10:25:00.000Z', now)).toBe(1500);
    expect(phaseRemaining('BREAK', '2026-10-19T10:00:00.000Z', now)).toBe(0);
    expect(phaseRemaining('FOCUS', '2026-10-19T09:59:00.000Z', now)).toBe(0);
    expect(phaseRemaining('IDLE', '2026-10-19T10:25:00.000Z', now)).toBe(0);
    expect(phaseRemaining('FOCUS', null, now)).toBe(0);
  });

  it('alternates focus and break but never leaves idle on its own', () => {
    expect(nextPhase('FOCUS')).toBe('BREAK');
    expect(nextPhase('BREAK')).toBe('FOCUS');
    expect(nextPhase('IDLE')).toBe('FOCUS');
  });

  it('has readable labels and hints', () => {
    expect(phaseLabel('FOCUS')).toBe('Focus');
    expect(phaseLabel('IDLE')).toBe('Not started');
    expect(phaseHint('IDLE', 0)).toContain('host');
    expect(phaseHint('FOCUS', 300)).toContain('05:00');
    expect(phaseHint('BREAK', 60)).toContain('stretch');
  });

  it('clamps room durations to sensible blocks', () => {
    expect(normaliseRoomMinutes(1)).toBe(5);
    expect(normaliseRoomMinutes(90)).toBe(ROOM_MAX_FOCUS);
    expect(normaliseRoomMinutes(32.4)).toBe(32);
    expect(normaliseBreakMinutes(0)).toBe(1);
    expect(normaliseBreakMinutes(99)).toBe(ROOM_MAX_BREAK);
  });
});
