import { useState, type FormEvent } from 'react';
import { api, describeError } from '../../lib/api';
import { useAsync } from '../../hooks/useAsync';
import { useAuth } from '../../context/AuthContext';

type Event = { id:string; title:string; starts_at:string; ends_at:string; teacher_id:string; teacher_name:string; series_id:string|null; kind:'REGULAR'|'MAKEUP'; note:string };
type Repeat = 'once'|'weekly'|'monthly';
function localInput(value:string) {
  const d=new Date(value), pad=(n:number)=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function buildOccurrences(start:string,duration:number,repeat:Repeat,count:number) {
  const base=new Date(start), events=[];
  if(!Number.isFinite(base.getTime())||!Number.isInteger(duration)||duration<15||duration>1440||!Number.isInteger(count)||count<1||count>24) throw new Error('Kiểm tra thời gian, thời lượng và số buổi.');
  for(let i=0;i<(repeat==='once'?1:count);i++) {
    const d=new Date(base);
    if(repeat==='weekly') d.setDate(base.getDate()+7*i);
    if(repeat==='monthly') {
      const target=new Date(base.getFullYear(),base.getMonth()+i,1,base.getHours(),base.getMinutes());
      const last=new Date(target.getFullYear(),target.getMonth()+1,0).getDate();
      target.setDate(Math.min(base.getDate(),last)); d.setTime(target.getTime());
    }
    events.push({startsAt:d.toISOString(),endsAt:new Date(d.getTime()+duration*60000).toISOString()});
  }
  return events;
}
export function ClassSchedule({classroomId,isOwner}:{classroomId:string;isOwner:boolean}) {
  const {user}=useAuth(); const path=`/api/teacher/classrooms/${encodeURIComponent(classroomId)}/schedule`;
  const data=useAsync(()=>api.get<{events:Event[]}>(path),[path]);
  const [title,setTitle]=useState(''); const [start,setStart]=useState(''); const [duration,setDuration]=useState(60);
  const [kind,setKind]=useState<'REGULAR'|'MAKEUP'>('REGULAR'); const [note,setNote]=useState('');
  const [repeat,setRepeat]=useState<Repeat>('once'); const [count,setCount]=useState(4);
  const [edit,setEdit]=useState<Event|null>(null); const [busy,setBusy]=useState(false); const [message,setMessage]=useState('');
  function reset(){setEdit(null);setTitle('');setStart('');setDuration(60);setKind('REGULAR');setNote('');setRepeat('once');setCount(4);}
  function beginEdit(event:Event){setEdit(event);setTitle(event.title);setStart(localInput(event.starts_at));setDuration(Math.round((Date.parse(event.ends_at)-Date.parse(event.starts_at))/60000));setKind(event.kind);setNote(event.note);setRepeat('once');setMessage('');}
  async function add(e:FormEvent){
    e.preventDefault();setBusy(true);setMessage('');
    try {
      const events=buildOccurrences(start,duration,edit?'once':repeat,count),first=events[0]!;
      const payload={title:title.trim(),...first,kind,note:note.trim()};
      if(edit) await api.put(`${path}/${encodeURIComponent(edit.id)}`,payload);
      else await api.post(path,{...payload,occurrences:events.slice(1)});
      const n=events.length;reset();await data.reload();setMessage(edit?'Đã cập nhật buổi dạy.':`Đã thêm ${n} buổi dạy.`);
    } catch(err){setMessage(describeError(err));} finally{setBusy(false);}
  }
  return <section className="class-support"><h2>Lịch dạy lớp</h2><p>Lịch xuất hiện trong thời khóa biểu của giáo viên phụ trách và học viên. Giờ được nhập theo múi giờ thiết bị; sửa hoặc xóa chỉ ảnh hưởng một buổi. Ghi chú và lý do hiển thị cho học viên; lịch thay đổi và dạy bù có thông báo trong ứng dụng.</p>
    <form className="class-support__form" onSubmit={e=>void add(e)}>
      <label>Tên buổi<input required maxLength={150} value={title} onChange={e=>setTitle(e.target.value)}/></label>
      <label>Bắt đầu<input required type="datetime-local" value={start} onChange={e=>setStart(e.target.value)}/></label>
      <label>Thời lượng (phút)<input required type="number" min={15} max={1440} value={duration} onChange={e=>setDuration(Number(e.target.value))}/></label>
      <label>Loại buổi<select value={kind} onChange={e=>setKind(e.target.value as 'REGULAR'|'MAKEUP')}><option value="REGULAR">Buổi dạy</option><option value="MAKEUP">Dạy bù</option></select></label>
      <label>{kind==='MAKEUP'?'Lý do dạy bù':'Ghi chú'}<input required={kind==='MAKEUP'} maxLength={500} value={note} onChange={e=>setNote(e.target.value)}/></label>
      {!edit&&<><label>Lặp lại<select value={repeat} onChange={e=>setRepeat(e.target.value as Repeat)}><option value="once">Không lặp</option><option value="weekly">Hàng tuần</option><option value="monthly">Hàng tháng</option></select></label>{repeat!=='once'&&<label>Số buổi (tối đa 24)<input required type="number" min={2} max={24} value={count} onChange={e=>setCount(Number(e.target.value))}/></label>}</>}
      <button type="submit" disabled={busy||!start||!title.trim()}>{edit?'Lưu thay đổi':'Thêm buổi dạy'}</button>{edit&&<button type="button" disabled={busy} onClick={reset}>Hủy sửa</button>}
    </form>
    {repeat==='monthly'&&!edit&&<p>Ngày không có trong tháng sẽ dùng ngày cuối tháng; các buổi đã tạo có thể sửa riêng.</p>}{message&&<p role="status">{message}</p>}{data.error&&<p role="alert">{data.error}</p>}
    {data.data?.events.map(event=><article key={event.id}><strong>{event.kind==='MAKEUP'?'Dạy bù · ':''}{event.title}</strong><span>{new Date(event.starts_at).toLocaleString('vi-VN')} – {new Date(event.ends_at).toLocaleString('vi-VN')} · {event.teacher_name}</span>{event.note&&<small>{event.note}</small>}{event.series_id&&<small>Buổi trong lịch lặp</small>}{(isOwner||user?.role==='ADMIN'||user?.id===event.teacher_id)&&<div><button type="button" disabled={busy} onClick={()=>beginEdit(event)}>Sửa</button><button type="button" disabled={busy} onClick={()=>{if(!window.confirm('Xóa riêng buổi dạy này?'))return;setBusy(true);void api.delete(`${path}/${encodeURIComponent(event.id)}`).then(()=>data.reload()).catch(e=>setMessage(describeError(e))).finally(()=>setBusy(false));}}>Xóa</button></div>}</article>)}
    {data.data&&!data.data.events.length&&<p>Chưa có lịch dạy.</p>}
  </section>;
}
