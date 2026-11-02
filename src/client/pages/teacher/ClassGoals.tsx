import {PeriodComparison} from './PeriodComparison';
import {useState,type FormEvent} from 'react';
import {api,describeError} from '../../lib/api';
import {useAsync} from '../../hooks/useAsync';
type Goal={id:string;title:string;target_percent:number;due_date:string|null};
type Result={goals:Goal[];aggregate:{assigned:number;submitted:number};status:string};
export function ClassGoals({classroomId,canEdit}:{classroomId:string;canEdit:boolean}) {
 const path=`/api/teacher/classrooms/${encodeURIComponent(classroomId)}/goals`;const data=useAsync(()=>api.get<Result>(path),[path]);
 const [editing,setEditing]=useState<string|null>(null),[title,setTitle]=useState(''),[target,setTarget]=useState('80'),[due,setDue]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const editable=canEdit&&data.data?.status==='ACTIVE';
 const edit=(goal?:Goal)=>{setEditing(goal?.id??'new');setTitle(goal?.title??'');setTarget(String(goal?.target_percent??80));setDue(goal?.due_date??'');setMessage('');};
 const save=async(e:FormEvent)=>{e.preventDefault();if(!editing||busy)return;setBusy(true);setMessage('');try{const body={title,targetPercent:Number(target),dueDate:due||null};if(editing==='new')await api.post(path,body);else await api.put(`${path}/${encodeURIComponent(editing)}`,body);await data.reload();setEditing(null);setMessage('Đã lưu mục tiêu.');}catch(err){setMessage(describeError(err));}finally{setBusy(false);}};
 const remove=async(goal:Goal)=>{if(!window.confirm(`Xóa mục tiêu “${goal.title}”?`))return;setBusy(true);setMessage('');try{await api.delete(`${path}/${encodeURIComponent(goal.id)}`);await data.reload();setMessage('Đã xóa mục tiêu.');}catch(err){setMessage(describeError(err));}finally{setBusy(false);}};
 const {assigned=0,submitted=0}=data.data?.aggregate??{};const percent=assigned?submitted/assigned*100:null;
 return <section className="class-goals"><header><h2>Mục tiêu hoàn thành bài của lớp</h2><p>Giáo viên chủ lớp đặt tỷ lệ mục tiêu; đây là số tổng hợp hiện tại, không phải kết quả cố định theo hạn.</p></header>
 <PeriodComparison classroomId={classroomId}/>
 {data.error&&<p role="alert">{data.error}</p>}{data.loading&&!data.data&&<p>Đang tải…</p>}{data.data&&<><p>Hiện tại: <strong>{percent===null?'Chưa có bài được giao':`${percent.toFixed(1)}%`}</strong> · {submitted}/{assigned} cặp học viên–bài đã nộp hoặc hết giờ.</p><small>Tính bài ACTIVE/CLOSED và học viên đang hoạt động thuộc đối tượng; mỗi học viên tính một lần/bài. Ngày mục tiêu chỉ để tham khảo, không giới hạn dữ liệu. Thay đổi thành viên hoặc bài giao làm chỉ số thay đổi.</small>
 {editable&&<p><button type="button" onClick={()=>edit()} disabled={busy||data.data.goals.length>=50}>Thêm mục tiêu</button></p>}{!editable&&<p>Chỉ chủ lớp hoặc quản trị viên được sửa mục tiêu trong lớp đang hoạt động.</p>}
 {data.data.goals.map(goal=><article key={goal.id}><strong>{goal.title}</strong><span>Mục tiêu {goal.target_percent}% {goal.due_date?`· Hạn ${goal.due_date}`:'· Không đặt hạn'}</span><span>{percent===null?'Chưa đủ dữ liệu':percent>=goal.target_percent?'Đang đạt mục tiêu':'Chưa đạt mục tiêu'}</span>{editable&&<div><button type="button" onClick={()=>edit(goal)} disabled={busy}>Sửa</button> <button type="button" onClick={()=>void remove(goal)} disabled={busy}>Xóa</button></div>}</article>)}{!data.data.goals.length&&<p>Chưa có mục tiêu.</p>}</>}{message&&<p role="status">{message}</p>}
 {editing&&editable&&<form onSubmit={e=>void save(e)}><h3>{editing==='new'?'Thêm mục tiêu':'Sửa mục tiêu'}</h3><label>Tên mục tiêu<input required maxLength={200} value={title} onChange={e=>setTitle(e.target.value)}/></label><label>Tỷ lệ hoàn thành mục tiêu (%)<input required type="number" min="1" max="100" step="1" value={target} onChange={e=>setTarget(e.target.value)}/></label><label>Ngày mục tiêu (không bắt buộc)<input type="date" value={due} onChange={e=>setDue(e.target.value)}/></label><div><button disabled={busy} type="submit">Lưu mục tiêu</button> <button disabled={busy} type="button" onClick={()=>setEditing(null)}>Hủy</button></div></form>}
 </section>;
}
