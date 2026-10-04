import { describe, expect, it } from 'vitest';
import schemaSql from '@worker/lib/runtime-schema.sql';
import { getLeaderboard } from '../../src/worker/services/learn-leaderboard-service';
import type { Env } from '../../src/worker/env';

interface SqliteStatement {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
}
interface SqliteDb {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

function d1Adapter(db: SqliteDb) {
  return {
    prepare(sql: string) {
      const statement = db.prepare(sql);
      let params: unknown[] = [];
      const bound = {
        bind(...values: unknown[]) { params = values; return bound; },
        async all<T>() { return { results: statement.all(...params) as T[] }; },
        async first<T>() { return (statement.get(...params) as T | undefined) ?? null; },
      };
      return bound;
    },
  };
}

async function createSqlite(): Promise<SqliteDb | null> {
  const specifier = 'node:sqlite';
  const sqlite = await import(/* @vite-ignore */ specifier).catch(() => null) as { DatabaseSync: new (path: string) => SqliteDb } | null;
  if (!sqlite) return null;
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(schemaSql);
  db.exec('PRAGMA foreign_keys = OFF');
  const now = new Date().toISOString();
  const seen = new Date(Date.now() - 30_000).toISOString();
  const expiry = new Date(Date.now() + 86_400_000).toISOString();
  db.exec(`
    INSERT INTO users (id, email, role, status, created_at, updated_at) VALUES
      ('s1', 's1@example.test', 'STUDENT', 'ACTIVE', '${now}', '${now}'),
      ('s2', 's2@example.test', 'STUDENT', 'ACTIVE', '${now}', '${now}'),
      ('a1', 'a1@example.test', 'ADMIN', 'ACTIVE', '${now}', '${now}'),
      ('t1', 't1@example.test', 'TEACHER', 'ACTIVE', '${now}', '${now}');
    INSERT INTO user_profiles (user_id, display_name, created_at, updated_at) VALUES
      ('s1', 'A learner', '${now}', '${now}'),
      ('s2', 'Another learner', '${now}', '${now}'),
      ('a1', 'Staff learner', '${now}', '${now}'),
      ('t1', 'Teacher', '${now}', '${now}');
    INSERT INTO learn_profiles (user_id, xp, streak, best_streak, created_at, updated_at) VALUES
      ('s1', 40, 2, 4, '${now}', '${now}'),
      ('s2', 20, 1, 2, '${now}', '${now}'),
      ('a1', 80, 3, 7, '${now}', '${now}');
    INSERT INTO sessions (id, user_id, csrf_token, created_at, expires_at, last_seen_at) VALUES
      ('session-admin', 'a1', 'csrf', '${now}', '${expiry}', '${seen}');
    INSERT INTO learn_xp_log (id, user_id, day, xp, source, created_at) VALUES
      ('xp-a', 'a1', '2026-09-30', 80, 'lesson:a', '${now}'),
      ('xp-s1', 's1', '2026-09-30', 40, 'lesson:s1', '${now}'),
      ('xp-s2', 's2', '2026-09-30', 20, 'lesson:s2', '${now}');
    INSERT INTO learn_lessons_done (id, user_id, lesson_id, best_accuracy, completions, last_completed_at) VALUES
      ('done-a', 'a1', 'la', 1, 1, '${now}');
    INSERT INTO friendships (user_low_id, user_high_id, requested_by, status, created_at, updated_at) VALUES
      ('a1', 's1', 'a1', 'ACCEPTED', '${now}', '${now}');
    INSERT INTO attempts (id, user_id, test_id, test_version_id, test_type, status, started_at, submitted_at, created_at, updated_at) VALUES
      ('at-a', 'a1', 'test', 'version', 'READING', 'SUBMITTED', '${now}', '${now}', '${now}', '${now}'),
      ('at-s1', 's1', 'test', 'version', 'READING', 'SUBMITTED', '${now}', '${now}', '${now}', '${now}');
  `);
  return db;
}

describe('Learn leaderboard service', () => {
  it('includes active admins, presence and profile metadata on both boards', async () => {
    const db = await createSqlite();
    if (!db) return;
    try {
      const env = { DB: d1Adapter(db) } as unknown as Env;
      const learn = await getLeaderboard(env, 's1', 'learn', 'week', '2026-10-04');
      expect(learn.rows.map((row) => row.name)).toEqual(['Staff learner', 'A learner', 'Another learner']);
      expect(learn.rows[0]).toMatchObject({ role: 'ADMIN', online: true, level: 1, avatarId: 'bo', profileEffect: 'none' });
      expect(learn.rows[0]?.badgeIds).toContain('perfect_lesson');
      expect(learn.rows.find((row) => row.isMe)?.name).toBe('A learner');

      const practice = await getLeaderboard(env, 's1', 'practice', 'all', '2026-10-04');
      expect(practice.rows.map((row) => row.name)).toEqual(['Staff learner', 'A learner']);
      expect(practice.rows[0]).toMatchObject({ role: 'ADMIN', online: true, value: 1 });
    } finally {
      db.close();
    }
  });
});
