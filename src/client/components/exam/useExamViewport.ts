import { useEffect } from 'react';

/**
 * Pins the exam to the visible viewport while it is mounted.
 *
 * The exam is a fixed-height app: only its panes scroll. Before this, nothing
 * stopped the *document* from scrolling, and the page could grow far beyond the
 * viewport (hidden radio inputs escaped their pane), so a click or a focus
 * scrolled the whole page away and left a blank screen — "cuộn xuống vô tận".
 *
 * - `exam-active` on <html>/<body> removes document scrolling (see exam.css);
 * - `--exam-vh` / `--exam-top` follow the *visual* viewport, which on a phone
 *   shrinks when the on-screen keyboard opens, so the answer box never ends up
 *   behind the keyboard and the chrome never floats off-screen;
 * - any stray document scroll (iOS scrolls the page to reveal a focused field)
 *   is undone.
 */
export function useExamViewportLock(): void {
  useEffect(() => {
    const html = document.documentElement;
    const viewport = window.visualViewport;

    const sync = () => {
      html.style.setProperty('--exam-vh', `${Math.round(viewport?.height ?? window.innerHeight)}px`);
      html.style.setProperty('--exam-top', `${Math.round(viewport?.offsetTop ?? 0)}px`);
      if (window.scrollX !== 0 || window.scrollY !== 0) window.scrollTo(0, 0);
    };

    html.classList.add('exam-active');
    document.body.classList.add('exam-active');
    sync();

    viewport?.addEventListener('resize', sync);
    viewport?.addEventListener('scroll', sync);
    window.addEventListener('resize', sync);
    window.addEventListener('orientationchange', sync);
    window.addEventListener('scroll', sync, { passive: true });

    return () => {
      viewport?.removeEventListener('resize', sync);
      viewport?.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
      window.removeEventListener('orientationchange', sync);
      window.removeEventListener('scroll', sync);
      html.classList.remove('exam-active');
      document.body.classList.remove('exam-active');
      html.style.removeProperty('--exam-vh');
      html.style.removeProperty('--exam-top');
    };
  }, []);
}
