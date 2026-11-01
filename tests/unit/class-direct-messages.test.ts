import { describe, expect, it } from 'vitest';
import schemaSql from '@worker/lib/runtime-schema.sql';
import { classDirectMessages, postClassDirectMessage } from '@worker/services/mentor-service';
import type { Env } from '@worker/env';
import type { AuthUser } from '@worker/lib/auth-types';

interface Statement { all(...params: unknown[]): unknown[]; get(...params: unknown[]): unknown; run(...params: unknown[]): unknown }
interface SqliteDb { exec(sql: string): void; prepare(sql: string): Statement; close(): void }
function adapter(db: SqliteDb) {
  return { prepare(sql: string) {
    const statement = db.prepare(sql); let params: unknown[] = [];
    const bound = { bind(...values: unknown[]) { params = values; return bound; },
      async all<T>() { return { results: statement.all(...params) as T[] }; },
      async run() { return statement.run(...params); } };
    return bound;
  } };
}
function user(id: string, role: AuthUser['role']): AuthUser {
  return { id, role, email: `${id}@example.test`, username: null, status: 'ACTIVE', displayName: id, avatarUrl: null, createdAt: '', lastLoginAt: null };
}

describe('class direct messages', () => {
  it('isolates pairs and revokes access when membership ends, even for outsiders with admin role', async () => {
    const specifier = 'node:sqlite';
    const sqlite = await import(/* @vite-ignore */ specifier).catch(() => null) as { DatabaseSync: new (path: string) => SqliteDb } | null;
    if (!sqlite) return;
    const db = new sqlite.DatabaseSync(':memory:');
    try {
      db.exec(schemaSql); db.exec('PRAGMA foreign_keys = OFF');
      db.exec(`INSERT INTO users (id,email,role,status,created_at,updated_at) VALUES
        ('mentor','m@test','MENTOR','ACTIVE','now','now'),('student','s@test','STUDENT','ACTIVE','now','now'),
        ('other','o@test','STUDENT','ACTIVE','now','now'),('admin','a@test','ADMIN','ACTIVE','now','now');
        INSERT INTO mentor_classes (id,mentor_id,title,starts_at,ends_at,created_at,updated_at) VALUES ('class','mentor','Class','now','later','now','now');
        INSERT INTO mentor_class_members (class_id,user_id,joined_at) VALUES ('class','student','now'),('class','other','now');`);
      const env = { DB: adapter(db) } as unknown as Env;
      const mentor = user('mentor', 'MENTOR'); const student = user('student', 'STUDENT');
      const other = user('other', 'STUDENT'); const admin = user('admin', 'ADMIN');
      await postClassDirectMessage(env, student, 'class', 'mentor', '  hello  ');
      expect((await classDirectMessages(env, mentor, 'class', 'student')).map((m) => m.body)).toEqual(['hello']);
      expect(await classDirectMessages(env, other, 'class', 'student')).toEqual([]);
      await expect(classDirectMessages(env, admin, 'class', 'student')).rejects.toMatchObject({ status: 403 });
      await expect(classDirectMessages(env, student, 'class', 'admin')).rejects.toMatchObject({ status: 403 });
      await expect(classDirectMessages(env, student, 'class', 'student')).rejects.toMatchObject({ status: 400 });
      await expect(postClassDirectMessage(env, student, 'class', 'mentor', '   ')).rejects.toMatchObject({ status: 400 });
      db.exec("DELETE FROM mentor_class_members WHERE user_id = 'student'");
      await expect(classDirectMessages(env, student, 'class', 'mentor')).rejects.toMatchObject({ status: 403 });
      await expect(classDirectMessages(env, mentor, 'class', 'student')).rejects.toMatchObject({ status: 403 });
    } finally { db.close(); }
  });
});
