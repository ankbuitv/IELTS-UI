import {describe,it,expect} from 'vitest';
import schema from '@worker/lib/runtime-schema.sql';
import {saveClassGoal,listClassGoals,deleteClassGoal} from '@worker/services/classroom-goals';
import type {Env} from '@worker/env';
import type {AuthUser} from '@worker/lib/auth-types';
interface Stmt {get(...args:unknown[]):unknown; all(...args:unknown[]):unknown[]; run(...args:unknown[]):{changes:number|bigint}}
interface DB {exec(sql:string):void; prepare(sql:string):Stmt; close():void}
function adapter(db:DB){return {prepare(sql:string){const stmt=db.prepare(sql);let args:unknown[]=[];return {bind(...values:unknown[]){args=values;return this;},async first(){return stmt.get(...args)??null;},async all(){return {results:stmt.all(...args)};},async run(){return {meta:{changes:Number(stmt.run(...args).changes)}};}};}};}
const user=(id:string):AuthUser=>({id,role:'TEACHER',email:`${id}@test`,status:'ACTIVE',username:null,displayName:id,avatarUrl:null,createdAt:'',lastLoginAt:null});
describe('class goals',()=>{it('enforces ownership, class boundaries and counts learner-assignment pairs',async()=>{
 const module='node:sqlite';const {DatabaseSync}=await import(/* @vite-ignore */ module) as {DatabaseSync:new(path:string)=>DB};const db=new DatabaseSync(':memory:');
 try{db.exec(schema);db.exec('PRAGMA foreign_keys=OFF');db.exec(`INSERT INTO classrooms(id,name,teacher_id,join_code,status,created_at,updated_at) VALUES('c','Class','owner','123','ACTIVE','n','n'),('c2','Other','other','456','ACTIVE','n','n');
 INSERT INTO classroom_members(id,classroom_id,user_id,role,status,joined_at,updated_at) VALUES('m1','c','s','STUDENT','ACTIVE','n','n'),('m2','c','s2','STUDENT','ACTIVE','n','n'),('m3','c','co','CO_TEACHER','ACTIVE','n','n');
 INSERT INTO assignments(id,classroom_id,teacher_id,test_id,test_version_id,title,status,created_at,updated_at) VALUES('a','c','owner','test','v','Test','ACTIVE','n','n'),('b','c','owner','test','v','Draft','DRAFT','n','n');
 INSERT INTO attempts(id,user_id,assignment_id,test_id,test_version_id,test_type,status,started_at,submitted_at,created_at,updated_at) VALUES('t1','s','a','test','v','READING','SUBMITTED','n','n','n','n'),('t2','s','a','test','v','READING','SUBMITTED','n','n','n','n');`);
 const env={DB:adapter(db)} as unknown as Env,owner=user('owner'),co=user('co'),other=user('other'),draft={title:'80%',targetPercent:80,dueDate:'2027-02-28'};
 const g=await saveClassGoal(env,owner,'c',null,draft);expect(await listClassGoals(env,co,'c')).toMatchObject({goals:[{id:g.id}],aggregate:{assigned:2,submitted:1}});await expect(listClassGoals(env,other,'c')).rejects.toMatchObject({status:403});await expect(saveClassGoal(env,co,'c',g.id,draft)).rejects.toMatchObject({status:403});await expect(deleteClassGoal(env,other,'c2',g.id)).rejects.toMatchObject({status:404});
 await expect(saveClassGoal(env,owner,'c',null,{...draft,dueDate:'2027-02-30'})).rejects.toMatchObject({status:400});await expect(saveClassGoal(env,owner,'c',null,{...draft,targetPercent:101})).rejects.toMatchObject({status:400});await saveClassGoal(env,owner,'c',g.id,{...draft,title:'Updated'});expect(await listClassGoals(env,owner,'c')).toMatchObject({goals:[{title:'Updated'}]});
 db.exec("UPDATE classrooms SET status='ARCHIVED' WHERE id='c'");await expect(deleteClassGoal(env,owner,'c',g.id)).rejects.toMatchObject({status:409});expect((await listClassGoals(env,owner,'c')).goals.length).toBe(1);db.exec("UPDATE classrooms SET status='ACTIVE' WHERE id='c'");await deleteClassGoal(env,owner,'c',g.id);expect((await listClassGoals(env,owner,'c')).goals).toEqual([]);
 }finally{db.close();}
});});
