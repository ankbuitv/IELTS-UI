import {ClassroomMute} from './ClassroomMute';
import {ClassroomMentionPicker} from './ClassroomMentionPicker';
import {ClassroomThread} from './ClassroomThread';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
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
  replyTo?: string | null;
}

export function ClassroomChatButton({ classroomId, classroomName }: { classroomId: string; classroomName: string }) {
  const [open, setOpen] = useState(false);
  return <><Button size="sm" variant="ghost" onClick={() => setOpen(true)}><Icon name="bubble" size={13} /> Chat</Button>
    <Modal open={open} title={`Chat · ${classroomName}`} onClose={() => setOpen(false)} wide>{open && <ClassroomChat classroomId={classroomId} />}</Modal></>;
}

/** A classroom conversation; attachments and messages use the same membership rules. */
export function ClassroomChat({classroomId,view='messages'}:{classroomId:string;view?:'messages'|'files'}) {
  return <ClassroomChatInstance key={classroomId} classroomId={classroomId} view={view}/>;
}

function ClassroomChatInstance({ classroomId, view = 'messages' }: { classroomId: string; view?: 'messages' | 'files' }) {
  const { user } = useAuth();
  const toast = useToast();
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const searchId=useId();
  const [unread,setUnread]=useState<ChatMessage[]|null>(null);const [unreadError,setUnreadError]=useState(''),[unreadBusy,setUnreadBusy]=useState(false);const unreadVersion=useRef(0);
  const [pins,setPins]=useState<{canManage:boolean;messages:ChatMessage[]}|null>(null);
  const [pinError,setPinError]=useState(''),[pinBusy,setPinBusy]=useState(false);
  const pinVersion=useRef(0);
  const [searchQuery,setSearchQuery]=useState('');
  const [search,setSearch]=useState<{term:string;messages:ChatMessage[];next:{time:string;id:string}|null}|null>(null);
  const [searchBusy,setSearchBusy]=useState(false),[searchError,setSearchError]=useState('');
  const searchVersion=useRef(0);
  const [threadRoot,setThreadRoot]=useState<string|null>(null);
  const [mentions,setMentions]=useState<string[]>([]);
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

  const loadUnread=useCallback(async()=>{const n=++unreadVersion.current;try{const result=await api.get<{messages:ChatMessage[]}>(`/api/classrooms/${encodeURIComponent(classroomId)}/unread-marks`);if(n===unreadVersion.current){setUnread(result.messages);setUnreadError('');}}catch(e){if(n===unreadVersion.current)setUnreadError(describeError(e));}},[classroomId]);
  useEffect(()=>{void loadUnread();const timer=window.setInterval(()=>void loadUnread(),10000);return()=>window.clearInterval(timer);},[loadUnread]);
  const toggleUnread=async(message:ChatMessage)=>{setUnreadBusy(true);setUnreadError('');try{const path=`/api/classrooms/${encodeURIComponent(classroomId)}/unread-marks/${encodeURIComponent(message.id)}`;if(unread?.some(x=>x.id===message.id))await api.delete(path);else await api.put(path,{});await loadUnread();}catch(e){setUnreadError(describeError(e));}finally{setUnreadBusy(false);}};
  const loadPins=useCallback(async()=>{const version=++pinVersion.current;try{const result=await api.get<{canManage:boolean;messages:ChatMessage[]}>(`/api/classrooms/${encodeURIComponent(classroomId)}/message-pins`);if(version===pinVersion.current){setPins(result);setPinError('');}}catch(e){if(version===pinVersion.current)setPinError(describeError(e));}},[classroomId]);
  useEffect(()=>{void loadPins();const timer=window.setInterval(()=>void loadPins(),10000);return()=>{window.clearInterval(timer);pinVersion.current++;};},[loadPins]);
  const togglePin=async(message:ChatMessage)=>{setPinBusy(true);setPinError('');try{const path=`/api/classrooms/${encodeURIComponent(classroomId)}/message-pins/${encodeURIComponent(message.id)}`;if(pins?.messages.some(x=>x.id===message.id))await api.delete(path);else await api.put(path,{});await loadPins();}catch(e){setPinError(describeError(e));}finally{setPinBusy(false);}};

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
        body: draft.trim(), mentions, ...(file ? { attachmentName: file.name, attachmentMime: file.type || 'application/octet-stream', attachmentBase64 } : {}),
      });
      requestVersion.current += 1;
      stickToBottom.current = true;
      setMessages((current) => [...(current ?? []).filter((item) => item.id !== result.message.id), result.message]);
      setDraft(''); setMentions([]); setFile(null); if (fileRef.current) fileRef.current.value = '';
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
  const runSearch = async (term:string,more=false) => {
    const normalized=term.trim();if(normalized.length<2||normalized.length>100){setSearchError('Nhập từ 2 đến 100 ký tự.');return;}
    const cursor=more?search?.next:null;const version=++searchVersion.current;setSearchBusy(true);setSearchError('');
    try{const params=new URLSearchParams({q:normalized});if(cursor){params.set('beforeTime',cursor.time);params.set('beforeId',cursor.id);}
      const result=await api.get<{messages:ChatMessage[];next:{time:string;id:string}|null}>(`/api/classrooms/${encodeURIComponent(classroomId)}/messages/search?${params}`);
      if(version===searchVersion.current){stickToBottom.current=false;setSearch(previous=>({term:normalized,messages:more&&previous?.term===normalized?[...previous.messages,...result.messages]:result.messages,next:result.next}));}
    }catch(e){if(version===searchVersion.current)setSearchError(describeError(e));}finally{if(version===searchVersion.current)setSearchBusy(false);}
  };
  const closeSearch=()=>{searchVersion.current++;setSearch(null);setSearchQuery('');setSearchError('');setSearchBusy(false);stickToBottom.current=true;};
  const visible = view === 'files' ? messages?.filter((message) => message.attachmentUrl) : search?.messages ?? messages;
  return <div className="course-chat">
    {view==='messages'&&<ClassroomMute classroomId={classroomId}/>}
    {view==='messages'&&<details className="course-chat__pins"><summary>Tin đánh dấu chưa đọc ({unread?.length??0})</summary><p>Chỉ bạn thấy các tin tự đánh dấu; không tự đánh dấu tin mới.</p>{unreadError&&<p role="alert">{unreadError}</p>}{unread?.length?unread.map(message=><article key={message.id}><strong>{message.senderName}</strong>{message.body&&<p>{message.body}</p>}{message.attachmentUrl&&<button type="button" onClick={()=>void download(message)}>{message.attachmentName??'Tải tệp'}</button>}<button type="button" onClick={()=>setThreadRoot(message.replyTo??message.id)}>Xem luồng</button><button type="button" disabled={unreadBusy} onClick={()=>void toggleUnread(message)} aria-label={`Đánh dấu đã đọc ${message.id}`}>Đã đọc</button></article>):unread?<p>Chưa đánh dấu tin nào.</p>:!unreadError?<p>Đang tải…</p>:null}</details>}
    {view==='messages'&&<details className="course-chat__pins"><summary>Tin ghim ({pins?.messages.length??0})</summary>{pinError&&<p role="alert">{pinError}</p>}{!pins&&!pinError?<p>Đang tải tin ghim…</p>:pins?.messages.length?pins.messages.map(message=><article key={message.id}><strong>{message.senderName}</strong>{message.body&&<p>{message.body}</p>}{message.attachmentUrl&&<button type="button" onClick={()=>void download(message)}>{message.attachmentName??'Tải tệp'}</button>}{pins.canManage&&<button type="button" disabled={pinBusy} onClick={()=>void togglePin(message)} aria-label={`Bỏ ghim tin ${message.id}`}>Bỏ ghim</button>}</article>):!pinError?<p>Chưa có tin ghim.</p>:null}</details>}
    {view==='messages'&&<form className="course-chat__search" onSubmit={e=>{e.preventDefault();void runSearch(searchQuery);}}><label htmlFor={searchId}>Tìm tin nhắn</label><input id={searchId} type="search" maxLength={100} value={searchQuery} onChange={e=>setSearchQuery(e.target.value)} placeholder="Nội dung hoặc tên tệp"/><button type="submit" disabled={searchBusy||searchQuery.trim().length<2}>Tìm</button>{search&&<button type="button" onClick={closeSearch}>Đóng tìm kiếm</button>}</form>}
    {searchError&&<p className="course-chat__error" role="alert">{searchError}</p>}{search&&view==='messages'&&<p className="course-chat__search-info">Kết quả cho “{search.term}” · mới nhất trước; chữ có dấu cần đúng chữ hoa/thường.</p>}
    {loadError && <p className="course-chat__error" role="status">Không tải được tin nhắn: {loadError}. Đang thử lại.</p>}
    <div ref={feedRef} className="course-chat__feed" onScroll={(event) => { const el = event.currentTarget; stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }} aria-label={view === 'files' ? 'Tệp của lớp' : 'Tin nhắn của lớp'}>
      {messages === null && !search && !loadError ? <Loading label="Đang tải hội thoại…" /> : visible?.length === 0 ? <EmptyState title={search && view==='messages' ? 'Không tìm thấy tin nhắn' : view === 'files' ? 'Chưa có tệp' : 'Chưa có tin nhắn'}><p>{search && view==='messages' ? 'Hãy thử từ khóa khác.' : view === 'files' ? 'Tệp được chia sẻ trong hội thoại sẽ xuất hiện ở đây.' : 'Gửi lời chào hoặc chia sẻ tài liệu với lớp.'}</p></EmptyState> : visible?.map((message) => <article className={`course-message${message.senderId === user?.id ? ' course-message--self' : ''}`} key={message.id}>
        <div className="course-message__avatar" aria-hidden="true">{message.senderName.trim().slice(0, 1).toUpperCase()}</div><div className="course-message__content"><div className="course-message__meta"><strong>{message.senderId === user?.id ? 'Bạn' : message.senderName}</strong><time>{relativeTime(message.createdAt)}</time></div>
        {message.body && <p>{message.body}</p>}{message.attachmentUrl && <button type="button" className="course-message__file" onClick={() => void download(message)}><Icon name="upload" size={15} /> {message.attachmentName ?? 'Tải tệp'}</button>}{view==='messages'&&unread&&<button type="button" className="course-message__pin" disabled={unreadBusy} aria-label={`${unread.some(x=>x.id===message.id)?'Đánh dấu đã đọc':'Đánh dấu chưa đọc'} ${message.id}`} onClick={()=>void toggleUnread(message)}>{unread.some(x=>x.id===message.id)?'Đã đọc':'Đánh dấu chưa đọc'}</button>}{view==='messages'&&<button type="button" className="course-message__pin" onClick={()=>setThreadRoot(message.replyTo??message.id)}>{message.replyTo?'Xem luồng':'Trả lời'}</button>}{view==='messages'&&pins?.canManage&&<button type="button" className="course-message__pin" disabled={pinBusy} aria-label={`${pins.messages.some(x=>x.id===message.id)?'Bỏ ghim':'Ghim'} tin ${message.id}`} onClick={()=>void togglePin(message)}>{pins.messages.some(x=>x.id===message.id)?'Bỏ ghim':'Ghim'}</button>}</div>
      </article>)}
    </div>
    {view==='messages'&&threadRoot&&<ClassroomThread key={threadRoot} classroomId={classroomId} rootId={threadRoot} onClose={()=>setThreadRoot(null)} onDownload={message=>void download(message)} unreadIds={unread?.map(item=>item.id)??[]} onToggleUnread={message=>void toggleUnread(message)} unreadBusy={unreadBusy}/>}
    {view==='messages'&&search?.next&&<button type="button" className="course-chat__search-more" disabled={searchBusy} onClick={()=>void runSearch(search.term,true)}>Xem thêm kết quả cũ</button>}
    {view === 'messages' && <form className="course-chat__composer" onSubmit={(event) => void send(event)}>
      {file && <div className="course-chat__selected">Tệp: {file.name} <button type="button" disabled={busy} onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ''; }}>Bỏ tệp</button></div>}
      <ClassroomMentionPicker classroomId={classroomId} selected={mentions} onChange={setMentions} disabled={busy}/>
      <label htmlFor="course-chat-draft">Tin nhắn đến lớp</label><div className="course-chat__input"><input id="course-chat-draft" value={draft} maxLength={4000} onChange={(event) => setDraft(event.target.value)} placeholder="Viết tin nhắn…" /><label className="course-chat__attach" title="Đính kèm tệp (tối đa 10 MB)"><Icon name="upload" size={17} /><span className="sr-only">Chọn tệp đính kèm</span><input ref={fileRef} type="file" disabled={busy} onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label><Button type="submit" variant="primary" loading={busy} disabled={!draft.trim() && !file}>Gửi</Button></div>
    </form>}
  </div>;
}
