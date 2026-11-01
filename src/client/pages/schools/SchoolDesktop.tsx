import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useAsync } from '../../hooks/useAsync';
import { api, describeError } from '../../lib/api';
import { Icon, type IconName } from '../../components/Icon';
import { Loading, Notice } from '../../components/ui';
import { LessonPlansWindow } from './LessonPlansWindow';

type School = { id: string; name: string; status: string; member_status: string; member_role?: string; address?: string };
type ClassItem = { id: string; name: string; studentCount?: number; status?: string };
type Member = { user_id: string; role: string; status: string; email: string; display_name: string | null };
type AppId = 'lesson-plans' | 'classes' | 'class-detail' | 'class-manage' | 'school-manage' | 'wallpaper' | 'schools' | 'members' | 'assignments' | 'messages' | 'files' | 'marking' | 'calendar' | 'sessions' | 'learn' | 'admin';
type DesktopApp = { id: AppId; title: string; icon: IconName; tone: string; group: string; path?: string };
type Wallpaper = 'sky' | 'forest' | 'sunset' | 'midnight' | 'custom';
type WindowState = { id: AppId; x: number; y: number; z: number; minimized: boolean; maximized: boolean };
const statusLabel = (s?: string) => ({ APPROVED: 'Đã duyệt', PENDING: 'Chờ duyệt', REJECTED: 'Từ chối', ACTIVE: 'Hoạt động', INVITED: 'Đã mời', DECLINED: 'Đã từ chối', REMOVED: 'Đã xóa', ARCHIVED: 'Lưu trữ', OWNER: 'Quản lý', TEACHER: 'Giáo viên' }[s ?? ''] ?? s ?? '—');

export function SchoolDesktop() {
  const { user } = useAuth();
  const access = useAsync(() => api.get<{ isManager: boolean }>('/api/schools/access'), []);
  const schools = useAsync(() => api.get<{ schools: School[] }>('/api/schools'), []);
  const classes = useAsync(async () => {
    if (user?.role === 'MENTOR') {
      const result = await api.get<{ classes: Array<{ id: string; title: string; mentorId: string }> }>('/api/mentor/classes/list');
      return result.classes.filter(c => c.mentorId === user.id).map(c => ({ id: c.id, name: c.title } as ClassItem));
    }
    if (user?.role === 'TEACHER' || user?.role === 'ADMIN') return (await api.get<{ classrooms: ClassItem[] }>('/api/teacher/classrooms')).classrooms;
    return [];
  }, [user?.id, user?.role]);
  const [schoolId, setSchoolId] = useState('');
  const [classId, setClassId] = useState('');
  const [members, setMembers] = useState<{ schoolId: string; items: Member[]; error?: string } | null>(null);
  const [logo, setLogo] = useState<{ id: string; mime: string; data_b64: string } | null>(null);
  const [windows, setWindows] = useState<WindowState[]>([]);
  const [start, setStart] = useState(false);
  const [submenu, setSubmenu] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteError, setInviteError] = useState('');
  const [inviteNotice, setInviteNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [clock, setClock] = useState(() => new Date());
  const wallpaperKey = `school-desktop-background:${user?.id ?? 'guest'}`;
  const [background, setBackground] = useState<{ choice: Wallpaper; image: string | null }>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(wallpaperKey) ?? '{}') as { choice?: string; image?: string };
      const choice = ['sky', 'forest', 'sunset', 'midnight', 'custom'].includes(stored.choice ?? '') ? stored.choice as Wallpaper : 'sky';
      const image = typeof stored.image === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(stored.image) ? stored.image : null;
      return { choice: choice === 'custom' && !image ? 'sky' : choice, image };
    } catch { return { choice: 'sky', image: null }; }
  });
  const [wallpaperError, setWallpaperError] = useState('');
  const [wallpaperBusy, setWallpaperBusy] = useState(false);
  const desktopRef = useRef<HTMLDivElement>(null);
  const zCounter = useRef(1);
  const drag = useRef<{ id: AppId; startX: number; startY: number; x: number; y: number } | null>(null);
  const approved = (schools.data?.schools ?? []).filter(s => s.status === 'APPROVED' && s.member_status === 'ACTIVE');
  const school = approved.find(s => s.id === schoolId) ?? approved[0];
  const selected = classes.data?.find(c => c.id === classId) ?? classes.data?.[0];
  const isMentor = user?.role === 'MENTOR';
  const owner = school?.member_role === 'OWNER';
  const classList = isMentor ? '/classes' : '/teacher';
  const classPath = selected ? (isMentor ? `/classes/${selected.id}` : `/teacher/classrooms/${selected.id}`) : classList;
  const classTab = (tab: string) => selected && !isMentor ? `${classPath}?tab=${tab}` : classPath;
  const apps: DesktopApp[] = [
    { id: 'lesson-plans', title: 'Quản lý giáo án', icon: 'book', tone: 'green', group: 'Giảng dạy' },
    { id: 'classes', title: 'Quản lý lớp học', icon: 'users', tone: 'blue', group: 'Giảng dạy' },
    { id: 'schools', title: 'Trường học', icon: 'graduation', tone: 'cyan', group: 'Nhà trường' },
    { id: 'members', title: 'Nhân sự giáo viên', icon: 'user', tone: 'orange', group: 'Nhà trường' },
    ...(!isMentor ? [{ id: 'assignments' as const, title: 'Quản lý bài tập', icon: 'list' as const, tone: 'violet', group: 'Giảng dạy', path: classTab('assignments') }] : []),
    { id: 'messages', title: 'Tin nhắn lớp', icon: 'bubble', tone: 'blue', group: 'Giảng dạy', path: classTab('conversation') },
    ...(!isMentor ? [{ id: 'files' as const, title: 'Tài liệu lớp', icon: 'file' as const, tone: 'orange', group: 'Giảng dạy', path: classTab('files') }, { id: 'marking' as const, title: 'Chấm bài Writing', icon: 'pen' as const, tone: 'red', group: 'Giảng dạy', path: '/teacher/marking' }] : []),
    { id: 'calendar', title: 'Lịch dạy', icon: 'calendar', tone: 'green', group: 'Tiện ích', path: '/calendar' },
    { id: 'wallpaper', title: 'Cài đặt hình nền', icon: 'settings', tone: 'violet', group: 'Tiện ích' },
    { id: 'sessions', title: 'Buổi học', icon: 'video', tone: 'cyan', group: 'Tiện ích', path: '/my-sessions' },
    { id: 'learn', title: 'Practice & Learn', icon: 'book', tone: 'green', group: 'Tiện ích', path: '/learn' },
    ...(user?.role === 'ADMIN' ? [{ id: 'admin' as const, title: 'Quản trị hệ thống', icon: 'shield' as const, tone: 'red', group: 'Hệ thống', path: '/admin' }] : []),
    { id: 'class-detail', title: 'Chi tiết lớp học', icon: 'users', tone: 'blue', group: 'Giảng dạy', path: classPath },
    { id: 'class-manage', title: 'Quản lý và tạo lớp', icon: 'plus', tone: 'blue', group: 'Giảng dạy', path: classList },
    { id: 'school-manage', title: 'Quản lý trường', icon: 'settings', tone: 'cyan', group: 'Nhà trường', path: '/schools' },
  ];
  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!school?.id) { setLogo(null); return; }
    let active = true; const id = school.id;
    void api.get<{ logo: { mime: string; data_b64: string } | null }>(`/api/schools/${encodeURIComponent(id)}/logo`).then(r => { if (active) setLogo(r.logo ? { id, ...r.logo } : null); }).catch(() => { if (active) setLogo(null); });
    return () => { active = false; };
  }, [school?.id]);
  useEffect(() => {
    if (!school?.id || !owner) { setMembers(null); return; }
    let active = true; const id = school.id;
    setMembers(null);
    void api.get<{ members: Member[] }>(`/api/schools/${encodeURIComponent(id)}/members`).then(r => { if (active) setMembers({ schoolId: id, items: r.members }); }).catch(e => { if (active) setMembers({ schoolId: id, items: [], error: describeError(e) }); });
    return () => { active = false; };
  }, [school?.id, owner]);
  useEffect(() => {
    const keydown = (e: KeyboardEvent) => { if (e.key === 'Escape') { setStart(false); setSubmenu(null); setInviteOpen(false); } };
    window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown);
  }, []);

  if (access.loading) return <Loading label="Đang mở không gian làm việc…" />;
  if (!user || (!['TEACHER', 'MENTOR', 'ADMIN'].includes(user.role) && !access.data?.isManager)) return <div className="sd-access-denied"><Notice tone="danger">Không gian này dành cho nhân sự giảng dạy và quản lý trường.</Notice><Link to="/dashboard">← Quay lại Ai eo</Link></div>;
  const open = (id: AppId) => {
    setStart(false); setSubmenu(null);
    const z = ++zCounter.current;
    setWindows(current => current.some(w => w.id === id) ? current.map(w => w.id === id ? { ...w, minimized: false, z } : w) : [...current, { id, x: 115 + (current.length % 4) * 32, y: 38 + (current.length % 4) * 28, z, minimized: false, maximized: false }]);
  };
  const update = (id: AppId, patch: Partial<WindowState>) => setWindows(current => current.map(w => w.id === id ? { ...w, ...patch } : w));
  const focus = (id: AppId) => update(id, { z: ++zCounter.current });
  const beginDrag = (event: ReactPointerEvent<HTMLElement>, w: WindowState) => {
    if (w.maximized || (event.target as HTMLElement).closest('button') || window.innerWidth <= 700) return;
    drag.current = { id: w.id, startX: event.clientX, startY: event.clientY, x: w.x, y: w.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (!drag.current || !desktopRef.current) return;
    const { id, startX, startY, x, y } = drag.current; const bounds = desktopRef.current.getBoundingClientRect();
    update(id, { x: Math.max(0, Math.min(bounds.width - 160, x + event.clientX - startX)), y: Math.max(0, Math.min(bounds.height - 90, y + event.clientY - startY)) });
  };
  const invite = async () => {
    if (!school || !inviteEmail.trim()) return;
    setBusy(true); setInviteError(''); setInviteNotice('');
    try {
      await api.post(`/api/schools/${encodeURIComponent(school.id)}/invite`, { email: inviteEmail.trim() });
      const result = await api.get<{ members: Member[] }>(`/api/schools/${encodeURIComponent(school.id)}/members`);
      setMembers({ schoolId: school.id, items: result.members }); setInviteEmail(''); setInviteOpen(false);
      setInviteNotice('Đã gửi lời mời trong Ai eo. Giáo viên cần chấp nhận lời mời.');
    } catch (e) { setInviteError(describeError(e)); } finally { setBusy(false); }
  };
  const saveBackground = (next: { choice: Wallpaper; image: string | null }) => {
    setBackground(next);
    try {
      localStorage.setItem(wallpaperKey, JSON.stringify(next));
      setWallpaperError('');
    } catch {
      setWallpaperError('Không thể lưu hình nền trên trình duyệt này. Hình nền chỉ áp dụng cho đến khi tải lại trang.');
    }
  };
  const uploadBackground = async (file: File) => {
    setWallpaperError('');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setWallpaperError('Chọn ảnh JPG, PNG hoặc WebP.'); return; }
    if (file.size > 10_000_000) { setWallpaperError('Ảnh phải nhỏ hơn 10 MB.'); return; }
    setWallpaperBusy(true);
    const url = URL.createObjectURL(file);
    try {
      const image = new Image(); image.src = url;
      await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('Không thể đọc ảnh này.')); });
      if (!image.naturalWidth || !image.naturalHeight) throw new Error('Ảnh không hợp lệ.');
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 1920 / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d'); if (!context) throw new Error('Trình duyệt không hỗ trợ xử lý ảnh.');
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      let data = canvas.toDataURL('image/jpeg', .82);
      if (data.length > 1_800_000) data = canvas.toDataURL('image/jpeg', .6);
      if (data.length > 1_800_000) throw new Error('Ảnh sau khi nén vẫn quá lớn. Hãy chọn ảnh khác.');
      saveBackground({ choice: 'custom', image: data });
    } catch (e) { setWallpaperError(e instanceof Error ? e.message : 'Không thể xử lý ảnh.'); }
    finally { URL.revokeObjectURL(url); setWallpaperBusy(false); }
  };
  const groups = [...new Set(apps.map(app => app.group))];
  return <div className={`school-desktop school-desktop--${background.choice}`} style={background.choice === 'custom' && background.image ? { backgroundImage: `linear-gradient(90deg, rgba(11,43,63,.28), rgba(11,43,63,.05)), url("${background.image}")`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined} ref={desktopRef} onPointerDown={e => { if (e.target === e.currentTarget) { setStart(false); setSubmenu(null); } }}>
    <div className="sd-brand"><div className="sd-brand__mark">A<span>i</span></div><div><b>Ai eo</b><small>SCHOOL DESKTOP</small></div></div>
    <div className="sd-school-badge">{logo && logo.id === school?.id ? <img src={`data:${logo.mime};base64,${logo.data_b64}`} alt="" /> : <Icon name="graduation" size={21} />}<div><small>ĐƠN VỊ LÀM VIỆC</small>{approved.length > 1 ? <select aria-label="Chọn trường" value={school?.id ?? ''} onChange={e => setSchoolId(e.target.value)}>{approved.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select> : <b>{school?.name || 'Không gian cá nhân'}</b>}</div></div>
    <div className="sd-wallpaper-word" aria-hidden="true">Dạy học.<br/><strong>Thật đơn giản.</strong><span>Không gian làm việc của bạn</span></div>
    <div className="sd-icons" aria-label="Ứng dụng trên desktop">{apps.filter(app => !['class-detail', 'class-manage', 'school-manage'].includes(app.id)).map(app => <button className="sd-icon" key={app.id} type="button" onClick={() => open(app.id)}><span className={`sd-icon__art sd-icon__art--${app.tone}`}><Icon name={app.icon} size={27} /></span><span>{app.title}</span></button>)}</div>
    {windows.map(w => {
      const app = apps.find(a => a.id === w.id); if (!app) return null;
      return <section key={w.id} className={`sd-window${w.maximized ? ' sd-window--max' : ''}${w.minimized ? ' sd-window--min' : ''}`} style={{ left: w.x, top: w.y, zIndex: w.z }} onPointerDown={() => focus(w.id)} aria-label={`Cửa sổ ${app.title}`}>
        <header className="sd-window__title" onPointerDown={e => beginDrag(e, w)} onPointerMove={moveDrag} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onDoubleClick={() => update(w.id, { maximized: !w.maximized })}><span><Icon name={app.icon} size={15} /> {app.title}</span><div><button type="button" title="Thu nhỏ" aria-label={`Thu nhỏ ${app.title}`} onClick={() => update(w.id, { minimized: true })}>−</button><button type="button" title={w.maximized ? 'Khôi phục' : 'Phóng to'} aria-label={`${w.maximized ? 'Khôi phục' : 'Phóng to'} ${app.title}`} onClick={() => update(w.id, { maximized: !w.maximized })}>□</button><button type="button" title="Đóng" aria-label={`Đóng ${app.title}`} onClick={() => setWindows(current => current.filter(win => win.id !== w.id))}>×</button></div></header>
        {app.id === 'lesson-plans' ? <LessonPlansWindow key={school?.id ?? "no-school"} school={school} schools={approved} setSchoolId={setSchoolId} /> : null}
        {app.id === 'classes' ? <div className="sd-window__body"><div className="sd-appbar"><button onClick={() => open('class-manage')}><Icon name="plus" size={15} /> Mở quản lý lớp</button><button onClick={() => void classes.reload()}><Icon name="rotate" size={15} /> Làm mới</button></div><div className="sd-appheading"><div><b>Danh sách lớp học</b><small>Chọn một lớp để mở các công cụ giảng dạy.</small></div><span>{classes.data?.length ?? 0} lớp</span></div>{classes.error ? <p className="sd-message">{classes.error}</p> : classes.loading && !classes.data ? <p className="sd-message">Đang tải lớp học…</p> : <div className="sd-table-wrap"><table><thead><tr><th>STT</th><th>Tên lớp</th><th>Học viên</th><th>Trạng thái</th><th></th></tr></thead><tbody>{classes.data?.map((c, i) => <tr key={c.id} className={selected?.id === c.id ? 'selected' : ''} onClick={() => setClassId(c.id)}><td>{i + 1}</td><td><button className="sd-row-select" onClick={() => setClassId(c.id)}>{c.name}</button></td><td>{c.studentCount ?? '—'}</td><td>{statusLabel(c.status)}</td><td><button className="sd-row-select" onClick={() => { setClassId(c.id); open('class-detail'); }}>Mở lớp ↗</button></td></tr>)}</tbody></table>{!classes.data?.length && <p className="sd-message">Chưa có lớp học. Mở quản lý lớp để tạo lớp mới.</p>}</div>}<div className="sd-status">{selected ? `Lớp đang chọn: ${selected.name}` : 'Chưa chọn lớp'}<span>{classes.data?.length ?? 0} kết quả</span></div></div> : null}
        {app.id === 'schools' ? <div className="sd-window__body"><div className="sd-appbar"><button onClick={() => open('school-manage')}><Icon name="external" size={15} /> Quản lý trường và lời mời</button><button onClick={() => void schools.reload()}><Icon name="rotate" size={15} /> Làm mới</button></div><div className="sd-appheading"><div><b>Trường và trung tâm</b><small>Danh sách đăng ký và lời mời của bạn.</small></div></div>{schools.error ? <p className="sd-message">{schools.error}</p> : <div className="sd-table-wrap"><table><thead><tr><th>STT</th><th>Tên trường</th><th>Vai trò</th><th>Trạng thái</th></tr></thead><tbody>{schools.data?.schools.map((s, i) => <tr key={s.id} onClick={() => { if (approved.some(a => a.id === s.id)) setSchoolId(s.id); }} className={school?.id === s.id ? 'selected' : ''}><td>{i + 1}</td><td>{s.name}</td><td>{statusLabel(s.member_role)}</td><td>{statusLabel(s.status)} · {statusLabel(s.member_status)}</td></tr>)}</tbody></table>{!schools.loading && !schools.data?.schools.length && <p className="sd-message">Bạn chưa có trường hoặc lời mời nào.</p>}</div>}<div className="sd-status">Chọn trường đã duyệt để làm việc<span>{schools.data?.schools.length ?? 0} kết quả</span></div></div> : null}
        {app.id === 'members' ? <div className="sd-window__body"><div className="sd-appbar"><button disabled={!owner} onClick={() => { setInviteError(''); setInviteOpen(true); }}><Icon name="plus" size={15} /> Mời giáo viên</button><button onClick={() => open('school-manage')}><Icon name="settings" size={15} /> Quản lý thành viên</button></div><div className="sd-appheading"><div><b>Nhân sự giáo viên</b><small>{school?.name || 'Chưa chọn trường'}</small></div>{approved.length > 1 && <select aria-label="Chọn trường nhân sự" value={school?.id ?? ''} onChange={e => setSchoolId(e.target.value)}>{approved.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}</div>{inviteNotice && <p className="sd-notice">{inviteNotice}</p>}{!school ? <p className="sd-message">Bạn chưa thuộc trường đã được duyệt. Xem trường và lời mời để bắt đầu.</p> : !owner ? <p className="sd-message">Danh sách nhân sự chỉ dành cho người quản lý trường.</p> : !members || members.schoolId !== school.id ? <p className="sd-message">Đang tải nhân sự…</p> : members.error ? <p className="sd-message">{members.error}</p> : <div className="sd-table-wrap"><table><thead><tr><th>STT</th><th>Họ tên</th><th>Email</th><th>Vai trò</th><th>Trạng thái</th></tr></thead><tbody>{members.items.map((m, i) => <tr key={m.user_id}><td>{i + 1}</td><td>{m.display_name || '—'}</td><td>{m.email}</td><td>{statusLabel(m.role)}</td><td>{statusLabel(m.status)}</td></tr>)}</tbody></table>{!members.items.length && <p className="sd-message">Chưa có nhân sự.</p>}</div>}<div className="sd-status">Thông tin theo trường được chọn<span>{owner && members?.schoolId === school?.id ? members.items.length : 0} kết quả</span></div></div> : null}
        {app.id === 'wallpaper' ? <div className="sd-window__body sd-wallpaper-settings"><div className="sd-appheading"><div><b>Hình nền desktop</b><small>Chọn giao diện hoặc tải ảnh của riêng bạn. Cài đặt được lưu trên trình duyệt này.</small></div></div><div className="sd-wallpaper-content"><div className="sd-wallpaper-presets">{([{ id: 'sky', label: 'Bầu trời' }, { id: 'forest', label: 'Xanh rừng' }, { id: 'sunset', label: 'Hoàng hôn' }, { id: 'midnight', label: 'Đêm xanh' }] as const).map(preset => <button type="button" key={preset.id} className={`sd-wallpaper-choice${background.choice === preset.id ? ' active' : ''}`} aria-pressed={background.choice === preset.id} onClick={() => saveBackground({ ...background, choice: preset.id })}><span className={`sd-wallpaper-swatch sd-wallpaper-swatch--${preset.id}`} /><b>{preset.label}</b>{background.choice === preset.id && <Icon name="checkCircle" size={16} />}</button>)}</div><div className="sd-wallpaper-upload"><div><b>Ảnh của bạn</b><small>JPG, PNG hoặc WebP, tối đa 10 MB. Ảnh được nén và chỉ lưu trên thiết bị này.</small></div><label className="sd-upload-button">{wallpaperBusy ? 'Đang xử lý…' : 'Chọn ảnh'}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={wallpaperBusy} onChange={e => { const file = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (file) void uploadBackground(file); }} /></label>{background.image && <><button type="button" className="sd-upload-button" onClick={() => saveBackground({ ...background, choice: 'custom' })}>Dùng ảnh đã chọn</button><button type="button" className="sd-remove-background" onClick={() => saveBackground({ choice: background.choice === 'custom' ? 'sky' : background.choice, image: null })}>Xóa ảnh</button></>}</div>{wallpaperError && <p className="sd-error" role="alert">{wallpaperError}</p>}</div><div className="sd-status">Cài đặt chỉ áp dụng cho tài khoản này trên trình duyệt hiện tại</div></div> : null}
        {app.path ? <div className="sd-frame"><div className="sd-frame__bar"><span>Ứng dụng hiện có · {app.title}{['assignments', 'messages', 'files'].includes(app.id) && selected ? ` · ${selected.name}` : ''}</span><Link to={app.path}>Mở toàn trang ↗</Link></div><iframe title={app.title} name="school-desktop-application" src={app.path} allow="camera; microphone; display-capture; autoplay" /></div> : null}
      </section>;
    })}
    {inviteOpen && school && owner && <div className="sd-dialog-backdrop" role="presentation"><form className="sd-dialog" role="dialog" aria-modal="true" aria-labelledby="sd-invite-title" onSubmit={e => { e.preventDefault(); void invite(); }}><header id="sd-invite-title">Mời giáo viên <button type="button" aria-label="Đóng" onClick={() => setInviteOpen(false)}>×</button></header><div><p>Gửi lời mời tham gia <strong>{school.name}</strong> đến tài khoản đã có trên Ai eo.</p><label>Email giáo viên hoặc mentor<input type="email" required autoFocus value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} /></label>{inviteError && <p className="sd-error" role="alert">{inviteError}</p>}<div className="sd-dialog__actions"><button type="button" onClick={() => setInviteOpen(false)}>Hủy</button><button type="submit" disabled={busy}>{busy ? 'Đang gửi…' : 'Gửi lời mời'}</button></div></div></form></div>}
    {start && <div className="sd-start"><div className="sd-start__user"><span><Icon name="user" size={26} /></span><div><b>{user.displayName || user.email}</b><small>Không gian làm việc</small></div></div><div className="sd-start__content"><div className="sd-start__groups"><small>ỨNG DỤNG</small>{groups.map(group => <button key={group} type="button" className={submenu === group ? 'active' : ''} onMouseEnter={() => setSubmenu(group)} onFocus={() => setSubmenu(group)} onClick={() => setSubmenu(submenu === group ? null : group)}><Icon name={group === 'Giảng dạy' ? 'book' : group === 'Nhà trường' ? 'graduation' : group === 'Hệ thống' ? 'settings' : 'grid'} size={17}/><span>{group}</span><Icon name="chevronRight" size={14}/></button>)}<div className="sd-start__divider"/><Link to="/dashboard"><Icon name="home" size={17}/> Trang chủ Ai eo</Link><Link to="/schools"><Icon name="external" size={17}/> Trường và lời mời</Link></div>{submenu && <div className="sd-submenu"><small>{submenu.toLocaleUpperCase()}</small>{apps.filter(a => a.group === submenu).map(app => <button key={app.id} onClick={() => open(app.id)}><Icon name={app.icon} size={17}/>{app.title}</button>)}</div>}</div><div className="sd-start__footer">Ai eo · School Desktop <button onClick={() => { setStart(false); setSubmenu(null); }}>Đóng</button></div></div>}
    <footer className="sd-taskbar"><button type="button" className={`sd-start-button${start ? ' active' : ''}`} aria-expanded={start} onClick={() => { setStart(!start); setSubmenu(null); }}><span className="sd-start-logo"><Icon name="grid" size={17}/></span> Start</button><div className="sd-taskbar__divider"/><div className="sd-tasks">{windows.map(w => { const app = apps.find(a => a.id === w.id); if (!app) return null; return <button key={w.id} className={!w.minimized ? 'active' : ''} title={app.title} onClick={() => w.minimized || w.z < Math.max(...windows.filter(win => !win.minimized).map(win => win.z)) ? open(w.id) : update(w.id, { minimized: true })}><Icon name={app.icon} size={15}/><span>{app.title}</span></button>; })}</div><div className="sd-taskbar__right"><Link className="sd-exit" to="/dashboard" title="Thoát Desktop" aria-label="Thoát Desktop"><Icon name="logout" size={16}/><span>Thoát</span></Link><span className="sd-online" title="Không gian làm việc">●</span><span>{clock.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}<small>{clock.toLocaleDateString('vi-VN')}</small></span></div></footer>
  </div>;
}
