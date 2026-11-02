import {describe,it,expect} from 'vitest';
import schema from '@worker/lib/runtime-schema.sql';
import {classQuestionAnalysis} from '@worker/services/class-question-analysis';
import type {Env} from '@worker/env';
import type {AuthUser} from '@worker/lib/auth-types';
interface Stmt {get(...args:unknown[]):unknown; all(...args:unknown[]):unknown[]; run(...args:unknown[]):{changes:number|bigint}}
interface DB {exec(sql:string):void; prepare(sql:string):Stmt; close():void}
function adapter(db:DB){return {prepare(sql:string){const stmt=db.prepare(sql);let args:unknown[]=[];return {bind(...values:unknown[]){args=values;return this;},async first(){return stmt.get(...args)??null;},async all(){return {results:stmt.all(...args)};},async run(){return {meta:{changes:Number(stmt.run(...args).changes)}};}};}};}
const user=(id:string):AuthUser=>({id,role:'TEACHER',email:`${id}@test`,status:'ACTIVE',username:null,displayName:id,avatarUrl:null,createdAt:'',lastLoginAt:null});
describe('class question analysis',()=>{it('limits results to marked authorized assigned work and counts attempts without leaking answers',async()=>{
 const module='node:sqlite';const {DatabaseSync}=await import(/* @vite-ignore */ module) as {DatabaseSync:new(path:string)=>DB};const db=new DatabaseSync(':memory:');
 try{db.exec(schema);db.exec('PRAGMA foreign_keys=OFF');db.exec(`INSERT INTO classrooms(id,name,teacher_id,join_code,status,created_at,updated_at) VALUES('c','Class','owner','123','ACTIVE','n','n');
 INSERT INTO classroom_members(id,classroom_id,user_id,role,status,joined_at,updated_at) VALUES('m1','c','s','STUDENT','ACTIVE','n','n'),('m2','c','left','STUDENT','REMOVED','n','n');
 INSERT INTO assignments(id,classroom_id,teacher_id,test_id,test_version_id,title,status,created_at,updated_at) VALUES('a','c','owner','test','v','Test','ACTIVE','n','n');
 INSERT INTO attempts(id,user_id,assignment_id,test_id,test_version_id,test_type,status,started_at,submitted_at,created_at,updated_at) VALUES('t1','s','a','test','v','READING','SUBMITTED','n','n','n','n'),('t2','left','a','test','v','READING','SUBMITTED','n','n','n','n'),('t3','s','a','test','v','READING','IN_PROGRESS','n',NULL,'n','n'),('t4','s','a','test','v','READING','SUBMITTED','n','n','n','n');
 INSERT INTO attempt_skill_sessions(id,attempt_id,component_index,skill,test_version_id,status,submitted_at,created_at,updated_at) VALUES('x1','t1',1,'READING','v','SUBMITTED','n','n','n'),('x2','t2',1,'READING','v','SUBMITTED','n','n','n'),('x3','t3',1,'READING','v','SUBMITTED','n','n','n'),('x4','t4',1,'READING','v','SUBMITTED','n','n','n');
 INSERT INTO questions(id,test_version_id,section_id,question_group_id,number,prompt,created_at,updated_at) VALUES('q1','v','sec','group',1,'Prompt','n','n'),('q2','v','sec','group',2,'Unmarked','n','n');
 INSERT INTO attempt_answers(id,attempt_id,skill_session_id,question_id,test_version_id,answer_json,is_correct,updated_at) VALUES('ans1','t1','x1','q1','v','SECRET',0,'n'),('ans2','t2','x2','q1','v','SECRET',1,'n'),('ans3','t3','x3','q1','v','SECRET',1,'n'),('ans4','t1','x1','q2','v','SECRET',NULL,'n'),('ans5','t4','x4','q1','v','SECRET',1,'n');`);
 const env={DB:adapter(db)} as unknown as Env;const result=await classQuestionAnalysis(env,user('owner'),'c');expect(result.questions).toEqual([expect.objectContaining({question_id:'q1',marked:2,wrong:1,learners:1,learners_wrong:1})]);expect(JSON.stringify(result)).not.toContain('SECRET');await expect(classQuestionAnalysis(env,user('other'),'c')).rejects.toMatchObject({status:403});
 }finally{db.close();}
});});
