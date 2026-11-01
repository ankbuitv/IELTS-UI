import { useEffect, useState, type FormEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { prepareLogo } from '../../lib/prepare-logo';
import { api, describeError } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useAsync } from '../../hooks/useAsync';
import { Badge, Button, Card, Field, Loading, Notice, TextInput } from '../../components/ui';

type School = { id: string; name: string; address: string; contact_email: string; status: 'PENDING'|'APPROVED'|'REJECTED'; review_note: string|null; created_at: string; member_role?: 'OWNER'|'TEACHER'; member_status?: 'ACTIVE'|'INVITED'|'DECLINED'|'REMOVED'; owner_email?: string };
type Member = { user_id: string; role: string; status: string; email: string; display_name: string|null };
const label = (value: string) => ({ PENDING:'Chờ duyệt', APPROVED:'Đã duyệt', REJECTED:'Không được duyệt', ACTIVE:'Đang hoạt động', INVITED:'Đã mời', DECLINED:'Đã từ chối', REMOVED:'Đã xóa', OWNER:'Đại diện', TEACHER:'Giáo viên' }[value] ?? value);

export function SchoolsPage() {
  const { user } = useAuth();
  const access = useAsync(() => api.get<{isManager:boolean}>('/api/schools/access'), []);
  const canRegister = !!access.data?.isManager;
  const canManageExisting = user?.role === 'TEACHER' || user?.role === 'MENTOR' || user?.role === 'ADMIN';
  const location = useLocation();
  useEffect(() => { if (location.hash === '#register') document.getElementById('register')?.scrollIntoView({ block: 'start' }); }, [location.hash, canRegister]);
  const schools = useAsync(() => api.get<{schools: School[]}>('/api/schools'), []);
  const [name,setName] = useState(''); const [address,setAddress] = useState(''); const [email,setEmail] = useState('');
  const [busy,setBusy] = useState(false); const [error,setError] = useState<string|null>(null); const [notice,setNotice] = useState<string|null>(null);
  const [selected,setSelected] = useState<string|null>(null); const [inviteEmail,setInviteEmail] = useState('');
  const [teacherEmail,setTeacherEmail]=useState(''); const [teacherName,setTeacherName]=useState(''); const [teacherPassword,setTeacherPassword]=useState('');
  const members = useAsync(() => selected ? api.get<{members: Member[]}>(`/api/schools/${encodeURIComponent(selected)}/members`) : Promise.resolve({members:[]}), [selected]);
  const run = async (task: () => Promise<unknown>, message: string) => { setBusy(true); setError(null); setNotice(null); try { await task(); setNotice(message); await schools.reload(); window.dispatchEvent(new Event('desktop-schools-changed')); if(selected) await members.reload(); } catch(e) { setError(describeError(e)); } finally { setBusy(false); } };
  const register = (event:FormEvent) => { event.preventDefault(); void run(async()=>{await api.post('/api/schools',{name,address,contactEmail:email}); setName('');setAddress('');setEmail('');},'Đã gửi đăng ký. Admin Ai eo sẽ xem xét thông tin của trường.'); };
  return <div className="school-page stack">
    <div className="page-head"><div><p className="page-head__kicker">Ai eo · Dành cho tổ chức</p><h1>Trường học</h1><p className="page-head__meta">Xem lời mời và quản lý trường được phân quyền tại một nơi.</p></div></div>
    {error ? <Notice tone="danger">{error}</Notice> : null}{notice ? <Notice tone="success">{notice}</Notice> : null}
    <div className="school-columns"><div className="stack"><Card title="Trường của bạn" hint="Lời mời và các đăng ký sẽ xuất hiện ở đây.">
      {schools.loading && !schools.data ? <Loading /> : null}
      {schools.data?.schools.length === 0 ? <p className="muted">Bạn chưa có trường hoặc lời mời nào.</p> : null}
      <div className="school-list">{schools.data?.schools.map(s=><article key={s.id} className="school-item"><div className="school-item__head"><div><h3>{s.name}</h3><p>{s.address}</p></div><Badge tone={s.status==='APPROVED'?'success':s.status==='PENDING'?'warning':'neutral'}>{label(s.status)}</Badge></div>
        <p className="school-meta">{label(s.member_role ?? '')} · {label(s.member_status ?? '')}</p>
        {s.member_role==='OWNER' && s.status==='PENDING' ? <p className="school-note">Bạn sẽ quản lý trường sau khi hồ sơ được duyệt.</p> : null}
        {s.review_note ? <p className="school-note">Phản hồi: {s.review_note}</p> : null}
        {s.member_status==='INVITED' && s.status==='APPROVED' ? <div className="school-actions"><Button size="sm" variant="primary" disabled={busy} onClick={()=>void run(()=>api.post(`/api/schools/${s.id}/respond`,{accept:true}),'Đã tham gia trường.')}>Chấp nhận</Button><Button size="sm" disabled={busy} onClick={()=>void run(()=>api.post(`/api/schools/${s.id}/respond`,{accept:false}),'Đã từ chối lời mời.')}>Từ chối</Button></div> : null}
        {canManageExisting && s.member_role==='OWNER' && s.status==='APPROVED' ? <Button size="sm" onClick={()=>setSelected(selected===s.id?null:s.id)}>{selected===s.id?'Đóng quản lý':'Quản lý trường và logo'}</Button> : null}
        {selected===s.id && canManageExisting && s.member_role==='OWNER' && s.status==='APPROVED' ? <div className="school-members"><h4>Logo trường</h4><p>Ảnh PNG, JPG hoặc WebP tối đa 10 MB sẽ được tự nén. Logo sẽ xuất hiện trong các phòng thuộc trường.</p><label className="field"><span className="field__label">Tải logo mới</span><input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={e=>{const file=e.currentTarget.files?.[0];e.currentTarget.value='';if(!file)return;void run(async()=>{const image=await prepareLogo(file);await api.post(`/api/schools/${s.id}/logo`,image); window.postMessage({ type: 'school-logo-updated', schoolId: s.id }, window.location.origin); if (window.parent !== window) window.parent.postMessage({ type: 'school-logo-updated', schoolId: s.id }, window.location.origin);},'Đã cập nhật logo trường.');}} /></label><h4>Thành viên trường</h4>{members.loading ? <Loading/> : members.data?.members.map(m=><div className="school-member" key={m.user_id}><span><strong>{m.display_name || m.email}</strong><small>{m.email}</small></span><span>{label(m.role)} · {label(m.status)} {m.role==='TEACHER' && (m.status==='ACTIVE' || m.status==='INVITED') ? <Button size="sm" variant="ghost" disabled={busy} onClick={()=>{if(window.confirm(m.status==='INVITED'?'Thu hồi lời mời này?':'Xóa giáo viên khỏi trường này?')) void run(()=>api.post(`/api/schools/${s.id}/members/${m.user_id}/remove`,{}),m.status==='INVITED'?'Đã thu hồi lời mời.':'Đã xóa giáo viên khỏi trường.');}}>{m.status==='INVITED'?'Thu hồi':'Xóa'}</Button> : null}</span></div>)}<form onSubmit={e=>{e.preventDefault();void run(async()=>{await api.post(`/api/schools/${s.id}/invite`,{email:inviteEmail});setInviteEmail('');},'Đã gửi lời mời trong Ai eo. Giáo viên có thể chấp nhận tại trang Trường học.');}} className="school-invite"><Field label="Email giáo viên hoặc mentor" required>{id=><TextInput id={id} type="email" required value={inviteEmail} onChange={e=>setInviteEmail(e.target.value)} placeholder="giaovien@example.com"/>}</Field><Button type="submit" variant="primary" disabled={busy}>Gửi lời mời</Button></form><details className="school-create-teacher"><summary>Tạo tài khoản giáo viên mới</summary><form className="stack" onSubmit={e=>{e.preventDefault();void run(async()=>{await api.post(`/api/schools/${s.id}/teachers`,{email:teacherEmail,displayName:teacherName,password:teacherPassword});setTeacherEmail('');setTeacherName('');setTeacherPassword('');},'Đã tạo tài khoản và gửi lời mời. Giáo viên cần chấp nhận lời mời.');}}><Field label="Tên giáo viên" required>{id=><TextInput id={id} required value={teacherName} onChange={e=>setTeacherName(e.target.value)}/>}</Field><Field label="Email tài khoản" required>{id=><TextInput id={id} type="email" required value={teacherEmail} onChange={e=>setTeacherEmail(e.target.value)}/>}</Field><Field label="Mật khẩu ban đầu" hint="Tối thiểu 10 ký tự, có chữ hoa, chữ thường và số. Gửi qua kênh riêng an toàn." required>{id=><TextInput id={id} type="password" required minLength={10} autoComplete="new-password" value={teacherPassword} onChange={e=>setTeacherPassword(e.target.value)}/>}</Field><Button type="submit" disabled={busy}>Tạo tài khoản và mời</Button></form></details></div> : null}
      </article>)}</div>
    </Card></div>{canRegister ? <div id="register" className="school-registration"><Card title="Đăng ký trường" hint="Người gửi là đại diện quản lý trường sau khi được duyệt."><form className="school-form" onSubmit={register}><Field label="Tên trường" required>{id=><TextInput id={id} required minLength={2} maxLength={120} value={name} onChange={e=>setName(e.target.value)} placeholder="Tên trường hoặc trung tâm"/>}</Field><Field label="Địa chỉ" required>{id=><TextInput id={id} required minLength={3} maxLength={300} value={address} onChange={e=>setAddress(e.target.value)} placeholder="Địa chỉ trường"/>}</Field><Field label="Email liên hệ của trường" required>{id=><TextInput id={id} type="email" required maxLength={254} value={email} onChange={e=>setEmail(e.target.value)} placeholder="lienhe@truong.edu.vn"/>}</Field><p className="school-disclaimer">Admin hoặc cán bộ được chỉ định sẽ xét duyệt. Bạn chỉ quản lý trường sau khi được duyệt. Lời mời hiện gửi trong Ai eo, không gửi email.</p><Button type="submit" variant="primary" loading={busy}>Gửi đăng ký</Button></form></Card></div> : null}</div>
  </div>;
}

export function AdminSchoolsPage() {
  const {user} = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const data = useAsync(()=>api.get<{schools: School[]}>('/api/schools/applications'),[]);
  type Staff = {id:string;email:string;role:string;display_name:string|null};
  const reviewers=useAsync(()=>isAdmin ? api.get<{reviewers:Staff[]}>('/api/schools/reviewers') : Promise.resolve({reviewers:[]}),[isAdmin]);
  const managers=useAsync(()=>isAdmin ? api.get<{managers:Staff[]}>('/api/schools/managers') : Promise.resolve({managers:[]}),[isAdmin]);
  const [reviewerEmail,setReviewerEmail]=useState(''); const [managerEmail,setManagerEmail]=useState('');
  const [busy,setBusy]=useState<string|null>(null); const [error,setError]=useState<string|null>(null); const [notes,setNotes]=useState<Record<string,string>>({});
  const review = async (school:School,status:'APPROVED'|'REJECTED') => {
    if(status==='REJECTED' && !notes[school.id]?.trim()) { setError('Vui lòng nhập lý do từ chối.'); return; }
    setBusy(school.id); setError(null);
    try { await api.post(`/api/schools/${school.id}/review`,{status,note:notes[school.id]??''}); await data.reload(); window.dispatchEvent(new Event('desktop-schools-changed')); }
    catch(e) { setError(describeError(e)); } finally { setBusy(null); }
  };
  const grant = async (kind:'reviewers'|'managers') => {
    setBusy(kind);setError(null);
    try { await api.post(`/api/schools/${kind}`,{email:kind==='reviewers'?reviewerEmail:managerEmail}); if(kind==='reviewers'){setReviewerEmail('');await reviewers.reload();}else{setManagerEmail('');await managers.reload();} }
    catch(e){setError(describeError(e));}finally{setBusy(null);}
  };
  const revoke = async (kind:'reviewers'|'managers',member:Staff) => {
    if(!window.confirm(`Thu hồi quyền của ${member.email}?`))return;
    setBusy(member.id);setError(null);
    try { await api.delete(`/api/schools/${kind}/${encodeURIComponent(member.id)}`); if(kind==='reviewers')await reviewers.reload();else await managers.reload(); }
    catch(e){setError(describeError(e));}finally{setBusy(null);}
  };
  return <div className="school-page stack">
    <div className="page-head"><div><p className="page-head__kicker">Quản trị tổ chức</p><h2>Đăng ký trường học</h2><p className="page-head__meta">Xác minh đại diện và thông tin trường trước khi duyệt. Người đăng ký không tự duyệt hồ sơ của mình.</p></div></div>
    {error || data.error ? <Notice tone="danger">{error || data.error}</Notice> : null}
    {isAdmin && <Card title="Cán bộ duyệt trường" hint="Chỉ admin chỉ định giáo viên hoặc mentor. Cán bộ chỉ được duyệt hồ sơ trường, không có quyền admin.">
      <form className="school-invite" onSubmit={e=>{e.preventDefault();void grant('reviewers');}}><Field label="Email cán bộ duyệt">{id=><TextInput id={id} type="email" required value={reviewerEmail} onChange={e=>setReviewerEmail(e.target.value)}/>}</Field><Button type="submit" disabled={!!busy}>Chỉ định cán bộ</Button></form>
      {reviewers.error && <Notice tone="danger">{reviewers.error}</Notice>}
      {reviewers.data?.reviewers.map(m=><div className="school-member" key={m.id}><span><strong>{m.display_name || m.email}</strong><small>{m.email} · {m.role}</small></span><Button size="sm" disabled={!!busy} onClick={()=>void revoke('reviewers',m)}>Thu hồi quyền duyệt</Button></div>)}
    </Card>}
    {isAdmin && <Card title="Quyền đăng ký cho mentor" hint="Giáo viên và admin có thể gửi đăng ký trường; mentor cần được admin cấp quyền. Trường chỉ hoạt động sau khi được duyệt.">
      <form className="school-invite" onSubmit={e=>{e.preventDefault();void grant('managers');}}><Field label="Email mentor">{id=><TextInput id={id} type="email" required value={managerEmail} onChange={e=>setManagerEmail(e.target.value)}/>}</Field><Button type="submit" disabled={!!busy}>Cấp quyền đăng ký</Button></form>
      {managers.error && <Notice tone="danger">{managers.error}</Notice>}
      {managers.data?.managers.map(m=><div className="school-member" key={m.id}><span><strong>{m.display_name || m.email}</strong><small>{m.email} · {m.role}</small></span>{m.role !== 'MENTOR' ? <small>Quyền đăng ký từ vai trò</small> : <Button size="sm" disabled={!!busy} onClick={()=>void revoke('managers',m)}>Thu hồi quyền đăng ký</Button>}</div>)}
    </Card>}
    <Card title="Hồ sơ đăng ký" hint="Các hồ sơ chờ duyệt được đưa lên đầu.">{data.loading&&!data.data?<Loading/>:null}{data.data?.schools.length===0?<p className="muted">Chưa có hồ sơ đăng ký.</p>:null}
      <div className="school-list">{data.data?.schools.map(s=><article className="school-item" key={s.id}><div className="school-item__head"><div><h3>{s.name}</h3><p>{s.address}</p></div><Badge tone={s.status==='APPROVED'?'success':s.status==='PENDING'?'warning':'neutral'}>{label(s.status)}</Badge></div><p className="school-meta">Liên hệ: {s.contact_email} · Đại diện: {s.owner_email}</p>{s.review_note?<p className="school-note">Phản hồi: {s.review_note}</p>:null}{s.status==='PENDING' && s.owner_email?.toLowerCase() === user?.email.toLowerCase() ? <p className="school-note">Hồ sơ của bạn cần admin hoặc cán bộ khác duyệt.</p> : s.status==='PENDING'?<><Field label="Ghi chú xét duyệt (không bắt buộc)">{id=><TextInput id={id} maxLength={500} value={notes[s.id]??''} onChange={e=>setNotes({...notes,[s.id]:e.target.value})} />}</Field><div className="school-actions"><Button size="sm" variant="primary" disabled={!!busy} onClick={()=>void review(s,'APPROVED')}>Duyệt trường</Button><Button size="sm" variant="danger" disabled={!!busy} onClick={()=>void review(s,'REJECTED')}>Từ chối</Button></div></>:null}</article>)}</div>
    </Card>
  </div>;
}
