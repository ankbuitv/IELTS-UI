import {describe,it,expect} from 'vitest';
import schema from '@worker/lib/runtime-schema.sql';
import {saveBannerTemplate,listBannerTemplates,deleteBannerTemplate} from '@worker/services/school-banner-templates';
import type {Env} from '@worker/env';
import type {AuthUser} from '@worker/lib/auth-types';
interface Stmt {get(...args:unknown[]):unknown; all(...args:unknown[]):unknown[]; run(...args:unknown[]):{changes:number|bigint}}
interface DB {exec(sql:string):void; prepare(sql:string):Stmt; close():void}
function adapter(db:DB){return {prepare(sql:string){const stmt=db.prepare(sql);let args:unknown[]=[];return {bind(...values:unknown[]){args=values;return this;},async first(){return stmt.get(...args)??null;},async all(){return {results:stmt.all(...args)};},async run(){return {meta:{changes:Number(stmt.run(...args).changes)}};}};}};}
const user=(id:string):AuthUser=>({id,role:'TEACHER',email:`${id}@test`,status:'ACTIVE',username:null,displayName:id,avatarUrl:null,createdAt:'',lastLoginAt:null});
describe('school banner templates',()=>{it('isolates schools and owners, enforces limits and never publishes',async()=>{
 const module='node:sqlite';const {DatabaseSync}=await import(/* @vite-ignore */ module) as {DatabaseSync:new(path:string)=>DB};const db=new DatabaseSync(':memory:');
 try{db.exec(schema);db.exec('PRAGMA foreign_keys=OFF');db.exec(`INSERT INTO schools(id,name,address,contact_email,owner_user_id,status,created_at,updated_at) VALUES('s1','One','Address','x@x','one','APPROVED','n','n'),('s2','Two','Address','x@x','two','APPROVED','n','n'),('pending','Pending','Address','x@x','one','PENDING','n','n')`);
 const env={DB:adapter(db)} as unknown as Env;const one=user('one'),two=user('two'),teacher=user('teacher');const draft={name:'Thông báo',title:'Chào năm học',message:'Chào mừng',theme:'blue' as const};
 await expect(listBannerTemplates(env,teacher,'s1')).rejects.toMatchObject({status:403});await expect(saveBannerTemplate(env,one,'pending',null,draft)).rejects.toMatchObject({status:409});
 const item=await saveBannerTemplate(env,one,'s1',null,draft);expect(await listBannerTemplates(env,one,'s1')).toMatchObject([{id:item.id,title:draft.title}]);expect(db.prepare('SELECT count(*) AS n FROM school_banners').get()).toEqual({n:0});
 await expect(saveBannerTemplate(env,two,'s2',item.id,draft)).rejects.toMatchObject({status:404});await expect(deleteBannerTemplate(env,two,'s2',item.id)).rejects.toMatchObject({status:404});await expect(saveBannerTemplate(env,one,'s1',null,{...draft,title:' '})).rejects.toMatchObject({status:400});
 await saveBannerTemplate(env,one,'s1',item.id,{...draft,name:'Sửa',theme:'green'});expect(await listBannerTemplates(env,one,'s1')).toMatchObject([{name:'Sửa',theme:'green'}]);
 for(let i=0;i<49;i++)await saveBannerTemplate(env,one,'s1',null,{...draft,name:`Mẫu ${i}`});await expect(saveBannerTemplate(env,one,'s1',null,draft)).rejects.toMatchObject({status:409});await deleteBannerTemplate(env,one,'s1',item.id);expect((await listBannerTemplates(env,one,'s1')).length).toBe(49);
 }finally{db.close();}
});});
