import type {Env} from '../env';import {notify} from './notification-service';
/** Advisory only: IP and user agent are approximate and may change or be spoofed. */
export async function alertUnusualLogin(env:Env,userId:string,sessionId:string,ip:string,userAgent:string){
 if(!ip||!userAgent||ip==='unknown'||ip==='0.0.0.0')return;
 try{const since=new Date(Date.now()-90*86400000).toISOString(),throttle=new Date(Date.now()-24*3600000).toISOString();const result=await env.DB.prepare(`SELECT EXISTS(SELECT 1 FROM sessions WHERE user_id=? AND id<>? AND created_at>=? AND ip IS NOT NULL AND ip<>'' AND ip<>'unknown' AND ip<>'0.0.0.0' AND user_agent IS NOT NULL AND user_agent<>'') AS seen, EXISTS(SELECT 1 FROM sessions WHERE user_id=? AND id<>? AND created_at>=? AND ip=? AND user_agent=?) AS match, EXISTS(SELECT 1 FROM notifications WHERE user_id=? AND kind='SYSTEM' AND title='Đăng nhập từ thiết bị hoặc mạng mới' AND created_at>=?) AS alerted`).bind(userId,sessionId,since,userId,sessionId,since,ip,userAgent,userId,throttle).first<{seen:number;match:number;alerted:number}>();
 if(result?.seen&&!result.match&&!result.alerted)await notify(env,{userId,kind:'SYSTEM',title:'Đăng nhập từ thiết bị hoặc mạng mới',body:'Thiết bị hoặc mạng khác các phiên còn lưu gần đây. Nếu không phải bạn, hãy đổi mật khẩu, bật xác thực hai bước và đăng xuất các phiên lạ trong Hồ sơ → Bảo mật.',href:'/profile'});
 }catch(error){console.error('login_alert_failed',(error as Error).message);}
}
