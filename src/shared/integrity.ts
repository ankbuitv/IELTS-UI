/**
 * Exam integrity policy + observable event vocabulary.
 *
 * TAB LOCK. Every exam mode, practice included, counts each time the candidate
 * leaves the exam tab. A blocking notice appears when they come back, and at
 * `TAB_LOCK_STRIKES` counted events the server submits the attempt.
 *
 * WINDOW AND POPUP LOCK (exam modes). The exam enters fullscreen on the first
 * interaction, covers the paper until fullscreen is re-entered, refuses
 * window.open / Ctrl-click / middle-click / target=_blank, and hides the layers
 * that translation and dictionary extensions inject into the page. Practice mode
 * does none of that: it is a study tool, not an invigilated room.
 *
 * HONEST LIMITATION (surfaced in the UI and in the docs): a web application
 * cannot physically block operating-system level actions such as Alt+Tab,
 * cannot detect another device, and cannot guarantee that nothing was copied by
 * external means. What it can do is notice that the exam page was left, count
 * it, interrupt the candidate on return and submit at the limit. The platform
 * records *observable browser events* for the teacher and never asserts that an
 * event proves cheating.
 */
import type { ExamMode } from './types';

export const INTEGRITY_EVENT_TYPES = [
  'TAB_HIDDEN',
  'WINDOW_BLUR',
  'FULLSCREEN_EXIT',
  'POPUP_BLOCKED',
  'EXTENSION_OVERLAY',
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

/** Counted tab-away events after which the attempt is submitted automatically. */
export const TAB_LOCK_STRIKES = 3;

export type IntegritySeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export interface IntegrityPolicy {
  mode: ExamMode;
  /** Request fullscreen on start (browsers require a user gesture). */
  requireFullscreen: boolean;
  monitorVisibility: boolean;
  /**
   * Enter fullscreen by itself instead of only asking: the browser still needs a
   * gesture, so the request fires on the first pointer/keydown inside the exam.
   */
  autoFullscreen: boolean;
  /**
   * Cover the paper until fullscreen is re-entered. Deliberately never
   * auto-submits: leaving fullscreen is also what a screensaver, an OS update
   * or a browser permission prompt does.
   */
  lockOnFullscreenExit: boolean;
  /**
   * Refuse new windows/tabs opened from the exam (window.open, Ctrl/Cmd-click,
   * middle-click, `target="_blank"`) and record each refusal. Browser-level
   * shortcuts (Ctrl+T) belong to the browser and cannot be blocked from a page;
   * the focus loss they cause is what gets counted.
   */
  blockPopups: boolean;
  /**
   * Suppress the overlays translation and dictionary extensions inject into the
   * page, and mark the document `translate="no"` so browser page translation
   * stays off during an attempt.
   */
  blockTranslatorOverlays: boolean;
  /**
   * Nothing on the paper can be selected, dragged out or copy-cut: the text
   * leaves the page only through the candidate's own answer fields.
   */
  blockTextSelection: boolean;
  /**
   * Count a suppressed extension overlay as a strike. Only for the strictest
   * mode: an extension can fire on its own, so by default it is recorded, not
   * punished.
   */
  countExtensionStrikes: boolean;
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
    monitorVisibility: true,
    autoFullscreen: false,
    lockOnFullscreenExit: false,
    blockPopups: false,
    blockTranslatorOverlays: false,
    blockTextSelection: false,
    countExtensionStrikes: false,
    maxTabAwayEvents: TAB_LOCK_STRIKES,
    maxFullscreenExits: null,
    allowCopy: true,
    allowPaste: true,
    allowContextMenu: true,
    warnAtEvents: 1,
    autoSubmitAtEvents: TAB_LOCK_STRIKES,
    allowResume: true,
    showIndicator: true,
  },
  STANDARD_EXAM: {
    mode: 'STANDARD_EXAM',
    requireFullscreen: true,
    monitorVisibility: true,
    autoFullscreen: true,
    lockOnFullscreenExit: true,
    blockPopups: true,
    blockTranslatorOverlays: true,
    // Selection is deliberately allowed: it feeds the highlighter and the note
    // pad (see shared/annotations.ts). Copy, cut, drag and the context menu
    // are still refused below; an institution can still turn this on to remove
    // the highlighter from one assignment.
    blockTextSelection: false,
    countExtensionStrikes: false,
    maxTabAwayEvents: TAB_LOCK_STRIKES,
    maxFullscreenExits: 5,
    allowCopy: false,
    allowPaste: false,
    allowContextMenu: false,
    warnAtEvents: 1,
    autoSubmitAtEvents: TAB_LOCK_STRIKES,
    allowResume: true,
    showIndicator: true,
  },
  STRICT_EXAM: {
    mode: 'STRICT_EXAM',
    requireFullscreen: true,
    monitorVisibility: true,
    autoFullscreen: true,
    lockOnFullscreenExit: true,
    blockPopups: true,
    blockTranslatorOverlays: true,
    // Selection is deliberately allowed: it feeds the highlighter and the note
    // pad (see shared/annotations.ts). Copy, cut, drag and the context menu
    // are still refused below; an institution can still turn this on to remove
    // the highlighter from one assignment.
    blockTextSelection: false,
    countExtensionStrikes: true,
    maxTabAwayEvents: 3,
    maxFullscreenExits: 2,
    allowCopy: false,
    allowPaste: false,
    allowContextMenu: false,
    warnAtEvents: 1,
    autoSubmitAtEvents: TAB_LOCK_STRIKES,
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
export const COUNTED_EVENT_TYPES: IntegrityEventType[] = ['TAB_HIDDEN', 'FULLSCREEN_EXIT', 'POPUP_BLOCKED'];

/**
 * The counted set depends on the policy: an extension overlay is a strike only
 * where the institution asked for it, because an auto-triggering extension would
 * otherwise submit a candidate's paper for something they never did.
 */
export function countedEventTypes(policy?: Pick<IntegrityPolicy, 'countExtensionStrikes'> | null): IntegrityEventType[] {
  return policy?.countExtensionStrikes ? [...COUNTED_EVENT_TYPES, 'EXTENSION_OVERLAY'] : [...COUNTED_EVENT_TYPES];
}

export const EVENT_LABELS: Record<IntegrityEventType, string> = {
  TAB_HIDDEN: 'Browser tab hidden',
  WINDOW_BLUR: 'Window lost focus',
  FULLSCREEN_EXIT: 'Left fullscreen',
  POPUP_BLOCKED: 'New window or tab blocked',
  EXTENSION_OVERLAY: 'Extension overlay suppressed',
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
  POPUP_BLOCKED: 'WARNING',
  EXTENSION_OVERLAY: 'WARNING',
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

export function isCountedEvent(
  type: string,
  policy?: Pick<IntegrityPolicy, 'countExtensionStrikes'> | null,
): boolean {
  return (countedEventTypes(policy) as string[]).includes(type);
}

export function countEvents(events: Array<{ type: string }>, policy?: Pick<IntegrityPolicy, 'countExtensionStrikes'> | null): {
  counted: number;
  tabAway: number;
  fullscreenExits: number;
  popupsBlocked: number;
  overlaysSuppressed: number;
  copies: number;
  pastes: number;
  interruptions: number;
  total: number;
} {
  const tabAway = events.filter((e) => e.type === 'TAB_HIDDEN').length;
  const fullscreenExits = events.filter((e) => e.type === 'FULLSCREEN_EXIT').length;
  return {
    counted: events.filter((e) => isCountedEvent(e.type, policy)).length,
    popupsBlocked: events.filter((e) => e.type === 'POPUP_BLOCKED').length,
    overlaysSuppressed: events.filter((e) => e.type === 'EXTENSION_OVERLAY').length,
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

/**
 * Whether the fullscreen allowance is used up. Reported to the candidate as a
 * lock (re-enter fullscreen to continue) and to the teacher as a note; never a
 * reason to submit an attempt on its own.
 */
export function fullscreenLimitReached(
  policy: Pick<IntegrityPolicy, 'maxFullscreenExits'>,
  exits: number,
): boolean {
  return policy.maxFullscreenExits !== null && exits > policy.maxFullscreenExits;
}
