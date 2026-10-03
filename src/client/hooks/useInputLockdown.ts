import { useEffect } from 'react';

/**
 * Discourages casual inspection on the secure surfaces (the live exam and the
 * result/review screen): the right-click menu and the common open-devtools /
 * view-source shortcuts are swallowed.
 *
 * This is a deterrent for learners, not a security boundary — a determined
 * person can always open the site in another window. Real protection lives in
 * the server's tab-lock and integrity events; this simply removes the obvious
 * in-page shortcuts so the exam conditions read clearly.
 */
export function useInputLockdown(enabled = true) {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    const isBlocked = (event: KeyboardEvent): boolean => {
      const key = event.key.toUpperCase();
      if (event.key === 'F12') return true;
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.shiftKey && ['I', 'J', 'C', 'K'].includes(key)) return true;
      if (mod && ['U', 'S', 'P'].includes(key)) return true; // view-source / save / print
      return false;
    };

    const onKey = (event: KeyboardEvent) => {
      if (isBlocked(event)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const onContextMenu = (event: MouseEvent) => event.preventDefault();

    window.addEventListener('keydown', onKey, true);
    window.addEventListener('contextmenu', onContextMenu, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('contextmenu', onContextMenu, true);
    };
  }, [enabled]);
}
