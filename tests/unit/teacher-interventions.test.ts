import {describe,it,expect} from 'vitest';
import schema from '@worker/lib/runtime-schema.sql';
import {listInterventions,createIntervention,updateIntervention,deleteIntervention} from '@worker/services/teacher-interventions';
import type {Env} from '@worker/env';
import type {AuthUser} from '@worker/lib/auth-types';
interface Stmt {get(...args:unknown[]):unknown; all(...args:unknown[]):unknown[]; run(...args:unknown[]):{changes:number|bigint}}
interface DB {exec(sql:string):void; prepare(sql:string):Stmt; close():void}
function adapter(db:DB){return {prepare(sql:string){const stmt=db.prepare(sql);let args:unknown[]=[];return {bind(...values:unknown[]){args=values;return this;},async first(){return stmt.get(...args)??null;},async all(){return {results:stmt.all(...args)};},async run(){return {meta:{changes:Number(stmt.run(...args).changes)}};}};}};}
const user=(id:string):AuthUser=>({id,role:'TEACHER',email:`${id}@test`,status:'ACTIVE',username:null,displayName:id,avatarUrl:null,createdAt:'',lastLoginAt:null});
describe('private intervention history',()=>{it('supports CRUD while isolating teacher, student and class',async()=>{
 const module='node:sqlite';const {DatabaseSync}=await import(/* @vite-ignore */ module) as {DatabaseSync:new(path:string)=>DB};const db=new DatabaseSync(':memory:');
 try{db.exec(schema);db.exec('PRAGMA foreign_keys=OFF');db.exec(`INSERT INTO classrooms(id,name,teacher_id,join_code,status,created_at,updated_at) VALUES('c','Class','owner','123','ACTIVE','n','n');
 INSERT INTO classroom_members(id,classroom_id,user_id,role,status,joined_at,updated_at) VALUES('m1','c','s','STUDENT','ACTIVE','n','n'),('m2','c','co','CO_TEACHER','ACTIVE','n','n');`);
 const env={DB:adapter(db)} as unknown as Env;const input={occurredOn:'2026-11-02',action:'Practice listening',outcome:'Improved'};const id=(await createIntervention(env,user('owner'),'c','s',input)).id;expect(await listInterventions(env,user('owner'),'c','s')).toMatchObject([{id,action:'Practice listening'}]);expect(await listInterventions(env,user('co'),'c','s')).toEqual([]);await expect(updateIntervention(env,user('co'),'c','s',id,input)).rejects.toMatchObject({status:404});await expect(listInterventions(env,user('other'),'c','s')).rejects.toMatchObject({status:403});await expect(createIntervention(env,user('owner'),'c','s',{...input,occurredOn:'2026-02-30'})).rejects.toMatchObject({status:400});await updateIntervention(env,user('owner'),'c','s',id,{...input,outcome:'Done'});expect(await listInterventions(env,user('owner'),'c','s')).toMatchObject([{outcome:'Done'}]);db.exec("UPDATE classrooms SET status='ARCHIVED' WHERE id='c'");await expect(deleteIntervention(env,user('owner'),'c','s',id)).rejects.toMatchObject({status:409});expect(await listInterventions(env,user('owner'),'c','s')).toHaveLength(1);db.exec("UPDATE classrooms SET status='ACTIVE' WHERE id='c'");await deleteIntervention(env,user('owner'),'c','s',id);expect(await listInterventions(env,user('owner'),'c','s')).toEqual([]);
 }finally{db.close();}
});});
