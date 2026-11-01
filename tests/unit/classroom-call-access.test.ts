import { describe, expect, it } from 'vitest';
import schemaSql from '@worker/lib/runtime-schema.sql';
import { assertSessionAccess, getSession } from '@worker/services/mentor-service';
import type { Env } from '@worker/env';
import type { AuthUser } from '@worker/lib/auth-types';

interface Statement { get(...params: unknown[]): unknown }
interface SqliteDb { exec(sql: string): void; prepare(sql: string): Statement; close(): void }
function adapter(db: SqliteDb) {
  return { prepare(sql: string) { const statement = db.prepare(sql); let params: unknown[] = [];
    const bound = { bind(...values: unknown[]) { params = values; return bound; },
      async first<T>() { return (statement.get(...params) as T | undefined) ?? null; } }; return bound;
  } };
}
function user(id: string, role: AuthUser['role']): AuthUser {
  return { id, role, email: `${id}@example.test`, username: null, status: 'ACTIVE', displayName: id, avatarUrl: null, createdAt: '', lastLoginAt: null };
}

describe('teacher classroom call access', () => {
  it('uses active classroom membership and denies archived rooms', async () => {
    const specifier = 'node:sqlite';
    const sqlite = await import(/* @vite-ignore */ specifier).catch(() => null) as { DatabaseSync: new (path: string) => SqliteDb } | null;
    if (!sqlite) return;
    const db = new sqlite.DatabaseSync(':memory:');
    try {
      db.exec(schemaSql); db.exec('PRAGMA foreign_keys = OFF');
      db.exec(`INSERT INTO users (id,email,role,status,created_at,updated_at) VALUES
        ('teacher','t@test','TEACHER','ACTIVE','now','now'),('student','s@test','STUDENT','ACTIVE','now','now'),
        ('outsider','o@test','STUDENT','ACTIVE','now','now');
        INSERT INTO classrooms (id,name,teacher_id,join_code,status,created_at,updated_at) VALUES ('class','Class','teacher','1234','ACTIVE','now','now');
        INSERT INTO classroom_members (id,classroom_id,user_id,role,status,joined_at,updated_at) VALUES ('member','class','student','STUDENT','ACTIVE','now','now');
        INSERT INTO mentor_sessions (id,mentor_id,student_id,kind,status,topic,starts_at,ends_at,created_at,updated_at) VALUES ('room','teacher','teacher','CLASS','SCHEDULED','Class','now','later','now','now');
        INSERT INTO classroom_call_rooms (classroom_id,session_id,created_at) VALUES ('class','room','now');`);
      const env = { DB: adapter(db) } as unknown as Env;
      const session = await getSession(env, 'room');
      await expect(assertSessionAccess(env, session, user('teacher', 'TEACHER'))).resolves.toBeUndefined();
      await expect(assertSessionAccess(env, session, user('student', 'STUDENT'))).resolves.toBeUndefined();
      await expect(assertSessionAccess(env, session, user('outsider', 'STUDENT'))).rejects.toMatchObject({ status: 403 });
      db.exec("UPDATE classroom_members SET status = 'REMOVED' WHERE id = 'member'");
      await expect(assertSessionAccess(env, session, user('student', 'STUDENT'))).rejects.toMatchObject({ status: 403 });
      db.exec("UPDATE classrooms SET status = 'ARCHIVED' WHERE id = 'class'");
      await expect(assertSessionAccess(env, session, user('teacher', 'TEACHER'))).rejects.toMatchObject({ status: 403 });
    } finally { db.close(); }
  });
});
