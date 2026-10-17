import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { loadTurnstile, type TurnstileWidgetApi } from '../../lib/turnstile';

/**
 * The Turnstile check, dressed in the site's own card.
 *
 * The real widget is never styled by hand (Cloudflare forbids hiding it), but it
 * does not have to look like a foreign box either: it is rendered with
 * `appearance: "interaction-only"`, which leaves it transparent until a
 * challenge is actually needed, and it sits inside a card that carries the
 * state — a box that turns into a spinner and then a tick, the same shape as the
 * paper's own form fields. So in the normal case the candidate sees this
 * component's UI, and the moment Cloudflare wants a click the challenge appears
 * in the slot beneath it.
 *
 * A failed load (offline, a blocked script) is deliberately not fatal to the
 * form: the state says so, and the server decides whether to let the attempt
 * through. When Turnstile is not configured at all the component renders
 * nothing, so a development copy never shows an empty box.
 */
export type TurnstileStatus = 'loading' | 'ready' | 'verifying' | 'passed' | 'expired' | 'failed' | 'unavailable';

const LABELS: Record<TurnstileStatus, { title: string; hint: string }> = {
  loading: { title: 'Checking your browser', hint: 'No click needed unless we are asked for one.' },
  ready: { title: 'Confirm you are not a robot', hint: 'One click and the form unlocks.' },
  verifying: { title: 'Verifying…', hint: 'Almost done.' },
  passed: { title: 'Verified', hint: 'You can continue.' },
  expired: { title: 'Check expired', hint: 'Renewing the check…' },
  failed: { title: 'Check failed', hint: 'Retry, or turn off any script blocker.' },
  unavailable: { title: 'Check unavailable', hint: 'The security script could not load — submit anyway.' },
};

export function TurnstileField({
  enabled,
  siteKey,
  action,
  resetKey = 0,
  onToken,
}: {
  enabled: boolean;
  siteKey: string | null;
  action: 'LOGIN' | 'REGISTER';
  /** Change this number to force a fresh token (after a rejected password). */
  resetKey?: number;
  onToken: (token: string | null) => void;
}) {
  const slotRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<TurnstileWidgetApi | null>(null);
  const widgetRef = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);
  const [status, setStatus] = useState<TurnstileStatus>('loading');

  // The callbacks handed to Turnstile are registered once, so they read the
  // current handler through a ref instead of being re-rendered into the widget.
  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  useEffect(() => {
    if (!enabled || !siteKey) return undefined;
    let disposed = false;
    let widgetId: string | null = null;

    loadTurnstile()
      .then((api) => {
        if (disposed || !slotRef.current) return;
        const dark = document.documentElement.dataset.theme === 'dark';
        widgetId = api.render(slotRef.current, {
          sitekey: siteKey,
          action,
          appearance: 'interaction-only',
          size: 'flexible',
          theme: dark ? 'dark' : 'light',
          language: navigator.language.startsWith('vi') ? 'vi' : 'en',
          callback: (token) => {
            if (disposed) return;
            setStatus('passed');
            onTokenRef.current(token);
          },
          'expired-callback': () => {
            if (disposed) return;
            setStatus('expired');
            onTokenRef.current(null);
            // Renew it for them: a token expiring while someone reads the
            // instructions should not cost them the exam window.
            window.setTimeout(() => {
              if (!disposed && widgetId) {
                try {
                  api.reset(widgetId);
                  api.execute(widgetId);
                } catch {
                  /* the button stays available for a manual retry */
                }
              }
            }, 400);
          },
          'error-callback': () => {
            if (disposed) return;
            setStatus('failed');
            onTokenRef.current(null);
          },
        });
        apiRef.current = api;
        widgetRef.current = widgetId;
        setStatus('ready');
      })
      .catch(() => {
        if (disposed) return;
        setStatus('unavailable');
      });

    return () => {
      disposed = true;
      onTokenRef.current(null);
      const api = apiRef.current;
      if (api && widgetId) {
        try {
          api.remove(widgetId);
        } catch {
          /* already gone */
        }
      }
      if (widgetRef.current === widgetId) widgetRef.current = null;
    };
  }, [enabled, siteKey, action]);

  // A rejected sign-in spends the token, so the parent bumps `resetKey`.
  useEffect(() => {
    if (!enabled || resetKey === 0) return;
    const api = apiRef.current;
    const id = widgetRef.current;
    if (!api || !id) return;
    // A frame later: the widget call is what the effect is for, and the label
    // follows the result of that call rather than preceding it.
    window.requestAnimationFrame(() => {
      try {
        api.reset(id);
        api.execute(id);
        setStatus('verifying');
      } catch {
        setStatus('failed');
      }
    });
  }, [enabled, resetKey]);

  if (!enabled || !siteKey) return null;

  const label = LABELS[status];
  return (
    <div className={`turnstile turnstile--${status}`} data-exam-layer>
      <span className="turnstile__box" aria-hidden="true">
        {status === 'passed' ? (
          <svg viewBox="0 0 20 20" className="turnstile__tick">
            <path d="M4 10.6 8.1 14.7 16 6.8" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : status === 'failed' ? (
          <span className="turnstile__bang">!</span>
        ) : status === 'loading' || status === 'verifying' || status === 'expired' ? (
          <span className="turnstile__spinner" />
        ) : (
          <span className="turnstile__empty" />
        )}
      </span>
      <span className="turnstile__text">
        <strong>{label.title}</strong>
        <span>{label.hint}</span>
      </span>
      <span className="turnstile__brand" aria-hidden="true">
        Cloudflare
      </span>
      <div className="turnstile__slot" ref={slotRef} />
      {status === 'failed' || status === 'expired' ? (
        <button
          type="button"
          className="turnstile__retry"
          onClick={() => {
            const api = apiRef.current;
            const id = widgetRef.current;
            if (!api || !id) return;
            api.reset(id);
            api.execute(id);
            setStatus('verifying');
          }}
        >
          Try the check again
        </button>
      ) : null}
    </div>
  );
}

/** Cached `/api/auth/status` answer: the widget only exists if the platform has keys. */
let statusPromise: Promise<{ enabled: boolean; siteKey: string | null }> | null = null;

function readTurnstileStatus() {
  if (!statusPromise) {
    statusPromise = api
      .get<{ turnstileSiteKey?: string | null }>('/api/auth/status')
      .then((status) => {
        const siteKey = typeof status.turnstileSiteKey === 'string' && status.turnstileSiteKey ? status.turnstileSiteKey : null;
        return { enabled: siteKey !== null, siteKey };
      })
      .catch(() => ({ enabled: false, siteKey: null }));
  }
  return statusPromise;
}

export interface TurnstileGuard {
  /** True once the platform has published a site key. */
  enabled: boolean;
  siteKey: string | null;
  token: string | null;
  /** Bump to make the widget mint a fresh token (a rejected attempt spends it). */
  resetKey: number;
  setToken: (token: string | null) => void;
  rearm: () => void;
}

export function useTurnstileGuard(): TurnstileGuard {
  const [status, setStatus] = useState<{ enabled: boolean; siteKey: string | null }>({ enabled: false, siteKey: null });
  const [token, setToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);

  useEffect(() => {
    let alive = true;
    void readTurnstileStatus().then((next) => {
      if (alive) setStatus(next);
    });
    return () => {
      alive = false;
    };
  }, []);

  return {
    ...status,
    token,
    resetKey,
    setToken,
    rearm: () => {
      setToken(null);
      setResetKey((key) => key + 1);
    },
  };
}
