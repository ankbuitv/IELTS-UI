import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api, describeError } from '../../lib/api';
import { Icon } from '../../components/Icon';
import { Badge } from '../../components/ui';
import {
  TUTOR_FOCUS,
  TUTOR_SUGGESTIONS,
  type TutorConversation,
  type TutorFocus,
  type TutorMessage,
  type TutorThread,
} from '@shared/tutor';

const FOCUS_LABELS: Record<TutorFocus, string> = {
  ANY: 'Mọi kỹ năng',
  WRITING: 'Writing',
  SPEAKING: 'Speaking',
  READING: 'Reading',
  LISTENING: 'Listening',
  VOCABULARY: 'Từ vựng',
};

/**
 * The Markdown the tutor writes — headings, tables, fenced code, lists,
 * emphasis, inline code and links — rendered as React elements rather than
 * HTML, so model output can never inject markup.
 *
 * The parser is a small line scanner: fenced blocks and tables hold their
 * rows together across single newlines (a blank line is the only paragraph
 * break), which a plain split-on-blank-lines would tear apart.
 */
type RichBlock =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'code'; lines: string[] }
  | { kind: 'table'; rows: string[][] }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'paragraph'; text: string };

const HEADING_RE = /^(#{1,4})\s+(.*)$/;
const BULLET_RE = /^\s*[-•*]\s+(.*)$/;
const ORDERED_RE = /^\s*\d+[.)]\s+(.*)$/;
const FENCE_RE = /^\s*```/;
const SEPARATOR_CELL_RE = /^:?-{3,}:?$/;

const splitTableRow = (line: string): string[] =>
  line.trim().replace(/^\|/, '').replace(/\|\s*$/, '').split('|').map((cell) => cell.trim());

function parseRich(text: string): RichBlock[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: RichBlock[] = [];
  let code: string[] | null = null;
  let table: string[][] | null = null;
  let list: { ordered: boolean; items: string[] } | null = null;
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ kind: 'paragraph', text: paragraph.join('\n') });
    paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push({ kind: 'list', ordered: list.ordered, items: list.items });
    list = null;
  };
  const flushTable = () => {
    if (table) blocks.push({ kind: 'table', rows: table });
    table = null;
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
    flushTable();
  };

  for (const line of lines) {
    if (code) {
      if (FENCE_RE.test(line)) {
        blocks.push({ kind: 'code', lines: code });
        code = null;
      } else code.push(line);
      continue;
    }
    if (FENCE_RE.test(line)) {
      flushAll();
      code = [];
      continue;
    }
    if (/^\s*\|/.test(line)) {
      flushParagraph();
      flushList();
      const cells = splitTableRow(line);
      if (cells.every((cell) => SEPARATOR_CELL_RE.test(cell))) continue;
      (table ??= []).push(cells);
      continue;
    }
    flushTable();

    const heading = HEADING_RE.exec(line);
    if (heading) {
      flushAll();
      blocks.push({ kind: 'heading', level: Math.min(heading[1]!.length, 3), text: heading[2]! });
      continue;
    }

    const bullet = BULLET_RE.exec(line);
    if (bullet) {
      flushParagraph();
      if (list && !list.ordered) list.items.push(bullet[1]!);
      else {
        flushList();
        list = { ordered: false, items: [bullet[1]!] };
      }
      continue;
    }
    const ordered = ORDERED_RE.exec(line);
    if (ordered) {
      flushParagraph();
      if (list && list.ordered) list.items.push(ordered[1]!);
      else {
        flushList();
        list = { ordered: true, items: [ordered[1]!] };
      }
      continue;
    }
    flushList();
    if (!line.trim()) flushParagraph();
    else paragraph.push(line);
  }
  if (code) blocks.push({ kind: 'code', lines: code });
  flushAll();
  return blocks;
}

/** Emphasis, `code` and links, split out of one line of plain text. */
const INLINE_RE = /(`[^`]+`|\*\*[^*\n]+\*\*|\[[^\]]+\]\([^)]+\)|\*[^*\n]+\*|_[^_\n]+_)/g;

const inline = (text: string): ReactNode[] =>
  text.split(INLINE_RE).map((part, index) => {
    if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith('**') && part.endsWith('**') && part.slice(2, -2).trim()) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    if (link) {
      const href = link[2]!;
      // Only real destinations: the model does not get to run script from a chat bubble.
      if (/^https?:\/\//i.test(href) || href.startsWith('/')) {
        return (
          <a key={index} href={href} target="_blank" rel="noreferrer noopener">
            {inline(link[1]!)}
          </a>
        );
      }
      return <span key={index}>{part}</span>;
    }
    if (part.length > 2 && (part[0] === '*' || part[0] === '_') && part[0] === part[part.length - 1]) {
      const inner = part.slice(1, -1);
      // "2 * 3 * 4" is arithmetic and snake_case is an identifier — italics need
      // tight delimiters, and "_" only separates words (never inside one).
      const tight = inner.trim() && !inner.startsWith(' ') && !inner.endsWith(' ');
      if (tight && (part[0] === '*' || inner.includes(' '))) return <em key={index}>{inner}</em>;
    }
    return <span key={index}>{part}</span>;
  });

function TutorRichText({ text }: { text: string }) {
  return (
    <div className="tutor-rich">
      {parseRich(text).map((block, index) => {
        switch (block.kind) {
          case 'heading': {
            const Tag = (block.level <= 1 ? 'h4' : block.level === 2 ? 'h5' : 'h6') as 'h4' | 'h5' | 'h6';
            return <Tag key={index}>{inline(block.text)}</Tag>;
          }
          case 'code':
            return (
              <pre key={index} className="tutor-rich__pre">
                <code>{block.lines.join('\n')}</code>
              </pre>
            );
          case 'table': {
            const [header = [], ...body] = block.rows;
            return (
              <div key={index} className="tutor-rich__scroll">
                <table className="tutor-rich__table">
                  <thead>
                    <tr>{header.map((cell, cellIndex) => <th key={cellIndex}>{inline(cell)}</th>)}</tr>
                  </thead>
                  <tbody>
                    {body.map((row, rowIndex) => (
                      <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{inline(cell)}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }
          case 'list':
            return block.ordered ? (
              <ol key={index}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{inline(item)}</li>)}</ol>
            ) : (
              <ul key={index}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{inline(item)}</li>)}</ul>
            );
          case 'paragraph':
            return <p key={index}>{inline(block.text)}</p>;
        }
      })}
    </div>
  );
}

export function TutorPage() {
  const [conversations, setConversations] = useState<TutorConversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [thread, setThread] = useState<TutorThread | null>(null);
  const [focus, setFocus] = useState<TutorFocus>('ANY');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const loadList = useCallback(async () => {
    const { conversations: list } = await api.get<{ conversations: TutorConversation[] }>('/api/student/tutor');
    setConversations(list);
    return list;
  }, []);

  const openConversation = useCallback(async (id: string) => {
    setActiveId(id);
    setError(null);
    try {
      setThread(await api.get<TutorThread>(`/api/student/tutor/${encodeURIComponent(id)}`));
    } catch (cause) {
      setError(describeError(cause));
      setThread(null);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await loadList();
        if (!alive) return;
        if (list[0]) await openConversation(list[0].id);
      } catch (cause) {
        if (alive) setError(describeError(cause));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [loadList, openConversation]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [thread?.messages.length, busy]);

  const newChat = async () => {
    setCreating(true);
    setError(null);
    try {
      const conversation = await api.post<TutorConversation>('/api/student/tutor', { focusSkill: focus });
      setConversations((list) => [conversation, ...list]);
      setThread({ conversation, messages: [] });
      setActiveId(conversation.id);
      requestAnimationFrame(() => inputRef.current?.focus());
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setCreating(false);
    }
  };

  const send = async () => {
    const content = input.trim();
    if (!content || busy || !activeId) return;
    setError(null);
    setBusy(true);
    setInput('');
    // Optimistic bubble so the learner sees their question immediately.
    const optimistic: TutorMessage = {
      id: `tmp-${Date.now()}`,
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    };
    setThread((current) => (current ? { ...current, messages: [...current.messages, optimistic] } : current));
    try {
      const next = await api.post<TutorThread>(`/api/student/tutor/${encodeURIComponent(activeId)}/messages`, { content });
      setThread(next);
      setConversations((list) =>
        list
          .map((item) => (item.id === next.conversation.id ? { ...next.conversation } : item))
          .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)),
      );
    } catch (cause) {
      setError(describeError(cause));
      // The question was saved server-side before the model failed.
      try {
        setThread(await api.get<TutorThread>(`/api/student/tutor/${encodeURIComponent(activeId)}`));
      } catch {
        setThread((current) =>
          current ? { ...current, messages: current.messages.filter((item) => item.id !== optimistic.id) } : current,
        );
      }
    } finally {
      setBusy(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  const remove = async (id: string) => {
    try {
      await api.delete(`/api/student/tutor/${encodeURIComponent(id)}`);
      const rest = conversations.filter((item) => item.id !== id);
      setConversations(rest);
      if (activeId === id) {
        if (rest[0]) await openConversation(rest[0].id);
        else {
          setActiveId(null);
          setThread(null);
        }
      }
    } catch (cause) {
      setError(describeError(cause));
    }
  };

  const applySuggestion = (prompt: string) => {
    setInput(prompt);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      const length = prompt.length;
      inputRef.current?.setSelectionRange(length, length);
    });
  };

  return (
    <div className="tutor-page">
      <aside className="tutor-side" aria-label="Cuộc trò chuyện">
        <div className="tutor-side__head">
          <div>
            <p className="tutor-side__kicker">
              <Icon name="sparkle" size={13} />
              AI Tutor
            </p>
            <strong>Hỏi bất cứ điều gì</strong>
          </div>
          <button type="button" className="tutor-side__new" onClick={() => void newChat()} disabled={creating} title="Cuộc trò chuyện mới">
            <Icon name={creating ? 'rotate' : 'plus'} size={15} />
          </button>
        </div>

        <label className="tutor-side__focus">
          <span>Đang tập trung</span>
          <select value={focus} onChange={(event) => setFocus(event.target.value as TutorFocus)}>
            {TUTOR_FOCUS.map((item) => (
              <option key={item} value={item}>
                {FOCUS_LABELS[item]}
              </option>
            ))}
          </select>
        </label>

        <div className="tutor-side__list">
          {loading ? <p className="tutor-side__empty">Đang mở…</p> : null}
          {!loading && conversations.length === 0 ? (
            <p className="tutor-side__empty">Chưa có cuộc trò chuyện. Đặt câu hỏi đầu tiên ở bên phải.</p>
          ) : null}
          {conversations.map((item) => (
            <div key={item.id} className={`tutor-conv${item.id === activeId ? ' is-active' : ''}`}>
              <button type="button" className="tutor-conv__open" onClick={() => void openConversation(item.id)}>
                <strong>{item.title}</strong>
                <span>{item.preview || FOCUS_LABELS[item.focusSkill]}</span>
              </button>
              <button
                type="button"
                className="tutor-conv__del"
                onClick={() => void remove(item.id)}
                aria-label={`Xoá ${item.title}`}
                title="Xoá cuộc trò chuyện"
              >
                <Icon name="trash" size={13} />
              </button>
            </div>
          ))}
        </div>

        <Link className="tutor-side__back" to="/dashboard">
          <Icon name="chevronRight" size={13} className="icon--flip" />
          Về trang chủ
        </Link>
      </aside>

      <section className="tutor-main" aria-label="Khung trò chuyện">
        {thread ? (
          <>
            <header className="tutor-main__head">
              <div>
                <h1>{thread.conversation.title}</h1>
                <p>
                  <Badge tone="accent">{FOCUS_LABELS[thread.conversation.focusSkill]}</Badge>
                  <span>Trả lời bằng tiếng Việt hoặc tiếng Anh · không thay thế giám khảo</span>
                </p>
              </div>
              <button type="button" className="tutor-main__del" onClick={() => void remove(thread.conversation.id)}>
                <Icon name="trash" size={14} />
                Xoá
              </button>
            </header>

            <div className="tutor-thread">
              {thread.messages.length === 0 ? (
                <div className="tutor-welcome">
                  <span className="tutor-welcome__mark">
                    <Icon name="sparkle" size={22} />
                  </span>
                  <h2>Mình giúp gì được cho bạn hôm nay?</h2>
                  <p>
                    Sửa một câu, giải thích ngữ pháp, gợi ý dàn ý Speaking, hay lên lịch học. Mình không tự bịa band điểm —
                    bài thi thật được chấm ở phần Practice.
                  </p>
                  <div className="tutor-suggestions">
                    {TUTOR_SUGGESTIONS.map((item) => (
                      <button key={item.label} type="button" onClick={() => applySuggestion(item.prompt)}>
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                thread.messages.map((message) => (
                  <article key={message.id} className={`tutor-msg tutor-msg--${message.role}`}>
                    <span className="tutor-msg__who">{message.role === 'user' ? 'Bạn' : 'AI Tutor'}</span>
                    <div className="tutor-msg__bubble">
                      <TutorRichText text={message.content} />
                    </div>
                  </article>
                ))
              )}
              {busy ? (
                <article className="tutor-msg tutor-msg--assistant">
                  <span className="tutor-msg__who">AI Tutor</span>
                  <div className="tutor-msg__bubble tutor-msg__bubble--typing" aria-label="AI đang trả lời">
                    <i />
                    <i />
                    <i />
                  </div>
                </article>
              ) : null}
              <div ref={endRef} />
            </div>

            {error ? (
              <div className="tutor-error" role="alert">
                <Icon name="alert" size={14} />
                {error}
              </div>
            ) : null}

            <form
              className="tutor-composer"
              onSubmit={(event) => {
                event.preventDefault();
                void send();
              }}
            >
              <textarea
                ref={inputRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
                rows={2}
                maxLength={4000}
                placeholder="Viết câu hỏi… ví dụ: “Sửa giúp mình câu này cho tự nhiên hơn”"
                aria-label="Câu hỏi cho AI Tutor"
                disabled={busy}
              />
              <button type="submit" disabled={!input.trim() || busy} aria-label="Gửi">
                <Icon name="send" size={17} />
              </button>
            </form>
            <p className="tutor-hint">Enter để gửi · Shift + Enter xuống dòng · AI có thể sai, hãy kiểm tra lại</p>
          </>
        ) : (
          <div className="tutor-welcome tutor-welcome--full">
            <span className="tutor-welcome__mark">
              <Icon name="sparkle" size={22} />
            </span>
            <h2>AI Tutor</h2>
            <p>Hỏi về IELTS, ngữ pháp, từ vựng hoặc cách học. Bắt đầu bằng một cuộc trò chuyện mới.</p>
            <button type="button" className="btn btn--primary" onClick={() => void newChat()} disabled={creating}>
              <Icon name="plus" size={14} /> Bắt đầu
            </button>
            {error ? <p className="tutor-error">{error}</p> : null}
          </div>
        )}
      </section>
    </div>
  );
}
