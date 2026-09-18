import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiRequestError, describeError } from '../../lib/api';
import type { CandidateResponse } from '@shared/answer-key';
import type { IntegrityEventType } from '@shared/integrity';
import type { CandidateTestPayload } from '@shared/candidate';

export interface AttemptComponentState {
  componentIndex: number;
  sessionId: string;
  skill: 'READING' | 'LISTENING' | 'WRITING';
  label: string;
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'SUBMITTED' | 'EXPIRED';
  testVersionId: string;
  durationSeconds: number | null;
  breakAfterSeconds: number;
  startedAt: string | null;
  deadlineAt: string | null;
  remainingSeconds: number | null;
}

export interface AttemptState {
  attemptId: string;
  testId: string;
  testTitle: string;
  testType: 'READING' | 'LISTENING' | 'WRITING' | 'FULL_MOCK';
  testVersionId: string;
  versionNumber: number;
  mode: 'PRACTICE' | 'STANDARD_EXAM' | 'STRICT_EXAM';
  status: 'IN_PROGRESS' | 'SUBMITTED' | 'EXPIRED' | 'ABANDONED';
  assignmentId: string | null;
  startedAt: string;
  serverNow: string;
  remainingSeconds: number | null;
  time: {
    serverNow: string;
    attemptDeadline: string | null;
    attemptRemainingSeconds: number | null;
    activeSessionId: string | null;
    sessionRemainingSeconds: number | null;
    sessionDeadline: string | null;
    autoSubmitted: boolean;
  };
  components: AttemptComponentState[];
  activeComponentIndex: number;
  content: CandidateTestPayload | null;
  answers: Record<string, CandidateResponse>;
  flagged: string[];
  answeredCount: number;
  totalQuestions: number;
  writing: Array<{ questionId: string; text: string; wordCount: number }>;
  integrity: {
    policy: import('@shared/integrity').IntegrityPolicy;
    counted: number;
    tabAway: number;
    fullscreenExits: number;
    warningLevel: 'NONE' | 'WARNING' | 'CRITICAL';
    notice: string;
  };
  submitted: boolean;
}

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'offline';

interface PendingUpdate {
  response: CandidateResponse | null;
  flagged: boolean;
}

export interface ExamSessionApi {
  state: AttemptState | null;
  loading: boolean;
  error: string | null;
  saveStatus: SaveStatus;
  lastSavedAt: string | null;
  remainingSeconds: number | null;
  sessionRemainingSeconds: number | null;
  connection: 'online' | 'offline';
  warning: string | null;
  dismissWarning: () => void;
  setAnswer: (questionId: string, response: CandidateResponse | null) => void;
  toggleFlag: (questionId: string) => void;
  saveWriting: (questionId: string, text: string) => void;
  submit: (options?: { confirmUnanswered?: boolean }) => Promise<void>;
  advanceComponent: () => Promise<void>;
  reload: () => Promise<void>;
  setWarning: (message: string | null) => void;
  logIntegrity: (type: IntegrityEventType, metadata?: Record<string, unknown>) => void;
  requestFullscreen: () => Promise<void>;
  isFullscreen: boolean;
}

/**
 * Client-side exam session.
 *
 * The timer shown here is DISPLAY ONLY. Every authoritative value (deadline,
 * remaining time, submission state) comes from the Worker: `remainingSeconds`
 * is recomputed from server timestamps on every refresh and every poll, so
 * reloading the page or changing the system clock grants no extra time.
 */
export function useExamSession(attemptId: string): ExamSessionApi {
  const [state, setState] = useState<AttemptState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [connection, setConnection] = useState<'online' | 'offline'>(navigator.onLine ? 'online' : 'offline');
  const [isFullscreen, setIsFullscreen] = useState(Boolean(document.fullscreenElement));

  const pending = useRef<Map<string, PendingUpdate>>(new Map());
  const writingTimers = useRef<Map<string, number>>(new Map());
  const integrityQueue = useRef<Array<{ type: IntegrityEventType; metadata?: Record<string, unknown> }>>([]);
  const [clockOffsetMs, setClockOffsetMs] = useState(0);
  const [nowMs, setNowMs] = useState<number | null>(null);

  // ------------------------------------------------------------------ load
  const load = useCallback(async () => {
    try {
      const next = await api.get<AttemptState>(`/api/attempts/${attemptId}`);
      setClockOffsetMs(Date.parse(next.serverNow) - Date.now());
      setNowMs(Date.now());
      setState(next);
      setError(null);
    } catch (loadError) {
      setError(describeError(loadError));
    } finally {
      setLoading(false);
    }
  }, [attemptId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Periodic resync with the server (keeps the displayed clock honest and
  // picks up policy-driven auto-submission).
  useEffect(() => {
    const interval = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(interval);
  }, [load]);

  // Local 1s tick for the displayed countdown. Keeping `now` in state means
  // the render pass itself stays pure.
  useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  // ------------------------------------------------------------- integrity
  const flushIntegrity = useCallback(async () => {
    if (integrityQueue.current.length === 0) return;
    const batch = integrityQueue.current.splice(0, integrityQueue.current.length);
    try {
      const result = await api.post<{ warningLevel: 'NONE' | 'WARNING' | 'CRITICAL'; autoSubmitted: boolean }>(
        `/api/attempts/${attemptId}/integrity`,
        { events: batch.map((event) => ({ type: event.type, occurredAt: new Date().toISOString(), metadata: event.metadata ?? {} })) },
      );
      if (result.warningLevel === 'CRITICAL') {
        setWarning('Integrity policy threshold reached. This attempt is being submitted automatically.');
      }
      if (result.autoSubmitted) void load();
    } catch {
      // Re-queue on failure so nothing is silently dropped.
      integrityQueue.current.unshift(...batch);
    }
  }, [attemptId, load]);

  const logIntegrity = useCallback(
    (type: IntegrityEventType, metadata?: Record<string, unknown>) => {
      integrityQueue.current.push({ type, ...(metadata ? { metadata } : {}) });
      if (type === 'TAB_HIDDEN' || type === 'FULLSCREEN_EXIT' || type === 'COPY_ATTEMPT' || type === 'PASTE_ATTEMPT') {
        void flushIntegrity();
      }
    },
    [flushIntegrity],
  );

  useEffect(() => {
    const interval = window.setInterval(() => void flushIntegrity(), 8000);
    return () => window.clearInterval(interval);
  }, [flushIntegrity]);

  useEffect(() => {
    if (!state || state.submitted) return;
    const policy = state.integrity.policy;
    const cleanup: Array<() => void> = [];

    // Reload detection: a marker in sessionStorage means this page was visited
    // before within the same tab session.
    const marker = `exam-visited:${attemptId}`;
    if (window.sessionStorage.getItem(marker)) {
      logIntegrity('RELOAD');
      logIntegrity('SESSION_RESUME');
    } else {
      window.sessionStorage.setItem(marker, String(Date.now()));
    }

    if (policy.monitorVisibility) {
      const onVisibility = () => {
        if (document.hidden) {
          logIntegrity('TAB_HIDDEN', { visibilityState: document.visibilityState });
          if (policy.warnAtEvents !== null) {
            setWarning(
              'The exam page is no longer visible. This has been recorded. A web page cannot block Alt+Tab or other application switching.',
            );
          }
        } else {
          logIntegrity('SESSION_RESUME');
        }
      };
      const onBlur = () => logIntegrity('WINDOW_BLUR');
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('blur', onBlur);
      cleanup.push(() => document.removeEventListener('visibilitychange', onVisibility));
      cleanup.push(() => window.removeEventListener('blur', onBlur));
    }

    const onFullscreenChange = () => {
      const active = Boolean(document.fullscreenElement);
      setIsFullscreen(active);
      if (!active && policy.requireFullscreen) {
        logIntegrity('FULLSCREEN_EXIT');
        setWarning('Fullscreen was exited. Re-enter fullscreen to continue in this exam mode.');
      } else if (!active) {
        logIntegrity('FULLSCREEN_EXIT');
      }
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    cleanup.push(() => document.removeEventListener('fullscreenchange', onFullscreenChange));

    if (!policy.allowCopy) {
      const onCopy = (event: Event) => {
        event.preventDefault();
        logIntegrity('COPY_ATTEMPT');
        setWarning('Copying is disabled during this attempt.');
      };
      document.addEventListener('copy', onCopy);
      cleanup.push(() => document.removeEventListener('copy', onCopy));
    }

    if (!policy.allowPaste) {
      const onPaste = (event: Event) => {
        const target = event.target as HTMLElement | null;
        if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) {
          // Writing sections must remain usable; paste is recorded not blocked there.
          logIntegrity('PASTE_ATTEMPT', { target: target.tagName });
          return;
        }
        event.preventDefault();
        logIntegrity('PASTE_ATTEMPT');
      };
      document.addEventListener('paste', onPaste);
      cleanup.push(() => document.removeEventListener('paste', onPaste));
    }

    if (!policy.allowContextMenu) {
      const onContextMenu = (event: Event) => {
        event.preventDefault();
        logIntegrity('CONTEXT_MENU_ATTEMPT');
      };
      document.addEventListener('contextmenu', onContextMenu);
      cleanup.push(() => document.removeEventListener('contextmenu', onContextMenu));
    }

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (pending.current.size > 0) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    cleanup.push(() => window.removeEventListener('beforeunload', onBeforeUnload));

    const onPopState = () => {
      logIntegrity('NAVIGATION_ATTEMPT');
      logIntegrity('PAGE_LEAVE_ATTEMPT', { via: 'history-back' });
    };
    window.addEventListener('popstate', onPopState);
    cleanup.push(() => window.removeEventListener('popstate', onPopState));

    return () => cleanup.forEach((fn) => fn());
  }, [state, attemptId, logIntegrity]);

  // Connectivity monitoring.
  useEffect(() => {
    const onOffline = () => {
      setConnection('offline');
      logIntegrity('CONNECTION_INTERRUPTION', { reason: 'browser-offline' });
      setSaveStatus('offline');
    };
    const onOnline = () => {
      setConnection('online');
      logIntegrity('RESUME');
      void load();
      void flushIntegrity();
    };
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, [logIntegrity, load, flushIntegrity]);

  // --------------------------------------------------------------- autosave
  const flushAnswers = useCallback(async () => {
    if (pending.current.size === 0) return;
    if (!navigator.onLine) {
      setSaveStatus('offline');
      return;
    }

    const updates = [...pending.current.entries()].map(([questionId, value]) => ({
      questionId,
      response: value.response,
      flagged: value.flagged,
    }));
    pending.current.clear();
    setSaveStatus('saving');

    try {
      await api.patch(`/api/attempts/${attemptId}/answers`, { updates });
      setSaveStatus('saved');
      setLastSavedAt(new Date().toISOString());
    } catch (saveError) {
      // Put the work back and retry on the next flush; never lose a response.
      for (const update of updates) {
        if (!pending.current.has(update.questionId)) {
          pending.current.set(update.questionId, { response: update.response, flagged: Boolean(update.flagged) });
        }
      }
      if (saveError instanceof ApiRequestError && saveError.status >= 400 && saveError.status < 500) {
        setSaveStatus('error');
        setWarning(saveError.message);
      } else {
        setSaveStatus('offline');
        logIntegrity('CONNECTION_INTERRUPTION', { reason: 'autosave-failed' });
      }
    }
  }, [attemptId, logIntegrity]);

  useEffect(() => {
    const interval = window.setInterval(() => void flushAnswers(), 1400);
    return () => window.clearInterval(interval);
  }, [flushAnswers]);

  useEffect(() => {
    const onHidden = () => void flushAnswers();
    document.addEventListener('visibilitychange', onHidden);
    return () => document.removeEventListener('visibilitychange', onHidden);
  }, [flushAnswers]);

  const setAnswer = useCallback((questionId: string, response: CandidateResponse | null) => {
    setState((current) => {
      if (!current) return current;
      const answers = { ...current.answers };
      if (response === null) delete answers[questionId];
      else answers[questionId] = response;
      return { ...current, answers };
    });
    const existing = pending.current.get(questionId);
    pending.current.set(questionId, { response, flagged: existing?.flagged ?? false });
    setSaveStatus('saving');
  }, []);

  const toggleFlag = useCallback((questionId: string) => {
    setState((current) => {
      if (!current) return current;
      const flagged = current.flagged.includes(questionId)
        ? current.flagged.filter((id) => id !== questionId)
        : [...current.flagged, questionId];
      const existing = pending.current.get(questionId);
      pending.current.set(questionId, {
        response: existing?.response ?? current.answers[questionId] ?? null,
        flagged: flagged.includes(questionId),
      });
      return { ...current, flagged };
    });
    setSaveStatus('saving');
  }, []);

  const saveWriting = useCallback(
    (questionId: string, text: string) => {
      setState((current) => {
        if (!current) return current;
        const others = current.writing.filter((item) => item.questionId !== questionId);
        const wordCount = text.trim() ? text.trim().split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).length : 0;
        return { ...current, writing: [...others, { questionId, text, wordCount }] };
      });
      setSaveStatus('saving');

      const existing = writingTimers.current.get(questionId);
      if (existing) window.clearTimeout(existing);
      const timer = window.setTimeout(async () => {
        try {
          await api.post(`/api/attempts/${attemptId}/writing`, { questionId, text });
          setSaveStatus('saved');
          setLastSavedAt(new Date().toISOString());
        } catch (saveError) {
          setSaveStatus('error');
          setWarning(describeError(saveError));
        }
      }, 1500);
      writingTimers.current.set(questionId, timer);
    },
    [attemptId],
  );

  return {
    state,
    loading,
    error,
    saveStatus,
    lastSavedAt,
    remainingSeconds: useMemo(() => {
      if (!state) return null;
      const now = nowMs;
      if (now === null || !state.time.attemptDeadline) return null;
      const remaining = Math.max(0, Math.round((Date.parse(state.time.attemptDeadline) - (now + clockOffsetMs)) / 1000));
      return remaining;
    }, [state, nowMs, clockOffsetMs]),
    sessionRemainingSeconds: useMemo(() => {
      const now = nowMs;
      if (now === null || !state?.time.sessionDeadline) return null;
      return Math.max(0, Math.round((Date.parse(state.time.sessionDeadline) - (now + clockOffsetMs)) / 1000));
    }, [state, nowMs, clockOffsetMs]),
    connection,
    warning,
    dismissWarning: () => setWarning(null),
    setWarning,
    setAnswer,
    toggleFlag,
    saveWriting,
    submit: async (options) => {
      await flushAnswers();
      await flushIntegrity();
      await api.post<{ status: string }>(`/api/attempts/${attemptId}/submit`, {
        confirmUnanswered: options?.confirmUnanswered ?? false,
      });
      await load();
    },
    advanceComponent: async () => {
      await flushAnswers();
      await api.post(`/api/attempts/${attemptId}/advance`, {});
      await load();
    },
    reload: load,
    logIntegrity,
    isFullscreen,
    requestFullscreen: async () => {
      try {
        await document.documentElement.requestFullscreen();
        setIsFullscreen(true);
      } catch {
        setWarning(
          'This browser refused the fullscreen request. You can continue, but fullscreen monitoring is not active.',
        );
      }
    },
  };
}
