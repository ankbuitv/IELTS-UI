import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAsync } from '../../hooks/useAsync';
import { mentorApi } from '../../lib/mentor-api';
import { describeError } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { Button, EmptyState, Loading, Notice, useToast } from '../../components/ui';
import { ClassLogo } from '../../components/ClassLogo';
import { Icon } from '../../components/Icon';
import { formatWhen } from '../../components/mentor/MentorBits';
import { CreateClassModal } from '../../components/mentor/CreateClassModal';
import type { MentorClass } from '@shared/mentor';

export function ClassesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const classes = useAsync(() => mentorApi.classes(), []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [query, setQuery] = useState('');
  const list = classes.data?.classes ?? [];
  const filtered = list.filter((item) => `${item.title} ${item.mentorName} ${item.level}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const mine = filtered.filter((item) => item.joined || item.mentorId === user?.id);
  const discover = filtered.filter((item) => !mine.includes(item));

  const join = async (item: MentorClass) => {
    setBusy(item.id); setError(null);
    try { await mentorApi.joinClass(item.id); toast.push(`Đã tham gia “${item.title}”.`, 'success'); await classes.reload(); }
    catch (cause) { setError(describeError(cause)); }
    finally { setBusy(null); }
  };
  const leave = async (item: MentorClass) => {
    if (!window.confirm(`Rời lớp “${item.title}”?`)) return;
    setBusy(item.id); setError(null);
    try { await mentorApi.leaveClass(item.id); await classes.reload(); }
    catch (cause) { setError(describeError(cause)); }
    finally { setBusy(null); }
  };
  const renderCard = (item: MentorClass) => {
    const full = item.memberCount >= item.capacity && !item.joined;
    const owned = item.mentorId === user?.id;
    return <article className="class-tile" key={item.id}>
      <div className="class-tile__header"><ClassLogo type="mentor" id={item.id} name={item.title} /><span className="class-tile__status">{item.status === 'OPEN' ? 'Đang mở' : 'Đã đóng'}</span></div>
      <h3><Link to={`/classes/${item.id}`}>{item.title}</Link></h3><p className="class-tile__mentor">{item.mentorName} · {item.level}</p>
      <p className="class-tile__description">{item.description || 'Luyện tập trực tiếp cùng cố vấn và các thành viên.'}</p>
      <div className="class-tile__meta"><span><Icon name="calendar" size={14} /> {formatWhen(item.startsAt)}</span><span><Icon name="users" size={14} /> {item.memberCount}/{item.capacity}</span></div>
      <div className="class-tile__actions">{owned || item.joined ? <><Button variant="primary" onClick={() => navigate(`/classes/${item.id}`)}>Mở lớp <Icon name="chevronRight" size={14} /></Button>{!owned && <Button variant="ghost" loading={busy === item.id} onClick={() => void leave(item)}>Rời lớp</Button>}</> : <><Button variant="primary" loading={busy === item.id} disabled={full || item.status !== 'OPEN'} onClick={() => void join(item)}>{full ? 'Đã đủ chỗ' : 'Tham gia'}</Button><Link to={`/classes/${item.id}`} className="class-tile__link">Chi tiết</Link></>}</div>
    </article>;
  };
  return <div className="class-directory">
    <header className="class-directory__header"><div><h1>Lớp học trực tiếp</h1><p>Một nơi để gặp gỡ, trò chuyện và học cùng nhau.</p></div>{(user?.role === 'MENTOR' || user?.role === 'ADMIN') && <Button variant="primary" onClick={() => setCreateOpen(true)}><Icon name="plus" size={15} /> Tạo lớp học</Button>}</header>
    <div className="class-directory__toolbar"><label htmlFor="class-search"><Icon name="search" size={17} /><input id="class-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm lớp, cố vấn hoặc trình độ" /></label><span>{filtered.length} lớp học</span></div>
    {error && <Notice tone="danger">{error}</Notice>}
    {classes.error && <Notice tone="danger">Không tải được lớp học: {describeError(classes.error)}</Notice>}
    {classes.loading && !list.length && <Loading label="Đang tải lớp học…" />}
    {mine.length > 0 && <section className="class-directory__section"><div className="class-directory__section-head"><h2>Lớp của bạn</h2><span>{mine.length}</span></div><div className="class-directory__grid">{mine.map(renderCard)}</div></section>}
    <section className="class-directory__section"><div className="class-directory__section-head"><h2>Khám phá lớp học</h2><span>{discover.length}</span></div>{discover.length ? <div className="class-directory__grid">{discover.map(renderCard)}</div> : !classes.loading && <EmptyState title={query ? 'Không tìm thấy lớp phù hợp' : 'Chưa có lớp để khám phá'}>{query ? 'Thử tìm bằng tên khác.' : 'Quay lại sau hoặc tìm một cố vấn để đặt buổi học riêng.'}</EmptyState>}</section>
    <CreateClassModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={() => { toast.push('Đã tạo lớp học.', 'success'); void classes.reload(); }} />
  </div>;
}
