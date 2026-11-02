import {useState} from 'react';
type ClassItem={id:string;name:string};
/** Shortcuts are device-local and never grant classroom access. */
export function PinnedClasses({userId,classes,loaded,mentor,onOpen}:{userId:string;classes:ClassItem[];loaded:boolean;mentor:boolean;onOpen:(path:string)=>void}){
 const key=`school-desktop-pinned-classes:${userId}`;
 const [pins,setPins]=useState<string[]>(()=>{try{const value:unknown=JSON.parse(localStorage.getItem(key)??'[]');return Array.isArray(value)?value.filter((id):id is string=>typeof id==='string').slice(0,10):[];}catch{return [];}});
 const [candidate,setCandidate]=useState(''),[warning,setWarning]=useState('');
 const visible=pins.flatMap(id=>{const item=classes.find(c=>c.id===id);return item?[item]:[];});
 function save(next:string[]){setPins(next);try{localStorage.setItem(key,JSON.stringify(next));setWarning('');}catch{setWarning('Không thể lưu trên trình duyệt này; lựa chọn chỉ dùng tạm.');}}
 return <details className="sd-class-pins"><summary>Lớp thường dùng ({visible.length})</summary><div><small>Ghim trên thiết bị này; chỉ hiện lớp bạn còn quyền truy cập.</small>{visible.map(c=><div className="sd-class-pins__row" key={c.id}><button type="button" onClick={()=>onOpen(mentor?`/classes/${encodeURIComponent(c.id)}`:`/teacher/classrooms/${encodeURIComponent(c.id)}`)}>{c.name}</button><button type="button" aria-label={`Bỏ ghim ${c.name}`} onClick={()=>save(pins.filter(id=>id!==c.id))}>×</button></div>)}{loaded&&pins.length>visible.length&&<button type="button" onClick={()=>save(visible.map(c=>c.id))}>Xóa ghim lớp không còn trong danh sách</button>}<label>Chọn lớp<select value={candidate} onChange={e=>setCandidate(e.target.value)}><option value="">Chọn lớp…</option>{classes.filter(c=>!pins.includes(c.id)).map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select></label><button type="button" disabled={!candidate||pins.length>=10} onClick={()=>{if(!classes.some(c=>c.id===candidate))return;save([...pins,candidate]);setCandidate('');}}>Ghim lớp</button>{pins.length>=10&&<small>Tối đa 10 lớp.</small>}{warning&&<small role="alert">{warning}</small>}</div></details>;
}
