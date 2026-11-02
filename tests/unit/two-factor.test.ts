import {describe,it,expect} from 'vitest';
import schema from '@worker/lib/runtime-schema.sql';
import {createUser,setupTotp,enableTotp,disableTotp,login,loginFederated,verifyTwoFactor} from '@worker/services/auth-service';
import {totpCode} from '@worker/lib/totp';
import type {Env} from '@worker/env';
interface Statement {get(...p:unknown[]):unknown;all(...p:unknown[]):unknown[];run(...p:unknown[]):unknown}
interface Db {exec(sql:string):void;prepare(sql:string):Statement;close():void}
function adapter(db:Db){return {prepare(sql:string){const stmt=db.prepare(sql);let args:unknown[]=[];const bound={bind(...v:unknown[]){args=v;return bound},async first<T>(){return (stmt.get(...args) as T|undefined)??null},async all<T>(){return {results:stmt.all(...args) as T[]}},async run(){const r=stmt.run(...args) as {changes:number};return {meta:{changes:Number(r.changes)}}}};return bound},async batch(statements:Array<{run:()=>Promise<unknown>}>){const results=[];for(const statement of statements)results.push(await statement.run());return results}}}
describe('two-factor security',()=>{
 it('enforces authenticator, rejects setup reset and federation bypass, and consumes all recovery codes once',async()=>{
  const spec='node:sqlite';const sqlite=await import(/* @vite-ignore */ spec).catch(()=>null) as {DatabaseSync:new(path:string)=>Db}|null;if(!sqlite)return;
  const db=new sqlite.DatabaseSync(':memory:');try{db.exec(schema);const env={DB:adapter(db),APP_ENV:'test'} as unknown as Env;
   const user=await createUser(env,{email:'test@example.com',password:'Unique-Passw0rd!23',displayName:'Test',role:'TEACHER'});const setup=await setupTotp(env,user);const code=await totpCode(setup.secret);
   const enabled=await enableTotp(env,user,code);expect(enabled.backupCodes).toHaveLength(8);
   await expect(setupTotp(env,user)).rejects.toMatchObject({status:409});await expect(enableTotp(env,user,code)).rejects.toMatchObject({status:409});
   await expect(loginFederated(env,user.email,{ip:'x',userAgent:'test'})).rejects.toMatchObject({status:403});
   const pending=await login(env,{email:user.email,password:'Unique-Passw0rd!23'},{ip:'x',userAgent:'test'});if(!('twoFactorRequired' in pending))throw new Error('missing challenge');
   await expect(verifyTwoFactor(env,{ticket:pending.ticket,code:'!!!!!!'},{ip:'x',userAgent:'test'})).rejects.toMatchObject({status:401});
   await expect(verifyTwoFactor(env,{ticket:pending.ticket,code:enabled.backupCodes[0]!},{ip:'x',userAgent:'test'})).resolves.toHaveProperty('token');
   await expect(verifyTwoFactor(env,{ticket:pending.ticket,code},{ip:'x',userAgent:'test'})).rejects.toMatchObject({status:401});
   const second=await login(env,{email:user.email,password:'Unique-Passw0rd!23'},{ip:'x',userAgent:'test'});if(!('twoFactorRequired' in second))throw new Error('missing challenge');
   await expect(verifyTwoFactor(env,{ticket:second.ticket,code:enabled.backupCodes[0]!},{ip:'x',userAgent:'test'})).rejects.toMatchObject({status:401});
   await expect(verifyTwoFactor(env,{ticket:second.ticket,code:enabled.backupCodes[7]!},{ip:'x',userAgent:'test'})).resolves.toHaveProperty('token');
   const third=await login(env,{email:user.email,password:'Unique-Passw0rd!23'},{ip:'x',userAgent:'test'});if(!('twoFactorRequired' in third))throw new Error('missing challenge');
   const concurrent=await Promise.allSettled([verifyTwoFactor(env,{ticket:third.ticket,code:await totpCode(setup.secret)},{ip:'x',userAgent:'test'}),verifyTwoFactor(env,{ticket:third.ticket,code:await totpCode(setup.secret)},{ip:'x',userAgent:'test'})]);
   expect(concurrent.filter(x=>x.status==='fulfilled')).toHaveLength(1);
   await expect(disableTotp(env,user,'!!!!!!')).rejects.toMatchObject({status:400});await expect(disableTotp(env,user,await totpCode(setup.secret))).resolves.toEqual({enabled:false});
  }finally{db.close()}
 });
});
