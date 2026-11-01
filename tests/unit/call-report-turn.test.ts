import { describe, expect, it } from 'vitest';
import schemaSql from '@worker/lib/runtime-schema.sql';
import { callReport, submitCallFeedback } from '@worker/services/call-feedback-service';
import { turnConfig } from '@worker/services/turn-service';
import type { Env } from '@worker/env';
import type { AuthUser } from '@worker/lib/auth-types';

interface Statement { get(...params: unknown[]): unknown; all(...params: unknown[]): unknown[]; run(...params: unknown[]): unknown }
interface SqliteDb { exec(sql: string): void; prepare(sql: string): Statement; close(): void }
function adapter(db: SqliteDb) {
  return { prepare(sql: string) { const statement = db.prepare(sql); let params: unknown[] = [];
    const bound = { bind(...values: unknown[]) { params = values; return bound; },
      async first<T>() { return (statement.get(...params) as T | undefined) ?? null; },
      async all() { return { results: statement.all(...params) }; },
      async run() { return statement.run(...params); } }; return bound;
  } };
}
function user(id: string, role: AuthUser['role']): AuthUser {
  return { id, role, email: `${id}@example.test`, username: null, status: 'ACTIVE', displayName: id, avatarUrl: null, createdAt: '', lastLoginAt: null };
}

describe('call reports, feedback and TURN credentials', () => {
  it('enforces attendance and host access and issues only short-lived relay credentials', async () => {
    const specifier = 'node:sqlite';
    const sqlite = await import(/* @vite-ignore */ specifier).catch(() => null) as { DatabaseSync: new (path: string) => SqliteDb } | null;
    if (!sqlite) return;
    const db = new sqlite.DatabaseSync(':memory:');
    try {
      db.exec(schemaSql); db.exec('PRAGMA foreign_keys = OFF');
      db.exec(`INSERT INTO users (id,email,role,status,created_at,updated_at) VALUES
        ('teacher','t@test','TEACHER','ACTIVE','now','now'),('student','s@test','STUDENT','ACTIVE','now','now'),('outsider','o@test','STUDENT','ACTIVE','now','now');
        INSERT INTO classrooms (id,name,teacher_id,join_code,status,created_at,updated_at) VALUES ('class','Class','teacher','1234','ACTIVE','now','now');
        INSERT INTO classroom_members (id,classroom_id,user_id,role,status,joined_at,updated_at) VALUES ('member','class','student','STUDENT','ACTIVE','now','now');
        INSERT INTO mentor_sessions (id,mentor_id,student_id,kind,status,topic,starts_at,ends_at,created_at,updated_at) VALUES ('room','teacher','teacher','CLASS','ACTIVE','Class','now','later','now','now');
        INSERT INTO classroom_call_rooms (classroom_id,session_id,created_at) VALUES ('class','room','now');`);
      const env = { DB: adapter(db), TURN_URLS: 'turn:turn.example.org:3478, turns:turn.example.org:5349', TURN_SHARED_SECRET: 'test-secret' } as unknown as Env;
      const student = user('student', 'STUDENT'); const host = user('teacher', 'TEACHER'); const outsider = user('outsider', 'STUDENT');
      await expect(callReport(env, student, 'room')).rejects.toMatchObject({ status: 403 });
      await expect(submitCallFeedback(env, student, 'room', 5, 'good')).rejects.toMatchObject({ status: 403 });
      await expect(turnConfig(env, outsider, 'room')).rejects.toMatchObject({ status: 403 });
      const config = await turnConfig(env, student, 'room');
      expect(config.configured).toBe(true);
      expect(config.iceServers[0]?.username).toMatch(/^\d+:student$/);
      expect(config.iceServers[0]?.credential).not.toBe('test-secret');
      db.exec("INSERT INTO call_attendance (id,session_id,user_id,joined_at,last_seen_at,left_at) VALUES ('visit','room','student','2026-01-01','2026-01-02','2026-01-02')");
      await submitCallFeedback(env, student, 'room', 5, 'great');
      await expect(submitCallFeedback(env, student, 'room', 5, 'again')).rejects.toMatchObject({ status: 409 });
      const report = await callReport(env, host, 'room');
      expect(report.attendance).toHaveLength(1);
      expect(report.feedback).toHaveLength(1);
      db.exec("UPDATE classroom_members SET status = 'REMOVED' WHERE id = 'member'");
      await expect(turnConfig(env, student, 'room')).rejects.toMatchObject({ status: 403 });
      await expect(submitCallFeedback(env, student, 'room', 5, '')).rejects.toMatchObject({ status: 403 });
    } finally { db.close(); }
  });
});
