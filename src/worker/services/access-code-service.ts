import type { Env } from '../env';
import type { AuthUser } from '../lib/auth-types';
import { ApiError } from '../lib/errors';
import { hashPassword, verifyPassword } from '../lib/crypto';
import { nowIso } from '../lib/ids';
import { enforceRateLimit } from '../lib/rate-limit';

/**
 * Per-test access codes.
 *
 * An administrator may attach a code to any test. Students must then enter
 * that code once before they can self-start practice attempts or preview the
 * test; the first correct entry records a permanent unlock row so the code is
 * only ever needed once per student per test.
 *
 * - Codes are normalised (trimmed, upper-cased) and stored as PBKDF2-SHA256
 *   hashes, exactly like passwords. Plaintext codes are never persisted.
 * - Staff (teachers, administrators) bypass the gate: they manage or preview
 *   content rather than consume it as candidates.
 * - Assignment attempts bypass the gate: a teacher explicitly assigned that
 *   test to the class, which is itself the authorisation.
 * - Setting a new code (or clearing it) revokes all existing unlocks, so a
 *   rotation immediately forces re-entry.
 */

export const ACCESS_CODE_MIN_LENGTH = 4;
export const ACCESS_CODE_MAX_LENGTH = 32;

/** Normalise for comparison: codes are case-insensitive and space-tolerant. */
export function normalizeAccessCode(code: string): string {
  return code.trim().toUpperCase();
}

export function assertValidAccessCode(code: string): string {
  const normalised = normalizeAccessCode(code);
  if (normalised.length < ACCESS_CODE_MIN_LENGTH || normalised.length > ACCESS_CODE_MAX_LENGTH) {
    throw ApiError.validation(
      `Access codes must be between ${ACCESS_CODE_MIN_LENGTH} and ${ACCESS_CODE_MAX_LENGTH} characters.`,
    );
  }
  return normalised;
}

interface TestCodeRow {
  access_code_hash: string | null;
  access_code_salt: string | null;
  access_code_iterations: number | null;
}

async function loadTestCode(env: Env, testId: string): Promise<TestCodeRow | null> {
  return env.DB.prepare(
    'SELECT access_code_hash, access_code_salt, access_code_iterations FROM tests WHERE id = ?',
  )
    .bind(testId)
    .first<TestCodeRow>();
}

export async function testRequiresAccessCode(env: Env, testId: string): Promise<boolean> {
  const row = await loadTestCode(env, testId);
  return Boolean(row?.access_code_hash);
}

export async function isTestUnlocked(env: Env, userId: string, testId: string): Promise<boolean> {
  const row = await env.DB.prepare('SELECT 1 AS ok FROM test_unlocks WHERE user_id = ? AND test_id = ?')
    .bind(userId, testId)
    .first<{ ok: number }>();
  return Boolean(row);
}

async function recordUnlock(env: Env, userId: string, testId: string): Promise<void> {
  await env.DB.prepare(
    'INSERT OR IGNORE INTO test_unlocks (user_id, test_id, unlocked_at) VALUES (?, ?, ?)',
  )
    .bind(userId, testId, nowIso())
    .run();
}

/** Brute-force protection: codes are short, so guesses are rate limited. */
async function enforceUnlockRateLimit(env: Env, userId: string, testId: string): Promise<void> {
  await enforceRateLimit(
    env,
    { bucket: `unlock:${userId}:${testId}`, windowSeconds: 900, limit: 10 },
    'Too many incorrect codes. Please wait a while before trying again.',
  );
}

/**
 * Verify a student's code and record the unlock. Throws ACCESS_CODE_REQUIRED
 * when the code is missing and FORBIDDEN when it is wrong, so the client can
 * tell "prompt for a code" apart from "the code was incorrect".
 */
export async function verifyAndUnlock(
  env: Env,
  user: AuthUser,
  testId: string,
  code: string | null | undefined,
): Promise<void> {
  if (user.role !== 'STUDENT') return;
  const stored = await loadTestCode(env, testId);
  if (!stored?.access_code_hash) return;
  if (await isTestUnlocked(env, user.id, testId)) return;
  if (!code || !code.trim()) {
    throw new ApiError('ACCESS_CODE_REQUIRED', 'This test requires an access code.');
  }
  await enforceUnlockRateLimit(env, user.id, testId);
  const ok = await verifyPassword(normalizeAccessCode(code), {
    hash: stored.access_code_hash,
    salt: stored.access_code_salt ?? '',
    iterations: stored.access_code_iterations ?? 0,
    algo: 'PBKDF2-SHA256',
  });
  if (!ok) {
    throw ApiError.forbidden('That access code is not correct.');
  }
  await recordUnlock(env, user.id, testId);
}

/**
 * Gate for self-started practice attempts: students need an unlock (or a
 * correct code supplied with the request). Staff and assignment attempts
 * bypass. Resuming an already-started attempt is handled by the caller.
 */
export async function assertPracticeAccess(
  env: Env,
  user: AuthUser,
  testId: string,
  code?: string,
): Promise<void> {
  await verifyAndUnlock(env, user, testId, code);
}

export async function setTestAccessCode(
  env: Env,
  testId: string,
  code: string,
  actorUserId: string,
): Promise<void> {
  const normalised = assertValidAccessCode(code);
  const test = await env.DB.prepare('SELECT id FROM tests WHERE id = ?').bind(testId).first<{ id: string }>();
  if (!test) throw ApiError.notFound('Test not found.');
  const { hash, salt, iterations } = await hashPassword(normalised);
  const timestamp = nowIso();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE tests
          SET access_code_hash = ?, access_code_salt = ?, access_code_iterations = ?,
              access_code_set_at = ?, access_code_set_by = ?, updated_at = ?
        WHERE id = ?`,
    ).bind(hash, salt, iterations, timestamp, actorUserId, timestamp, testId),
    // Rotation revokes previous unlocks so every student re-enters the code.
    env.DB.prepare('DELETE FROM test_unlocks WHERE test_id = ?').bind(testId),
  ]);
}

export async function clearTestAccessCode(env: Env, testId: string): Promise<void> {
  const test = await env.DB.prepare('SELECT id FROM tests WHERE id = ?').bind(testId).first<{ id: string }>();
  if (!test) throw ApiError.notFound('Test not found.');
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE tests
          SET access_code_hash = NULL, access_code_salt = NULL, access_code_iterations = NULL,
              access_code_set_at = NULL, access_code_set_by = NULL, updated_at = ?
        WHERE id = ?`,
    ).bind(nowIso(), testId),
    env.DB.prepare('DELETE FROM test_unlocks WHERE test_id = ?').bind(testId),
  ]);
}
