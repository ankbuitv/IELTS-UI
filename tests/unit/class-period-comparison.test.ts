import {describe,it,expect} from 'vitest';
import schema from '@worker/lib/runtime-schema.sql';
import {classPeriodComparison} from '@worker/services/class-period-comparison';
import type {Env} from '@worker/env';
import type {AuthUser} from '@worker/lib/auth-types';
interface Stmt {get(...args:unknown[]):unknown; all(...args:unknown[]):unknown[]; run(...args:unknown[]):{changes:number|bigint}}
interface DB {exec(sql:string):void; prepare(sql:string):Stmt; close():void}
function adapter(db:DB){return {prepare(sql:string){const stmt=db.prepare(sql);let args:unknown[]=[];return {bind(...values:unknown[]){args=values;return this;},async first(){return stmt.get(...args)??null;},async all(){return {results:stmt.all(...args)};},async run(){return {meta:{changes:Number(stmt.run(...args).changes)}};}};}};}
const user=(id:string):AuthUser=>({id,role:'TEACHER',email:`${id}@test`,status:'ACTIVE',username:null,displayName:id,avatarUrl:null,createdAt:'',lastLoginAt:null});
describe('class period comparison',()=>{it('compares current outcomes for assignments created in each period, respecting scope and audiences',async()=>{
 const module='node:sqlite';const {DatabaseSync}=await import(/* @vite-ignore */ module) as {DatabaseSync:new(path:string)=>DB};const db=new DatabaseSync(':memory:');
 try{db.exec(schema);db.exec('PRAGMA foreign_keys=OFF');db.exec(`INSERT INTO classrooms(id,name,teacher_id,join_code,status,created_at,updated_at) VALUES('c','Class','owner','123','ACTIVE','n','n');
 INSERT INTO classroom_members(id,classroom_id,user_id,role,status,joined_at,updated_at) VALUES('m1','c','s','STUDENT','ACTIVE','n','n'),('m2','c','s2','STUDENT','ACTIVE','n','n');
 INSERT INTO assignments(id,classroom_id,teacher_id,test_id,test_version_id,title,status,created_at,updated_at) VALUES('a','c','owner','test','v','A','ACTIVE','2026-10-10T01:00:00.000Z','n'),('b','c','owner','test','v','B','CLOSED','2026-11-10T01:00:00.000Z','n');
 INSERT INTO assignment_audiences(assignment_id,expected_count,verified_count) VALUES('b',1,1); INSERT INTO assignment_audience_students(assignment_id,student_id) VALUES('b','s');
 INSERT INTO attempts(id,user_id,assignment_id,test_id,test_version_id,test_type,status,started_at,submitted_at,created_at,updated_at) VALUES('t1','s','a','test','v','READING','SUBMITTED','n','n','n','n'),('t2','s','a','test','v','READING','SUBMITTED','n','n','n','n');`);
 const env={DB:adapter(db)} as unknown as Env;const result=await classPeriodComparison(env,user('owner'),'c','2026-10-01','2026-10-31','2026-11-01','2026-11-30');expect(result.first).toMatchObject({assigned:2,submitted:1});expect(result.second).toMatchObject({assigned:1,submitted:0});await expect(classPeriodComparison(env,user('other'),'c','2026-10-01','2026-10-31','2026-11-01','2026-11-30')).rejects.toMatchObject({status:403});await expect(classPeriodComparison(env,user('owner'),'c','2026-02-30','2026-10-31','2026-11-01','2026-11-30')).rejects.toMatchObject({status:400});
 }finally{db.close();}
});});
