import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api, describeError, getSessionToken } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Button, EmptyState, Loading, Modal, useToast } from './ui';
import { Icon } from './Icon';
import { relativeTime } from '../lib/format';

interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  body: string;
  createdAt: string;
  attachmentUrl?: string | null;
  attachmentName?: string | null;
}

export function ClassroomChatButton({ classroomId, classroomName }: { classroomId: string; classroomName: string }) {
  const [open, setOpen] = useState(false);
  return <><Button size="sm" variant="ghost" onClick={() => setOpen(true)}><Icon name="bubble" size={13} /> Chat</Button>
    <Modal open={open} title={`Chat · ${classroomName}`} onClose={() => setOpen(false)} wide>{open && <ClassroomChat classroomId={classroomId} />}</Modal></>;
}

/** A classroom conversation; attachments and messages use the same membership rules. */
export function ClassroomChat({ classroomId, view = 'messages' }: { classroomId: string; view?: 'messages' | 'files' }) {
  const { user } = useAuth();
  const toast = useToast();
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const requestVersion = useRef(0);
  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    try {
      const result = await api.get<{ messages: ChatMessage[] }>(`/api/classrooms/${encodeURIComponent(classroomId)}/messages`);
      if (version === requestVersion.current) { setMessages(result.messages); setLoadError(null); }
    } catch (cause) { if (version === requestVersion.current) setLoadError(describeError(cause)); }
  }, [classroomId]);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [load]);

  useLayoutEffect(() => {
    const feed = feedRef.current;
    if (feed && stickToBottom.current) feed.scrollTop = feed.scrollHeight;
  }, [messages, view]);

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    if ((!draft.trim() && !file) || busy) return;
    if (file && file.size > 10_485_760) { toast.push('Tệp không được lớn hơn 10 MB.', 'error'); return; }
    setBusy(true);
    try {
      let attachmentBase64: string | undefined;
      if (file) attachmentBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Không đọc được tệp.'));
        reader.readAsDataURL(file);
      });
      const result = await api.post<{ message: ChatMessage }>(`/api/classrooms/${encodeURIComponent(classroomId)}/messages`, {
        body: draft.trim(), ...(file ? { attachmentName: file.name, attachmentMime: file.type || 'application/octet-stream', attachmentBase64 } : {}),
      });
      requestVersion.current += 1;
      stickToBottom.current = true;
      setMessages((current) => [...(current ?? []).filter((item) => item.id !== result.message.id), result.message]);
      setDraft(''); setFile(null); if (fileRef.current) fileRef.current.value = '';
    } catch (cause) { toast.push(describeError(cause), 'error'); }
    finally { setBusy(false); }
  };
  const download = async (message: ChatMessage) => {
    if (!message.attachmentUrl) return;
    try {
      const token = getSessionToken();
      const response = await fetch(message.attachmentUrl, { credentials: 'same-origin', headers: token ? { 'x-session-token': token } : {} });
      if (!response.ok) throw new Error('Không thể tải tệp. Hãy thử lại hoặc kiểm tra quyền truy cập.');
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = message.attachmentName ?? 'attachment';
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { toast.push(describeError(cause), 'error'); }
  };
  const visible = view === 'files' ? messages?.filter((message) => message.attachmentUrl) : messages;
  return <div className="course-chat">
    {loadError && <p className="course-chat__error" role="status">Không tải được tin nhắn: {loadError}. Đang thử lại.</p>}
    <div ref={feedRef} className="course-chat__feed" onScroll={(event) => { const el = event.currentTarget; stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }} aria-label={view === 'files' ? 'Tệp của lớp' : 'Tin nhắn của lớp'}>
      {messages === null && !loadError ? <Loading label="Đang tải hội thoại…" /> : visible?.length === 0 ? <EmptyState title={view === 'files' ? 'Chưa có tệp' : 'Chưa có tin nhắn'}><p>{view === 'files' ? 'Tệp được chia sẻ trong hội thoại sẽ xuất hiện ở đây.' : 'Gửi lời chào hoặc chia sẻ tài liệu với lớp.'}</p></EmptyState> : visible?.map((message) => <article className={`course-message${message.senderId === user?.id ? ' course-message--self' : ''}`} key={message.id}>
        <div className="course-message__avatar" aria-hidden="true">{message.senderName.trim().slice(0, 1).toUpperCase()}</div><div className="course-message__content"><div className="course-message__meta"><strong>{message.senderId === user?.id ? 'Bạn' : message.senderName}</strong><time>{relativeTime(message.createdAt)}</time></div>
        {message.body && <p>{message.body}</p>}{message.attachmentUrl && <button type="button" className="course-message__file" onClick={() => void download(message)}><Icon name="upload" size={15} /> {message.attachmentName ?? 'Tải tệp'}</button>}</div>
      </article>)}
    </div>
    {view === 'messages' && <form className="course-chat__composer" onSubmit={(event) => void send(event)}>
      {file && <div className="course-chat__selected">Tệp: {file.name} <button type="button" disabled={busy} onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ''; }}>Bỏ tệp</button></div>}
      <label htmlFor="course-chat-draft">Tin nhắn đến lớp</label><div className="course-chat__input"><input id="course-chat-draft" value={draft} maxLength={4000} onChange={(event) => setDraft(event.target.value)} placeholder="Viết tin nhắn…" /><label className="course-chat__attach" title="Đính kèm tệp (tối đa 10 MB)"><Icon name="upload" size={17} /><span className="sr-only">Chọn tệp đính kèm</span><input ref={fileRef} type="file" disabled={busy} onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label><Button type="submit" variant="primary" loading={busy} disabled={!draft.trim() && !file}>Gửi</Button></div>
    </form>}
  </div>;
}
