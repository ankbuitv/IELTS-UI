import { useCallback, useEffect, useRef, useState } from 'react';
import { api, describeError } from '../lib/api';

export interface AiMarkingFailure {
  submissionId?: string;
  judge: string;
  message: string;
}

export interface AiMarkingState {
  running: boolean;
  /** Set when no judge could answer at all, or the request itself failed. */
  error: string | null;
  /** Set when at least one judge answered and another did not. */
  failures: AiMarkingFailure[];
  /** Asks the judges (again). `force` re-marks work that already has an opinion. */
  run: (force?: boolean) => Promise<void>;
}

/**
 * Drives AI marking from the page that shows the result.
 *
 * Writing and Speaking are marked automatically: when the page opens and
 * something still needs a verdict, the request goes out by itself, once. A
 * session-storage stamp stops a refresh or a remount from asking again within
 * a minute (the server is idempotent anyway, this only saves a round trip),
 * and the retry button is always there when it fails.
 */
export function useAiMarking(options: {
  path: string;
  enabled: boolean;
  needed: boolean;
  onDone?: () => Promise<void> | void;
}): AiMarkingState {
  const { path, enabled, needed } = options;
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failures, setFailures] = useState<AiMarkingFailure[]>([]);
  const started = useRef(false);
  const onDone = useRef(options.onDone);
  useEffect(() => {
    onDone.current = options.onDone;
  }, [options.onDone]);

  const run = useCallback(
    async (force = false) => {
      setRunning(true);
      setError(null);
      try {
        const result = await api.post<{ failures?: AiMarkingFailure[] }>(path, force ? { force: true } : {});
        setFailures(result.failures ?? []);
      } catch (cause) {
        setFailures([]);
        setError(describeError(cause));
      } finally {
        try {
          sessionStorage.setItem(`aieo.aimark:${path}`, String(Date.now()));
        } catch {
          // Private mode: the stamp is an optimisation only.
        }
        await onDone.current?.();
        setRunning(false);
      }
    },
    [path],
  );

  useEffect(() => {
    if (!enabled || !needed || started.current) return;
    started.current = true;
    try {
      const last = Number(sessionStorage.getItem(`aieo.aimark:${path}`) ?? 0);
      if (last && Date.now() - last < 60_000) return;
    } catch {
      // ignore
    }
    void run(false);
  }, [enabled, needed, path, run]);

  return { running, error, failures, run };
}
