/**
 * Cloudflare Turnstile loader for the auth forms.
 *
 * The API is loaded once and shared by every form on the page. Rendering is
 * explicit (`?onload=` + `turnstile.render`) because a form can mount, unmount
 * and remount while the user moves between sign-in and sign-up, and the site
 * key is not even known until `/api/auth/status` answers.
 */

export const TURNSTILE_SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

export interface TurnstileRenderOptions {
  sitekey: string;
  action?: string;
  appearance?: 'always' | 'execute' | 'interaction-only';
  execution?: 'render' | 'execute';
  size?: 'normal' | 'flexible' | 'compact';
  theme?: 'light' | 'dark' | 'auto';
  language?: string;
  callback?: (token: string) => void;
  'expired-callback'?: () => void;
  'error-callback'?: () => void;
}

export interface TurnstileWidgetApi {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string;
  remove: (widgetId: string) => void;
  reset: (widgetId: string) => void;
  execute: (widgetId: string) => void;
  ready?: (callback: () => void) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileWidgetApi;
    __turnstileLoader?: Promise<TurnstileWidgetApi>;
  }
}

let loader: Promise<TurnstileWidgetApi> | null = null;

/** Loads the script once per document and resolves when `window.turnstile` exists. */
export function loadTurnstile(): Promise<TurnstileWidgetApi> {
  if (typeof window === 'undefined') return Promise.reject(new Error('Turnstile needs a browser'));
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (loader) return loader;

  loader = new Promise<TurnstileWidgetApi>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('Turnstile did not load')), 12_000);
    const check = window.setInterval(() => {
      if (!window.turnstile) return;
      window.clearInterval(check);
      window.clearTimeout(timeout);
      resolve(window.turnstile);
    }, 40);

    const existing = document.querySelector<HTMLScriptElement>('script[data-turnstile-api]');
    if (existing) return;
    const script = document.createElement('script');
    script.src = TURNSTILE_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.dataset.turnstileApi = 'true';
    script.onerror = () => {
      window.clearInterval(check);
      window.clearTimeout(timeout);
      reject(new Error('Turnstile could not be loaded'));
    };
    document.head.appendChild(script);
  }).catch((error: Error) => {
    loader = null;
    throw error;
  });

  return loader;
}
