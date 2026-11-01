import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, describeError } from '../../lib/api';
import { useAsync } from '../../hooks/useAsync';
import { mentorApi } from '../../lib/mentor-api';
import { useAuth } from '../../context/AuthContext';
import { formatDateTime } from '../../lib/format';
import { Button, EmptyState, Field, Loading, Modal, Notice, TextArea, TextInput, useToast } from '../../components/ui';
import { ClassLogo } from '../../components/ClassLogo';
import { Icon } from '../../components/Icon';
import { MentorAvatar } from '../../components/mentor/MentorBits';
import type { MentorClassMessage } from '@shared/mentor';

/** A class workspace: the shared conversation, private member chats and its live room. */
export function ClassDetailPage() {
  const { classId = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const { data, error, loading, reload } = useAsync(() => mentorApi.classDetail(classId), [classId]);
  const klass = data?.class ?? null;
  const members = klass?.members ?? [];
  const participant = klass?.mentorId === user?.id || members.some((member) => member.userId === user?.id);
  const canSeeClassChat = participant || user?.role === 'ADMIN';
  const canDelete = klass?.mentorId === user?.id || user?.role === 'ADMIN';
  const [navOpen, setNavOpen] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const requestVersion = useRef(0);
  const [peer, setPeer] = useState<{ id: string; name: string } | null>(null);
  const [messages, setMessages] = useState<MentorClassMessage[]>([]);
  const [chatError, setChatError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [callBusy, setCallBusy] = useState(false);
  const [joinBusy, setJoinBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [editOpen,setEditOpen]=useState(false); const [editTitle,setEditTitle]=useState(''); const [editDescription,setEditDescription]=useState(''); const [editBusy,setEditBusy]=useState(false);

  useEffect(() => {
    if (!canSeeClassChat) return undefined;
    let active = true;
    const load = async () => {
      const version = ++requestVersion.current;
      try {
        const result = peer ? await mentorApi.classDirectMessages(classId, peer.id) : await mentorApi.classMessages(classId);
        if (active && version === requestVersion.current) { setMessages(result.messages); setChatError(null); }
      } catch (cause) {
        if (active && version === requestVersion.current) setChatError(describeError(cause));
      }
    };
    void load();
    const timer = setInterval(() => void load(), 4500);
    return () => { active = false; clearInterval(timer); };
  }, [classId, canSeeClassChat, peer]);

  useLayoutEffect(() => {
    if (feedRef.current && stickToBottom.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [messages]);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const result = peer ? await mentorApi.postClassDirectMessage(classId, peer.id, text) : await mentorApi.postClassMessage(classId, text);
      requestVersion.current += 1;
      stickToBottom.current = true;
      setMessages((current) => current.some((item) => item.id === result.message.id) ? current : [...current, result.message]);
      setDraft('');
    } catch (cause) { toast.push(describeError(cause), 'error'); }
    finally { setSending(false); }
  }
  async function joinCall() {
    setCallBusy(true);
    try { const result = await mentorApi.classRoom(classId); navigate(`/sessions/${result.sessionId}/room`); }
    catch (cause) { toast.push(describeError(cause), 'error'); setCallBusy(false); }
  }
  async function joinClass() {
    setJoinBusy(true);
    try { await mentorApi.joinClass(classId); await reload(); toast.push('Đã tham gia lớp học.', 'success'); }
    catch (cause) { toast.push(describeError(cause), 'error'); }
    finally { setJoinBusy(false); }
  }
  async function deleteClass() {
    if (!window.confirm(`Xóa lớp “${klass?.title}”? Hành động này không thể hoàn tác.`)) return;
    setDeleteBusy(true);
    try { await mentorApi.deleteClass(classId); navigate('/classes'); }
    catch (cause) { toast.push(describeError(cause), 'error'); setDeleteBusy(false); }
  }
  if (loading && !klass) return <Loading label="Đang tải lớp học…" />;
  if (error || !klass) return <EmptyState icon="presentation" title="Không tìm thấy lớp học"><p>{error ? describeError(error) : 'Lớp có thể đã bị xóa.'}</p><Link to="/classes">Quay lại danh sách lớp</Link></EmptyState>;

  const people = [
    { id: klass.mentorId, name: klass.mentorName, avatar: klass.mentorAvatarUpdatedAt, role: 'Cố vấn' },
    ...members.filter((member) => member.userId !== klass.mentorId).map((member) => ({ id: member.userId, name: member.displayName, avatar: member.avatarUpdatedAt, role: 'Học viên' })),
  ];

  return (
    <div className="class-workspace">
      <div className="class-workspace__top">
        <div><Link to="/classes" className="class-workspace__back">← Tất cả lớp học</Link><h1>{klass.title}</h1><p>{klass.level} · {klass.mentorName}</p><ClassLogo type="mentor" id={classId} name={klass.title} editable={canDelete} />{canDelete && <Button size="sm" onClick={()=>{setEditTitle(klass.title);setEditDescription(klass.description);setEditOpen(true);}}>Chỉnh sửa lớp</Button>}</div>
        {canSeeClassChat ? <Button variant="primary" loading={callBusy} disabled={klass.status !== 'OPEN'} onClick={() => void joinCall()}><Icon name="video" size={16} /> Vào phòng học</Button> : <Button variant="primary" loading={joinBusy} disabled={klass.status !== 'OPEN'} onClick={() => void joinClass()}><Icon name="plus" size={16} /> Tham gia lớp</Button>}
      </div>
      <Modal open={editOpen} title="Chỉnh sửa lớp học" onClose={()=>setEditOpen(false)} actions={<><Button onClick={()=>setEditOpen(false)}>Hủy</Button><Button variant="primary" loading={editBusy} onClick={()=>{setEditBusy(true);void api.patch(`/api/mentor/classes/${encodeURIComponent(classId)}`,{title:editTitle.trim(),description:editDescription.trim()}).then(async()=>{await reload();setEditOpen(false);toast.push('Đã cập nhật lớp học.','success');}).catch(e=>toast.push(describeError(e),'error')).finally(()=>setEditBusy(false));}}>Lưu thay đổi</Button></>}><div className="stack"><Field label="Tên lớp" required>{id=><TextInput id={id} value={editTitle} maxLength={140} onChange={e=>setEditTitle(e.target.value)}/>}</Field><Field label="Mô tả">{id=><TextArea id={id} value={editDescription} maxLength={2000} onChange={e=>setEditDescription(e.target.value)}/>}</Field></div></Modal>
      <div className="class-workspace__layout">
        <aside className={`class-workspace__nav${navOpen ? ' is-open' : ''}`} aria-label="Hội thoại lớp học">
          <div className="class-workspace__nav-title"><h2>Hội thoại</h2><button type="button" className="class-workspace__nav-toggle" aria-expanded={navOpen} onClick={() => setNavOpen((value) => !value)}>{navOpen ? 'Đóng' : 'Chọn hội thoại'}</button></div>
          <button type="button" disabled={sending} className={`class-workspace__channel${!peer ? ' is-active' : ''}`} onClick={() => { setPeer(null); setNavOpen(false); stickToBottom.current = true; setDraft(''); setMessages([]); setChatError(null); }}><span className="class-workspace__channel-icon"><Icon name="users" size={17} /></span><span><strong>Thảo luận chung</strong><small>Cả lớp</small></span></button>
          <div className="class-workspace__nav-heading">Thành viên <span>{people.length}</span></div>
          {people.map((person) => <button key={person.id} type="button" className={`class-workspace__person${peer?.id === person.id ? ' is-active' : ''}`} disabled={sending || !participant || person.id === user?.id} onClick={() => { setPeer({ id: person.id, name: person.name }); setNavOpen(false); stickToBottom.current = true; setDraft(''); setMessages([]); setChatError(null); }} title={person.id === user?.id ? 'Đây là bạn' : !participant ? 'Tham gia lớp để nhắn tin riêng' : `Nhắn tin cho ${person.name}`}><MentorAvatar name={person.name} userId={person.id} avatarUpdatedAt={person.avatar} size="md" /><span><strong>{person.name}{person.id === user?.id ? ' (bạn)' : ''}</strong><small>{person.role}</small></span></button>)}
          {!participant && <p className="class-workspace__hint">Tham gia lớp để nhắn tin riêng với các thành viên.</p>}
        </aside>
        <section className="class-workspace__conversation">
          <header className="class-workspace__conversation-head"><div><h2>{peer ? peer.name : 'Thảo luận chung'}</h2><p>{peer ? 'Tin nhắn riêng trong lớp · chỉ hai người có thể xem' : 'Trao đổi với mọi người trong lớp'}</p></div><Icon name={peer ? 'bubble' : 'users'} size={20} /></header>
          {!canSeeClassChat ? <div className="class-workspace__empty"><Icon name="bubble" size={30} /><h3>Tham gia cuộc trò chuyện</h3><p>Tham gia lớp để nhắn tin và vào phòng học trực tiếp.</p></div> : <>
            <div ref={feedRef} className="class-workspace__feed" aria-live="polite" onScroll={(event) => { const el = event.currentTarget; stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
              {chatError ? <Notice tone="danger">Không tải được tin nhắn: {chatError}</Notice> : null}
              {!chatError && messages.length === 0 ? <div className="class-workspace__empty"><Icon name="bubble" size={28} /><h3>Chưa có tin nhắn</h3><p>{peer ? `Gửi lời chào đến ${peer.name} để bắt đầu.` : 'Bắt đầu cuộc trò chuyện với lớp của bạn.'}</p></div> : messages.map((message) => <div key={message.id} className={`workspace-message${message.senderId === user?.id ? ' workspace-message--self' : ''}`}><MentorAvatar name={message.senderName} userId={message.senderId} avatarUpdatedAt={message.senderAvatarUpdatedAt} size="md" /><div><div className="workspace-message__meta"><strong>{message.senderId === user?.id ? 'Bạn' : message.senderName}</strong><time>{formatDateTime(message.createdAt)}</time></div><div className="workspace-message__body">{message.body}</div></div></div>)}
            </div>
            <form className="class-workspace__composer" onSubmit={(event) => void send(event)}><label htmlFor="class-message">{peer ? `Tin nhắn đến ${peer.name}` : 'Tin nhắn đến lớp'}</label><div><input id="class-message" maxLength={4000} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Viết tin nhắn…" /><Button type="submit" variant="primary" loading={sending} disabled={!draft.trim()}><Icon name="send" size={15} /> Gửi</Button></div></form>
          </>}
        </section>
        <aside className="class-workspace__details"><h2>Thông tin lớp</h2><p className="class-workspace__description">{klass.description || 'Lớp luyện tập trực tiếp cùng cố vấn.'}</p><dl><div><dt>Lịch học</dt><dd>{formatDateTime(klass.startsAt)}<br />đến {formatDateTime(klass.endsAt)}</dd></div><div><dt>Thành viên</dt><dd>{klass.memberCount} / {klass.capacity}</dd></div><div><dt>Học phí</dt><dd>{klass.priceCoins > 0 ? `${klass.priceCoins.toLocaleString('vi-VN')} xu` : 'Miễn phí'}</dd></div><div><dt>Trạng thái</dt><dd>{klass.status === 'OPEN' ? 'Đang mở' : 'Đã đóng'}</dd></div></dl><p className="class-workspace__hint">Trong phòng học: chia nhóm, câu hỏi nhanh và bảng trắng có sẵn trên thanh công cụ.</p>{canDelete && <Button variant="ghost" loading={deleteBusy} onClick={() => void deleteClass()}><Icon name="trash" size={14} /> Xóa lớp</Button>}</aside>
      </div>
    </div>
  );
}
