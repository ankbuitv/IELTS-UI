import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, describeError } from '../../lib/api';
import { useAsync } from '../../hooks/useAsync';
import { prepareLogo } from '../../lib/prepare-logo';
import { Icon } from '../../components/Icon';

type Progress={classroom_id:string;classroom_name:string;assignment_id:string;title:string;status:string;deadline_at:string|null;assigned_count:number;submitted_count:number;average_band:number|null};
export function TeacherProgressWindow() {
 const navigate=useNavigate();const data=useAsync(()=>api.get<{assignments:Progress[]}>('/api/teacher/progress'),[]);const [query,setQuery]=useState('');const [sort,setSort]=useState<'name'|'rate'>('name');
 const rows=(data.data?.assignments??[]).filter(x=>`${x.classroom_name} ${x.title}`.toLocaleLowerCase().includes(query.toLocaleLowerCase().trim()));
 const groups=new Map<string,{name:string;assigned:number;submitted:number;count:number}>();
 for(const x of data.data?.assignments??[]){const group=groups.get(x.classroom_id)??{name:x.classroom_name,assigned:0,submitted:0,count:0};group.assigned+=x.assigned_count;group.submitted+=x.submitted_count;group.count++;groups.set(x.classroom_id,group);}
 const visibleClasses=new Set(rows.map(x=>x.classroom_id));
 const comparison=[...groups].filter(([id])=>visibleClasses.has(id)).sort((a,b)=>sort==='rate'?((b[1].assigned?b[1].submitted/b[1].assigned:-1)-(a[1].assigned?a[1].submitted/a[1].assigned:-1)||a[1].name.localeCompare(b[1].name)):a[1].name.localeCompare(b[1].name));
 return <div className="sd-report"><header><div><span>GIẢNG DẠY</span><h1>Tiến độ bài tập</h1><p>Theo lớp bạn phụ trách · mỗi học viên chỉ tính một lần</p></div><button onClick={()=>void data.reload()}><Icon name="rotate" size={14}/> Làm mới</button></header><div className="sd-report__summary"><div><b>{new Set(rows.map(x=>x.classroom_id)).size}</b><span>Lớp có bài tập</span></div><div><b>{rows.length}</b><span>Bài tập</span></div><div><b>{rows.reduce((n,x)=>n+x.submitted_count,0)}</b><span>Lượt học viên đã nộp</span></div></div><label className="sd-report__search">Tìm lớp hoặc bài tập<input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Nhập tên lớp, bài tập…"/></label>{data.error&&<p role="alert">{data.error}</p>}{data.loading&&!data.data&&<p>Đang tải báo cáo…</p>}<section className="sd-report__table"><h2>So sánh hoàn thành theo lớp</h2><p>Mỗi lớp tính trên toàn bộ bài đang mở hoặc đã đóng, kể cả khi tìm theo tên một bài. Quy mô và độ khó từng lớp có thể khác nhau; tỷ lệ không đánh giá chất lượng giảng dạy.</p><label>Sắp xếp lớp <select value={sort} onChange={e=>setSort(e.target.value as 'name'|'rate')}><option value="name">Tên lớp</option><option value="rate">Tỷ lệ cao trước</option></select></label><table><thead><tr><th>Lớp</th><th>Số bài</th><th>Lượt đã nộp / được giao</th><th>Hoàn thành</th></tr></thead><tbody>{comparison.map(([id,g])=><tr key={id}><td>{g.name}</td><td>{g.count}</td><td>{g.submitted}/{g.assigned}</td><td>{g.assigned?`${Math.round(100*g.submitted/g.assigned)}%`:'Chưa có học viên'}</td></tr>)}</tbody></table></section><div className="sd-report__table"><table><thead><tr><th>Lớp / bài tập</th><th>Đã nộp</th><th>Tiến độ</th><th>Band TB</th><th></th></tr></thead><tbody>{rows.map(x=>{const rate=x.assigned_count ? Math.round(100*x.submitted_count/x.assigned_count):null;return <tr key={x.assignment_id}><td><strong>{x.title}</strong><small>{x.classroom_name}</small></td><td>{x.submitted_count}/{x.assigned_count}</td><td><div className="sd-report__meter"><i style={{width:`${rate??0}%`}}/></div><small>{rate===null?'Chưa có học viên':`${rate}%`}</small></td><td>{x.average_band===null?'—':x.average_band.toFixed(1)}</td><td><button onClick={()=>navigate(`/teacher/classrooms/${x.classroom_id}?tab=assignments`)}>Mở lớp</button></td></tr>})}</tbody></table>{!data.loading&&!rows.length&&<p>Chưa có bài tập phù hợp.</p>}</div><details><summary>Cách tính các chỉ số</summary><p>Số lớp là số lớp có ít nhất một bài đang mở/đã đóng trong kết quả tìm kiếm. Số bài đếm từng bài. Lượt học viên đã nộp cộng số học viên khác nhau trên mỗi bài, vì vậy một người làm hai bài được tính hai lượt.</p><p>Tỷ lệ từng bài và theo lớp dùng học viên hiện hoạt thuộc đối tượng giao bài. Bài SUBMITTED hoặc EXPIRED được tính đã nộp; IN_PROGRESS và ABANDONED không tính. Tỷ lệ là số lượt đã nộp chia số lượt được giao, làm tròn phần trăm; khi mẫu số bằng 0 không tính tỷ lệ.</p><p>Band TB là trung bình kết quả có band gần nhất của mỗi học viên ở bài đó, chỉ với lượt SUBMITTED/EXPIRED; học viên chưa có band bị loại khỏi trung bình. Chỉ thấy dữ liệu trong lớp được phân quyền.</p></details><footer>Tỷ lệ = tổng số học viên-bài đã nộp hoặc hết giờ / tổng học viên-bài được giao, tính học viên hiện hoạt còn thuộc đối tượng của bài. Mỗi học viên chỉ tính một lần cho mỗi bài; học viên làm nhiều bài được tính ở từng bài. Band TB tính trên kết quả đã chấm gần nhất của từng học viên.</footer></div>;
}
type Overview={id:string;name:string;address:string;status:string;staff_count:number;class_count:number;student_count:number;assignment_count:number;assigned_count:number;submitted_count:number;average_band:number|null};
export function SchoolOverviewWindow() {
 const data=useAsync(()=>api.get<{schools:Overview[]}>('/api/schools/overview'),[]);const [query,setQuery]=useState('');const [status,setStatus]=useState('ALL');const all=data.data?.schools??[];const rows=all.filter(x=>(status==='ALL'||x.status===status)&&`${x.name} ${x.address}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
 return <div className="sd-report"><header><div><span>TỔNG HỢP</span><h1>Hệ thống trường học</h1><p>Chỉ số tổng hợp · không hiển thị thông tin riêng của học sinh</p></div><button onClick={()=>void data.reload()}><Icon name="rotate" size={14}/> Làm mới</button></header><div className="sd-report__summary"><div><b>{all.length}</b><span>Hồ sơ trường</span></div><div><b>{all.filter(x=>x.status==='APPROVED').length}</b><span>Trường đã duyệt</span></div><div><b>{all.reduce((n,x)=>n+x.class_count,0)}</b><span>Lớp được liên kết</span></div></div><div className="sd-report__filters"><label>Tìm trường<input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Tên hoặc địa chỉ"/></label><label>Trạng thái<select value={status} onChange={e=>setStatus(e.target.value)}><option value="ALL">Tất cả</option><option value="APPROVED">Đã duyệt</option><option value="PENDING">Chờ duyệt</option><option value="REJECTED">Từ chối</option></select></label></div>{data.error&&<p role="alert">{data.error}</p>}{data.loading&&!data.data&&<p>Đang tải…</p>}<div className="sd-report__table"><table><thead><tr><th>Trường</th><th>Trạng thái</th><th>Nhân sự</th><th>Lớp</th><th>Học viên</th><th>Bài tập</th><th>Hoàn thành</th><th>Band TB</th></tr></thead><tbody>{rows.map(x=><tr key={x.id}><td><strong>{x.name}</strong><small>{x.address}</small></td><td><span className={`sd-report__status sd-report__status--${x.status.toLowerCase()}`}>{x.status==='APPROVED'?'Đã duyệt':x.status==='PENDING'?'Chờ duyệt':'Từ chối'}</span></td><td>{x.staff_count}</td><td>{x.class_count}</td><td>{x.student_count}</td><td>{x.assignment_count}</td><td>{x.assigned_count?`${Math.round(x.submitted_count*100/x.assigned_count)}%`: '—'}<small>{x.submitted_count}/{x.assigned_count}</small></td><td>{x.average_band===null?'—':x.average_band.toFixed(1)}</td></tr>)}</tbody></table>{!data.loading&&!rows.length&&<p>Không có trường phù hợp.</p>}</div><details><summary>Cách tính các chỉ số</summary><p>Nhân sự: chủ trường và giáo viên đang hoạt động. Lớp: lớp hoạt động đã liên kết, có chủ lớp còn hoạt động trong trường. Học viên: số người khác nhau đang hoạt động trong các lớp đó; một người ở nhiều lớp của trường chỉ tính một lần.</p><p>Bài tập: bài đang mở hoặc đã đóng trong các lớp hợp lệ. Hoàn thành: số cặp học viên-bài đã nộp hoặc hết giờ chia cho số cặp được giao, tính học viên còn hoạt động và thuộc đối tượng. Một người làm hai bài tính hai cặp.</p><p>Band TB là trung bình band có sẵn từ kết quả gần nhất của từng học viên-bài; các cặp chưa có band không tính. Không có dữ liệu thì hiển thị dấu gạch. Các số là ảnh chụp hiện tại, không phải thống kê bất biến.</p></details><footer>Số liệu chỉ tính lớp được liên kết và nhân sự còn hoạt động. Học viên thuộc nhiều trường có thể được tính ở mỗi trường. Hoàn thành tính trên học viên hiện tại và bài đang mở/đã đóng; band TB dùng kết quả đã chấm gần nhất của từng học viên cho mỗi bài.</footer></div>;
}
type School={id:string;name:string}|undefined;
type LinkedClass={id:string;name:string;teacher_name:string|null;teacher_email:string;linked_school_id:string|null;linked_school_name:string|null;can_transfer:number};
type Banner={title:string;message:string;theme:'blue'|'green'|'amber';image_mime:string|null;image_b64:string|null;active:number};
type BannerDraft={title:string;message:string;theme:'blue'|'green'|'amber';active:boolean;image:{mime:string;base64:string}|null};
const emptyBanner:BannerDraft={title:'',message:'',theme:'blue',active:false,image:null};

export function SchoolBannerWindow({school}:{school:School}) {
 const id=school?.id??'';
 const base=`/api/schools/${encodeURIComponent(id)}`;
 const banner=useAsync(()=>api.get<{banner:Banner|null}>(`${base}/banner`),[id],{immediate:!!id});
 const classes=useAsync(()=>api.get<{classes:LinkedClass[]}>(`${base}/classroom-links`),[id],{immediate:!!id});
 const [draft,setDraft]=useState<BannerDraft|null>(null);
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState('');
 if(!school)return <div className="sd-message">Chọn trường đã duyệt mà bạn quản lý.</div>;
 const saved=banner.data?.banner;
 const value=draft??(saved?{title:saved.title,message:saved.message,theme:saved.theme,active:!!saved.active,image:saved.image_mime&&saved.image_b64?{mime:saved.image_mime,base64:saved.image_b64}:null}:emptyBanner);
 const save=async()=>{
   setBusy(true);setMessage('');
   try {
     await api.put(`${base}/banner`,value);
     banner.setData({banner:{title:value.title.trim(),message:value.message.trim(),theme:value.theme,active:value.active?1:0,image_mime:value.image?.mime??null,image_b64:value.image?.base64??null}});
     setDraft(null);setMessage(saved?'Đã cập nhật banner.':'Đã tạo banner.');
   } catch(e){setMessage(describeError(e));} finally{setBusy(false);}
 };
 const remove=async()=>{
   if(!window.confirm(`Xóa banner của ${school.name}? Banner sẽ không còn hiển thị với học viên.`))return;
   setBusy(true);setMessage('');
   try{await api.delete(`${base}/banner`);banner.setData({banner:null});setDraft(null);setMessage('Đã xóa banner.');}
   catch(e){setMessage(describeError(e));}finally{setBusy(false);}
 };
 const link=async(item:LinkedClass,checked:boolean)=>{
   if(!checked&&!window.confirm(`Gỡ lớp “${item.name}” khỏi ${school.name}? Học viên lớp này sẽ không còn nhận banner của trường qua lớp này.`))return;
   setBusy(true);setMessage('');
   try{const path=`${base}/classroom-links/${encodeURIComponent(item.id)}`;if(checked)await api.put(path,{});else await api.delete(path);await classes.reload();setMessage('Đã cập nhật liên kết lớp.');}
   catch(e){setMessage(describeError(e));}finally{setBusy(false);}
 };
 const transfer=async(item:LinkedClass)=>{
   if(!item.linked_school_id)return;
   const source=item.linked_school_name??'trường cũ';
   if(!window.confirm(`Chuyển lớp “${item.name}” từ ${source} sang ${school.name}? Lớp sẽ không còn nhận banner hoặc được tính trong thống kê của trường cũ.`))return;
   setBusy(true);setMessage('');
   try{await api.post(`${base}/classroom-links/${encodeURIComponent(item.id)}/transfer`,{sourceSchoolId:item.linked_school_id});await classes.reload();setMessage(`Đã chuyển lớp sang ${school.name}.`);}
   catch(e){setMessage(describeError(e));await classes.reload();}finally{setBusy(false);}
 };
 return <div className="sd-report sd-banner-editor">
   <header><div><span>TRUYỀN THÔNG TRƯỜNG</span><h1>Banner học viên</h1><p>{school.name} · Chỉ quản lý trường mới chỉnh sửa được</p></div></header>
   {message&&<p className="sd-banner-editor__message" role="status">{message}</p>}
   <div className="sd-banner-editor__content">
     <section><h2>Nội dung banner</h2><p>Hiển thị trên trang chính của học viên thuộc các lớp đã liên kết bên dưới.</p>
       {banner.error&&<p role="alert">{banner.error} <button onClick={()=>void banner.reload()}>Thử lại</button></p>}
       {banner.loading&&!banner.data&&<p>Đang tải banner…</p>}
       <fieldset className="sd-banner-editor__fields" disabled={busy||!banner.data||!!banner.error}>
         <label>Tiêu đề<input maxLength={120} value={value.title} onChange={e=>setDraft({...value,title:e.target.value})}/></label>
         <label>Nội dung<textarea rows={3} maxLength={500} value={value.message} onChange={e=>setDraft({...value,message:e.target.value})}/></label>
         <label>Màu sắc<select value={value.theme} onChange={e=>setDraft({...value,theme:e.target.value as BannerDraft['theme']})}><option value="blue">Xanh dương</option><option value="green">Xanh lá</option><option value="amber">Vàng ấm</option></select></label>
         <label>Ảnh banner (không bắt buộc)<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>{const f=e.currentTarget.files?.[0];e.currentTarget.value='';if(f){setBusy(true);void prepareLogo(f).then(image=>setDraft({...value,image})).catch(err=>setMessage(describeError(err))).finally(()=>setBusy(false));}}}/></label>
         {value.image&&<button type="button" onClick={()=>setDraft({...value,image:null})}>Bỏ ảnh</button>}
         <label className="sd-banner-editor__check"><input type="checkbox" checked={value.active} onChange={e=>setDraft({...value,active:e.target.checked})}/> Hiện banner cho học viên</label>
         <div className="sd-banner-editor__actions"><button type="button" className="sd-banner-editor__save" disabled={!value.title.trim()} onClick={()=>void save()}>{saved?'Cập nhật banner':'Tạo banner'}</button>{saved&&<button type="button" className="sd-banner-editor__delete" onClick={()=>void remove()}>Xóa banner</button>}</div>
       </fieldset>
       <div className={`school-banner school-banner--${value.theme}`}>{value.image&&<img src={`data:${value.image.mime};base64,${value.image.base64}`} alt=""/>}<div><small>{school.name}</small><strong>{value.title||'Tiêu đề banner'}</strong><p>{value.message||'Nội dung sẽ hiện ở đây.'}</p></div></div>
     </section>
     <section><h2>Lớp thuộc trường</h2><p>Chỉ lớp của giáo viên đang thuộc trường mới có thể liên kết. Mỗi lớp thuộc một trường.</p>
       {classes.error&&<p role="alert">{classes.error} <button onClick={()=>void classes.reload()}>Thử lại</button></p>}
       {classes.loading&&!classes.data&&<p>Đang tải lớp…</p>}
       {classes.data?.classes.map(c=>{const elsewhere=!!c.linked_school_id&&c.linked_school_id!==id;return <div className="sd-banner-editor__class" key={c.id}>
         {elsewhere?<span className="sd-banner-editor__class-info"><strong>{c.name}</strong><small>{c.teacher_name||c.teacher_email} · Đã thuộc {c.linked_school_name||'trường khác'}</small>{!c.can_transfer&&<small>Nhờ đại diện trường cũ gỡ liên kết trước.</small>}</span>:<label className="sd-banner-editor__class-label"><input type="checkbox" disabled={busy} checked={c.linked_school_id===id} onChange={e=>void link(c,e.target.checked)}/><span><strong>{c.name}</strong><small>{c.teacher_name||c.teacher_email}</small></span></label>}
         {elsewhere&&!!c.can_transfer&&<button type="button" disabled={busy} onClick={()=>void transfer(c)}>Chuyển sang trường này</button>}
       </div>})}
       {classes.data?.classes.length===0&&<p>Chưa có lớp đủ điều kiện. Mời giáo viên tham gia trường và tạo lớp trước.</p>}
     </section>
   </div>
 </div>;
}
