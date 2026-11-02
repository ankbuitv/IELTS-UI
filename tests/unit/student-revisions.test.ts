import {describe,it,expect} from 'vitest';
import schema from '@worker/lib/runtime-schema.sql';
import {studentRevisions} from '@worker/services/student-revisions';
import type {Env} from '@worker/env';
import type {AuthUser} from '@worker/lib/auth-types';
interface Stmt {get(...args:unknown[]):unknown; all(...args:unknown[]):unknown[]; run(...args:unknown[]):{changes:number|bigint}}
interface DB {exec(sql:string):void; prepare(sql:string):Stmt; close():void}
function adapter(db:DB){return {prepare(sql:string){const stmt=db.prepare(sql);let args:unknown[]=[];return {bind(...values:unknown[]){args=values;return this;},async first(){return stmt.get(...args)??null;},async all(){return {results:stmt.all(...args)};},async run(){return {meta:{changes:Number(stmt.run(...args).changes)}};}};}};}
const user=(id:string):AuthUser=>({id,role:'TEACHER',email:`${id}@test`,status:'ACTIVE',username:null,displayName:id,avatarUrl:null,createdAt:'',lastLoginAt:null});
describe('student revisions',()=>{it('only shows own latest returned revisions where permitted and available',async()=>{
 const module='node:sqlite';const {DatabaseSync}=await import(/* @vite-ignore */ module) as {DatabaseSync:new(path:string)=>DB};const db=new DatabaseSync(':memory:');
 try{db.exec(schema);db.exec('PRAGMA foreign_keys=OFF');db.exec(`INSERT INTO classrooms(id,name,teacher_id,join_code,status,created_at,updated_at) VALUES('c','Class','owner','123','ACTIVE','n','n');
 INSERT INTO classroom_members(id,classroom_id,user_id,role,status,joined_at,updated_at) VALUES('m1','c','s','STUDENT','ACTIVE','n','n'),('m2','c','s2','STUDENT','ACTIVE','n','n');
 INSERT INTO assignments(id,classroom_id,teacher_id,test_id,test_version_id,title,status,result_visibility,deadline_at,created_at,updated_at) VALUES('a','c','owner','test','v','Writing','ACTIVE','IMMEDIATE',NULL,'n','n'),('b','c','owner','test','v','Hidden','ACTIVE','NO_REVIEW',NULL,'n','n'),('f','c','owner','test','v','Future','ACTIVE','AFTER_DEADLINE','9999-01-01T00:00:00.000Z','n','n');
 INSERT INTO attempts(id,user_id,assignment_id,test_id,test_version_id,test_type,result_visibility,status,started_at,submitted_at,created_at,updated_at) VALUES('t1','s','a','test','v','WRITING','IMMEDIATE','SUBMITTED','n','n','n','n'),('t2','s','b','test','v','WRITING','IMMEDIATE','SUBMITTED','n','n','n','n'),('t3','s2','a','test','v','WRITING','IMMEDIATE','SUBMITTED','n','n','n','n'),('t4','s','f','test','v','FULL_MOCK','IMMEDIATE','SUBMITTED','n','n','n','n');
 INSERT INTO writing_submissions(id,attempt_id,skill_session_id,test_version_id,created_at,updated_at) VALUES('w1','t1','ss','v','n','n'),('w2','t2','ss','v','n','n'),('w3','t3','ss','v','n','n'),('w4','t4','ss','v','n','n');
 INSERT INTO writing_review_versions(id,writing_submission_id,version,response_text,state,created_at,reviewed_at) VALUES('v1','w1',1,'private','RETURNED','n','n'),('v2','w2',1,'private','RETURNED','n','n'),('v3','w3',1,'private','RETURNED','n','n'),('v4','w4',1,'private','RETURNED','n','n');
 INSERT INTO class_worksheets(id,classroom_id,author_id,title,status,created_at) VALUES('sheet','c','owner','Sheet','ACTIVE','n'),('closed','c','owner','Closed','CLOSED','n');
 INSERT INTO class_worksheet_versions(id,worksheet_id,student_id,version,answers_json,state,created_at,reviewed_at) VALUES('sv','sheet','s',1,'[]','RETURNED','n','n'),('cv','closed','s',1,'[]','RETURNED','n','n');`);
 const env={DB:adapter(db)} as unknown as Env;const student={...user('s'),role:'STUDENT' as const};let result=await studentRevisions(env,student);expect(result.writing).toMatchObject([{submission_id:'w1'}]);expect(result.worksheets).toMatchObject([{worksheet_id:'sheet'}]);expect(JSON.stringify(result)).not.toContain('private');await expect(studentRevisions(env,user('owner'))).rejects.toMatchObject({status:403});db.exec("INSERT INTO writing_review_versions(id,writing_submission_id,version,response_text,state,created_at) VALUES('next','w1',2,'new','SUBMITTED','n')");result=await studentRevisions(env,student);expect(result.writing).toEqual([]);
 }finally{db.close();}
});});
