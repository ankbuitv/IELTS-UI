import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fullscreenLimitReached, type IntegrityEventType, type IntegrityPolicy } from '@shared/integrity';
import { installWindowGuard, requestExamFullscreen } from './window-guard';

export interface WindowGuardApi {
  /** True while the paper is covered because fullscreen was left. */
  needsFullscreen: boolean;
  /** The guard is running (an exam mode asked for at least one of its features). */
  engaged: boolean;
  /** Fullscreen is currently granted by the browser. */
  isFullscreen: boolean;
  /** Fullscreen was held at some point in this sitting — the lock and its banner build on this. */
  everFullscreen: boolean;
  /** The browser refused fullscreen here, so locking the paper would be unfair. */
  fullscreenUnavailable: boolean;
  popupsBlocked: number;
  overlaysSuppressed: number;
  /** The teacher's fullscreen allowance for this mode is used up. */
  allowanceUsed: boolean;
  enterFullscreen: () => Promise<boolean>;
  continueWithoutFullscreen: () => void;
}

/**
 * React wrapper around `installWindowGuard`: owns the mount lifetime, mirrors
 * fullscreen state, and decides when the paper is covered.
 *
 * The lock is released by re-entering fullscreen, and can be declined once —
 * a browser or OS that refuses fullscreen must not be able to freeze an attempt.
 * A declined lock comes back the next time fullscreen is left.
 */
export function useExamWindowGuard(options: {
  policy: IntegrityPolicy | null;
  active: boolean;
  fullscreenExits: number;
  logIntegrity: (type: IntegrityEventType, metadata?: Record<string, unknown>) => void;
}): WindowGuardApi {
  const { policy, active, fullscreenExits, logIntegrity } = options;
  // The guard is installed once per flag change, so it holds the logger in a ref
  // rather than re-installing every time the callback identity moves.
  const logRef = useRef(logIntegrity);
  useEffect(() => {
    logRef.current = logIntegrity;
  });

  const flags = useMemo(
    () => ({
      autoFullscreen: Boolean(policy?.autoFullscreen),
      lockOnExit: Boolean(policy?.lockOnFullscreenExit),
      blockPopups: Boolean(policy?.blockPopups),
      blockOverlays: Boolean(policy?.blockTranslatorOverlays),
    }),
    [policy?.autoFullscreen, policy?.lockOnFullscreenExit, policy?.blockPopups, policy?.blockTranslatorOverlays],
  );
  const engaged = active && Object.values(flags).some(Boolean);

  const [isFullscreen, setIsFullscreen] = useState(() => Boolean(document.fullscreenElement));
  /**
   * Fullscreen was held at some point in this sitting. The lock is only ever
   * shown after that: on a device where the browser never grants fullscreen, the
   * paper must simply stay readable.
   */
  const [everFullscreen, setEverFullscreen] = useState(() => Boolean(document.fullscreenElement));
  const [refused, setRefused] = useState(0);
  const [deniedByBrowser, setDeniedByBrowser] = useState(false);
  const [declined, setDeclined] = useState(false);
  const [popupsBlocked, setPopupsBlocked] = useState(0);
  const [overlaysSuppressed, setOverlaysSuppressed] = useState(0);

  const onEvent = useCallback((type: 'POPUP_BLOCKED' | 'EXTENSION_OVERLAY', detail?: Record<string, unknown>) => {
    logRef.current(type, detail);
    if (type === 'POPUP_BLOCKED') setPopupsBlocked((value) => value + 1);
    else setOverlaysSuppressed((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!engaged) return undefined;
    return installWindowGuard({
      blockPopups: flags.blockPopups,
      blockTranslatorOverlays: flags.blockOverlays,
      autoFullscreen: flags.autoFullscreen,
      onEvent,
      onFullscreenEnter: () => {
        setIsFullscreen(true);
        setEverFullscreen(true);
        setDeclined(false);
        // A later grant means this browser can do fullscreen after all.
        setDeniedByBrowser(false);
      },
      onFullscreenDenied: () => setDeniedByBrowser(true),
    });
  }, [engaged, flags.autoFullscreen, flags.blockPopups, flags.blockOverlays, onEvent]);

  useEffect(() => {
    const onChange = () => {
      const granted = Boolean(document.fullscreenElement);
      setIsFullscreen(granted);
      if (granted) {
        setEverFullscreen(true);
        setDeclined(false);
        setDeniedByBrowser(false);
        setRefused(0);
      }
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const enterFullscreen = useCallback(async () => {
    const granted = await requestExamFullscreen();
    setIsFullscreen(granted);
    if (granted) {
      setEverFullscreen(true);
      setDeclined(false);
      setDeniedByBrowser(false);
      setRefused(0);
    } else {
      setRefused((value) => value + 1);
    }
    return granted;
  }, []);

  const continueWithoutFullscreen = useCallback(() => {
    setDeclined(true);
    // Record the refusal as another exit: the teacher sees the candidate chose to
    // sit the test outside fullscreen rather than silently ignoring the lock.
    logRef.current('FULLSCREEN_EXIT', { reason: 'declined-lock' });
  }, []);

  const fullscreenUnavailable = deniedByBrowser || (refused >= 2 && !isFullscreen);
  const needsFullscreen =
    engaged && flags.lockOnExit && everFullscreen && !isFullscreen && !declined && !fullscreenUnavailable;

  return {
    needsFullscreen,
    engaged,
    isFullscreen,
    everFullscreen,
    fullscreenUnavailable,
    popupsBlocked,
    overlaysSuppressed,
    allowanceUsed: policy ? fullscreenLimitReached(policy, fullscreenExits) : false,
    enterFullscreen,
    continueWithoutFullscreen,
  };
}
