import { describe, expect, it } from 'vitest';
import type { AuthUser } from '../../src/worker/lib/auth-types';
import type { Env } from '../../src/worker/env';
import { ApiError } from '../../src/worker/lib/errors';
import { hashPassword } from '../../src/worker/lib/crypto';
import {
  assertValidAccessCode,
  clearTestAccessCode,
  isTestUnlocked,
  normalizeAccessCode,
  setTestAccessCode,
  testRequiresAccessCode,
  verifyAndUnlock,
} from '../../src/worker/services/access-code-service';

// ---------------------------------------------------------------------------
// Minimal in-memory D1 fake covering exactly the statements the access-code
// service (and its rate limiter) issues.
// ---------------------------------------------------------------------------
interface TestCodeState {
  access_code_hash: string | null;
  access_code_salt: string | null;
  access_code_iterations: number | null;
}

function createFakeEnv() {
  const tests = new Map<string, TestCodeState>();
  const unlocks = new Set<string>();
  const counters = new Map<string, number>();

  const execute = (sql: string, params: unknown[]): unknown => {
    const normalised = sql.replace(/\s+/g, ' ').trim();
    if (normalised.startsWith('SELECT access_code_hash')) {
      return tests.get(params[0] as string) ?? null;
    }
    if (normalised.startsWith('SELECT 1 AS ok FROM test_unlocks')) {
      return unlocks.has(`${params[0]}:${params[1]}`) ? { ok: 1 } : null;
    }
    if (normalised.startsWith('INSERT OR IGNORE INTO test_unlocks')) {
      unlocks.add(`${params[0]}:${params[1]}`);
      return null;
    }
    if (normalised.startsWith('SELECT id FROM tests')) {
      return tests.has(params[0] as string) ? { id: params[0] } : null;
    }
    if (normalised.startsWith('UPDATE tests')) {
      const row = tests.get(params[params.length - 1] as string);
      if (!row) return null;
      if (normalised.includes('access_code_hash = ?')) {
        row.access_code_hash = params[0] as string;
        row.access_code_salt = params[1] as string;
        row.access_code_iterations = params[2] as number;
      } else {
        row.access_code_hash = null;
        row.access_code_salt = null;
        row.access_code_iterations = null;
      }
      return null;
    }
    if (normalised.startsWith('DELETE FROM test_unlocks')) {
      const testId = params[0] as string;
      for (const key of [...unlocks]) {
        if (key.endsWith(`:${testId}`)) unlocks.delete(key);
      }
      return null;
    }
    if (normalised.startsWith('INSERT INTO rate_limit_counters')) {
      const key = `${params[0]}:${params[1]}`;
      const count = (counters.get(key) ?? 0) + 1;
      counters.set(key, count);
      return { count };
    }
    throw new Error(`Unexpected SQL in fake DB: ${normalised.slice(0, 80)}`);
  };

  interface FakeStatement {
    bind: (...params: unknown[]) => FakeStatement;
    first: () => Promise<unknown>;
    run: () => Promise<{ success: boolean }>;
    all: () => Promise<{ results: unknown[] }>;
    __sql: string;
    __params: unknown[];
  }
  const db = {
    prepare(sql: string): FakeStatement {
      const stmt: FakeStatement = {
        __sql: sql,
        __params: [],
        bind(...params: unknown[]) {
          stmt.__params = params;
          return stmt;
        },
        async first() {
          return execute(sql, stmt.__params);
        },
        async run() {
          execute(sql, stmt.__params);
          return { success: true };
        },
        async all() {
          return { results: [] };
        },
      };
      return stmt;
    },
    async batch(statements: FakeStatement[]) {
      for (const stmt of statements) execute(stmt.__sql, stmt.__params);
      return [];
    },
  };

  return {
    env: { DB: db } as unknown as Env,
    tests,
    unlocks,
    seedTest(testId: string) {
      tests.set(testId, { access_code_hash: null, access_code_salt: null, access_code_iterations: null });
    },
    async seedCode(testId: string, code: string) {
      // Low iteration count keeps the suite fast; the service reads it back.
      const { hash, salt, iterations } = await hashPassword(code, { iterations: 1000 });
      tests.set(testId, { access_code_hash: hash, access_code_salt: salt, access_code_iterations: iterations });
    },
  };
}

const student = (id: string): AuthUser => ({
  id,
  email: `${id}@example.test`,
  role: 'STUDENT',
  status: 'ACTIVE',
  displayName: 'Student',
  createdAt: new Date().toISOString(),
  lastLoginAt: null,
});

const teacher: AuthUser = { ...student('t'), role: 'TEACHER' };

async function expectErrorCode(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe(code);
    return;
  }
  throw new Error(`Expected ApiError with code ${code}, but the call succeeded.`);
}

describe('access code normalisation', () => {
  it('trims and upper-cases codes', () => {
    expect(normalizeAccessCode('  ab-12 ')).toBe('AB-12');
  });

  it('rejects codes outside the length bounds', async () => {
    await expectErrorCode(Promise.resolve().then(() => assertValidAccessCode('abc')), 'VALIDATION_FAILED');
    await expectErrorCode(
      Promise.resolve().then(() => assertValidAccessCode('x'.repeat(33))),
      'VALIDATION_FAILED',
    );
    expect(assertValidAccessCode('  abcd ')).toBe('ABCD');
  });
});

describe('access code gate', () => {
  it('leaves open tests untouched', async () => {
    const { env, seedTest } = createFakeEnv();
    seedTest('tst-open');
    expect(await testRequiresAccessCode(env, 'tst-open')).toBe(false);
    await verifyAndUnlock(env, student('s1'), 'tst-open', undefined);
  });

  it('requires the code, then unlocks permanently', async () => {
    const { env, seedTest, seedCode } = createFakeEnv();
    seedTest('tst-locked');
    await seedCode('tst-locked', 'READING-01');

    expect(await testRequiresAccessCode(env, 'tst-locked')).toBe(true);
    await expectErrorCode(verifyAndUnlock(env, student('s1'), 'tst-locked', undefined), 'ACCESS_CODE_REQUIRED');
    await expectErrorCode(verifyAndUnlock(env, student('s1'), 'tst-locked', 'wrong'), 'FORBIDDEN');
    expect(await isTestUnlocked(env, 's1', 'tst-locked')).toBe(false);

    // Case-insensitive entry unlocks; later calls need no code at all.
    await verifyAndUnlock(env, student('s1'), 'tst-locked', 'reading-01');
    expect(await isTestUnlocked(env, 's1', 'tst-locked')).toBe(true);
    await verifyAndUnlock(env, student('s1'), 'tst-locked', undefined);

    // Unlocks are per student.
    expect(await isTestUnlocked(env, 's2', 'tst-locked')).toBe(false);
  });

  it('lets staff bypass the gate', async () => {
    const { env, seedTest, seedCode } = createFakeEnv();
    seedTest('tst-locked');
    await seedCode('tst-locked', 'SECRET');
    await verifyAndUnlock(env, teacher, 'tst-locked', undefined);
  });

  it('revokes unlocks when the code is rotated or cleared', async () => {
    const { env, seedTest } = createFakeEnv();
    seedTest('tst-locked');

    await setTestAccessCode(env, 'tst-locked', 'first-code', 'admin');
    await verifyAndUnlock(env, student('s1'), 'tst-locked', 'FIRST-code');
    expect(await isTestUnlocked(env, 's1', 'tst-locked')).toBe(true);

    await setTestAccessCode(env, 'tst-locked', 'second-code', 'admin');
    expect(await isTestUnlocked(env, 's1', 'tst-locked')).toBe(false);
    await expectErrorCode(verifyAndUnlock(env, student('s1'), 'tst-locked', 'first-code'), 'FORBIDDEN');
    await verifyAndUnlock(env, student('s1'), 'tst-locked', 'second-code');

    await clearTestAccessCode(env, 'tst-locked');
    expect(await testRequiresAccessCode(env, 'tst-locked')).toBe(false);
    expect(await isTestUnlocked(env, 's1', 'tst-locked')).toBe(false);
  });

  it('rate-limits repeated wrong guesses', async () => {
    const { env, seedTest, seedCode } = createFakeEnv();
    seedTest('tst-locked');
    await seedCode('tst-locked', 'SECRET');
    for (let i = 0; i < 10; i += 1) {
      await expectErrorCode(verifyAndUnlock(env, student('s1'), 'tst-locked', `nope-${i}`), 'FORBIDDEN');
    }
    await expectErrorCode(verifyAndUnlock(env, student('s1'), 'tst-locked', 'nope-10'), 'RATE_LIMITED');
  });

  it('rejects setting a code on a missing test', async () => {
    const { env } = createFakeEnv();
    await expectErrorCode(setTestAccessCode(env, 'missing', 'ABCD', 'admin'), 'NOT_FOUND');
  });
});
