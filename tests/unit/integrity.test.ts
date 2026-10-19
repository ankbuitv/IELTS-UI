import { describe, expect, it } from 'vitest';
import {
  COUNTED_EVENT_TYPES,
  EVENT_LABELS,
  EVENT_SEVERITY,
  INTEGRITY_EVENT_TYPES,
  INTEGRITY_PRESETS,
  TAB_LOCK_STRIKES,
  countedEventTypes,
  countEvents,
  describeIntegrity,
  fullscreenLimitReached,
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
  });

  it('locks the tab in EVERY exam mode, practice included, and submits at the same limit', () => {
    for (const mode of ['PRACTICE', 'STANDARD_EXAM', 'STRICT_EXAM'] as const) {
      const preset = INTEGRITY_PRESETS[mode];
      expect(preset.monitorVisibility).toBe(true);
      expect(preset.warnAtEvents).toBe(1);
      expect(preset.autoSubmitAtEvents).toBe(TAB_LOCK_STRIKES);
      expect(preset.showIndicator).toBe(true);
    }
    expect(TAB_LOCK_STRIKES).toBe(3);
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
    expect(COUNTED_EVENT_TYPES).toEqual(['TAB_HIDDEN', 'FULLSCREEN_EXIT', 'POPUP_BLOCKED']);
  });

  it('assigns a severity to every supported event type', () => {
    for (const type of INTEGRITY_EVENT_TYPES) {
      expect(EVENT_SEVERITY[type]).toBeDefined();
    }
  });
});

describe('window, popup and overlay policy', () => {
  const WINDOW_FLAGS = ['autoFullscreen', 'lockOnFullscreenExit', 'blockPopups', 'blockTranslatorOverlays'] as const;
  // Selecting text is what the highlighter needs, so it is not part of the lock
  // in either exam mode; these are the flags that would remove it if a centre wants
  // a paper with no marks at all.
  const SELECTION_LOCK_FLAGS = ['blockTextSelection'] as const;

  it('leaves practice mode completely unblocked', () => {
    // Practice is a study tool: no fullscreen demand, no popup refusal, and
    // translation stays available to someone learning the language.
    const practice = INTEGRITY_PRESETS.PRACTICE;
    for (const flag of WINDOW_FLAGS) expect(practice[flag]).toBe(false);
    for (const flag of SELECTION_LOCK_FLAGS) expect(practice[flag]).toBe(false);
    expect(practice.requireFullscreen).toBe(false);
    expect(practice.countExtensionStrikes).toBe(false);
    // Copy, paste and the right-click menu stay available: practice is a study tool.
    expect(practice.allowCopy).toBe(true);
    expect(practice.allowPaste).toBe(true);
    expect(practice.allowContextMenu).toBe(true);
  });

  it('locks the window in both exam modes while leaving the highlighter usable', () => {
    for (const mode of ['STANDARD_EXAM', 'STRICT_EXAM'] as const) {
      const preset = INTEGRITY_PRESETS[mode];
      for (const flag of WINDOW_FLAGS) expect(preset[flag]).toBe(true);
      expect(preset.requireFullscreen).toBe(true);
      expect(preset.allowCopy).toBe(false);
      expect(preset.allowPaste).toBe(false);
      expect(preset.allowContextMenu).toBe(false);
      // Text can be selected — that is the input to the mark-up tool — but the
      // selection cannot leave the page.
      for (const flag of SELECTION_LOCK_FLAGS) expect(preset[flag]).toBe(false);
    }
  });

  it('still lets a centre lock selection away completely', () => {
    const policy = resolvePolicy('STRICT_EXAM', { blockTextSelection: true });
    expect(policy.blockTextSelection).toBe(true);
    expect(policy.allowCopy).toBe(false);
  });

  it('lets a teacher switch the guard off for one assignment without gutting the mode', () => {
    const policy = resolvePolicy('STANDARD_EXAM', { autoFullscreen: false, blockPopups: false });
    expect(policy.blockPopups).toBe(false);
    expect(policy.lockOnFullscreenExit).toBe(true);
    // The tab lock, which is not part of the window guard, survives untouched.
    expect(policy.autoSubmitAtEvents).toBe(INTEGRITY_PRESETS.STANDARD_EXAM.autoSubmitAtEvents);
  });

  it('counts an extension overlay only where the institution asked for it', () => {
    expect(countedEventTypes(INTEGRITY_PRESETS.STANDARD_EXAM)).not.toContain('EXTENSION_OVERLAY');
    expect(countedEventTypes(INTEGRITY_PRESETS.STRICT_EXAM)).toContain('EXTENSION_OVERLAY');
    expect(isCountedEvent('EXTENSION_OVERLAY')).toBe(false);
    expect(isCountedEvent('EXTENSION_OVERLAY', INTEGRITY_PRESETS.STRICT_EXAM)).toBe(true);
    const events = [{ type: 'EXTENSION_OVERLAY' }, { type: 'POPUP_BLOCKED' }];
    expect(countEvents(events, INTEGRITY_PRESETS.STANDARD_EXAM).counted).toBe(1);
    expect(countEvents(events, INTEGRITY_PRESETS.STRICT_EXAM).counted).toBe(2);
    const counts = countEvents(events, INTEGRITY_PRESETS.STRICT_EXAM);
    expect(counts.popupsBlocked).toBe(1);
    expect(counts.overlaysSuppressed).toBe(1);
  });

  it('names and rates the new events so the teacher report can read them', () => {
    for (const type of ['POPUP_BLOCKED', 'EXTENSION_OVERLAY'] as const) {
      expect(INTEGRITY_EVENT_TYPES).toContain(type);
      expect(EVENT_LABELS[type].length).toBeGreaterThan(0);
      expect(EVENT_SEVERITY[type]).toBe('WARNING');
    }
  });

  it('treats the fullscreen allowance as a lock and never as a submission', () => {
    expect(fullscreenLimitReached(INTEGRITY_PRESETS.STRICT_EXAM, 2)).toBe(false);
    expect(fullscreenLimitReached(INTEGRITY_PRESETS.STRICT_EXAM, 3)).toBe(true);
    // null means unlimited, which is what practice and standard exam use: leaving
    // fullscreen is also what a screensaver or an OS update does.
    expect(fullscreenLimitReached(INTEGRITY_PRESETS.PRACTICE, 99)).toBe(false);
    for (const mode of ['PRACTICE', 'STANDARD_EXAM', 'STRICT_EXAM'] as const) {
      expect(INTEGRITY_PRESETS[mode].autoSubmitAtEvents).not.toBe(0);
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
