import {api} from './api';
type Interval={startsAt:string;endsAt:string};
type Result={conflicts:Array<{index:number;conflicts:Array<{title:string;startsAt:string}>}>};
export async function confirmTeachingConflicts(intervals:Interval[],ignoreEventId?:string){
 const result=await api.post<Result>('/api/teacher/schedule-conflicts',{intervals,...(ignoreEventId?{ignoreEventId}:{})});
 if(!result.conflicts.length)return true;
 const lines=result.conflicts.slice(0,6).map(row=>`Buổi ${row.index+1}: ${row.conflicts.slice(0,3).map(c=>`${c.title} (${new Date(c.startsAt).toLocaleString('vi-VN')})`).join('; ')}`);
 return window.confirm(`Lịch của bạn có thể bị trùng:\n${lines.join('\n')}${result.conflicts.length>6?'\n…':''}\n\nVẫn tiếp tục?`);
}
