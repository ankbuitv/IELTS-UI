import { useEffect, useState, type FormEvent } from 'react';
import { api, describeError } from '../../lib/api';
import { Icon } from '../../components/Icon';
import { LessonAttachments } from './LessonAttachments';

type Plan = { id: string; title: string; subject: string; week: number | null; content: string; updated_at: string };
type SchoolOption = { id: string; name: string };
type Group = { id:string; name:string };
type Version = {id:string;title:string;subject:string;week:number|null;content:string;created_at:string};
type Submission = {id:string;group_name:string;status:string;comment:string;created_at:string};
type Draft = { title: string; subject: string; week: string; content: string };
const templates:Record<string,string> = {
  general: 'MỤC TIÊU\n\nCHUẨN BỊ\n\nKHỞI ĐỘNG\n\nHOẠT ĐỘNG CHÍNH\n\nLUYỆN TẬP VÀ ĐÁNH GIÁ\n\nDẶN DÒ',
  skills: 'MỤC TIÊU KỸ NĂNG\n\nTỪ VỰNG / CẤU TRÚC\n\nTRƯỚC KHI THỰC HÀNH\n\nTHỰC HÀNH CÓ HƯỚNG DẪN\n\nTHỰC HÀNH ĐỘC LẬP\n\nPHẢN HỒI VÀ BÀI TẬP VỀ NHÀ',
};
const emptyDraft = (): Draft => ({ title: '', subject: '', week: '', content: '' });

/** Personal lesson plans: no approval or signature workflow is implied. */
export function LessonPlansWindow({ school, schools, setSchoolId }: { school?: SchoolOption; schools: SchoolOption[]; setSchoolId: (id: string) => boolean }) {
  const [result, setResult] = useState<{ schoolId: string; plans: Plan[]; error?: string } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<'new' | string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState('');
  const [groups, setGroups] = useState<Group[]>([]);
  const [aux, setAux] = useState<'submit'|'history'|'files'|null>(null);
  const [groupId, setGroupId] = useState('');
  const [versions, setVersions] = useState<Version[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [showVersion, setShowVersion] = useState<string|null>(null);
  useEffect(() => { if (!school?.id) return; let active=true; void api.get<{groups:Group[]}>(`/api/schools/${school.id}/my-subject-groups`).then(r=>{if(active)setGroups(r.groups);}).catch(()=>{if(active)setGroups([]);});return()=>{active=false;}; },[school?.id]);

  useEffect(() => {
    if (!school?.id) return;
    let active = true; const id = school.id;
    void api.get<{ plans: Plan[] }>(`/api/schools/${encodeURIComponent(id)}/lesson-plans`)
      .then(data => { if (active) setResult({ schoolId: id, plans: data.plans }); })
      .catch(e => { if (active) setResult({ schoolId: id, plans: [], error: describeError(e) }); });
    return () => { active = false; };
  }, [school?.id, revision]);

  const plans = result && school && result.schoolId === school.id ? result.plans : [];
  const current = plans.find(plan => plan.id === selected);
  const visible = plans.filter(plan => `${plan.title} ${plan.subject}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const openEditor = (plan?: Plan) => {
    setError(''); setEditing(plan?.id ?? 'new');
    setDraft(plan ? { title: plan.title, subject: plan.subject, week: plan.week?.toString() ?? '', content: plan.content } : emptyDraft());
  };
  const duplicate = () => {
    if (!current) return;
    setError(''); setEditing('new');
    setDraft({title: `${current.title.slice(0, 188)} (bản sao)`,subject: current.subject,week: current.week?.toString() ?? '',content: current.content});
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (!school || !editing || busy) return;
    setError(''); setBusy(true);
    try {
      const payload = { title: draft.title.trim(), subject: draft.subject.trim(), week: draft.week ? Number(draft.week) : null, content: draft.content };
      const base = `/api/schools/${encodeURIComponent(school.id)}/lesson-plans`;
      if (editing === 'new') await api.post(base, payload);
      else await api.patch(`${base}/${encodeURIComponent(editing)}`, payload);
      setEditing(null); setSelected(null); setRevision(r => r + 1);
    } catch (e) { setError(describeError(e)); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!school || !current || busy || !window.confirm(`Xóa giáo án “${current.title}”? Không thể hoàn tác.`)) return;
    setError(''); setBusy(true);
    try {
      await api.delete(`/api/schools/${encodeURIComponent(school.id)}/lesson-plans/${encodeURIComponent(current.id)}`);
      setSelected(null); setRevision(r => r + 1);
    } catch (e) { setError(describeError(e)); } finally { setBusy(false); }
  };
  const showHistory = async () => {
    if (!school || !current) return;setError('');setBusy(true);
    try { const base=`/api/schools/${school.id}/lesson-plans/${current.id}`; const [v,s]=await Promise.all([api.get<{versions:Version[]}>(`${base}/versions`),api.get<{submissions:Submission[]}>(`${base}/submissions`)]);setVersions(v.versions);setSubmissions(s.submissions);setShowVersion(null);setAux('history'); }
    catch(e){setError(describeError(e));}finally{setBusy(false);}
  };
  const send = async (event:FormEvent) => {
    event.preventDefault();if(!school||!current||!groupId||busy)return;setBusy(true);setError('');
    try {await api.post(`/api/schools/${school.id}/lesson-plans/${current.id}/submit`,{groupId});setAux(null);setVersionCount();}
    catch(e){setError(describeError(e));}finally{setBusy(false);}
  };
  const setVersionCount = () => setRevision(r=>r+1);
  const changeSchool = (id: string) => { if (!setSchoolId(id)) return; setSelected(null); setEditing(null); setError(''); };

  return <div className="sd-window__body sd-plan-window">
    <div className="sd-appbar"><button disabled={!school} onClick={() => openEditor()}><Icon name="plus" size={15} /> Thêm giáo án</button><button disabled={!current} onClick={duplicate}><Icon name="file" size={15} /> Nhân bản</button><button disabled={!current} onClick={() => current && openEditor(current)}><Icon name="edit" size={15} /> Sửa</button><button disabled={!current || busy} onClick={() => void remove()}><Icon name="trash" size={15} /> Xóa</button><button disabled={!current || busy} onClick={() => { setError(''); setGroupId(groups[0]?.id ?? ''); setAux('submit'); }}><Icon name="send" size={15} /> Gửi duyệt</button><button disabled={!current || busy} onClick={() => {setError('');setAux('files');}}><Icon name="file" size={15} /> Tệp đính kèm</button><button disabled={!current || busy} onClick={() => void showHistory()}><Icon name="clock" size={15} /> Lịch sử</button><button disabled={!school} onClick={() => setRevision(r => r + 1)}><Icon name="rotate" size={15} /> Làm mới</button></div>
    <div className="sd-appheading"><div><b>Danh sách giáo án của tôi</b><small>Giáo án cá nhân · gửi duyệt theo tổ · chưa hỗ trợ ký số</small></div>{schools.length > 1 && <select aria-label="Chọn trường giáo án" value={school?.id ?? ''} onChange={e => changeSchool(e.target.value)}>{schools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}</div>
    {school && <div className="sd-plan-filter"><span>{school.name}</span><input type="search" aria-label="Tìm giáo án" placeholder="Tìm tên hoặc môn học" value={query} onChange={e => setQuery(e.target.value)} /></div>}
    {error && !editing && <p className="sd-error sd-plan-error" role="alert">{error}</p>}
    {!school ? <p className="sd-message">Cần tham gia một trường đã được duyệt để tạo giáo án.</p> : result?.schoolId !== school.id ? <p className="sd-message">Đang tải giáo án…</p> : result.error ? <p className="sd-message">{result.error}</p> : <div className="sd-table-wrap"><table><thead><tr><th>STT</th><th>Tên giáo án</th><th>Môn học</th><th>Tuần</th><th>Cập nhật</th></tr></thead><tbody>{visible.map((plan, index) => <tr key={plan.id} className={selected === plan.id ? 'selected' : ''} onClick={() => setSelected(plan.id)}><td>{index + 1}</td><td><button className="sd-row-select" onClick={() => setSelected(plan.id)} onDoubleClick={() => openEditor(plan)}>{plan.title}</button></td><td>{plan.subject || '—'}</td><td>{plan.week ?? '—'}</td><td>{new Date(plan.updated_at).toLocaleDateString('vi-VN')}</td></tr>)}</tbody></table>{!visible.length && <p className="sd-message">{query ? 'Không tìm thấy giáo án phù hợp.' : 'Chưa có giáo án. Chọn “Thêm giáo án” để bắt đầu.'}</p>}</div>}
    <div className="sd-status"><span>{current ? `Đang chọn: ${current.title}` : 'Chọn giáo án để sửa, đính kèm file hoặc xóa'}</span><span>{visible.length} kết quả (tối đa 200)</span></div>
    {aux && current && <div className="sd-plan-backdrop"><form className="sd-plan-dialog" role="dialog" aria-modal="true" aria-labelledby="sd-plan-aux-title" onSubmit={e=>void send(e)}><header><b id="sd-plan-aux-title">{aux==='submit'?'Gửi giáo án để duyệt':aux==='files'?'Tệp đính kèm giáo án':'Lịch sử giáo án'}</b><button type="button" aria-label="Đóng" onClick={()=>setAux(null)}>×</button></header><div className="sd-plan-form">{aux==='submit' ? <><p>Gửi bản hiện tại của “{current.title}” đến tổ trưởng hoặc quản lý trường. Người gửi không thể tự duyệt.</p>{groups.length ? <label>Chọn tổ bộ môn<select required value={groupId} onChange={e=>setGroupId(e.target.value)}>{groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select></label> : <p>Bạn chưa thuộc tổ có tổ trưởng đang hoạt động. Hãy liên hệ quản lý trường.</p>}</> : aux==='files' && school ? <LessonAttachments key={current.id} base={`/api/schools/${encodeURIComponent(school.id)}/lesson-plans/${encodeURIComponent(current.id)}/attachments`} editable/> : <><b>Các lần gửi duyệt</b>{submissions.length?submissions.map(item=><div key={item.id} className="sd-history-item"><strong>{item.group_name} · {({PENDING:'Chờ duyệt',APPROVED:'Đã duyệt',RETURNED:'Trả lại'} as Record<string,string>)[item.status]}</strong><small>{new Date(item.created_at).toLocaleString('vi-VN')}{item.comment ? ` · ${item.comment}` : ''}</small>{school&&<LessonAttachments base={`/api/schools/${encodeURIComponent(school.id)}/lesson-reviews/${encodeURIComponent(item.id)}/attachments`}/>}</div>):<p>Chưa gửi duyệt.</p>}<b>Phiên bản đã lưu</b>{versions.length?versions.map(v=><div key={v.id} className="sd-history-item"><button type="button" className="sd-row-select" onClick={()=>setShowVersion(showVersion===v.id?null:v.id)}>{v.title} · {new Date(v.created_at).toLocaleString('vi-VN')}</button>{showVersion===v.id&&<pre>{v.content || 'Không có nội dung'}</pre>}</div>):<p>Chưa có phiên bản lưu trong lịch sử.</p>}</>}{error && <p className="sd-error" role="alert">{error}</p>}</div><footer><button type="button" onClick={()=>setAux(null)}>Đóng</button>{aux==='submit' && groups.length>0 && <button type="submit" disabled={busy}>{busy?'Đang gửi…':'Gửi duyệt'}</button>}</footer></form></div>}
    {editing && <div className="sd-plan-backdrop"><form className="sd-plan-dialog" role="dialog" aria-modal="true" aria-labelledby="sd-plan-title" onSubmit={e => void submit(e)} onKeyDown={e => { if (e.key === 'Escape' && !busy) { e.stopPropagation(); setEditing(null); } }}><header><b id="sd-plan-title">{editing === 'new' ? 'Thêm giáo án' : 'Sửa giáo án'}</b><button type="button" disabled={busy} aria-label="Đóng biểu mẫu giáo án" onClick={() => setEditing(null)}>×</button></header><div className="sd-plan-form">{editing === 'new' && <><label>Mẫu nội dung<select defaultValue="" onChange={e=>{const template=templates[e.target.value];e.target.value='';if(!template)return;if(draft.content && !window.confirm('Áp dụng mẫu sẽ thay thế nội dung hiện tại. Tiếp tục?'))return;setDraft({...draft,content:template});}}><option value="">Chọn mẫu (tùy chọn)</option><option value="general">Kế hoạch bài dạy</option><option value="skills">Luyện kỹ năng IELTS</option></select></label><small>Bản nhân bản chỉ sao chép nội dung, không sao chép file đính kèm hoặc lịch sử duyệt.</small></>}<label>Tên giáo án <span>*</span><input autoFocus required maxLength={200} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label><div className="sd-plan-form__row"><label>Môn học<input maxLength={120} value={draft.subject} onChange={e => setDraft({ ...draft, subject: e.target.value })} /></label><label>Tuần<input type="number" min="1" max="53" value={draft.week} onChange={e => setDraft({ ...draft, week: e.target.value })} /></label></div><label>Nội dung<textarea maxLength={30000} rows={8} value={draft.content} onChange={e => setDraft({ ...draft, content: e.target.value })} placeholder="Mục tiêu, hoạt động và ghi chú cho bài học…" /></label>{error && <p className="sd-error" role="alert">{error}</p>}</div><footer><button type="button" disabled={busy} onClick={() => setEditing(null)}>Hủy</button><button type="submit" disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu giáo án'}</button></footer></form></div>}
  </div>;
}
