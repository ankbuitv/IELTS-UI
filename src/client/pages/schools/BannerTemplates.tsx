import {useState,type FormEvent} from 'react';
import {api,describeError} from '../../lib/api';
import {useAsync} from '../../hooks/useAsync';

type Theme='blue'|'green'|'amber';
type Template={id:string;name:string;title:string;message:string;theme:Theme;updated_at:string};
type TemplateDraft={name:string;title:string;message:string;theme:Theme};
export function BannerTemplates({schoolId,onApply}:{schoolId:string;onApply:(value:{title:string;message:string;theme:Theme})=>void}) {
 const base=`/api/schools/${encodeURIComponent(schoolId)}/banner-templates`;
 const templates=useAsync(()=>api.get<{templates:Template[]}>(base),[schoolId]);
 const [editing,setEditing]=useState<string|null>(null),[draft,setDraft]=useState<TemplateDraft>({name:'',title:'',message:'',theme:'blue'}),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const edit=(item?:Template)=>{setEditing(item?.id??'new');setDraft(item?{name:item.name,title:item.title,message:item.message,theme:item.theme}:{name:'',title:'',message:'',theme:'blue'});setMessage('');};
 const save=async(e:FormEvent)=>{e.preventDefault();if(!editing||busy)return;setBusy(true);setMessage('');try{if(editing==='new')await api.post(base,draft);else await api.put(`${base}/${encodeURIComponent(editing)}`,draft);await templates.reload();setEditing(null);setMessage('Đã lưu mẫu. Banner hiện tại chưa thay đổi.');}catch(err){setMessage(describeError(err));}finally{setBusy(false);}};
 const remove=async(item:Template)=>{if(!window.confirm(`Xóa mẫu “${item.name}”? Banner đã phát hành không thay đổi.`))return;setBusy(true);setMessage('');try{await api.delete(`${base}/${encodeURIComponent(item.id)}`);await templates.reload();if(editing===item.id)setEditing(null);setMessage('Đã xóa mẫu.');}catch(err){setMessage(describeError(err));}finally{setBusy(false);}};
 return <div className="sd-banner-templates"><h3>Mẫu thông báo trường</h3><p>Mẫu chỉ lưu văn bản và màu. Áp dụng vào bản nháp, kiểm tra rồi chủ động lưu banner; ảnh không có trong mẫu.</p>
 {templates.error&&<p role="alert">{templates.error} <button type="button" onClick={()=>void templates.reload()}>Thử lại</button></p>}{message&&<p role="status">{message}</p>}
 <button type="button" disabled={busy||(templates.data?.templates.length??0)>=50} onClick={()=>edit()}>Tạo mẫu</button>
 {templates.loading&&!templates.data?<p>Đang tải mẫu…</p>:templates.data?.templates.map(item=><article key={item.id}><strong>{item.name}</strong><small>{item.title}</small><div><button type="button" disabled={busy} onClick={()=>{if(window.confirm('Áp dụng mẫu sẽ thay nội dung nháp và bỏ ảnh; banner chưa được phát hành. Tiếp tục?'))onApply(item);}}>Dùng mẫu</button> <button type="button" disabled={busy} onClick={()=>edit(item)}>Sửa mẫu</button> <button type="button" disabled={busy} onClick={()=>void remove(item)}>Xóa mẫu</button></div></article>)}
 {templates.data&&!templates.data.templates.length&&<p>Chưa có mẫu. Tối đa 50 mẫu/trường.</p>}
 {editing&&<form onSubmit={e=>void save(e)}><h4>{editing==='new'?'Tạo mẫu':'Sửa mẫu'}</h4><label>Tên mẫu<input required maxLength={100} value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></label><label>Tiêu đề mẫu<input required maxLength={120} value={draft.title} onChange={e=>setDraft({...draft,title:e.target.value})}/></label><label>Nội dung mẫu<textarea maxLength={500} rows={3} value={draft.message} onChange={e=>setDraft({...draft,message:e.target.value})}/></label><label>Màu mẫu<select value={draft.theme} onChange={e=>setDraft({...draft,theme:e.target.value as Theme})}><option value="blue">Xanh dương</option><option value="green">Xanh lá</option><option value="amber">Vàng ấm</option></select></label><div><button type="submit" disabled={busy}>Lưu mẫu</button> <button type="button" disabled={busy} onClick={()=>setEditing(null)}>Hủy</button></div></form>}
 </div>;
}
