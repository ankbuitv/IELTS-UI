import {useState,type FormEvent} from 'react';
import {api,describeError} from '../../lib/api';
type Result={from:string;to:string;counts:{skill:string;count:number}[]};
const label:Record<string,string>={LISTENING:'Listening',READING:'Reading',WRITING:'Writing',SPEAKING:'Speaking'};
const date=(d:Date)=>d.toISOString().slice(0,10);
export function PracticeBalance({classroomId}:{classroomId:string}){
 const [to,setTo]=useState(()=>date(new Date())),[from,setFrom]=useState(()=>date(new Date(Date.now()-89*86400000))),[data,setData]=useState<Result|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const load=async(e:FormEvent)=>{e.preventDefault();setBusy(true);setError('');try{setData(await api.get<Result>(`/api/teacher/classrooms/${encodeURIComponent(classroomId)}/practice-balance?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`));}catch(err){setError(describeError(err));}finally{setBusy(false);}};
 const minimum=data?Math.min(...data.counts.map(v=>v.count)):0;
 return <section className="practice-balance"><h3>Kỹ năng ít được luyện trong lớp</h3><p>Đếm số lượt bài giao theo kỹ năng, không bao gồm luyện tập riêng hay lớp khác.</p><form onSubmit={e=>void load(e)}><label>Từ ngày (UTC)<input required type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>Đến ngày (UTC)<input required type="date" value={to} onChange={e=>setTo(e.target.value)}/></label><button type="submit" disabled={busy}>{busy?'Đang tải…':'Xem phân bố'}</button></form>{error&&<p role="alert">{error}</p>}{data&&<><p>Kỳ {data.from} – {data.to} (UTC)</p><ul>{data.counts.map(item=><li key={item.skill}><strong>{label[item.skill]}</strong>: {item.count} lượt {item.count===minimum?'· ít nhất':''}</li>)}</ul><small>Chỉ gồm bài ACTIVE/CLOSED, học viên hiện hoạt được giao; mỗi lượt thi tính tối đa một lần/kỹ năng. Reading/Listening/Writing theo lúc nộp hoặc hết giờ từng kỹ năng; Speaking đã nộp/chấm theo ngày tạo phiên. Đây không đo thời gian luyện hay phản ánh hoạt động ngoài lớp; 0 có thể do chưa có bài tương ứng.</small></>}</section>;
}
