import { describe, expect, it } from 'vitest';
import schemaSql from '@worker/lib/runtime-schema.sql';
import { getSchoolLogo, saveSchoolLogo, inviteTeacher, listMySchools, listSchoolApplications, listSchoolMembers, registerSchool, removeSchoolMember, respondSchoolInvitation, reviewSchool } from '@worker/services/school-service';
import type { AuthUser } from '@worker/lib/auth-types';
import type { Env } from '@worker/env';
interface Statement { get(...params: unknown[]): unknown; all(...params: unknown[]): unknown[]; run(...params: unknown[]): { changes: number | bigint } }
interface Database { exec(sql: string): void; prepare(sql: string): Statement; close(): void }
function adapter(db: Database) {
  return {
    prepare(sql: string) { let values: unknown[] = []; const statement = db.prepare(sql); return {
      bind(...params: unknown[]) { values = params; return this; },
      async first<T>() { return (statement.get(...values) as T | undefined) ?? null; },
      async all<T>() { return { results: statement.all(...values) as T[] }; },
      async run() { return { meta: { changes: Number(statement.run(...values).changes) } }; },
    }; },
    async batch(statements: Array<{run: () => Promise<unknown>}>) { db.exec('BEGIN'); try { const result = []; for (const statement of statements) result.push(await statement.run()); db.exec('COMMIT'); return result; } catch (e) { db.exec('ROLLBACK'); throw e; } },
  };
}
function user(id: string, role: AuthUser['role']): AuthUser {
  return { id, role, email: `${id}@example.test`, username: null, status: 'ACTIVE', displayName: id, avatarUrl: null, createdAt: '', lastLoginAt: null };
}
describe('school registration and invitation permissions', () => {
  it('requires approval, allows only owners to invite, and requires teachers to accept', async () => {
    const specifier = 'node:sqlite';
    const sqlite = await import(/* @vite-ignore */ specifier).catch(() => null) as { DatabaseSync: new (path: string) => Database } | null;
    if (!sqlite) return;
    const db = new sqlite.DatabaseSync(':memory:');
    try {
      db.exec(schemaSql); db.exec('PRAGMA foreign_keys=OFF');
      db.exec(`INSERT INTO users (id,email,role,status,created_at,updated_at) VALUES
        ('owner','owner@example.test','TEACHER','ACTIVE','now','now'),
        ('teacher','teacher@example.test','TEACHER','ACTIVE','now','now'),
        ('student','student@example.test','STUDENT','ACTIVE','now','now'),
        ('admin','admin@example.test','ADMIN','ACTIVE','now','now');`);
      const env = { DB: adapter(db) } as unknown as Env;
      const owner=user('owner','TEACHER'), teacher=user('teacher','TEACHER'), student=user('student','STUDENT'), admin=user('admin','ADMIN');
      await expect(registerSchool(env,student,{name:'Không hợp lệ',address:'Biên Hòa',contactEmail:'x@example.test'})).rejects.toMatchObject({status:403});
      const school = await registerSchool(env,owner,{name:'Trường thử',address:'Biên Hòa',contactEmail:'CONTACT@example.test'});
      await expect(inviteTeacher(env,owner,school.id,teacher.email)).rejects.toMatchObject({status:409});
      await expect(listSchoolApplications(env,student)).rejects.toMatchObject({status:403});
      await expect(reviewSchool(env,student,school.id,'APPROVED','')).rejects.toMatchObject({status:403});
      await reviewSchool(env,admin,school.id,'APPROVED','Đã xác minh');
      await expect(saveSchoolLogo(env,teacher,school.id,'image/png','aGVsbG8=')).rejects.toMatchObject({status:403});
      await expect(saveSchoolLogo(env,owner,school.id,'image/png','aGVsbG8=')).rejects.toMatchObject({status:400});
      const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZ0AAAAASUVORK5CYII=';
      await saveSchoolLogo(env,owner,school.id,'image/png',png);
      expect(await getSchoolLogo(env,school.id)).toEqual({mime:'image/png',data_b64:png});
      await expect(reviewSchool(env,admin,school.id,'REJECTED','Đã xử lý')).rejects.toMatchObject({status:409});
      await expect(inviteTeacher(env,student,school.id,teacher.email)).rejects.toMatchObject({status:403});
      await expect(inviteTeacher(env,owner,school.id,student.email)).rejects.toMatchObject({status:404});
      await inviteTeacher(env,owner,school.id,teacher.email);
      expect(await listMySchools(env,teacher)).toMatchObject([{id:school.id,member_status:'INVITED'}]);
      await expect(listSchoolMembers(env,teacher,school.id)).rejects.toMatchObject({status:403});
      await expect(removeSchoolMember(env,student,school.id,teacher.id)).rejects.toMatchObject({status:403});
      await respondSchoolInvitation(env,teacher,school.id,true);
      expect(await listSchoolMembers(env,owner,school.id)).toEqual(expect.arrayContaining([expect.objectContaining({user_id:'teacher',status:'ACTIVE'})]));
      await removeSchoolMember(env,owner,school.id,teacher.id);
      await expect(respondSchoolInvitation(env,teacher,school.id,true)).rejects.toMatchObject({status:409});
      await inviteTeacher(env,owner,school.id,teacher.email);
      await removeSchoolMember(env,owner,school.id,teacher.id);
      await expect(respondSchoolInvitation(env,teacher,school.id,true)).rejects.toMatchObject({status:409});
      await expect(removeSchoolMember(env,owner,school.id,owner.id)).rejects.toMatchObject({status:409});
    } finally { db.close(); }
  });
});
