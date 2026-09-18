import type { Env } from '../env';
import { nowIso } from './ids';
import { ApiError } from './errors';

/**
 * Fixed-window rate limiting backed by D1. Adequate for authentication and the
 * expensive AI-import endpoints; a Cloudflare Rate Limiting rule or Durable
 * Object can be layered on top without changing call sites.
 */
export interface RateLimitOptions {
  bucket: string;
  windowSeconds: number;
  limit: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: string;
}

export async function checkRateLimit(env: Env, options: RateLimitOptions): Promise<RateLimitResult> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % options.windowSeconds);
  const key = options.bucket;

  const row = await env.DB.prepare(
    `INSERT INTO rate_limit_counters (bucket, window_start, count, updated_at)
     VALUES (?, ?, 1, ?)
     ON CONFLICT (bucket, window_start)
     DO UPDATE SET count = count + 1, updated_at = excluded.updated_at
     RETURNING count`,
  )
    .bind(key, windowStart, nowIso())
    .first<{ count: number }>();

  const count = row?.count ?? 1;
  const resetAt = new Date((windowStart + options.windowSeconds) * 1000).toISOString();

  return {
    allowed: count <= options.limit,
    remaining: Math.max(0, options.limit - count),
    resetAt,
  };
}

export async function enforceRateLimit(env: Env, options: RateLimitOptions, message: string): Promise<void> {
  const result = await checkRateLimit(env, options);
  if (!result.allowed) {
    throw new ApiError('RATE_LIMITED', message, { resetAt: result.resetAt });
  }
}

/** Best-effort cleanup so counters do not grow without bound. */
export async function pruneRateLimits(env: Env): Promise<void> {
  const cutoff = Math.floor(Date.now() / 1000) - 86_400;
  await env.DB.prepare('DELETE FROM rate_limit_counters WHERE window_start < ?').bind(cutoff).run();
}
