import { describe, expect, it } from 'vitest';
import schemaSql from '@worker/lib/runtime-schema.sql';
import { deleteSchoolEvent, deleteSubjectGroup, listSchoolEvents, listSubjectGroups, saveSchoolEvent, saveSubjectGroup } from '@worker/services/school-operations-service';
import type { AuthUser } from '@worker/lib/auth-types';
import type { Env } from '@worker/env';
interface Statement { get(...params:unknown[]):unknown; all(...params:unknown[]):unknown[]; run(...params:unknown[]):{changes:number|bigint} }
interface Database { exec(sql:string):void;prepare(sql:string):Statement;close():void }
function adapter(db:Database) { return { prepare(sql:string) { let values:unknown[]=[];const stmt=db.prepare(sql);return { bind(...params:unknown[]) {values=params;return this;},async first(){return stmt.get(...values)??null;},async all(){return {results:stmt.all(...values)};},async run(){return {meta:{changes:Number(stmt.run(...values).changes)}};} }; }, async batch(statements:Array<{run:()=>Promise<unknown>}>) { db.exec('BEGIN');try{const rows=[];for(const s of statements)rows.push(await s.run());db.exec('COMMIT');return rows;}catch(e){db.exec('ROLLBACK');throw e;} } }; }
function user(id:string,role:AuthUser['role']='TEACHER'):AuthUser{return {id,role,email:`${id}@example.test`,username:null,status:'ACTIVE',displayName:id,avatarUrl:null,createdAt:'',lastLoginAt:null};}
describe('school groups and events permissions',()=>{
 it('limits group and event management to the approved school owner',async()=>{
  const specifier='node:sqlite'; const sqlite=await import(/* @vite-ignore */ specifier) as {DatabaseSync:new(path:string)=>Database};const db=new sqlite.DatabaseSync(':memory:');
  try {db.exec(schemaSql);db.exec('PRAGMA foreign_keys=OFF');db.exec(`INSERT INTO schools(id,name,address,contact_email,owner_user_id,status,created_at,updated_at) VALUES ('s','Test','Address','x@test.dev','owner','APPROVED','now','now'),('pending','Pending','Address','x@test.dev','owner','PENDING','now','now');
    INSERT INTO school_members(id,school_id,user_id,role,status,created_at,updated_at) VALUES ('1','s','owner','OWNER','ACTIVE','now','now'),('2','s','teacher','TEACHER','ACTIVE','now','now'),('3','s','invited','TEACHER','INVITED','now','now'),('4','pending','owner','OWNER','ACTIVE','now','now');`);
   const env={DB:adapter(db)} as unknown as Env;const owner=user('owner'),teacher=user('teacher'),invited=user('invited'),stranger=user('stranger');const group={name:'Tiếng Anh',leaderId:'teacher',memberIds:['teacher','owner']};
   await expect(saveSubjectGroup(env,teacher,'s',null,group)).rejects.toMatchObject({status:403});await expect(listSubjectGroups(env,teacher,'s')).rejects.toMatchObject({status:403});await expect(saveSubjectGroup(env,owner,'pending',null,group)).rejects.toMatchObject({status:403});
   await expect(saveSubjectGroup(env,owner,'s',null,{...group,memberIds:['invited'],leaderId:'invited'})).rejects.toMatchObject({status:400});await expect(saveSubjectGroup(env,owner,'s',null,{...group,memberIds:['teacher'],leaderId:'owner'})).rejects.toMatchObject({status:400});
   const g=await saveSubjectGroup(env,owner,'s',null,group);expect(await listSubjectGroups(env,owner,'s')).toMatchObject([{id:g.id,leader_id:'teacher',memberIds:expect.arrayContaining(['teacher','owner'])}]);await expect(saveSubjectGroup(env,owner,'s',null,{...group,name:'tiếng anh'})).rejects.toMatchObject({status:409});await saveSubjectGroup(env,owner,'s',g.id,{name:'Toán',leaderId:null,memberIds:[]});expect(await listSubjectGroups(env,owner,'s')).toMatchObject([{name:'Toán',memberIds:[]}]);await deleteSubjectGroup(env,owner,'s',g.id);expect(await listSubjectGroups(env,owner,'s')).toEqual([]);
   const event={title:'Họp trường',description:'Ghi chú',startsAt:'2026-11-02T01:00:00.000Z',endsAt:'2026-11-02T02:00:00.000Z'};
   await expect(saveSchoolEvent(env,teacher,'s',null,event)).rejects.toMatchObject({status:403});await expect(listSchoolEvents(env,invited,'s')).rejects.toMatchObject({status:403});await expect(listSchoolEvents(env,stranger,'s')).rejects.toMatchObject({status:403});await expect(saveSchoolEvent(env,owner,'s',null,{...event,endsAt:event.startsAt})).rejects.toMatchObject({status:400});
   const e=await saveSchoolEvent(env,owner,'s',null,event);expect(await listSchoolEvents(env,teacher,'s')).toMatchObject([{id:e.id,title:'Họp trường'}]);await expect(deleteSchoolEvent(env,teacher,'s',e.id)).rejects.toMatchObject({status:403});await saveSchoolEvent(env,owner,'s',e.id,{...event,title:'Lịch mới'});expect(await listSchoolEvents(env,teacher,'s')).toMatchObject([{title:'Lịch mới'}]);await deleteSchoolEvent(env,owner,'s',e.id);expect(await listSchoolEvents(env,teacher,'s')).toEqual([]);
  }finally{db.close();}
 });
});
