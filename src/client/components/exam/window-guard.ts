/**
 * Window and popup guard for the exam screen.
 *
 * Split deliberately: the *decisions* are pure functions of a plain object, so
 * a node test can cover them, and the *installer* is the only place that touches
 * `document`. The hook (`useExamWindowGuard`) owns mounting and React state.
 *
 * What it does, and what it honestly cannot do:
 * - fullscreen: requested on mount and then on the first interaction, because
 *   browsers only allow it from a user gesture; a refusal is recorded, not fatal.
 * - popups: `window.open` from the exam page is refused, and modifier-clicks /
 *   middle-clicks (which browsers turn into new tabs/windows) are swallowed.
 *   Ctrl+T and Ctrl+N belong to the browser and cannot be blocked from a page —
 *   the focus loss they cause is what the tab lock counts.
 * - translator/dictionary extensions: they inject a layer into our own document
 *   rather than opening a window, so nothing above stops them. Every element
 *   appended to `<body>`/`<html>` outside the app root is hidden and recorded.
 *   The document is also marked `translate="no"` with a `notranslate` meta, which
 *   is what Chrome's page translation and most "translate on hover" extensions
 *   respect. An in-exam dictionary remains available, because that one the
 *   institution controls.
 */

export interface MouseEventLike {
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  button: number;
}

/** Modifiers that make a click open a tab/window, plus the middle button. */
export function isPopupGesture(event: MouseEventLike): boolean {
  return event.button === 1 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey;
}

interface NodeLike {
  tagName?: string;
  id?: string;
  className?: unknown;
  getAttribute?: (name: string) => string | null;
  closest?: (selector: string) => unknown;
  matches?: (selector: string) => boolean;
}

/** Tag names that may legitimately sit directly under `<body>`/`<html>`. */
const ALLOWED_TAGS = new Set(['SCRIPT', 'LINK', 'STYLE', 'NOSCRIPT', 'META', 'TEMPLATE', 'TITLE']);

/** Our own body-level layers carry this (dialogs, portals, the app root). */
export const EXEMPT_ATTRIBUTE = 'data-exam-layer';

/**
 * Is this body-level element somebody else's (an extension's) rather than ours?
 *
 * The app root is exempt by id, our own portals by attribute, and the script/style
 * plumbing every page has. Anything else that appears while an exam is open is
 * treated as an injected overlay.
 */
export function isForeignBodyNode(node: NodeLike | null | undefined, rootId = 'root'): boolean {
  if (!node) return false;
  const tag = (node.tagName ?? '').toUpperCase();
  if (!tag || ALLOWED_TAGS.has(tag)) return false;
  if (node.matches?.(`#${rootId}, [${EXEMPT_ATTRIBUTE}], [${EXEMPT_ATTRIBUTE}] *`)) return false;
  if (node.id === rootId) return false;
  if (node.getAttribute?.(EXEMPT_ATTRIBUTE) !== null && node.getAttribute?.(EXEMPT_ATTRIBUTE) !== undefined) return false;
  return true;
}

/** A short, stable description of an injected node for the teacher's log. */
export function describeOverlayNode(node: NodeLike): string {
  const tag = (node.tagName ?? 'unknown').toLowerCase();
  const id = node.id ? `#${node.id}` : '';
  const className = typeof node.className === 'string' && node.className.trim()
    ? `.${node.className.trim().split(/\s+/).slice(0, 2).join('.')}`
    : '';
  const role = node.getAttribute?.('role') ? `[role=${node.getAttribute('role')}]` : '';
  return `${tag}${id}${className}${role}`.slice(0, 120);
}

export interface WindowGuardOptions {
  blockPopups: boolean;
  blockTranslatorOverlays: boolean;
  autoFullscreen: boolean;
  /** Called for every blocked/refused action; `type` matches the integrity vocabulary. */
  onEvent: (type: 'POPUP_BLOCKED' | 'EXTENSION_OVERLAY', detail?: Record<string, unknown>) => void;
  /** Fires whenever fullscreen is (re)entered by the guard, so the UI can clear its lock. */
  onFullscreenEnter?: () => void;
  /** Fires when this browser will not grant fullscreen at all (iOS Safari, for example). */
  onFullscreenDenied?: () => void;
  rootId?: string;
}

/** Requests fullscreen on the document; resolves false when the browser refuses. */
export async function requestExamFullscreen(): Promise<boolean> {
  if (typeof document === 'undefined') return false;
  if (document.fullscreenElement) return true;
  const element = document.documentElement as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void> | void;
  };
  // Safari's legacy API returns nothing to await and fills `webkitFullscreenElement`
  // only with the change event, so a call that did not throw is the answer there.
  const legacy = !element.requestFullscreen && Boolean(element.webkitRequestFullscreen);
  try {
    if (element.requestFullscreen) {
      await element.requestFullscreen({ navigationUI: 'hide' } as FullscreenOptions);
    } else if (element.webkitRequestFullscreen) {
      await element.webkitRequestFullscreen();
    } else {
      return false;
    }
    if (legacy) return true;
    return Boolean(document.fullscreenElement ?? (document as Document & { webkitFullscreenElement?: unknown }).webkitFullscreenElement);
  } catch {
    return false;
  }
}

/** Installs every listener the guard needs and returns one cleanup function. */
export function installWindowGuard(options: WindowGuardOptions): () => void {
  if (typeof document === 'undefined') return () => undefined;
  const { blockPopups, blockTranslatorOverlays, autoFullscreen, onEvent } = options;
  const rootId = options.rootId ?? 'root';
  const cleanups: Array<() => void> = [];

  // Lets the stylesheet drop affordances that the guard would refuse anyway (for
  // example the "open the audio file in a new tab" recovery link).
  document.documentElement.classList.add('exam-window-lock');
  cleanups.push(() => document.documentElement.classList.remove('exam-window-lock'));

  // --- popups: refuse anything that would leave this window ------------------
  if (blockPopups) {
    const nativeOpen = window.open.bind(window);
    window.open = function blockedOpen(...args: Parameters<typeof window.open>) {
      onEvent('POPUP_BLOCKED', { via: 'window.open', url: typeof args[0] === 'string' ? args[0].slice(0, 200) : '' });
      return null;
    } as typeof window.open;
    cleanups.push(() => {
      window.open = nativeOpen;
    });

    const onClickCapture = (event: MouseEvent) => {
      const target = event.target as Element | null;
      const anchor = target?.closest?.('a[href], [target]') as HTMLAnchorElement | null;
      const wantsBlank = Boolean(anchor?.target?.toLowerCase().includes('_blank'));
      // Plain left-clicks inside the app must keep working; only gestures that a
      // browser turns into a new tab/window, and links that ask for one, are stopped.
      if (!isPopupGesture(event) && !wantsBlank) return;
      event.preventDefault();
      event.stopPropagation();
      onEvent('POPUP_BLOCKED', {
        via: event.button === 1 ? 'middle-click' : 'modifier-click',
        href: anchor?.href ? anchor.href.slice(0, 200) : '',
      });
    };
    document.addEventListener('click', onClickCapture, true);
    cleanups.push(() => document.removeEventListener('click', onClickCapture, true));
  }

  // --- translator / dictionary overlays injected into our own document --------
  if (blockTranslatorOverlays) {
    const html = document.documentElement;
    const previousTranslate = html.getAttribute('translate');
    html.setAttribute('translate', 'no');
    let meta = document.querySelector<HTMLMetaElement>('meta[name="google"]');
    const createdMeta = !meta;
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'google');
      document.head.appendChild(meta);
    }
    const previousContent = meta.getAttribute('content');
    meta.setAttribute('content', `${previousContent ? `${previousContent},` : ''}notranslate`);

    const styleId = 'exam-overlay-block';
    let blockStyle = document.getElementById(styleId) as HTMLStyleElement | null;
    if (!blockStyle) {
      blockStyle = document.createElement('style');
      blockStyle.id = styleId;
      blockStyle.textContent = '[data-exam-blocked]{display:none !important;pointer-events:none !important;}';
      document.head.appendChild(blockStyle);
    }

    const hide = (node: Element) => {
      node.setAttribute('data-exam-blocked', '');
      (node as HTMLElement).style.setProperty('display', 'none', 'important');
    };

    const scan = () => {
      for (const candidate of Array.from(document.body.children)) {
        if (candidate.hasAttribute('data-exam-blocked')) continue;
        if (!isForeignBodyNode(candidate as NodeLike, rootId)) continue;
        hide(candidate);
        onEvent('EXTENSION_OVERLAY', { node: describeOverlayNode(candidate as NodeLike) });
      }
    };
    // Extensions are often already there before the exam mounts.
    scan();

    const observer = new MutationObserver((records) => {
      let foreign = false;
      for (const record of records) {
        for (const added of Array.from(record.addedNodes)) {
          if (added.nodeType !== 1) continue;
          if (!isForeignBodyNode(added as NodeLike, rootId)) continue;
          hide(added as Element);
          onEvent('EXTENSION_OVERLAY', { node: describeOverlayNode(added as NodeLike) });
          foreign = true;
        }
      }
      if (foreign) return;
      // Attribute-only mutations (an extension showing a hidden container) are
      // cheap to re-check and catch the "create it first, show it later" pattern.
      scan();
    });
    observer.observe(document.body, { childList: true, subtree: false, attributes: true, attributeFilter: ['style', 'hidden', 'class'] });
    observer.observe(html, { childList: true });
    cleanups.push(() => observer.disconnect());
    cleanups.push(() => {
      if (createdMeta) meta?.remove();
      else if (previousContent === null) meta?.removeAttribute('content');
      else if (previousContent) meta?.setAttribute('content', previousContent);
      if (previousTranslate === null) html.removeAttribute('translate');
      else html.setAttribute('translate', previousTranslate);
    });
  }

  // --- fullscreen: try now, then again on the first gesture ------------------
  if (autoFullscreen) {
    let settled = false;
    let failures = 0;
    const gestureTypes = ['pointerdown', 'keydown', 'touchstart'] as const;
    const onGesture = () => void enter();
    const teardownGesture = () => {
      for (const type of gestureTypes) document.removeEventListener(type, onGesture, true);
    };
    async function enter(): Promise<void> {
      if (settled) return;
      const granted = await requestExamFullscreen();
      if (granted) {
        settled = true;
        options.onFullscreenEnter?.();
        teardownGesture();
        return;
      }
      // Some browsers never allow it (iOS Safari has no element fullscreen). Give
      // up after a few tries instead of firing a rejected request on every tap —
      // and say so, because a lock built on fullscreen must not be used there.
      failures += 1;
      if (failures >= 3) {
        teardownGesture();
        options.onFullscreenDenied?.();
      }
    }
    // Works when the click that started the attempt is still the active gesture
    // (same-document navigation keeps the user activation alive).
    void enter();
    if (!settled) {
      for (const type of gestureTypes) document.addEventListener(type, onGesture, { capture: true, once: false });
      cleanups.push(teardownGesture);
    }
  }

  return () => {
    for (const cleanup of cleanups.reverse()) cleanup();
  };
}
