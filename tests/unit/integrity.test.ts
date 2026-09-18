import { describe, expect, it } from 'vitest';
import {
  COUNTED_EVENT_TYPES,
  EVENT_SEVERITY,
  INTEGRITY_EVENT_TYPES,
  INTEGRITY_PRESETS,
  countEvents,
  describeIntegrity,
  isCountedEvent,
  resolvePolicy,
} from '../../src/shared/integrity';

describe('integrity policy presets', () => {
  it('defines a policy for every exam mode', () => {
    for (const mode of ['PRACTICE', 'STANDARD_EXAM', 'STRICT_EXAM'] as const) {
      const policy = INTEGRITY_PRESETS[mode];
      expect(policy.mode).toBe(mode);
      expect(policy.autoSubmitAtEvents === null || policy.autoSubmitAtEvents > 0).toBe(true);
    }
  });

  it('lets a teacher override individual policy fields without losing the rest', () => {
    const policy = resolvePolicy('STANDARD_EXAM', { maxTabAwayEvents: 3, monitorVisibility: false });
    expect(policy.maxTabAwayEvents).toBe(3);
    expect(policy.monitorVisibility).toBe(false);
    // Untouched defaults survive the override.
    expect(policy.mode).toBe('STANDARD_EXAM');
    expect(policy.warnAtEvents).toBe(INTEGRITY_PRESETS.STANDARD_EXAM.warnAtEvents);
  });

  it('falls back to a safe policy for an unknown mode', () => {
    const policy = resolvePolicy('NOT_A_MODE' as never, null);
    expect(policy).toEqual(INTEGRITY_PRESETS.PRACTICE);
  });

  it('never claims browser JS can block operating-system actions', () => {
    for (const mode of ['PRACTICE', 'STANDARD_EXAM', 'STRICT_EXAM'] as const) {
      const preset = INTEGRITY_PRESETS[mode];
      // requireFullscreen is a request, not a block: the policy object records
      // intent only. The UI copy explains browser limits (see ExamShell).
      expect(typeof preset.requireFullscreen).toBe('boolean');
    }
    expect(INTEGRITY_PRESETS.STRICT_EXAM.requireFullscreen).toBe(true);
    expect(INTEGRITY_PRESETS.PRACTICE.monitorVisibility).toBe(false);
  });
});

describe('countEvents', () => {
  it('counts only the events that drive thresholds', () => {
    const events = [
      { type: 'TAB_HIDDEN' },
      { type: 'WINDOW_BLUR' },
      { type: 'FULLSCREEN_EXIT' },
      { type: 'COPY_ATTEMPT' },
      { type: 'PASTE_ATTEMPT' },
      { type: 'CONNECTION_INTERRUPTION' },
    ];
    const counts = countEvents(events);
    expect(counts.counted).toBe(2);
    expect(counts.tabAway).toBe(1);
    expect(counts.fullscreenExits).toBe(1);
    expect(counts.copies).toBe(1);
    expect(counts.pastes).toBe(1);
    expect(counts.interruptions).toBe(1);
    expect(counts.total).toBe(6);
    expect(counts.counted).toBeLessThan(counts.total);
  });

  it('counts an Alt+Tab once: WINDOW_BLUR and its TAB_HIDDEN partner', () => {
    // The client records both events for a single Alt+Tab; only TAB_HIDDEN is
    // counted, so a teacher threshold of 3 is not reached by three tab-outs.
    const events = [
      { type: 'WINDOW_BLUR' },
      { type: 'TAB_HIDDEN' },
      { type: 'WINDOW_BLUR' },
      { type: 'TAB_HIDDEN' },
      { type: 'WINDOW_BLUR' },
      { type: 'TAB_HIDDEN' },
    ];
    expect(countEvents(events).counted).toBe(3);
  });

  it('treats informational events as uncounted', () => {
    expect(isCountedEvent('WINDOW_BLUR')).toBe(false);
    expect(isCountedEvent('COPY_ATTEMPT')).toBe(false);
    expect(isCountedEvent('TAB_HIDDEN')).toBe(true);
    expect(isCountedEvent('FULLSCREEN_EXIT')).toBe(true);
    expect(COUNTED_EVENT_TYPES).toEqual(['TAB_HIDDEN', 'FULLSCREEN_EXIT']);
  });

  it('assigns a severity to every supported event type', () => {
    for (const type of INTEGRITY_EVENT_TYPES) {
      expect(EVENT_SEVERITY[type]).toBeDefined();
    }
  });
});

describe('describeIntegrity', () => {
  it('never presents events as proof of cheating', () => {
    expect(describeIntegrity(0, 0)).toBe('No observable integrity events recorded.');
    expect(describeIntegrity(0, 4)).toContain('none counted');
    const described = describeIntegrity(2, 7);
    expect(described).toContain('do not by themselves prove misconduct');
    expect(described.toLowerCase()).not.toContain('cheat');
  });
});
