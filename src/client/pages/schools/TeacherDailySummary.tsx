import {useEffect,useState} from 'react';
import {api,describeError} from '../../lib/api';
type Task={completed:boolean;completedAt:string|null};
const dateKey=(date:Date)=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
function DailyNote({day,tasks,onDirty}:{day:string;tasks:Task[];onDirty:(dirty:boolean)=>void}) {
 const [body,setBody]=useState(''),[loading,setLoading]=useState(true),[loadFailed,setLoadFailed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 useEffect(()=>{let active=true;void api.get<{body:string}>(`/api/teacher/daily-notes/${encodeURIComponent(day)}`).then(data=>{if(active){setBody(data.body);setLoading(false);}}).catch(e=>{if(active){setError(describeError(e));setLoadFailed(true);setLoading(false);}});return()=>{active=false;};},[day]);
 const completed=tasks.filter(task=>task.completed&&task.completedAt&&dateKey(new Date(task.completedAt))===day).length;
 return <div className="teacher-summary__body"><p><b>{completed} việc cá nhân</b> đang được đánh dấu hoàn thành trong ngày này. Số liệu thay đổi nếu bạn khôi phục hoặc xóa việc; các việc hoàn thành trước khi có tính năng không có thời điểm.</p>{error&&<p role="alert">{error}</p>}<label>Ghi chú tổng kết<textarea value={body} disabled={loading||busy||loadFailed} maxLength={4000} rows={4} onChange={e=>{setBody(e.target.value);onDirty(true);setMessage('');}} placeholder="Điều đã làm được, việc cần theo dõi…"/></label><button type="button" disabled={loading||busy||loadFailed} onClick={async()=>{setBusy(true);setError('');setMessage('');try{await api.put(`/api/teacher/daily-notes/${encodeURIComponent(day)}`,{body});onDirty(false);setMessage('Đã lưu tổng kết.');}catch(e){setError(describeError(e));}finally{setBusy(false);}}}>Lưu tổng kết</button>{message&&<p role="status">{message}</p>}<small>Ghi chú riêng theo tài khoản, không gửi cho nhà trường hoặc học viên.</small></div>;
}
export function TeacherDailySummary({today,tasks}:{today:string;tasks:Task[]}) {
 const [day,setDay]=useState(today),[dirty,setDirty]=useState(false);
 return <section className="teacher-summary" aria-label="Tổng kết cuối ngày"><h2>Tổng kết cuối ngày</h2><label>Ngày tổng kết<input type="date" value={day} onChange={e=>{if(!e.target.value)return;if(dirty&&!window.confirm('Ghi chú chưa lưu sẽ bị bỏ. Chuyển ngày?'))return;setDirty(false);setDay(e.target.value);}}/></label><DailyNote key={day} day={day} tasks={tasks} onDirty={setDirty}/></section>;
}
