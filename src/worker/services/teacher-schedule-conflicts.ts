import type {Env} from '../env';
import type {AuthUser} from '../lib/auth-types';
import {ApiError} from '../lib/errors';
import {CALENDAR_PERSONAL_SQL,CALENDAR_SESSIONS_SQL,CALENDAR_CLASSES_SQL,CALENDAR_STAFF_SCHOOL_EVENTS_SQL,CALENDAR_SUPPORT_SQL,CALENDAR_TEACHING_SQL} from '../routes/calendar-queries';

type Interval={startsAt:string;endsAt:string};
type Busy={id:string;kind:string;title:string;startsAt:string;endsAt:string};
export async function teacherScheduleConflicts(env:Env,user:AuthUser,intervals:Interval[],ignoreEventId?:string){
 if(!intervals.length||intervals.length>24)throw ApiError.validation('Kiểm tra từ 1 đến 24 buổi.');
 const normalized=intervals.map(item=>{const start=new Date(item.startsAt),end=new Date(item.endsAt);if(!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||end<=start||end.getTime()-start.getTime()>86400000)throw ApiError.validation('Thời gian không hợp lệ.');return{startsAt:start.toISOString(),endsAt:end.toISOString()};});
 const output:Array<{index:number;conflicts:Busy[]}>=[];
 for(const [index,interval] of normalized.entries()){
  const from=interval.startsAt,to=interval.endsAt;
  const [personal,sessions,classes,school,support,teaching]=await Promise.all([
   env.DB.prepare(CALENDAR_PERSONAL_SQL).bind(user.id,from,to).all<{id:string;title:string;starts_at:string;ends_at:string}>(),
   env.DB.prepare(CALENDAR_SESSIONS_SQL).bind(user.id,user.id,from,to).all<{id:string;topic:string;starts_at:string;ends_at:string}>(),
   env.DB.prepare(CALENDAR_CLASSES_SQL).bind(user.id,user.id,from,to).all<{id:string;title:string;status:string;starts_at:string;ends_at:string}>(),
   env.DB.prepare(CALENDAR_STAFF_SCHOOL_EVENTS_SQL).bind(user.id,from,to).all<{id:string;title:string;school_name:string;starts_at:string;ends_at:string}>(),
   env.DB.prepare(CALENDAR_SUPPORT_SQL).bind(from,to,user.id,user.id).all<{id:string;teacher_id:string;classroom_name:string;starts_at:string;ends_at:string}>(),
   env.DB.prepare(CALENDAR_TEACHING_SQL).bind(from,to,user.id,user.id).all<{id:string;teacher_id:string;title:string;classroom_name:string;starts_at:string;ends_at:string}>(),
  ]);
  const busy:Busy[]=[
   ...personal.results.map(x=>({id:x.id,kind:'PERSONAL',title:x.title,startsAt:x.starts_at,endsAt:x.ends_at})),
   ...sessions.results.map(x=>({id:x.id,kind:'SESSION',title:x.topic||'Buổi cố vấn',startsAt:x.starts_at,endsAt:x.ends_at})),
   ...classes.results.filter(x=>x.status==='OPEN'||x.status==='LIVE').map(x=>({id:x.id,kind:'CLASS',title:x.title,startsAt:x.starts_at,endsAt:x.ends_at})),
   ...school.results.map(x=>({id:x.id,kind:'SCHOOL',title:`${x.title} · ${x.school_name}`,startsAt:x.starts_at,endsAt:x.ends_at})),
   ...support.results.filter(x=>x.teacher_id===user.id).map(x=>({id:x.id,kind:'SUPPORT',title:`Lịch hỗ trợ · ${x.classroom_name}`,startsAt:x.starts_at,endsAt:x.ends_at})),
   ...teaching.results.filter(x=>x.teacher_id===user.id&&x.id!==ignoreEventId).map(x=>({id:x.id,kind:'TEACHING',title:`${x.title} · ${x.classroom_name}`,startsAt:x.starts_at,endsAt:x.ends_at})),
  ].filter(x=>new Date(x.startsAt).getTime()<new Date(to).getTime()&&new Date(x.endsAt).getTime()>new Date(from).getTime()).sort((a,b)=>a.startsAt.localeCompare(b.startsAt));
  for(let i=0;i<normalized.length;i++){if(i===index)continue;const other=normalized[i]!;if(other.startsAt<to&&other.endsAt>from)busy.push({id:`draft:${i}`,kind:'DRAFT',title:`Một buổi khác trong chuỗi (${i+1})`,startsAt:other.startsAt,endsAt:other.endsAt});}
  if(busy.length)output.push({index,conflicts:busy.slice(0,20)});
 }
 return output;
}
