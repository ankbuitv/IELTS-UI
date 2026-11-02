import type {Env} from '../env';
import type {AuthUser} from '../lib/auth-types';
import {ApiError} from '../lib/errors';
import {nowIso,parseJson} from '../lib/ids';
export type AvailabilitySlot={day:number;start:string;end:string};
function isTime(time:string){return /^([01]\d|2[0-3]):[0-5]\d$/.test(time);}
export function validateAvailability(timezone:string,slots:AvailabilitySlot[]) {
 try{new Intl.DateTimeFormat('en',{timeZone:timezone}).format(new Date(0));}catch{throw ApiError.validation('Múi giờ không hợp lệ.');}
 if(slots.length>7||new Set(slots.map(x=>x.day)).size!==slots.length||slots.some(x=>!Number.isInteger(x.day)||x.day<0||x.day>6||!isTime(x.start)||!isTime(x.end)||x.start>=x.end))throw ApiError.validation('Mỗi ngày chỉ có một khoảng giờ hợp lệ, bắt đầu trước kết thúc.');
}
export async function getTeacherAvailability(env:Env,user:AuthUser){
 const row=await env.DB.prepare('SELECT timezone,slots_json,updated_at FROM teacher_weekly_availability WHERE user_id=?').bind(user.id).first<{timezone:string;slots_json:string;updated_at:string}>();
 if(!row)return null;
 return {timezone:row.timezone,slots:parseJson<AvailabilitySlot[]>(row.slots_json,[]),updatedAt:row.updated_at};
}
export async function saveTeacherAvailability(env:Env,user:AuthUser,timezone:string,slots:AvailabilitySlot[]){
 validateAvailability(timezone,slots);const sorted=[...slots].sort((a,b)=>a.day-b.day);
 await env.DB.prepare(`INSERT INTO teacher_weekly_availability(user_id,timezone,slots_json,updated_at) VALUES(?,?,?,?)
 ON CONFLICT(user_id) DO UPDATE SET timezone=excluded.timezone,slots_json=excluded.slots_json,updated_at=excluded.updated_at`).bind(user.id,timezone,JSON.stringify(sorted),nowIso()).run();
}
