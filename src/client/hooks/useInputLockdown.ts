import { useEffect } from 'react';

/**
 * Locks the input surface of a secure screen: the live exam, the result/review
 * screen, and a lesson in progress.
 *
 * WHAT IT DOES, and why the old version was not enough.
 *
 * The first version listened to `keydown` and `contextmenu` only. That leaves
 * three real holes:
 *
 *   1. **keyup.** Firefox and some Chromium builds fire the default action of a
 *      shortcut on the *up* stroke for a few key combinations, so swallowing
 *      `keydown` alone still opened the inspector. Both strokes are now taken.
 *   2. **selection and drag.** With the right-click menu gone, `Ctrl+C`, a
 *      drag-to-copy and long-press-to-select on a phone all still worked. The
 *      exam already reports copy attempts (`useExamSession`); this stops the
 *      ones that never produce a `copy` event — `selectstart`, `dragstart`, and
 *      the browser's own image drag.
 *   3. **detection.** Nothing noticed the inspector actually *opening*. Blocking
 *      a shortcut is worthless against the menu item, the browser's own DevTools
 *      button, or a detached window. So the hook now measures whether a debugger
 *      is attached and covers the page until it is not.
 *
 * HOW DETECTION WORKS. Two independent signals, either of which is enough:
 *
 *   - a `debugger` statement on a timer. With no inspector attached it is a
 *     no-op that costs microseconds; with one attached it *suspends the page*,
 *     and the gap between the two `performance.now()` calls jumps to however
 *     long the person took to press continue. A 160 ms threshold is far above
 *     any ordinary timer jitter and far below any human reaction.
 *   - the outer/inner window gap. A docked inspector makes the viewport smaller
 *     than the window by a few hundred pixels. This signal is only trusted at
 *     the top level: inside an iframe `outerWidth` belongs to the *browser*,
 *     while `innerWidth` is the frame, so the difference is meaningless and
 *     would fire on every embedded preview.
 *
 * Both are skipped when `navigator.webdriver` is set, so an automated browser
 * (which is attached to a debugging protocol by definition) is never veiled.
 *
 * HONEST LIMITATION. This is a deterrent, not a boundary — the same content is
 * still on the network, and no web page can stop a person opening the site in
 * another profile or screenshotting it. The authoritative protection is on the
 * server: the tab lock, the integrity log, and the frozen question version. What
 * this removes is the casual in-page route, and it says so plainly on screen
 * rather than pretending to be absolute.
 */

/** Keys that open an inspector or reveal the source, whatever the modifier set. */
const DEVTOOLS_KEYS = new Set(['F12']);
const SHIFT_MODIFIER_KEYS = new Set(['I', 'J', 'C', 'K']);
const PLAIN_MODIFIER_KEYS = new Set(['U', 'S', 'P']); // view-source, save, print

/** How long a `debugger` statement may take before we call it a suspension. */
const SUSPEND_THRESHOLD_MS = 160;
/** How often the timer probe runs. Slow enough to be invisible, fast enough to matter. */
const PROBE_INTERVAL_MS = 1400;
/** A docked inspector takes at least this much off the viewport in either axis. */
const VIEWPORT_GAP_PX = 190;

export interface InputLockdownOptions {
  /** Swallow the inspector / view-source shortcuts on both key strokes. Default true. */
  blockKeys?: boolean;
  /** Swallow the right-click menu. Default true. */
  blockContextMenu?: boolean;
  /** Swallow selection, copy-by-drag and the browser's image drag. Default true. */
  blockSelection?: boolean;
  /** Measure whether a debugger is attached and cover the page while it is. Default true. */
  detectInspector?: boolean;
  /** Called when the detection verdict changes, so the caller can log an integrity event. */
  onInspectorChange?: (open: boolean) => void;
}

export type InputLockdownConfig = boolean | InputLockdownOptions;

function configOf(value: InputLockdownConfig): Required<Omit<InputLockdownOptions, 'onInspectorChange'>> & InputLockdownOptions {
  if (typeof value === 'boolean') {
    return { blockKeys: value, blockContextMenu: value, blockSelection: value, detectInspector: value };
  }
  return {
    blockKeys: value.blockKeys ?? true,
    blockContextMenu: value.blockContextMenu ?? true,
    blockSelection: value.blockSelection ?? true,
    detectInspector: value.detectInspector ?? true,
    ...value,
  };
}

function isDevtoolsShortcut(event: KeyboardEvent): boolean {
  const key = event.key?.toUpperCase?.() ?? '';
  if (DEVTOOLS_KEYS.has(key)) return true;
  const modifier = event.ctrlKey || event.metaKey;
  if (!modifier) return false;
  if (event.shiftKey && SHIFT_MODIFIER_KEYS.has(key)) return true;
  if (!event.shiftKey && PLAIN_MODIFIER_KEYS.has(key)) return true;
  // Ctrl+Shift+I with a dead key still reports `key === 'Dead'` on some layouts.
  return event.shiftKey && key === 'DEAD';
}

/** The blocking veil, built once and reused. Imperative on purpose: it has to
 *  sit above every React root, including a portal, and it has to appear even if
 *  the component that asked for it is mid-render. */
function mountVeil(): HTMLDivElement {
  const existing = document.getElementById('inspector-veil');
  if (existing instanceof HTMLDivElement) return existing;
  existing?.remove(); // something else took the id: replace it rather than trust it

  const veil = document.createElement('div');
  veil.id = 'inspector-veil';
  veil.className = 'inspector-veil';
  veil.setAttribute('role', 'alertdialog');
  veil.setAttribute('aria-modal', 'true');
  veil.setAttribute('aria-labelledby', 'inspector-veil-title');
  veil.innerHTML = `
    <div class="inspector-veil__card">
      <span class="inspector-veil__mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M8 6 3 12l5 6" /><path d="m16 6 5 6-5 6" /><path d="m13 4-2 16" />
        </svg>
      </span>
      <h2 id="inspector-veil-title">Developer tools are open</h2>
      <p>
        This screen is locked while an inspector is attached to the page. Close the developer tools panel
        &mdash; press <kbd>Esc</kbd> inside it, or the <kbd>&times;</kbd> in its corner &mdash; and the exam
        continues where you left it. Your answers and your timer are untouched.
      </p>
      <p class="inspector-veil__aside">
        Nothing on this page is secret: the questions are the ones you can already see. The lock exists so that
        exam conditions read the same for everybody, and the attempt is recorded either way.
      </p>
      <p class="inspector-veil__status">Waiting for the inspector to close&hellip;</p>
    </div>`;
  document.body.appendChild(veil);
  return veil;
}

export function useInputLockdown(config: InputLockdownConfig = true): void {
  const options = configOf(config);
  const { blockKeys, blockContextMenu, blockSelection, detectInspector } = options;
  // Kept out of the effect's dependency list on purpose: the caller usually
  // passes an inline arrow, and re-arming the whole lockdown on every render
  // would create gaps in coverage.
  const onInspectorChange = options.onInspectorChange;

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const swallow = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
    };

    const listeners: Array<[EventTarget, string, EventListenerOrEventListenerObject]> = [];
    const add = (target: EventTarget, type: string, handler: EventListener, capture = true) => {
      target.addEventListener(type, handler, capture);
      listeners.push([target, type, handler]);
    };

    if (blockKeys) {
      const onKey = (event: Event) => {
        if (isDevtoolsShortcut(event as KeyboardEvent)) swallow(event);
      };
      // Both strokes: some builds act on keyup for a few combinations.
      add(window, 'keydown', onKey);
      add(window, 'keyup', onKey);
      add(window, 'keypress', onKey);
    }

    if (blockContextMenu) {
      add(window, 'contextmenu', swallow);
    }

    if (blockSelection) {
      // Text the candidate typed themselves stays selectable — blocking that
      // would make the Writing tasks unusable. Everything else is off limits.
      const editable = (node: EventTarget | null): boolean => {
        const element = node as HTMLElement | null;
        if (!element || typeof element.isContentEditable === 'undefined') return false;
        if (element.isContentEditable) return true;
        const tag = element.tagName;
        return tag === 'TEXTAREA' || (tag === 'INPUT' && (element as HTMLInputElement).type !== 'hidden');
      };
      add(document, 'selectstart', (event) => {
        if (!editable(event.target)) swallow(event);
      });
      add(document, 'dragstart', (event) => {
        if (!editable(event.target)) swallow(event);
      });
      // Images cannot be dragged out, and cannot be long-pressed on a phone.
      add(document, 'dragstart', (event) => {
        if ((event.target as HTMLElement | null)?.tagName === 'IMG') swallow(event);
      });
      document.documentElement.classList.add('lockdown-selection');
    }

    // ------------------------------------------------------- inspector probe
    let veil: HTMLDivElement | null = null;
    let timer = 0;
    let verdict = false;

    const automated = (): boolean => (navigator as Navigator & { webdriver?: boolean }).webdriver === true;
    /** True when the window is noticeably smaller than the frame around it. */
    const gapSaysOpen = (): boolean => {
      if (window.self !== window.top) return false; // iframes cannot be measured this way
      const { outerWidth, outerHeight, innerWidth, innerHeight } = window;
      if (!outerWidth || !outerHeight) return false; // some builds report 0
      return outerWidth - innerWidth > VIEWPORT_GAP_PX || outerHeight - innerHeight > VIEWPORT_GAP_PX;
    };
    /** True when a `debugger` statement took long enough to have been paused. */
    const probeSaysOpen = (): boolean => {
      if (automated()) return false;
      const started = performance.now();
      // eslint-disable-next-line no-debugger
      debugger;
      return performance.now() - started > SUSPEND_THRESHOLD_MS;
    };

    const setVerdict = (open: boolean) => {
      if (open === verdict) return;
      verdict = open;
      document.documentElement.classList.toggle('inspector-open', open);
      if (open) {
        veil = mountVeil();
        veil.hidden = false;
      } else if (veil) {
        veil.hidden = true;
        veil.remove();
        veil = null;
      }
      onInspectorChange?.(open);
    };

    if (detectInspector && !automated()) {
      const check = () => {
        // Size first: it is free. The probe costs a suspended frame when the
        // inspector really is open, which is the point, but should not run on
        // every check when we already know.
        setVerdict(verdict ? probeSaysOpen() || gapSaysOpen() : gapSaysOpen() || probeSaysOpen());
      };
      check();
      timer = window.setInterval(check, PROBE_INTERVAL_MS);
      add(window, 'resize', check);
      add(window, 'blur', () => window.setTimeout(check, 400));
      add(window, 'focus', () => window.setTimeout(check, 400));
      add(document, 'visibilitychange', () => window.setTimeout(check, 400));
    }

    return () => {
      for (const [target, type, handler] of listeners) target.removeEventListener(type, handler, true);
      if (timer) window.clearInterval(timer);
      if (blockSelection) document.documentElement.classList.remove('lockdown-selection');
      if (veil) {
        veil.remove();
        veil = null;
      }
      document.documentElement.classList.remove('inspector-open');
    };
    // `onInspectorChange` is deliberately excluded: see the note above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockKeys, blockContextMenu, blockSelection, detectInspector]);
}
