import { describe, expect, it } from 'vitest';
import schemaSql from '@worker/lib/runtime-schema.sql';
import { createLessonPlan, deleteLessonPlan, listLessonPlans, updateLessonPlan } from '@worker/services/lesson-plan-service';
import type { AuthUser } from '@worker/lib/auth-types';
import type { Env } from '@worker/env';

interface Statement { get(...params: unknown[]): unknown; all(...params: unknown[]): unknown[]; run(...params: unknown[]): { changes: number | bigint } }
interface Database { exec(sql: string): void; prepare(sql: string): Statement; close(): void }
function adapter(db: Database) {
  return { prepare(sql: string) { let values: unknown[] = []; const stmt = db.prepare(sql); return {
    bind(...params: unknown[]) { values = params; return this; },
    async first() { return stmt.get(...values) ?? null; },
    async all() { return { results: stmt.all(...values) }; },
    async run() { return { meta: { changes: Number(stmt.run(...values).changes) } }; },
  }; }, async batch(statements: Array<{run: () => Promise<unknown>}>) { db.exec('BEGIN'); try { const rows=[]; for (const stmt of statements) rows.push(await stmt.run()); db.exec('COMMIT'); return rows; } catch (e) { db.exec('ROLLBACK'); throw e; } } };
}
function user(id: string, role: AuthUser['role'] = 'TEACHER'): AuthUser {
  return { id, role, email: `${id}@example.test`, username: null, status: 'ACTIVE', displayName: id, avatarUrl: null, createdAt: '', lastLoginAt: null };
}

describe('personal school lesson plans', () => {
  it('allows active staff CRUD, isolates authors and schools, and revokes access on removal', async () => {
    const specifier = 'node:sqlite';
    const sqlite = await import(/* @vite-ignore */ specifier).catch(() => null) as { DatabaseSync: new (path: string) => Database } | null;
    if (!sqlite) throw new Error('node:sqlite is required for lesson plan tests');
    const db = new sqlite.DatabaseSync(':memory:');
    try {
      db.exec(schemaSql); db.exec('PRAGMA foreign_keys=OFF');
      db.exec(`INSERT INTO schools(id,name,address,contact_email,owner_user_id,status,created_at,updated_at) VALUES
        ('one','One','Address','one@example.test','owner','APPROVED','now','now'),
        ('two','Two','Address','two@example.test','owner','PENDING','now','now');
        INSERT INTO school_members(id,school_id,user_id,role,status,created_at,updated_at) VALUES
        ('m1','one','owner','OWNER','ACTIVE','now','now'),('m2','one','teacher','TEACHER','ACTIVE','now','now'),
        ('m3','one','invited','TEACHER','INVITED','now','now'),('m4','two','owner','OWNER','ACTIVE','now','now');`);
      const env = { DB: adapter(db) } as unknown as Env;
      const owner = user('owner'), teacher = user('teacher'), invited = user('invited'), outsider = user('outsider');
      const input = { title: 'Reading', subject: 'English', week: 3, content: 'Objectives' };
      await expect(createLessonPlan(env, invited, 'one', input)).rejects.toMatchObject({ status: 403 });
      await expect(createLessonPlan(env, outsider, 'one', input)).rejects.toMatchObject({ status: 403 });
      await expect(createLessonPlan(env, owner, 'two', input)).rejects.toMatchObject({ status: 403 });
      await expect(createLessonPlan(env, user('owner', 'STUDENT'), 'one', input)).rejects.toMatchObject({ status: 403 });
      const plan = await createLessonPlan(env, teacher, 'one', input);
      expect(await listLessonPlans(env, teacher, 'one')).toMatchObject([{ id: plan.id, ...input }]);
      expect(await listLessonPlans(env, owner, 'one')).toEqual([]);
      await expect(updateLessonPlan(env, owner, 'one', plan.id, input)).rejects.toMatchObject({ status: 404 });
      await expect(deleteLessonPlan(env, owner, 'one', plan.id)).rejects.toMatchObject({ status: 404 });
      await updateLessonPlan(env, teacher, 'one', plan.id, { ...input, title: 'Reading revised', week: null });
      expect(await listLessonPlans(env, teacher, 'one')).toMatchObject([{ title: 'Reading revised', week: null }]);
      db.exec("UPDATE school_members SET status='REMOVED' WHERE id='m2'");
      await expect(listLessonPlans(env, teacher, 'one')).rejects.toMatchObject({ status: 403 });
      await expect(deleteLessonPlan(env, teacher, 'one', plan.id)).rejects.toMatchObject({ status: 403 });
      db.exec("UPDATE school_members SET status='ACTIVE' WHERE id='m2'");
      await deleteLessonPlan(env, teacher, 'one', plan.id);
      expect(await listLessonPlans(env, teacher, 'one')).toEqual([]);
    } finally { db.close(); }
  });
});
