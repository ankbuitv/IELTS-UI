/**
 * Exam integrity policy + observable event vocabulary.
 *
 * HONEST LIMITATION (surfaced in the UI and in the docs): a web application
 * cannot block operating-system level actions such as Alt+Tab, cannot detect
 * another device, and cannot guarantee that nothing was copied by external
 * means. The platform records *observable browser events* for the teacher and
 * never asserts that an event proves cheating.
 */
import type { ExamMode } from './types';

export const INTEGRITY_EVENT_TYPES = [
  'TAB_HIDDEN',
  'WINDOW_BLUR',
  'FULLSCREEN_EXIT',
  'PAGE_LEAVE_ATTEMPT',
  'NAVIGATION_ATTEMPT',
  'RELOAD',
  'CONNECTION_INTERRUPTION',
  'RESUME',
  'COPY_ATTEMPT',
  'PASTE_ATTEMPT',
  'CONTEXT_MENU_ATTEMPT',
  'SESSION_START',
  'SESSION_RESUME',
  'SUBMIT',
] as const;
export type IntegrityEventType = (typeof INTEGRITY_EVENT_TYPES)[number];

export type IntegritySeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export interface IntegrityPolicy {
  mode: ExamMode;
  /** Request fullscreen on start (browsers require a user gesture). */
  requireFullscreen: boolean;
  monitorVisibility: boolean;
  /** Max counted tab-away events before a warning / auto-submit. null = unlimited. */
  maxTabAwayEvents: number | null;
  /** Max counted fullscreen exits. null = unlimited. */
  maxFullscreenExits: number | null;
  allowCopy: boolean;
  allowPaste: boolean;
  allowContextMenu: boolean;
  /** Show an in-exam warning toast after this many counted events. */
  warnAtEvents: number | null;
  /** Auto-submit the attempt at this many counted events. null = never. */
  autoSubmitAtEvents: number | null;
  /** Permit resuming an in-progress attempt after a disconnect. */
  allowResume: boolean;
  /** Show the candidate a visible integrity indicator. */
  showIndicator: boolean;
}

export const INTEGRITY_PRESETS: Record<ExamMode, IntegrityPolicy> = {
  PRACTICE: {
    mode: 'PRACTICE',
    requireFullscreen: false,
    monitorVisibility: false,
    maxTabAwayEvents: null,
    maxFullscreenExits: null,
    allowCopy: true,
    allowPaste: true,
    allowContextMenu: true,
    warnAtEvents: null,
    autoSubmitAtEvents: null,
    allowResume: true,
    showIndicator: false,
  },
  STANDARD_EXAM: {
    mode: 'STANDARD_EXAM',
    requireFullscreen: false,
    monitorVisibility: true,
    maxTabAwayEvents: 5,
    maxFullscreenExits: 5,
    allowCopy: false,
    allowPaste: false,
    allowContextMenu: false,
    warnAtEvents: 1,
    autoSubmitAtEvents: null,
    allowResume: true,
    showIndicator: true,
  },
  STRICT_EXAM: {
    mode: 'STRICT_EXAM',
    requireFullscreen: true,
    monitorVisibility: true,
    maxTabAwayEvents: 3,
    maxFullscreenExits: 2,
    allowCopy: false,
    allowPaste: false,
    allowContextMenu: false,
    warnAtEvents: 1,
    autoSubmitAtEvents: 5,
    allowResume: true,
    showIndicator: true,
  },
};

/**
 * Events that count towards warning / auto-submit thresholds.
 * WINDOW_BLUR is deliberately excluded: a single Alt+Tab fires both
 * WINDOW_BLUR and TAB_HIDDEN, and counting both would double-penalise the
 * candidate. Both are still logged for the teacher.
 */
export const COUNTED_EVENT_TYPES: IntegrityEventType[] = ['TAB_HIDDEN', 'FULLSCREEN_EXIT'];

export const EVENT_LABELS: Record<IntegrityEventType, string> = {
  TAB_HIDDEN: 'Browser tab hidden',
  WINDOW_BLUR: 'Window lost focus',
  FULLSCREEN_EXIT: 'Left fullscreen',
  PAGE_LEAVE_ATTEMPT: 'Attempted to leave the page',
  NAVIGATION_ATTEMPT: 'Attempted to navigate away',
  RELOAD: 'Page reload',
  CONNECTION_INTERRUPTION: 'Connection interrupted',
  RESUME: 'Session resumed',
  COPY_ATTEMPT: 'Copy attempt',
  PASTE_ATTEMPT: 'Paste attempt',
  CONTEXT_MENU_ATTEMPT: 'Context menu attempt',
  SESSION_START: 'Session started',
  SESSION_RESUME: 'Session resumed',
  SUBMIT: 'Submitted',
};

export const EVENT_SEVERITY: Record<IntegrityEventType, IntegritySeverity> = {
  TAB_HIDDEN: 'WARNING',
  WINDOW_BLUR: 'INFO',
  FULLSCREEN_EXIT: 'WARNING',
  PAGE_LEAVE_ATTEMPT: 'WARNING',
  NAVIGATION_ATTEMPT: 'INFO',
  RELOAD: 'INFO',
  CONNECTION_INTERRUPTION: 'INFO',
  RESUME: 'INFO',
  COPY_ATTEMPT: 'WARNING',
  PASTE_ATTEMPT: 'WARNING',
  CONTEXT_MENU_ATTEMPT: 'INFO',
  SESSION_START: 'INFO',
  SESSION_RESUME: 'INFO',
  SUBMIT: 'INFO',
};

export function resolvePolicy(
  mode: ExamMode,
  overrides: Partial<IntegrityPolicy> | null | undefined,
): IntegrityPolicy {
  const base = INTEGRITY_PRESETS[mode] ?? INTEGRITY_PRESETS.PRACTICE;
  if (!overrides) return { ...base };
  const merged: IntegrityPolicy = { ...base, ...overrides, mode };
  return merged;
}

export function isCountedEvent(type: string): boolean {
  return (COUNTED_EVENT_TYPES as string[]).includes(type);
}

export function countEvents(events: Array<{ type: string }>): {
  counted: number;
  tabAway: number;
  fullscreenExits: number;
  copies: number;
  pastes: number;
  interruptions: number;
  total: number;
} {
  const tabAway = events.filter((e) => e.type === 'TAB_HIDDEN').length;
  const fullscreenExits = events.filter((e) => e.type === 'FULLSCREEN_EXIT').length;
  return {
    counted: events.filter((e) => isCountedEvent(e.type)).length,
    tabAway,
    fullscreenExits,
    copies: events.filter((e) => e.type === 'COPY_ATTEMPT').length,
    pastes: events.filter((e) => e.type === 'PASTE_ATTEMPT').length,
    interruptions: events.filter((e) => e.type === 'CONNECTION_INTERRUPTION').length,
    total: events.length,
  };
}

/** Human-readable summary shown to teachers - explicitly not a verdict. */
export function describeIntegrity(counted: number, total: number): string {
  if (total === 0) return 'No observable integrity events recorded.';
  if (counted === 0) return `${total} informational event(s) recorded; none counted towards policy thresholds.`;
  return `${counted} counted event(s) and ${total} total observable event(s) recorded. Events do not by themselves prove misconduct.`;
}
