import { describe,expect,it } from 'vitest';
import schema from '@worker/lib/runtime-schema.sql';
import {listQuestions,createQuestion,updateQuestion,deleteQuestion} from '@worker/services/teacher-question-bank-service';
import { listFeedbackTemplates,createFeedbackTemplate,deleteFeedbackTemplate } from '@worker/services/teacher-feedback-templates-service';
import { readSeating,saveSeating } from '@worker/services/teacher-seating-service';
import { listPrivateNotes,savePrivateNote } from '@worker/services/teacher-private-notes-service';
import { classroomGradebook } from '@worker/services/teacher-gradebook-service';
import { readAttendance,saveAttendance,validAttendanceDate } from '@worker/services/teacher-attendance-service';
import type {Env} from '@worker/env';import type {AuthUser} from '@worker/lib/auth-types';
interface Stmt{get(...p:unknown[]):unknown;all(...p:unknown[]):unknown[];run(...p:unknown[]):{changes:number|bigint}}
interface DB{exec(sql:string):void;prepare(sql:string):Stmt;close():void}
function adapter(db:DB){return{prepare(sql:string){let values:unknown[]=[];const stmt=db.prepare(sql);return{bind(...v:unknown[]){values=v;return this;},async first(){return stmt.get(...values)??null;},async all(){return{results:stmt.all(...values)};},async run(){return{meta:{changes:Number(stmt.run(...values).changes)}};}};},async batch(stmts:Array<{run:()=>Promise<unknown>}>){db.exec('BEGIN');try{const out=[];for(const stmt of stmts)out.push(await stmt.run());db.exec('COMMIT');return out;}catch(e){db.exec('ROLLBACK');throw e;}}};}
function user(id:string):AuthUser{return{id,email:`${id}@example.test`,username:null,role:'TEACHER',status:'ACTIVE',displayName:id,avatarUrl:null,createdAt:'',lastLoginAt:null};}
describe('manual attendance',()=>{it('scopes reads and writes to accessible classes and retains history',async()=>{
 const specifier='node:sqlite';const sqlite=await import(/* @vite-ignore */ specifier) as {DatabaseSync:new(path:string)=>DB};const db=new sqlite.DatabaseSync(':memory:');try{db.exec(schema);db.exec('PRAGMA foreign_keys=OFF');db.exec(`INSERT INTO users(id,email,role,status,created_at,updated_at) VALUES ('t','t@x','TEACHER','ACTIVE','n','n'),('co','co@x','TEACHER','ACTIVE','n','n'),('other','other@x','TEACHER','ACTIVE','n','n'),('s','s@x','STUDENT','ACTIVE','n','n'),('out','out@x','STUDENT','ACTIVE','n','n');
 INSERT INTO classrooms(id,name,teacher_id,join_code,status,created_at,updated_at) VALUES('c','Class','t','T','ACTIVE','n','n');
 INSERT INTO classroom_members(id,classroom_id,user_id,role,status,joined_at,updated_at) VALUES('m1','c','s','STUDENT','ACTIVE','n','n'),('m2','c','co','CO_TEACHER','ACTIVE','n','n');`);
 const env={DB:adapter(db)} as unknown as Env;const teacher=user('t'),co=user('co'),other=user('other');
 expect(validAttendanceDate('2026-02-30')).toBe(false);expect(validAttendanceDate('2024-02-29')).toBe(true);
 await expect(readAttendance(env,other,'c','2026-11-01')).rejects.toMatchObject({status:403});
 await expect(saveAttendance(env,other,'c','2026-11-01',[{studentId:'s',status:'ABSENT'}])).rejects.toMatchObject({status:403});
 await expect(saveAttendance(env,teacher,'c','2026-11-01',[{studentId:'out',status:'PRESENT'}])).rejects.toMatchObject({status:400});
 await expect(saveAttendance(env,teacher,'c','2026-11-01',[{studentId:'s',status:'PRESENT'},{studentId:'s',status:'LATE'}])).rejects.toMatchObject({status:400});
 db.exec(`INSERT INTO assignments(id,classroom_id,teacher_id,test_id,test_version_id,title,status,created_at,updated_at) VALUES('a','c','t','test','v','Test','ACTIVE','n','n'),('draft','c','t','test','v','Draft','DRAFT','n','n');
 INSERT INTO attempts(id,user_id,assignment_id,test_id,test_version_id,test_type,status,started_at,submitted_at,estimated_band,created_at,updated_at) VALUES('att1','s','a','test','v','READING','SUBMITTED','1','1',5,'1','1'),('att2','s','a','test','v','READING','SUBMITTED','2','2',7,'2','2');`);
 await expect(classroomGradebook(env,other,'c')).rejects.toMatchObject({status:403});
 const book=await classroomGradebook(env,co,'c');expect(book.assignments).toMatchObject([{id:'a'}]);expect(book.students).toMatchObject([{user_id:'s'}]);expect(book.cells).toMatchObject([{assignment_id:'a',user_id:'s',estimated_band:7}]);
 const question={skill:'READING' as const,topic:'Travel',question:'Where?',referenceAnswer:'London'};
 const qid=await createQuestion(env,teacher,question);expect(await listQuestions(env,teacher)).toMatchObject([{id:qid,reference_answer:'London'}]);expect(await listQuestions(env,co)).toHaveLength(0);
 await expect(updateQuestion(env,co,qid,question)).rejects.toMatchObject({status:404});await expect(deleteQuestion(env,co,qid)).rejects.toMatchObject({status:404});
 await updateQuestion(env,teacher,qid,{...question,question:'When?'});expect(await listQuestions(env,teacher)).toMatchObject([{id:qid,question:'When?'}]);await deleteQuestion(env,teacher,qid);
 const template=await createFeedbackTemplate(env,teacher,'Needs detail','Please add an example.');
 expect(await listFeedbackTemplates(env,teacher)).toMatchObject([{id:template,title:'Needs detail'}]);
 expect(await listFeedbackTemplates(env,co)).toHaveLength(0);
 await expect(deleteFeedbackTemplate(env,co,template)).rejects.toMatchObject({status:404});
 await deleteFeedbackTemplate(env,teacher,template);expect(await listFeedbackTemplates(env,teacher)).toHaveLength(0);
 await expect(readSeating(env,other,'c')).rejects.toMatchObject({status:403});
 await expect(saveSeating(env,co,'c',['s','s'])).rejects.toMatchObject({status:400});
 await expect(saveSeating(env,co,'c',['out'])).rejects.toMatchObject({status:409});
 await saveSeating(env,co,'c',['s']);
 expect((await readSeating(env,teacher,'c')).students).toMatchObject([{user_id:'s',position:0}]);
 await expect(listPrivateNotes(env,other,'c')).rejects.toMatchObject({status:403});
 await expect(savePrivateNote(env,teacher,'c','out','no')).rejects.toMatchObject({status:404});
 await savePrivateNote(env,teacher,'c','s','private teacher note');
 expect((await listPrivateNotes(env,teacher,'c')).students).toMatchObject([{user_id:'s',body:'private teacher note'}]);
 expect((await listPrivateNotes(env,co,'c')).students).toMatchObject([{user_id:'s',body:null}]);
 await savePrivateNote(env,co,'c','s','co only');
 await savePrivateNote(env,teacher,'c','s','');
 expect((await listPrivateNotes(env,teacher,'c')).students).toMatchObject([{user_id:'s',body:null}]);
 expect((await listPrivateNotes(env,co,'c')).students).toMatchObject([{user_id:'s',body:'co only'}]);
 await saveAttendance(env,co,'c','2026-11-01',[{studentId:'s',status:'LATE'}]);expect((await readAttendance(env,teacher,'c','2026-11-01')).students).toMatchObject([{user_id:'s',status:'LATE'}]);
 await saveAttendance(env,teacher,'c','2026-11-01',[{studentId:'s',status:'ABSENT'}]);expect((await readAttendance(env,co,'c','2026-11-01')).dates).toMatchObject([{attendance_date:'2026-11-01',total:1}]);
 db.exec("UPDATE classroom_members SET status='REMOVED' WHERE id='m1'");expect((await readAttendance(env,teacher,'c','2026-11-01')).students).toMatchObject([{user_id:'s',status:'ABSENT',member_status:'REMOVED'}]);await expect(saveAttendance(env,teacher,'c','2026-11-01',[{studentId:'s',status:'UNMARKED'}])).rejects.toMatchObject({status:400});
 db.exec("UPDATE classroom_members SET status='ACTIVE' WHERE id='m1';UPDATE classrooms SET status='ARCHIVED' WHERE id='c'");await expect(savePrivateNote(env,co,'c','s','edit')).rejects.toMatchObject({status:409});await expect(saveSeating(env,co,'c',['s'])).rejects.toMatchObject({status:409});await expect(saveAttendance(env,teacher,'c','2026-11-01',[{studentId:'s',status:'UNMARKED'}])).rejects.toMatchObject({status:409});expect((await readAttendance(env,co,'c','2026-11-01')).students).toHaveLength(1);
 }finally{db.close();}});});
