import { describe, expect, it } from 'vitest';
import schemaSql from '@worker/lib/runtime-schema.sql';
import { createLessonPlan, listPlanVersions, mySubmissions, reviewAccess, reviewLessonSubmission, reviewSubmissions, submitLessonPlan, updateLessonPlan } from '@worker/services/lesson-plan-service';
import { deleteSubjectGroup, saveSubjectGroup } from '@worker/services/school-operations-service';
import { listSchoolPermissions, schoolPermissions, setSchoolPermissions } from '@worker/services/school-permissions';
import type { AuthUser } from '@worker/lib/auth-types';
import type { Env } from '@worker/env';
interface Statement { get(...args:unknown[]):unknown; all(...args:unknown[]):unknown[]; run(...args:unknown[]):{changes:number|bigint} }
interface Database { exec(sql:string):void;prepare(sql:string):Statement;close():void }
function adapter(db:Database){return {prepare(sql:string){let values:unknown[]=[];const statement=db.prepare(sql);return {bind(...v:unknown[]){values=v;return this;},async first(){return statement.get(...values)??null;},async all(){return {results:statement.all(...values)};},async run(){return {meta:{changes:Number(statement.run(...values).changes)}};}};},async batch(statements:Array<{run:()=>Promise<unknown>}>){db.exec('BEGIN');try{const results=[];for(const stmt of statements)results.push(await stmt.run());db.exec('COMMIT');return results;}catch(e){db.exec('ROLLBACK');throw e;}}};}
function user(id:string):AuthUser{return{id,email:`${id}@example.test`,username:null,role:'TEACHER',status:'ACTIVE',displayName:id,avatarUrl:null,createdAt:'',lastLoginAt:null};}
describe('school lesson submission workflow',()=>{
 it('saves revisions, scopes reviewers to their groups, prevents self-review and preserves submission snapshots',async()=>{
  const specifier='node:sqlite';const sqlite=await import(/* @vite-ignore */ specifier) as {DatabaseSync:new(path:string)=>Database};const db=new sqlite.DatabaseSync(':memory:');
  try{db.exec(schemaSql);db.exec('PRAGMA foreign_keys=OFF');db.exec(`INSERT INTO users(id,email,role,status,created_at,updated_at) VALUES ('owner','owner@example.test','TEACHER','ACTIVE','now','now'),('author','author@example.test','TEACHER','ACTIVE','now','now'),('leader','leader@example.test','TEACHER','ACTIVE','now','now'),('other','other@example.test','TEACHER','ACTIVE','now','now');
   INSERT INTO schools(id,name,address,contact_email,owner_user_id,status,created_at,updated_at) VALUES('school','Test','Address','x@example.test','owner','APPROVED','now','now');
   INSERT INTO school_members(id,school_id,user_id,role,status,created_at,updated_at) VALUES('1','school','owner','OWNER','ACTIVE','now','now'),('2','school','author','TEACHER','ACTIVE','now','now'),('3','school','leader','TEACHER','ACTIVE','now','now'),('4','school','other','TEACHER','ACTIVE','now','now');`);
   const env={DB:adapter(db)} as unknown as Env;const owner=user('owner'),author=user('author'),leader=user('leader'),other=user('other');const group=await saveSubjectGroup(env,owner,'school',null,{name:'English',leaderId:'leader',memberIds:['leader','author']});
   const data={title:'First draft',subject:'English',week:1,content:'Before'};const plan=await createLessonPlan(env,author,'school',data);await updateLessonPlan(env,author,'school',plan.id,{...data,title:'Revision',content:'Submitted content'});expect((await listPlanVersions(env,author,'school',plan.id))).toHaveLength(2);await expect(listPlanVersions(env,other,'school',plan.id)).rejects.toMatchObject({status:404});
   await expect(setSchoolPermissions(env,other,'school','other',['MANAGE_GROUPS'])).rejects.toMatchObject({status:403});
   await setSchoolPermissions(env,owner,'school','other',['MANAGE_GROUPS']);
   expect(await schoolPermissions(env,other,'school')).toEqual(['MANAGE_GROUPS']);
   expect(await listSchoolPermissions(env,owner,'school')).toMatchObject([{user_id:'other',permission:'MANAGE_GROUPS'}]);
   await expect(saveSubjectGroup(env,other,'school',null,{name:'Escalation',leaderId:'other',memberIds:['other']})).rejects.toMatchObject({status:403});
   await expect(reviewSubmissions(env,other,'school')).rejects.toMatchObject({status:403});
   expect(await reviewAccess(env,leader,'school')).toBe(true);expect(await reviewAccess(env,other,'school')).toBe(false);await expect(reviewSubmissions(env,other,'school')).rejects.toMatchObject({status:403});
   await submitLessonPlan(env,author,'school',plan.id,group.id);await expect(submitLessonPlan(env,author,'school',plan.id,group.id)).rejects.toMatchObject({status:409});const review=await reviewSubmissions(env,leader,'school') as Array<{id:string;content:string;status:string}>;expect(review).toHaveLength(1);await updateLessonPlan(env,author,'school',plan.id,{...data,content:'Changed later'});expect((await reviewSubmissions(env,leader,'school') as Array<{content:string}>)[0]?.content).toBe('Submitted content');
   await expect(reviewLessonSubmission(env,other,'school',review[0]!.id,'APPROVED','')).rejects.toMatchObject({status:403});
   await setSchoolPermissions(env,owner,'school','other',['REVIEW_ALL']);
   expect(await reviewAccess(env,other,'school')).toBe(true);
   expect(await reviewSubmissions(env,other,'school')).toHaveLength(1);
   await setSchoolPermissions(env,owner,'school','other',[]);
   expect(await reviewAccess(env,other,'school')).toBe(false);await expect(reviewLessonSubmission(env,leader,'school',review[0]!.id,'RETURNED','')).rejects.toMatchObject({status:400});await reviewLessonSubmission(env,leader,'school',review[0]!.id,'RETURNED','Cần sửa mục tiêu');expect(await mySubmissions(env,author,'school',plan.id)).toMatchObject([{status:'RETURNED',comment:'Cần sửa mục tiêu'}]);await expect(reviewLessonSubmission(env,owner,'school',review[0]!.id,'APPROVED','')).rejects.toMatchObject({status:409});
   await submitLessonPlan(env,author,'school',plan.id,group.id);const pending=(await reviewSubmissions(env,owner,'school') as Array<{id:string;status:string}>).find(x=>x.status==='PENDING')!;await reviewLessonSubmission(env,owner,'school',pending.id,'APPROVED','Tốt');await expect(deleteSubjectGroup(env,owner,'school',group.id)).rejects.toMatchObject({status:409});
   const self=await createLessonPlan(env,leader,'school',data);await submitLessonPlan(env,leader,'school',self.id,group.id);const selfSubmission=(await reviewSubmissions(env,leader,'school') as Array<{id:string;author_id:string}>).find(x=>x.author_id==='leader')!;await expect(reviewLessonSubmission(env,leader,'school',selfSubmission.id,'APPROVED','')).rejects.toMatchObject({status:409});
   db.exec("UPDATE school_members SET status='REMOVED' WHERE user_id='leader'");await expect(reviewSubmissions(env,leader,'school')).rejects.toMatchObject({status:403});
  }finally{db.close();}
 });
});
