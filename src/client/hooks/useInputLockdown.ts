import { useCallback, useEffect, useRef } from 'react';

/**
 * Discourages casual inspection of the practice surfaces (the signed-in app, the
 * full-screen lesson player, the live exam and the result/review screen): the
 * right-click menu and every common route to the developer tools, the page
 * source, "save page as" and print-to-PDF are swallowed.
 *
 * This is a deterrent for learners, not a security boundary — a determined
 * person can still open the browser menu, use a second device, or read the
 * network from a proxy. Real protection lives in the server's section policy,
 * tab lock and integrity log; this simply removes the obvious in-page shortcuts
 * so the exam conditions read clearly, and tells the learner that it was
 * deliberate rather than a broken click.
 *
 * Two details matter for the surfaces that embed it:
 *
 *   * `contextmenu` is only `preventDefault`ed, never stopped: the exam session
 *     still records `CONTEXT_MENU_ATTEMPT` on its own listener (see
 *     `useExamSession`), and a second, silent listener would cost us that event;
 *   * the blocked keys are matched exactly (modifiers included) from one table,
 *     `DEVTOOLS_SHORTCUTS`, which is exported so a unit test can pin it — a
 *     shortcut that is forgotten is a hole, and an over-broad match would break
 *     ordinary typing.
 */
export type BlockedKind = 'contextmenu' | 'shortcut';

/** What the learner was trying to do, for a one-line notice. */
export const BLOCKED_MESSAGE: Record<BlockedKind, string> = {
  contextmenu: 'Right-click is disabled here.',
  shortcut: 'Developer tools are disabled here.',
};

export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/**
 * The combinations refused on a locked surface.
 *
 * `ctrl` matches Ctrl on Windows/Linux **and** Command on macOS (the standard
 * "primary modifier"), which is why the two families below carry both the
 * Windows/Linux spellings and the Safari/⌘ ones. Anything not listed — plain
 * typing, Ctrl+C, Alt+F4, the browser's own menu — is left alone.
 */
export interface Shortcut {
  /** Lower-case `KeyboardEvent.key` value. */
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export const DEVTOOLS_SHORTCUTS: Shortcut[] = [
  { key: 'f12' }, // Chrome / Edge / Firefox on Windows & Linux
  // Windows & Linux: inspector, console, element picker, Firefox's console,
  // network panel and debugger.
  { key: 'i', ctrl: true, shift: true },
  { key: 'j', ctrl: true, shift: true },
  { key: 'c', ctrl: true, shift: true },
  { key: 'k', ctrl: true, shift: true },
  { key: 'e', ctrl: true, shift: true },
  { key: 's', ctrl: true, shift: true },
  // View source, save page, print (print-to-PDF is a way to take the paper away).
  { key: 'u', ctrl: true },
  { key: 's', ctrl: true },
  { key: 'p', ctrl: true },
  // macOS: Safari's Web Inspector and console are ⌘⌥I / ⌘⌥C, Chrome uses the
  // same family, and ⌘⌥U is Safari's "Show Page Source".
  { key: 'i', ctrl: true, alt: true },
  { key: 'j', ctrl: true, alt: true },
  { key: 'c', ctrl: true, alt: true },
  { key: 'u', ctrl: true, alt: true },
  { key: 'e', ctrl: true, alt: true },
];

/** Exact match, modifier for modifier: `i` alone must stay typeable. */
export function isBlockedShortcut(event: KeyLike): boolean {
  const key = event.key.toLowerCase();
  const primary = event.ctrlKey || event.metaKey;
  return DEVTOOLS_SHORTCUTS.some(
    (combo) =>
      combo.key === key &&
      Boolean(combo.ctrl) === primary &&
      Boolean(combo.shift) === event.shiftKey &&
      Boolean(combo.alt) === event.altKey,
  );
}

export interface LockdownOptions {
  /** Mount the deterrent at all. */
  enabled?: boolean;
  /** Refuse the developer-tool / view-source / print shortcuts. */
  keyboard?: boolean;
  /** Refuse the right-click menu. */
  contextMenu?: boolean;
  /**
   * Told (at most once every two seconds) that something was blocked, so the
   * surface can explain itself once instead of on every held key.
   */
  onBlocked?: (kind: BlockedKind) => void;
}

export function useInputLockdown(options: boolean | LockdownOptions = true) {
  const { enabled, keyboard, contextMenu, onBlocked } =
    typeof options === 'boolean'
      ? { enabled: options, keyboard: true, contextMenu: true, onBlocked: undefined }
      : { enabled: options.enabled ?? true, keyboard: options.keyboard ?? true, contextMenu: options.contextMenu ?? true, onBlocked: options.onBlocked };

  // The callback is read from a ref so a caller that passes an inline arrow
  // function (every caller does) does not re-attach the listeners each render.
  // The ref is synced in an effect, not during render, which is what React's
  // lint rules ask for; one paint of latency on the notice is imperceptible.
  const notify = useRef(onBlocked);
  useEffect(() => {
    notify.current = onBlocked;
  }, [onBlocked]);
  const lastNotice = useRef(0);
  const tell = useCallback((kind: BlockedKind) => {
    const listener = notify.current;
    if (!listener) return;
    const now = Date.now();
    if (now - lastNotice.current < 2000) return;
    lastNotice.current = now;
    listener(kind);
  }, []);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    const onKey = (event: KeyboardEvent) => {
      if (!keyboard || !isBlockedShortcut(event)) return;
      event.preventDefault();
      event.stopPropagation();
      tell('shortcut');
    };
    const onContextMenu = (event: MouseEvent) => {
      if (!contextMenu) return;
      // Not `stopPropagation`: the exam session's own listener records the
      // attempt as an integrity event and must still see it.
      event.preventDefault();
      tell('contextmenu');
    };

    document.addEventListener('keydown', onKey, true);
    document.addEventListener('contextmenu', onContextMenu, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('contextmenu', onContextMenu, true);
    };
  }, [enabled, keyboard, contextMenu, tell]);
}
