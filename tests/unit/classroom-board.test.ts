import {describe,it,expect} from 'vitest';
import schema from '@worker/lib/runtime-schema.sql';
import {listClassroomBoard,createAnnouncement,pinAnnouncement,deleteAnnouncement,readAnnouncement,createPoll,closePoll,votePoll} from '@worker/services/classroom-board-service';
import type {Env} from '@worker/env';import type {AuthUser} from '@worker/lib/auth-types';
interface Stmt{get(...p:unknown[]):unknown;all(...p:unknown[]):unknown[];run(...p:unknown[]):{changes:number|bigint}}
interface DB{exec(sql:string):void;prepare(sql:string):Stmt;close():void}
function adapter(db:DB){return{prepare(sql:string){let values:unknown[]=[];const stmt=db.prepare(sql);return{bind(...v:unknown[]){values=v;return this;},async first(){return stmt.get(...values)??null;},async all(){return{results:stmt.all(...values)};},async run(){return{meta:{changes:Number(stmt.run(...values).changes)}};}};},async batch(stmts:Array<{run:()=>Promise<unknown>}>){db.exec('BEGIN');try{const out=[];for(const stmt of stmts)out.push(await stmt.run());db.exec('COMMIT');return out;}catch(e){db.exec('ROLLBACK');throw e;}}};}
function user(id:string,role:'STUDENT'|'TEACHER'|'ADMIN'='TEACHER'):AuthUser{return{id,email:`${id}@example.test`,username:null,role,status:'ACTIVE',displayName:id,avatarUrl:null,createdAt:'',lastLoginAt:null};}
describe('class board permissions and workflow',()=>{it('authorizes teacher and student actions, counts reads and lets a student change one vote until closed',async()=>{
 const specifier='node:sqlite';const sqlite=await import(/* @vite-ignore */ specifier) as {DatabaseSync:new(path:string)=>DB};const db=new sqlite.DatabaseSync(':memory:');try{db.exec(schema);db.exec('PRAGMA foreign_keys=ON');db.exec(`INSERT INTO users(id,email,role,status,created_at,updated_at) VALUES ('t','t@x','TEACHER','ACTIVE','n','n'),('co','co@x','TEACHER','ACTIVE','n','n'),('other','other@x','TEACHER','ACTIVE','n','n'),('s','s@x','STUDENT','ACTIVE','n','n'),('s2','s2@x','STUDENT','ACTIVE','n','n');
 INSERT INTO classrooms(id,name,teacher_id,join_code,status,created_at,updated_at) VALUES('c','Class','t','T','ACTIVE','n','n'),('otherclass','Other','other','O','ACTIVE','n','n');
 INSERT INTO classroom_members(id,classroom_id,user_id,role,status,joined_at,updated_at) VALUES('m1','c','s','STUDENT','ACTIVE','n','n'),('m2','c','s2','STUDENT','ACTIVE','n','n'),('m3','c','co','CO_TEACHER','ACTIVE','n','n');`);
 const env={DB:adapter(db)} as unknown as Env,t=user('t'),co=user('co'),other=user('other'),s=user('s','STUDENT'),s2=user('s2','STUDENT');
 await expect(listClassroomBoard(env,other,'c')).rejects.toMatchObject({status:403});await expect(createAnnouncement(env,s,'c','bad','x')).rejects.toMatchObject({status:403});
 const id=await createAnnouncement(env,t,'c','Meeting','Bring books');await pinAnnouncement(env,co,'c',id,true);
 await expect(readAnnouncement(env,t,'c',id)).rejects.toMatchObject({status:403});await readAnnouncement(env,s,'c',id);await readAnnouncement(env,s,'c',id);
 expect((await listClassroomBoard(env,co,'c')).announcements).toMatchObject([{id,pinned:true,readCount:1}]);expect((await listClassroomBoard(env,s,'c')).announcements).toMatchObject([{id,isRead:true}]);expect((await listClassroomBoard(env,s,'c')).announcements[0]).not.toHaveProperty('readCount');
 await expect(createPoll(env,t,'c','Question',['One','one'])).rejects.toMatchObject({status:400});const poll=await createPoll(env,t,'c','Pick a skill',['Reading','Listening']);
 await expect(votePoll(env,t,'c',poll,0)).rejects.toMatchObject({status:403});await expect(votePoll(env,s,'c',poll,2)).rejects.toMatchObject({status:400});
 await votePoll(env,s,'c',poll,0);await votePoll(env,s,'c',poll,1);await votePoll(env,s2,'c',poll,1);
 expect((await listClassroomBoard(env,s,'c')).polls).toMatchObject([{id:poll,myVote:1,choices:[{count:0},{count:2}]}]);
 await closePoll(env,co,'c',poll);await expect(votePoll(env,s,'c',poll,0)).rejects.toMatchObject({status:409});
 db.exec("UPDATE classroom_members SET status='REMOVED' WHERE id='m2'");expect((await listClassroomBoard(env,t,'c')).polls[0]?.choices[1]?.count).toBe(1);await expect(listClassroomBoard(env,s2,'c')).rejects.toMatchObject({status:403});
 db.exec("UPDATE classrooms SET status='ARCHIVED' WHERE id='c'");await expect(createAnnouncement(env,t,'c','x','x')).rejects.toMatchObject({status:409});await expect(readAnnouncement(env,s,'c',id)).rejects.toMatchObject({status:409});
 db.exec("UPDATE classrooms SET status='ACTIVE' WHERE id='c'");await deleteAnnouncement(env,t,'c',id);expect((await listClassroomBoard(env,t,'c')).announcements).toHaveLength(0);
 }finally{db.close();}});});
