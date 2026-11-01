import { useEffect, useState, type FormEvent } from 'react';
import { api, describeError } from '../../lib/api';
import { Icon } from '../../components/Icon';

type Plan = { id: string; title: string; subject: string; week: number | null; content: string; updated_at: string };
type SchoolOption = { id: string; name: string };
type Draft = { title: string; subject: string; week: string; content: string };
const emptyDraft = (): Draft => ({ title: '', subject: '', week: '', content: '' });

/** Personal lesson plans: no approval or signature workflow is implied. */
export function LessonPlansWindow({ school, schools, setSchoolId }: { school?: SchoolOption; schools: SchoolOption[]; setSchoolId: (id: string) => void }) {
  const [result, setResult] = useState<{ schoolId: string; plans: Plan[]; error?: string } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<'new' | string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState('');

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
  const changeSchool = (id: string) => { setSelected(null); setEditing(null); setError(''); setSchoolId(id); };

  return <div className="sd-window__body sd-plan-window">
    <div className="sd-appbar"><button disabled={!school} onClick={() => openEditor()}><Icon name="plus" size={15} /> Thêm giáo án</button><button disabled={!current} onClick={() => current && openEditor(current)}><Icon name="edit" size={15} /> Sửa</button><button disabled={!current || busy} onClick={() => void remove()}><Icon name="trash" size={15} /> Xóa</button><button disabled={!school} onClick={() => setRevision(r => r + 1)}><Icon name="rotate" size={15} /> Làm mới</button></div>
    <div className="sd-appheading"><div><b>Danh sách giáo án của tôi</b><small>Bản nháp cá nhân · chưa có luồng duyệt hoặc ký số</small></div>{schools.length > 1 && <select aria-label="Chọn trường giáo án" value={school?.id ?? ''} onChange={e => changeSchool(e.target.value)}>{schools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}</div>
    {school && <div className="sd-plan-filter"><span>{school.name}</span><input type="search" aria-label="Tìm giáo án" placeholder="Tìm tên hoặc môn học" value={query} onChange={e => setQuery(e.target.value)} /></div>}
    {error && !editing && <p className="sd-error sd-plan-error" role="alert">{error}</p>}
    {!school ? <p className="sd-message">Cần tham gia một trường đã được duyệt để tạo giáo án.</p> : result?.schoolId !== school.id ? <p className="sd-message">Đang tải giáo án…</p> : result.error ? <p className="sd-message">{result.error}</p> : <div className="sd-table-wrap"><table><thead><tr><th>STT</th><th>Tên giáo án</th><th>Môn học</th><th>Tuần</th><th>Cập nhật</th></tr></thead><tbody>{visible.map((plan, index) => <tr key={plan.id} className={selected === plan.id ? 'selected' : ''} onClick={() => setSelected(plan.id)}><td>{index + 1}</td><td><button className="sd-row-select" onClick={() => setSelected(plan.id)} onDoubleClick={() => openEditor(plan)}>{plan.title}</button></td><td>{plan.subject || '—'}</td><td>{plan.week ?? '—'}</td><td>{new Date(plan.updated_at).toLocaleDateString('vi-VN')}</td></tr>)}</tbody></table>{!visible.length && <p className="sd-message">{query ? 'Không tìm thấy giáo án phù hợp.' : 'Chưa có giáo án. Chọn “Thêm giáo án” để bắt đầu.'}</p>}</div>}
    <div className="sd-status"><span>{current ? `Đang chọn: ${current.title}` : 'Chọn giáo án để sửa hoặc xóa'}</span><span>{visible.length} kết quả (tối đa 200)</span></div>
    {editing && <div className="sd-plan-backdrop"><form className="sd-plan-dialog" role="dialog" aria-modal="true" aria-labelledby="sd-plan-title" onSubmit={e => void submit(e)} onKeyDown={e => { if (e.key === 'Escape' && !busy) { e.stopPropagation(); setEditing(null); } }}><header><b id="sd-plan-title">{editing === 'new' ? 'Thêm giáo án' : 'Sửa giáo án'}</b><button type="button" disabled={busy} aria-label="Đóng biểu mẫu giáo án" onClick={() => setEditing(null)}>×</button></header><div className="sd-plan-form"><label>Tên giáo án <span>*</span><input autoFocus required maxLength={200} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label><div className="sd-plan-form__row"><label>Môn học<input maxLength={120} value={draft.subject} onChange={e => setDraft({ ...draft, subject: e.target.value })} /></label><label>Tuần<input type="number" min="1" max="53" value={draft.week} onChange={e => setDraft({ ...draft, week: e.target.value })} /></label></div><label>Nội dung<textarea maxLength={30000} rows={8} value={draft.content} onChange={e => setDraft({ ...draft, content: e.target.value })} placeholder="Mục tiêu, hoạt động và ghi chú cho bài học…" /></label>{error && <p className="sd-error" role="alert">{error}</p>}</div><footer><button type="button" disabled={busy} onClick={() => setEditing(null)}>Hủy</button><button type="submit" disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu giáo án'}</button></footer></form></div>}
  </div>;
}
