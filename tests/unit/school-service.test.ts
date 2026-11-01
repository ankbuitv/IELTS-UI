import { describe, expect, it } from 'vitest';
import schemaSql from '@worker/lib/runtime-schema.sql';
import { grantSchoolManager, revokeSchoolManager, isSchoolManager, canReviewSchoolApplications, listSchoolReviewers, grantSchoolReviewer, revokeSchoolReviewer, getSchoolLogo, saveSchoolLogo, inviteTeacher, listMySchools, listSchoolApplications, listSchoolMembers, registerSchool, removeSchoolMember, respondSchoolInvitation, reviewSchool } from '@worker/services/school-service';
import { setSchoolPermissions, schoolPermissions } from '@worker/services/school-permissions';
import { schoolOverview, eligibleSchoolClasses, setSchoolClassLink, transferSchoolClass, getSchoolBanner, saveSchoolBanner, deleteSchoolBanner, studentSchoolBanners } from '@worker/services/school-insights-service';
import { teacherProgress } from '@worker/services/teacher-progress-service';
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
        ('mentor','mentor@example.test','MENTOR','ACTIVE','now','now'),
        ('student','student@example.test','STUDENT','ACTIVE','now','now'),
        ('admin','admin@example.test','ADMIN','ACTIVE','now','now');`);
      const env = { DB: adapter(db) } as unknown as Env;
      const owner=user('owner','TEACHER'), teacher=user('teacher','TEACHER'), student=user('student','STUDENT'), admin=user('admin','ADMIN'), mentor=user('mentor','MENTOR');
      expect(await isSchoolManager(env,admin)).toBe(true);
      expect(await isSchoolManager(env,{...admin,status:'SUSPENDED'})).toBe(false);
      const adminSchool = await registerSchool(env,admin,{name:'Trường admin',address:'Biên Hòa',contactEmail:'admin-school@example.test'});
      expect((await listMySchools(env,admin)).find(s => (s as {id:string}).id === adminSchool.id)).toMatchObject({status:'PENDING',member_role:'OWNER'});
      await expect(registerSchool(env,student,{name:'Không hợp lệ',address:'Biên Hòa',contactEmail:'x@example.test'})).rejects.toMatchObject({status:403});
      await expect(registerSchool(env,mentor,{name:'Không hợp lệ',address:'Biên Hòa',contactEmail:'x@example.test'})).rejects.toMatchObject({status:403});
      await expect(grantSchoolManager(env,student,owner.email)).rejects.toMatchObject({status:403});
      await expect(grantSchoolManager(env,admin,student.email)).rejects.toMatchObject({status:404});
      await grantSchoolManager(env,admin,mentor.email);
      expect(await isSchoolManager(env,mentor)).toBe(true);
      await revokeSchoolManager(env,admin,mentor.id);
      expect(await isSchoolManager(env,mentor)).toBe(false);
      expect(await isSchoolManager(env,owner)).toBe(true);
      await expect(reviewSchool(env,admin,adminSchool.id,'APPROVED','')).rejects.toMatchObject({status:403});
      await expect(listSchoolApplications(env,teacher)).rejects.toMatchObject({status:403});
      await expect(grantSchoolReviewer(env,teacher,teacher.email)).rejects.toMatchObject({status:403});
      await expect(grantSchoolReviewer(env,admin,student.email)).rejects.toMatchObject({status:404});
      await grantSchoolReviewer(env,admin,teacher.email);
      expect(await canReviewSchoolApplications(env,teacher)).toBe(true);
      await expect(grantSchoolReviewer(env,teacher,mentor.email)).rejects.toMatchObject({status:403});
      await expect(grantSchoolManager(env,teacher,mentor.email)).rejects.toMatchObject({status:403});
      expect(await listSchoolReviewers(env,admin)).toMatchObject([{id:teacher.id}]);
      await reviewSchool(env,teacher,adminSchool.id,'APPROVED','Đã xác minh');
      await revokeSchoolReviewer(env,admin,teacher.id);
      expect(await canReviewSchoolApplications(env,teacher)).toBe(false);
      await expect(reviewSchool(env,teacher,adminSchool.id,'APPROVED','')).rejects.toMatchObject({status:403});
      await expect(listSchoolApplications(env,teacher)).rejects.toMatchObject({status:403});
      const school = await registerSchool(env,owner,{name:'Trường thử',address:'Biên Hòa',contactEmail:'CONTACT@example.test'});
      await expect(inviteTeacher(env,owner,school.id,teacher.email)).rejects.toMatchObject({status:409});
      await grantSchoolReviewer(env,admin,owner.email);
      await expect(reviewSchool(env,owner,school.id,'APPROVED','')).rejects.toMatchObject({status:403});
      await revokeSchoolReviewer(env,admin,owner.id);
      await expect(listSchoolApplications(env,student)).rejects.toMatchObject({status:403});
      await expect(reviewSchool(env,student,school.id,'APPROVED','')).rejects.toMatchObject({status:403});
      await reviewSchool(env,admin,school.id,'APPROVED','Đã xác minh');
      await revokeSchoolManager(env,admin,owner.id);
      expect(await isSchoolManager(env,owner)).toBe(true);
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
      await setSchoolPermissions(env,owner,school.id,teacher.id,['MANAGE_CALENDAR']);
      expect(await schoolPermissions(env,teacher,school.id)).toContain('MANAGE_CALENDAR');
      await removeSchoolMember(env,owner,school.id,teacher.id);
      await expect(respondSchoolInvitation(env,teacher,school.id,true)).rejects.toMatchObject({status:409});
      await inviteTeacher(env,owner,school.id,teacher.email);
      await respondSchoolInvitation(env,teacher,school.id,true);
      expect(await schoolPermissions(env,teacher,school.id)).toEqual([]);
      await removeSchoolMember(env,owner,school.id,teacher.id);
      await expect(respondSchoolInvitation(env,teacher,school.id,true)).rejects.toMatchObject({status:409});
      await expect(removeSchoolMember(env,owner,school.id,owner.id)).rejects.toMatchObject({status:409});
    } finally { db.close(); }
  });
});

describe('school insights privacy and reporting', () => {
  it('scopes banners, aggregate access and assignment metrics to explicit active relationships', async () => {
    const specifier='node:sqlite'; const sqlite=await import(/* @vite-ignore */ specifier).catch(()=>null) as {DatabaseSync:new(path:string)=>Database}|null;if(!sqlite)return;
    const db=new sqlite.DatabaseSync(':memory:');try {
      db.exec(schemaSql); db.exec('PRAGMA foreign_keys=OFF');
      db.exec(`INSERT INTO users(id,email,role,status,created_at,updated_at) VALUES
      ('owner','owner@example.test','TEACHER','ACTIVE','now','now'),('other','other@example.test','TEACHER','ACTIVE','now','now'),('cot','cot@example.test','TEACHER','ACTIVE','now','now'),('reviewer','reviewer@example.test','MENTOR','ACTIVE','now','now'),('admin','admin@example.test','ADMIN','ACTIVE','now','now'),('s1','s1@example.test','STUDENT','ACTIVE','now','now'),('s2','s2@example.test','STUDENT','ACTIVE','now','now'),('outsider','out@example.test','STUDENT','ACTIVE','now','now');
      INSERT INTO schools(id,name,address,contact_email,owner_user_id,status,created_at,updated_at) VALUES ('sch','A','City','x@x.test','owner','APPROVED','now','now'),('sch2','B','City','y@x.test','other','APPROVED','now','now');
      INSERT INTO school_members(id,school_id,user_id,role,status,created_at,updated_at) VALUES ('m1','sch','owner','OWNER','ACTIVE','now','now'),('m2','sch2','other','OWNER','ACTIVE','now','now'),('m3','sch2','owner','TEACHER','ACTIVE','now','now');
      INSERT INTO classrooms(id,name,teacher_id,join_code,status,created_at,updated_at) VALUES ('c1','Class One','owner','A','ACTIVE','now','now'),('c2','Class Two','other','B','ACTIVE','now','now');
      INSERT INTO classroom_members(id,classroom_id,user_id,role,status,joined_at,updated_at) VALUES ('cm1','c1','s1','STUDENT','ACTIVE','now','now'),('cm2','c1','s2','STUDENT','ACTIVE','now','now'),('cm3','c1','cot','CO_TEACHER','ACTIVE','now','now'),('cm4','c2','outsider','STUDENT','ACTIVE','now','now');
      INSERT INTO assignments(id,classroom_id,teacher_id,test_id,test_version_id,title,status,created_at,updated_at) VALUES ('a1','c1','owner','t','v','Essay','ACTIVE','now','now'),('a2','c2','other','t','v','Other','ACTIVE','now','now');
      INSERT INTO attempts(id,user_id,assignment_id,test_id,test_version_id,test_type,status,started_at,submitted_at,estimated_band,created_at,updated_at) VALUES ('t1','s1','a1','t','v','READING','SUBMITTED','1','1',5,'1','1'),('t2','s1','a1','t','v','READING','SUBMITTED','2','2',7,'2','2'),('t3','s2','a1','t','v','READING','IN_PROGRESS','3',NULL,NULL,'3','3');`);
      const env={DB:adapter(db)} as unknown as Env;const owner=user('owner','TEACHER'),other=user('other','TEACHER'),cot=user('cot','TEACHER'),admin=user('admin','ADMIN'),reviewer=user('reviewer','MENTOR'),s1=user('s1','STUDENT'),outsider=user('outsider','STUDENT');
      await expect(schoolOverview(env,owner)).rejects.toMatchObject({status:403});await expect(schoolOverview(env,reviewer)).rejects.toMatchObject({status:403});
      await grantSchoolReviewer(env,admin,reviewer.email);expect(await schoolOverview(env,reviewer)).toHaveLength(2);
      await expect(saveSchoolBanner(env,other,'sch',{title:'A',message:'Hello',theme:'blue',active:true,image:null})).rejects.toMatchObject({status:403});
      await saveSchoolBanner(env,owner,'sch',{title:'A',message:'Hello',theme:'blue',active:true,image:null});
      expect(await studentSchoolBanners(env,s1)).toHaveLength(0);
      await expect(setSchoolClassLink(env,owner,'sch','c2',true)).rejects.toMatchObject({status:403});
      await setSchoolClassLink(env,owner,'sch','c1',true);
      expect(await eligibleSchoolClasses(env,owner,'sch')).toMatchObject([{id:'c1',linked_school_id:'sch'}]);
      await expect(setSchoolClassLink(env,other,'sch2','c1',true)).rejects.toMatchObject({status:409});
      expect(await studentSchoolBanners(env,s1)).toMatchObject([{school_id:'sch',title:'A'}]);expect(await studentSchoolBanners(env,outsider)).toHaveLength(0);
      db.exec("INSERT INTO classroom_members(id,classroom_id,user_id,role,status,joined_at,updated_at) VALUES ('cm5','c2','s1','STUDENT','ACTIVE','now','now')");
      await setSchoolClassLink(env,other,'sch2','c2',true);await saveSchoolBanner(env,other,'sch2',{title:'B',message:'Hello',theme:'green',active:true,image:null});
      expect(await studentSchoolBanners(env,s1)).toHaveLength(2);
      expect(await schoolOverview(env,reviewer)).toEqual(expect.arrayContaining([expect.objectContaining({id:'sch',class_count:1,student_count:2,assignment_count:1,assigned_count:2,submitted_count:1,average_band:7})]));
      expect(await teacherProgress(env,cot)).toMatchObject([{assignment_id:'a1',assigned_count:2,submitted_count:1,average_band:7}]);
      expect(await teacherProgress(env,other)).toMatchObject([{assignment_id:'a2',assigned_count:2,submitted_count:0,average_band:null}]);
      await expect(teacherProgress(env,s1)).rejects.toMatchObject({status:403});
      // A class may be moved only by the representative of both schools; the old
      // school must stop counting it and its pupils must see the destination banner.
      db.exec(`INSERT INTO schools(id,name,address,contact_email,owner_user_id,status,created_at,updated_at) VALUES ('lumi','Lumi','City','l@x.test','owner','APPROVED','now','now');
        INSERT INTO school_members(id,school_id,user_id,role,status,created_at,updated_at) VALUES ('m4','lumi','owner','OWNER','ACTIVE','now','now');`);
      await saveSchoolBanner(env,owner,'lumi',{title:'Lumi',message:'Welcome',theme:'blue',active:true,image:null});
      expect(await eligibleSchoolClasses(env,owner,'lumi')).toMatchObject([{id:'c1',linked_school_id:'sch',linked_school_name:'A',can_transfer:1}]);
      expect(await eligibleSchoolClasses(env,other,'sch2')).toEqual(expect.arrayContaining([expect.objectContaining({id:'c1',linked_school_id:'sch',linked_school_name:null,can_transfer:0})]));
      await expect(transferSchoolClass(env,other,'sch2','c1','sch')).rejects.toMatchObject({status:403});
      await expect(transferSchoolClass(env,owner,'lumi','c1','sch2')).rejects.toMatchObject({status:403});
      db.exec("UPDATE school_members SET status='REMOVED' WHERE id='m4'");
      await expect(transferSchoolClass(env,owner,'lumi','c1','sch')).rejects.toMatchObject({status:409});
      db.exec("UPDATE school_members SET status='ACTIVE' WHERE id='m4'");
      await transferSchoolClass(env,owner,'lumi','c1','sch');
      expect(await studentSchoolBanners(env,s1)).toEqual(expect.arrayContaining([expect.objectContaining({school_id:'lumi',title:'Lumi'})]));
      expect((await studentSchoolBanners(env,s1)).some((b:unknown)=>(b as {school_id:string}).school_id==='sch')).toBe(false);
      expect(await schoolOverview(env,reviewer)).toEqual(expect.arrayContaining([expect.objectContaining({id:'sch',class_count:0}),expect.objectContaining({id:'lumi',class_count:1})]));
      await expect(transferSchoolClass(env,owner,'lumi','c1','sch')).rejects.toMatchObject({status:409});
      await expect(deleteSchoolBanner(env,other,'lumi')).rejects.toMatchObject({status:403});
      await saveSchoolBanner(env,owner,'lumi',{title:'Updated',message:'Changed',theme:'green',active:true,image:null});
      expect(await getSchoolBanner(env,owner,'lumi')).toMatchObject({title:'Updated',message:'Changed',theme:'green',active:1});
      expect(await studentSchoolBanners(env,s1)).toEqual(expect.arrayContaining([expect.objectContaining({school_id:'lumi',title:'Updated'})]));
      await deleteSchoolBanner(env,owner,'lumi');expect(await getSchoolBanner(env,owner,'lumi')).toBeNull();
      expect((await studentSchoolBanners(env,s1)).some((b:unknown)=>(b as {school_id:string}).school_id==='lumi')).toBe(false);
      await deleteSchoolBanner(env,owner,'lumi'); // idempotent
      await transferSchoolClass(env,owner,'sch','c1','lumi');
      db.exec("UPDATE school_members SET status='REMOVED' WHERE id='m1'");expect(await studentSchoolBanners(env,s1)).toMatchObject([{school_id:'sch2'}]);expect(await schoolOverview(env,reviewer)).toEqual(expect.arrayContaining([expect.objectContaining({id:'sch',class_count:0,student_count:0})]));
      await revokeSchoolReviewer(env,admin,reviewer.id);await expect(schoolOverview(env,reviewer)).rejects.toMatchObject({status:403});
    } finally {db.close();}
  });
});
