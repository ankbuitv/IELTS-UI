/// <reference types="@cloudflare/workers-types" />

/** Bindings and configuration available to the Worker. */
export interface Env {
  // --- Bindings -----------------------------------------------------------
  DB: D1Database;
  /**
   * Static application bundle (built SPA + bundled demo media).
   *
   * V1 deliberately has no object-storage binding: lesson media is referenced
   * by external HTTPS URL and imports are processed in-request. See
   * `src/worker/services/media-service.ts` for the single place that knows how
   * an asset is turned into a URL, so an optional object-storage adapter can be
   * added later without touching the exam engine.
   */
  ASSETS: Fetcher;
  /** Optional: when absent the import pipeline runs inline (local dev). */
  IMPORT_QUEUE?: Queue<ImportQueueMessage>;

  // --- Vars (wrangler.jsonc `vars`) ---------------------------------------
  APP_ENV: string;
  APP_BASE_URL: string;
  SESSION_TTL_HOURS: string;
  SESSION_COOKIE_NAME: string;
  OPENAI_MODEL: string;
  OPENAI_TRANSCRIBE_MODEL: string;
  MAX_UPLOAD_BYTES: string;
  LOGIN_RATE_LIMIT_PER_15MIN: string;
  AI_RATE_LIMIT_PER_HOUR: string;

  // --- Secrets (wrangler secret put ...) ----------------------------------
  /** Required in production: pepper for session ids and password derivation. */
  SESSION_SECRET?: string;
  /** Optional: when unset, AI import reports itself as unavailable. */
  OPENAI_API_KEY?: string;
}

export interface ImportQueueMessage {
  importId: string;
  stage: 'EXTRACT' | 'AI_STRUCTURE';
  requestedBy: string;
}

export interface AppVariables {
  requestId: string;
  /** Populated by the auth middleware when a valid session cookie is present. */
  user: import('./lib/auth-types').AuthUser | null;
  session: import('./lib/auth-types').AuthSession | null;
}

export type AppBindings = { Bindings: Env; Variables: AppVariables };
