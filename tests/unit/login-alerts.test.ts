import {describe,it,expect} from 'vitest';
import schema from '@worker/lib/runtime-schema.sql';
import {alertUnusualLogin} from '@worker/services/login-alerts';
import type {Env} from '@worker/env';
interface Stmt {get(...args:unknown[]):unknown; all(...args:unknown[]):unknown[]; run(...args:unknown[]):{changes:number|bigint}}
interface DB {exec(sql:string):void; prepare(sql:string):Stmt; close():void}
function adapter(db:DB){return {prepare(sql:string){const stmt=db.prepare(sql);let args:unknown[]=[];return {bind(...values:unknown[]){args=values;return this;},async first(){return stmt.get(...args)??null;},async all(){return {results:stmt.all(...args)};},async run(){return {meta:{changes:Number(stmt.run(...args).changes)}};}};}};}
describe('login alerts',()=>{it('only notifies for unfamiliar combinations, limits alerts and fails safely',async()=>{
 const module='node:sqlite';const {DatabaseSync}=await import(/* @vite-ignore */ module) as {DatabaseSync:new(path:string)=>DB};const db=new DatabaseSync(':memory:');
 try{db.exec(schema);db.exec('PRAGMA foreign_keys=OFF');const env={DB:adapter(db)} as unknown as Env;const now=new Date().toISOString();const add=(id:string,ip:string,ua:string)=>db.prepare("INSERT INTO sessions(id,user_id,csrf_token,created_at,expires_at,last_seen_at,ip,user_agent) VALUES(?,'u','csrf',?,?,?, ?,?)").run(id,now,now,now,ip,ua);const count=()=>db.prepare('SELECT COUNT(*) AS n FROM notifications').get() as {n:number};add('first','ip1','ua1');await alertUnusualLogin(env,'u','first','ip1','ua1');expect(count().n).toBe(0);add('same','ip1','ua1');await alertUnusualLogin(env,'u','same','ip1','ua1');expect(count().n).toBe(0);add('new','ip2','ua2');await alertUnusualLogin(env,'u','new','ip2','ua2');expect(count().n).toBe(1);add('new2','ip3','ua3');await alertUnusualLogin(env,'u','new2','ip3','ua3');expect(count().n).toBe(1);await alertUnusualLogin(env,'u','new2','unknown','ua4');expect(count().n).toBe(1);
 }finally{db.close();}
});});
