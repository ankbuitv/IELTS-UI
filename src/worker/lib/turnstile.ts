/**
 * Cloudflare Turnstile verification for the credential endpoints.
 *
 * Turnstile is configured by environment: a site key in `wrangler.jsonc`
 * (`vars`) and the matching secret key from `wrangler secret put
 * TURNSTILE_SECRET_KEY`. When either is missing the guard is inert, so a
 * development preview or a self-hosted copy keeps working without an account —
 * which is also why the widget is rendered only when `/api/auth/status` says it
 * is enabled.
 *
 * Two rules shape the implementation:
 *   1. A missing token and a bad token are the same failure. Neither is
 *      reported with more detail than "confirm you are not a robot", so the
 *      endpoint does not tell a script which part it got right.
 *   2. Cloudflare being unreachable must not lock a real candidate out of
 *      their exam. A network or 5xx failure therefore allows the attempt (with
 *      a log line), while an explicit `success: false` always blocks it.
 *      The rate limiters in front of login and register still apply either way.
 */

export const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Flows the widget is used on; the action is checked so a token from one form cannot be replayed on another. */
export const TURNSTILE_ACTIONS = ['LOGIN', 'REGISTER'] as const;
export type TurnstileAction = (typeof TURNSTILE_ACTIONS)[number];

export interface TurnstileEnv {
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
}

const VERIFY_TIMEOUT_MS = 5_000;

export function turnstileEnabled(env: TurnstileEnv): boolean {
  return Boolean(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY);
}

export type TurnstileOutcome =
  | { status: 'ok' }
  /** The token was absent, spent, wrong or for another action. */
  | { status: 'rejected'; codes: string[] }
  /** Turnstile could not be reached; treated as allowed, never as proof. */
  | { status: 'unavailable' };

interface SiteverifyResponse {
  success?: boolean;
  action?: string;
  hostname?: string;
  'error-codes'?: string[];
  challenge_ts?: string;
}

/**
 * Verify a widget token for one action.
 *
 * `expectedAction` matters: without it a token minted on the registration form
 * would be valid on the login form, which is exactly what a scripted client
 * would want.
 */
export async function verifyTurnstile(
  env: TurnstileEnv,
  token: string | null | undefined,
  options: { action: TurnstileAction; ip?: string; signal?: AbortSignal },
): Promise<TurnstileOutcome> {
  if (!turnstileEnabled(env)) return { status: 'ok' };
  if (!token || token.length < 20) return { status: 'rejected', codes: ['missing-input-response'] };

  const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY!, response: token, action: options.action });
  if (options.ip) body.set('remoteip', options.ip);

  let payload: SiteverifyResponse | undefined;
  try {
    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body,
      signal: options.signal ?? AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
    if (!response.ok) return { status: 'unavailable' };
    payload = (await response.json()) as SiteverifyResponse | undefined;
  } catch (error) {
    console.warn('[turnstile] verification endpoint unavailable:', (error as Error)?.message ?? error);
    return { status: 'unavailable' };
  }

  if (!payload || !payload.success) {
    return { status: 'rejected', codes: payload?.['error-codes'] ?? ['bad-request'] };
  }
  if (payload.action && payload.action !== options.action) {
    return { status: 'rejected', codes: ['wrong-action'] };
  }
  return { status: 'ok' };
}

/** The failure shown to a human: one sentence, no detail about what was wrong. */
export const TURNSTILE_FAILURE_MESSAGE = 'Please confirm you are not a robot, then try again.';
