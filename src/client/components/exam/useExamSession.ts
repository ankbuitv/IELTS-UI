import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, describeError } from '../../lib/api';
import type { CandidateResponse } from '@shared/answer-key';
import type { IntegrityEventType } from '@shared/integrity';
import type { CandidateTestPayload } from '@shared/candidate';
import type { AttemptSectionState } from '@shared/candidate';
import type { SectionPolicy } from '@shared/sections';
import { countWords } from '../../lib/format';
import {
  applyDraft,
  backoffMs,
  buildDraft,
  classifySaveError,
  draftStorageKey,
  emptyTouched,
  mergeServerState,
  parseDraft,
  type PendingUpdate,
} from './exam-sync';

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
  /** Server-authoritative per-section progress and timers (38/39). */
  sections: AttemptSectionState[];
  sectionPolicy: SectionPolicy;
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

interface FlushOptions {
  /** Ignore the retry back-off and the typing pause (submit, leaving the page). */
  force?: boolean;
  /** Let the request outlive the page (pagehide). */
  keepalive?: boolean;
}

const extrasFor = (options: FlushOptions) => (options.keepalive ? { keepalive: true } : undefined);

/** An essay is sent once the candidate has stopped typing for this long. */
const TYPING_PAUSE_MS = 900;

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
  /** Sends every unsaved answer and essay now. Resolves true when nothing is left unsent. */
  flushAll: () => Promise<boolean>;
  submit: (options?: { confirmUnanswered?: boolean }) => Promise<void>;
  advanceComponent: () => Promise<void>;
  completeSection: (sectionId?: string) => Promise<void>;
  reload: () => Promise<void>;
  setWarning: (message: string | null) => void;
  logIntegrity: (type: IntegrityEventType, metadata?: Record<string, unknown>) => void;
  requestFullscreen: () => Promise<void>;
  isFullscreen: boolean;
  /** Set when the candidate has just come back to the exam tab after leaving it. */
  tabLock: TabLockState | null;
  /** Times the candidate has left the exam tab in this attempt (server count or this tab's count, whichever is higher). */
  tabStrikes: number;
  acknowledgeTabLock: () => void;
  /** True once the server submitted the attempt because the tab-lock limit was reached. */
  lockedOut: boolean;
}

/** The blocking "you left the exam" notice. `limit` is null when the policy has no auto-submit. */
export interface TabLockState {
  strikes: number;
  limit: number | null;
  final: boolean;
}

/** After this long without focus (but with the tab still visible) the candidate counts as having left. */
const PROLONGED_BLUR_MS = 2_500;

/**
 * Client-side exam session.
 *
 * The timer shown here is DISPLAY ONLY. Every authoritative value (deadline,
 * remaining time, submission state) comes from the Worker: `remainingSeconds`
 * is recomputed from server timestamps on every refresh and every poll, so
 * reloading the page or changing the system clock grants no extra time.
 */
export function useExamSession(attemptId: string): ExamSessionApi {
  // The ref is the source of truth for state that handlers read synchronously
  // (current flags, merge on poll); the mirrored React state drives rendering.
  const stateRef = useRef<AttemptState | null>(null);
  const [state, setStateMirror] = useState<AttemptState | null>(null);
  const commit = useCallback((update: (current: AttemptState | null) => AttemptState | null) => {
    const next = update(stateRef.current);
    stateRef.current = next;
    setStateMirror(next);
  }, []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [tabLock, setTabLock] = useState<TabLockState | null>(null);
  const [lockedOut, setLockedOut] = useState(false);
  const [tabStrikes, setTabStrikes] = useState(0);
  /** Counted "left the tab" events, so the notice can say "2 of 3" before the server answers. */
  const strikes = useRef(0);
  const [connection, setConnection] = useState<'online' | 'offline'>(navigator.onLine ? 'online' : 'offline');
  const [isFullscreen, setIsFullscreen] = useState(Boolean(document.fullscreenElement));

  /** Answers not yet sent. */
  const pending = useRef<Map<string, PendingUpdate>>(new Map());
  /** Answers sent or waiting to be sent but not yet acknowledged (what a draft keeps). */
  const unacked = useRef<Map<string, PendingUpdate>>(new Map());
  /** Essays whose latest text the server has not acknowledged. */
  const dirtyWriting = useRef<Map<string, { text: string; editedAt: number }>>(new Map());
  /** Everything changed in this tab: a poll never reverts these. */
  const touched = useRef(emptyTouched());
  const answersChain = useRef<Promise<boolean>>(Promise.resolve(true));
  const writingChains = useRef<Map<string, Promise<boolean>>>(new Map());
  const retry = useRef<{ failures: number; notBefore: number; kind: 'rejected' | 'transient' | null }>({
    failures: 0,
    notBefore: 0,
    kind: null,
  });
  const hasLoaded = useRef(false);
  const integrityQueue = useRef<Array<{ type: IntegrityEventType; metadata?: Record<string, unknown> }>>([]);
  const [clockOffsetMs, setClockOffsetMs] = useState(0);
  const [nowMs, setNowMs] = useState<number | null>(null);

  // ----------------------------------------------------------------- drafts
  // Unsent work is mirrored to localStorage, so a browser that kills the tab
  // (a phone under memory pressure, a crash, a dead battery) cannot lose it.
  const persistDraft = useCallback(() => {
    try {
      const draft = buildDraft(unacked.current, dirtyWriting.current);
      if (draft) window.localStorage.setItem(draftStorageKey(attemptId), JSON.stringify(draft));
      else window.localStorage.removeItem(draftStorageKey(attemptId));
    } catch {
      // Storage can be full or blocked; the in-memory queue still protects the work.
    }
  }, [attemptId]);

  const clearDraft = useCallback(() => {
    try {
      window.localStorage.removeItem(draftStorageKey(attemptId));
    } catch {
      // Nothing to clean up.
    }
  }, [attemptId]);

  /** First snapshot only: put back anything a previous session never got to send. */
  const restoreDraft = useCallback(
    (fetched: AttemptState): AttemptState => {
      let raw: string | null;
      try {
        raw = window.localStorage.getItem(draftStorageKey(attemptId));
      } catch {
        return fetched;
      }
      const draft = parseDraft(raw);
      if (!draft) return fetched;
      if (fetched.submitted || fetched.status !== 'IN_PROGRESS') {
        clearDraft();
        return fetched;
      }
      const applied = applyDraft(fetched, draft);
      for (const [questionId, update] of applied.answers) {
        pending.current.set(questionId, update);
        unacked.current.set(questionId, update);
        touched.current.answers.add(questionId);
        touched.current.flags.add(questionId);
      }
      for (const [questionId, text] of applied.writing) {
        dirtyWriting.current.set(questionId, { text, editedAt: 0 });
        touched.current.writing.add(questionId);
      }
      if (applied.answers.size > 0 || applied.writing.size > 0) setSaveStatus('saving');
      else clearDraft();
      return applied.state;
    },
    [attemptId, clearDraft],
  );

  // ------------------------------------------------------------------ load
  const load = useCallback(async () => {
    try {
      const fetched = await api.get<AttemptState>(`/api/attempts/${attemptId}`);
      setClockOffsetMs(Date.parse(fetched.serverNow) - Date.now());
      setNowMs(Date.now());
      if (!hasLoaded.current) {
        hasLoaded.current = true;
        const restored = restoreDraft(fetched);
        commit(() => restored);
      } else {
        commit((current) => mergeServerState(current, fetched, touched.current));
      }
      setError(null);
    } catch (loadError) {
      setError(describeError(loadError));
    } finally {
      setLoading(false);
    }
  }, [attemptId, commit, restoreDraft]);

  useEffect(() => {
    void load();
  }, [load]);

  // Periodic resync with the server (keeps the displayed clock honest and
  // picks up policy-driven auto-submission). It never reverts local edits.
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
        setWarning('You have left the exam tab too many times. This attempt is being submitted automatically.');
      }
      if (result.autoSubmitted) {
        setLockedOut(true);
        setTabLock((previous) => ({ strikes: previous?.strikes ?? strikes.current, limit: previous?.limit ?? null, final: true }));
        void load();
      }
    } catch {
      // Re-queue on failure so nothing is silently dropped.
      integrityQueue.current.unshift(...batch);
    }
  }, [attemptId, load]);

  const logIntegrity = useCallback(
    (type: IntegrityEventType, metadata?: Record<string, unknown>) => {
      integrityQueue.current.push({ type, ...(metadata ? { metadata } : {}) });
      // Flushed at once rather than waiting for the interval: these are the
      // events a teacher will want a timestamp for, and an inspector that is
      // closed again would otherwise look like it never opened.
      if (
        type === 'TAB_HIDDEN' ||
        type === 'FULLSCREEN_EXIT' ||
        type === 'COPY_ATTEMPT' ||
        type === 'PASTE_ATTEMPT' ||
        type === 'INSPECTOR_OPEN' ||
        type === 'INSPECTOR_CLOSED'
      ) {
        void flushIntegrity();
      }
    },
    [flushIntegrity],
  );

  useEffect(() => {
    const interval = window.setInterval(() => void flushIntegrity(), 8000);
    return () => window.clearInterval(interval);
  }, [flushIntegrity]);

  const integrityPolicy = state?.integrity.policy ?? null;
  const isSubmitted = state?.submitted ?? true;
  const serverCounted = state?.integrity.counted ?? 0;
  useEffect(() => {
    strikes.current = Math.max(strikes.current, serverCounted);
  }, [serverCounted]);

  // Reload detection, once per page load: a marker in sessionStorage means this
  // page was visited before within the same tab session. (This used to sit in
  // the listener effect below, which re-runs on every poll, so every answer and
  // every keystroke of an essay logged "Page reload" + "Session resumed".)
  const reloadChecked = useRef(false);
  useEffect(() => {
    if (!integrityPolicy || isSubmitted || reloadChecked.current) return;
    reloadChecked.current = true;
    const marker = `exam-visited:${attemptId}`;
    if (window.sessionStorage.getItem(marker)) {
      logIntegrity('RELOAD');
      logIntegrity('SESSION_RESUME');
    } else {
      window.sessionStorage.setItem(marker, String(Date.now()));
    }
  }, [integrityPolicy, isSubmitted, attemptId, logIntegrity]);

  useEffect(() => {
    if (!integrityPolicy || isSubmitted) return;
    const policy = integrityPolicy;
    const cleanup: Array<() => void> = [];

    if (policy.monitorVisibility) {
      // TAB LOCK. Leaving the exam tab is a counted strike; at the policy limit the
      // server submits the attempt. A page cannot stop Alt+Tab, so what it does is
      // notice it, block the exam behind a notice on return, and count it.
      const limit = policy.autoSubmitAtEvents;
      let blurTimer: number | null = null;
      let blurCounted = false;
      let pendingReturn = false;
      // Touch devices fire blur for notification shades and keyboards: only a hidden tab counts there.
      const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false;

      const countAway = (via: 'visibility' | 'blur') => {
        strikes.current += 1;
        setTabStrikes(strikes.current);
        pendingReturn = true;
        logIntegrity('TAB_HIDDEN', { via, visibilityState: document.visibilityState });
      };
      const showNotice = () => {
        pendingReturn = false;
        setTabLock({ strikes: strikes.current, limit, final: limit !== null && strikes.current >= limit });
      };
      const onVisibility = () => {
        if (document.hidden) {
          if (blurTimer !== null) {
            window.clearTimeout(blurTimer);
            blurTimer = null;
          }
          if (!blurCounted) countAway('visibility');
        } else {
          logIntegrity('SESSION_RESUME');
          blurCounted = false;
          if (pendingReturn) showNotice();
        }
      };
      const onBlur = () => {
        logIntegrity('WINDOW_BLUR');
        if (coarsePointer || blurTimer !== null) return;
        blurTimer = window.setTimeout(() => {
          blurTimer = null;
          if (!document.hidden && !document.hasFocus() && !blurCounted) {
            blurCounted = true;
            countAway('blur');
          }
        }, PROLONGED_BLUR_MS);
      };
      const onFocus = () => {
        if (blurTimer !== null) {
          window.clearTimeout(blurTimer);
          blurTimer = null;
        }
        if (blurCounted) {
          blurCounted = false;
          if (pendingReturn) showNotice();
        }
      };
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('blur', onBlur);
      window.addEventListener('focus', onFocus);
      cleanup.push(() => document.removeEventListener('visibilitychange', onVisibility));
      cleanup.push(() => window.removeEventListener('blur', onBlur));
      cleanup.push(() => window.removeEventListener('focus', onFocus));
      cleanup.push(() => {
        if (blurTimer !== null) window.clearTimeout(blurTimer);
      });
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
      if (unacked.current.size > 0 || dirtyWriting.current.size > 0) {
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
  }, [integrityPolicy, isSubmitted, logIntegrity]);

  // --------------------------------------------------------------- autosave
  /** Success bookkeeping shared by answer and essay saves. */
  const markSaved = useCallback(() => {
    retry.current = { failures: 0, notBefore: 0, kind: null };
    setLastSavedAt(new Date().toISOString());
    const nothingLeft =
      pending.current.size === 0 && unacked.current.size === 0 && dirtyWriting.current.size === 0;
    setSaveStatus(nothingLeft ? 'saved' : 'saving');
    persistDraft();
  }, [persistDraft]);

  const markFailed = useCallback(
    (saveError: unknown) => {
      const kind = classifySaveError(saveError);
      retry.current.failures += 1;
      retry.current.kind = kind;
      retry.current.notBefore = Date.now() + backoffMs(retry.current.failures);
      if (kind === 'rejected') {
        setSaveStatus('error');
        setWarning(describeError(saveError));
      } else {
        setSaveStatus(navigator.onLine ? 'error' : 'offline');
        if (retry.current.failures === 1) logIntegrity('CONNECTION_INTERRUPTION', { reason: 'autosave-failed' });
      }
      persistDraft();
    },
    [logIntegrity, persistDraft],
  );

  const flushAnswers = useCallback(
    (options: FlushOptions = {}): Promise<boolean> => {
      // Saves are chained so two requests can never reach the server out of
      // order and leave an older answer standing.
      const run = async (): Promise<boolean> => {
        if (pending.current.size === 0) return true;
        if (!options.force && Date.now() < retry.current.notBefore) return false;
        if (!navigator.onLine) {
          setSaveStatus('offline');
          return false;
        }
        const batch = [...pending.current.entries()];
        pending.current.clear();
        setSaveStatus('saving');
        try {
          await api.patch(
            `/api/attempts/${attemptId}/answers`,
            { updates: batch.map(([questionId, value]) => ({ questionId, response: value.response, flagged: value.flagged })) },
            extrasFor(options),
          );
          for (const [questionId, update] of batch) {
            if (unacked.current.get(questionId) === update) unacked.current.delete(questionId);
          }
          markSaved();
          return true;
        } catch (saveError) {
          // Put the work back and retry on the next flush; never lose a response.
          for (const [questionId, update] of batch) {
            if (!pending.current.has(questionId)) pending.current.set(questionId, update);
          }
          markFailed(saveError);
          return false;
        }
      };
      const next = answersChain.current.then(run, run);
      answersChain.current = next;
      return next;
    },
    [attemptId, markSaved, markFailed],
  );

  const sendWriting = useCallback(
    (questionId: string, options: FlushOptions): Promise<boolean> => {
      const run = async (): Promise<boolean> => {
        const entry = dirtyWriting.current.get(questionId);
        if (!entry) return true;
        const sent = entry.text;
        try {
          await api.post(`/api/attempts/${attemptId}/writing`, { questionId, text: sent }, extrasFor(options));
          // Typing may have continued while the request was in flight: only a
          // text the server now holds in full is considered saved.
          if (dirtyWriting.current.get(questionId)?.text === sent) dirtyWriting.current.delete(questionId);
          markSaved();
          return true;
        } catch (saveError) {
          markFailed(saveError);
          return false;
        }
      };
      const previous = writingChains.current.get(questionId) ?? Promise.resolve(true);
      const next = previous.then(run, run);
      writingChains.current.set(questionId, next);
      return next;
    },
    [attemptId, markSaved, markFailed],
  );

  /** Essays are sent once the candidate pauses typing (or at once when forced). */
  const flushWriting = useCallback(
    async (options: FlushOptions = {}): Promise<boolean> => {
      const due = [...dirtyWriting.current.entries()]
        .filter(([, entry]) => options.force || Date.now() - entry.editedAt >= TYPING_PAUSE_MS)
        .map(([questionId]) => questionId);
      if (due.length === 0) return dirtyWriting.current.size === 0;
      if (!options.force && Date.now() < retry.current.notBefore) return false;
      if (!navigator.onLine) {
        setSaveStatus('offline');
        return false;
      }
      setSaveStatus('saving');
      const results = await Promise.all(due.map((questionId) => sendWriting(questionId, options)));
      return results.every(Boolean);
    },
    [sendWriting],
  );

  const flushAll = useCallback(async (): Promise<boolean> => {
    const [answersSaved, writingSaved] = await Promise.all([
      flushAnswers({ force: true }),
      flushWriting({ force: true }),
    ]);
    return answersSaved && writingSaved;
  }, [flushAnswers, flushWriting]);

  /**
   * Before submitting or moving on the server must hold everything. A network
   * failure aborts the action (nothing is lost, nothing is submitted half
   * saved); a server refusal does not, because the next call will report why.
   */
  const saveBeforeLeaving = useCallback(async (): Promise<void> => {
    if (await flushAll()) return;
    if (retry.current.kind === 'rejected') return;
    throw new Error(
      'Some of your work has not reached the server yet. Check your connection and try again — nothing has been submitted.',
    );
  }, [flushAll]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void flushAnswers();
      void flushWriting();
    }, 1200);
    return () => window.clearInterval(interval);
  }, [flushAnswers, flushWriting]);

  // Leaving or hiding the page: send everything now, with keepalive so the
  // request survives the page, and refresh the local draft.
  useEffect(() => {
    const flushNow = () => {
      void flushAnswers({ force: true, keepalive: true });
      void flushWriting({ force: true, keepalive: true });
      persistDraft();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushNow();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flushNow);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flushNow);
    };
  }, [flushAnswers, flushWriting, persistDraft]);

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
      retry.current = { failures: 0, notBefore: 0, kind: null };
      void flushAll();
      void load();
      void flushIntegrity();
    };
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, [logIntegrity, load, flushIntegrity, flushAll]);

  const queueUpdate = useCallback(
    (questionId: string, update: PendingUpdate) => {
      pending.current.set(questionId, update);
      unacked.current.set(questionId, update);
      touched.current.answers.add(questionId);
      touched.current.flags.add(questionId);
      persistDraft();
      setSaveStatus('saving');
    },
    [persistDraft],
  );

  const setAnswer = useCallback(
    (questionId: string, response: CandidateResponse | null) => {
      const current = stateRef.current;
      if (!current) return;
      // Answering must not clear a flag the candidate set earlier: the update
      // carries the flag too, so it is read from the live state.
      const flagged = pending.current.get(questionId)?.flagged ?? current.flagged.includes(questionId);
      commit((snapshot) => {
        if (!snapshot) return snapshot;
        const answers = { ...snapshot.answers };
        if (response === null) delete answers[questionId];
        else answers[questionId] = response;
        return { ...snapshot, answers };
      });
      queueUpdate(questionId, { response, flagged });
    },
    [commit, queueUpdate],
  );

  const toggleFlag = useCallback(
    (questionId: string) => {
      const current = stateRef.current;
      if (!current) return;
      const nowFlagged = !current.flagged.includes(questionId);
      commit((snapshot) =>
        snapshot
          ? {
              ...snapshot,
              flagged: nowFlagged
                ? [...snapshot.flagged, questionId]
                : snapshot.flagged.filter((id) => id !== questionId),
            }
          : snapshot,
      );
      const existing = pending.current.get(questionId);
      queueUpdate(questionId, {
        response: existing ? existing.response : (current.answers[questionId] ?? null),
        flagged: nowFlagged,
      });
    },
    [commit, queueUpdate],
  );

  const saveWriting = useCallback(
    (questionId: string, text: string) => {
      commit((snapshot) => {
        if (!snapshot) return snapshot;
        const entry = { questionId, text, wordCount: countWords(text) };
        const exists = snapshot.writing.some((item) => item.questionId === questionId);
        return {
          ...snapshot,
          writing: exists
            ? snapshot.writing.map((item) => (item.questionId === questionId ? entry : item))
            : [...snapshot.writing, entry],
        };
      });
      touched.current.writing.add(questionId);
      dirtyWriting.current.set(questionId, { text, editedAt: Date.now() });
      persistDraft();
      setSaveStatus('saving');
    },
    [commit, persistDraft],
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
    tabLock,
    tabStrikes,
    acknowledgeTabLock: () => setTabLock(null),
    lockedOut,
    setAnswer,
    toggleFlag,
    saveWriting,
    flushAll,
    submit: async (options) => {
      await saveBeforeLeaving();
      await flushIntegrity();
      await api.post<{ status: string }>(`/api/attempts/${attemptId}/submit`, {
        confirmUnanswered: options?.confirmUnanswered ?? false,
      });
      clearDraft();
      unacked.current.clear();
      await load();
    },
    advanceComponent: async () => {
      await saveBeforeLeaving();
      await api.post(`/api/attempts/${attemptId}/advance`, {});
      await load();
    },
    completeSection: async (sectionId?: string) => {
      await saveBeforeLeaving();
      await api.post(`/api/attempts/${attemptId}/complete-section`, sectionId ? { sectionId } : {});
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
