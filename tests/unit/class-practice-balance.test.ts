import {describe,it,expect} from 'vitest';
import schema from '@worker/lib/runtime-schema.sql';
import {classPracticeBalance} from '@worker/services/class-practice-balance';
import type {Env} from '@worker/env';
import type {AuthUser} from '@worker/lib/auth-types';
interface Stmt {get(...args:unknown[]):unknown; all(...args:unknown[]):unknown[]; run(...args:unknown[]):{changes:number|bigint}}
interface DB {exec(sql:string):void; prepare(sql:string):Stmt; close():void}
function adapter(db:DB){return {prepare(sql:string){const stmt=db.prepare(sql);let args:unknown[]=[];return {bind(...values:unknown[]){args=values;return this;},async first(){return stmt.get(...args)??null;},async all(){return {results:stmt.all(...args)};},async run(){return {meta:{changes:Number(stmt.run(...args).changes)}};}};}};}
const user=(id:string):AuthUser=>({id,role:'TEACHER',email:`${id}@test`,status:'ACTIVE',username:null,displayName:id,avatarUrl:null,createdAt:'',lastLoginAt:null});
describe('class practice balance',()=>{it('counts only completed class work in the requested range and verifies access',async()=>{
 const module='node:sqlite';const {DatabaseSync}=await import(/* @vite-ignore */ module) as {DatabaseSync:new(path:string)=>DB};const db=new DatabaseSync(':memory:');
 try{db.exec(schema);db.exec('PRAGMA foreign_keys=OFF');db.exec(`INSERT INTO classrooms(id,name,teacher_id,join_code,status,created_at,updated_at) VALUES('c','Class','owner','123','ACTIVE','n','n'),('otherclass','Private','stranger','456','ACTIVE','n','n');
 INSERT INTO classroom_members(id,classroom_id,user_id,role,status,joined_at,updated_at) VALUES('m1','c','s','STUDENT','ACTIVE','n','n'),('m2','c','left','STUDENT','REMOVED','n','n'),('m3','c','co','CO_TEACHER','ACTIVE','n','n');
 INSERT INTO assignments(id,classroom_id,teacher_id,test_id,test_version_id,title,status,created_at,updated_at) VALUES('a','c','owner','test','v','Test','ACTIVE','n','n'),('b','otherclass','stranger','test','v','Private','ACTIVE','n','n');
 INSERT INTO attempts(id,user_id,assignment_id,test_id,test_version_id,test_type,status,started_at,submitted_at,created_at,updated_at) VALUES('t1','s','a','test','v','READING','SUBMITTED','n','n','n','n'),('t2','left','a','test','v','READING','SUBMITTED','n','n','n','n'),('t3','s','b','test','v','READING','SUBMITTED','n','n','n','n');
 INSERT INTO attempt_skill_sessions(id,attempt_id,component_index,skill,test_version_id,status,submitted_at,created_at,updated_at) VALUES('x1','t1',1,'READING','v','SUBMITTED','2026-11-02T10:00:00.000Z','n','n'),('x2','t1',2,'READING','v','SUBMITTED','2026-11-02T11:00:00.000Z','n','n'),('x3','t2',1,'WRITING','v','SUBMITTED','2026-11-02T11:00:00.000Z','n','n'),('x4','t3',1,'LISTENING','v','SUBMITTED','2026-11-02T11:00:00.000Z','n','n');`);
 const env={DB:adapter(db)} as unknown as Env;const result=await classPracticeBalance(env,user('co'),'c','2026-11-02','2026-11-02');expect(result.counts).toEqual([{skill:'LISTENING',count:0},{skill:'READING',count:1},{skill:'WRITING',count:0},{skill:'SPEAKING',count:0}]);expect((await classPracticeBalance(env,user('owner'),'c','2026-11-03','2026-11-03')).counts.every(x=>x.count===0)).toBe(true);await expect(classPracticeBalance(env,user('stranger'),'c','2026-11-02','2026-11-03')).rejects.toMatchObject({status:403});await expect(classPracticeBalance(env,user('owner'),'c','2026-02-30','2026-11-03')).rejects.toMatchObject({status:400});await expect(classPracticeBalance(env,user('owner'),'c','2024-01-01','2026-11-03')).rejects.toMatchObject({status:400});
 }finally{db.close();}
});});
