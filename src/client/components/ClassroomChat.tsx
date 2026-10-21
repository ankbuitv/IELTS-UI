import { useCallback, useEffect, useRef, useState } from 'react';
import { api, describeError } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Button, EmptyState, Loading, Modal, TextInput, useToast } from './ui';
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

/** Opens the course chat of one classroom in a modal. */
export function ClassroomChatButton({ classroomId, classroomName }: { classroomId: string; classroomName: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <Icon name="bubble" size={13} /> Chat
      </Button>
      <Modal open={open} title={`Chat · ${classroomName}`} onClose={() => setOpen(false)} wide>
        <ClassroomChat classroomId={classroomId} />
      </Modal>
    </>
  );
}

function ClassroomChat({ classroomId }: { classroomId: string }) {
  const { user } = useAuth();
  const toast = useToast();
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const result = await api.get<{ messages: ChatMessage[] }>(
        `/api/classrooms/${classroomId}/messages`,
      );
      setMessages(result.messages);
      setTimeout(() => bottomRef.current?.scrollIntoView({ block: 'end' }), 0);
    } catch (cause) {
      toast.push(describeError(cause), 'error');
    }
  }, [classroomId, toast]);

  useEffect(() => {
    if (!messages) void load();
  }, [messages, load]);

  const attach = async (file: File) => {
    setBusy(true);
    try {
      const attachmentBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Could not read the file.'));
        reader.readAsDataURL(file);
      });
      const result = await api.post<{ message: ChatMessage }>(`/api/classrooms/${classroomId}/messages`, {
        body: draft.trim() || undefined,
        attachmentName: file.name,
        attachmentMime: file.type || 'application/octet-stream',
        attachmentBase64,
      });
      setDraft('');
      setMessages((current) => [...(current ?? []), result.message]);
      setTimeout(() => bottomRef.current?.scrollIntoView({ block: 'end' }), 0);
    } catch (cause) {
      toast.push(describeError(cause), 'error');
    } finally {
      setBusy(false);
    }
  };

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setBusy(true);
    try {
      const result = await api.post<{ message: ChatMessage }>(
        `/api/classrooms/${classroomId}/messages`,
        { body: text },
      );
      setDraft('');
      setMessages((current) => [...(current ?? []), result.message]);
      setTimeout(() => bottomRef.current?.scrollIntoView({ block: 'end' }), 0);
    } catch (cause) {
      toast.push(describeError(cause), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack" style={{ minHeight: 280, maxHeight: '60vh' }}>
      <div className="stack" style={{ gap: 8, overflowY: 'auto', flex: 1, padding: '4px 2px' }}>
        {messages === null ? (
          <Loading label="Loading messages…" />
        ) : messages.length === 0 ? (
          <EmptyState title="No messages yet" icon="bubble">
            <p>Say hello to your class — questions, answers and announcements all live here.</p>
          </EmptyState>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              style={{
                alignSelf: message.senderId === user?.id ? 'flex-end' : 'flex-start',
                maxWidth: '78%',
                padding: '8px 12px',
                borderRadius: 14,
                background: message.senderId === user?.id ? 'var(--brand-600)' : 'var(--wash)',
                color: message.senderId === user?.id ? '#fff' : 'var(--ink-900)',
              }}
            >
              {message.senderId !== user?.id ? (
                <p className="tiny" style={{ margin: '0 0 2px', opacity: 0.75, fontWeight: 700 }}>{message.senderName}</p>
              ) : null}
              {message.body ? (
                <p style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{message.body}</p>
              ) : null}
              {message.attachmentUrl ? (
                <a
                  className="chat-attach"
                  href={message.attachmentUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  download={message.attachmentName ?? undefined}
                >
                  <Icon name="upload" size={13} style={{ transform: 'rotate(180deg)' }} />
                  {message.attachmentName ?? 'Download file'}
                </a>
              ) : null}
              <p className="tiny" style={{ margin: '2px 0 0', opacity: 0.65 }}>{relativeTime(message.createdAt)}</p>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
      <form className="row gap-8" onSubmit={send}>
        <label className="chat-attach-btn" title="Send a file">
          <Icon name="upload" size={16} style={{ transform: 'rotate(180deg)' }} />
          <input
            type="file"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void attach(file);
            }}
          />
        </label>
        <div style={{ flex: 1 }}>
          <TextInput value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Write a message…" aria-label="Message" />
        </div>
        <Button type="submit" variant="primary" loading={busy} disabled={!draft.trim()}>
          Send
        </Button>
      </form>
    </div>
  );
}
