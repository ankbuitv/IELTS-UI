import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CandidateSection } from '@shared/question-types';
import { Icon } from '../Icon';

interface PassageMark {
  id: string;
  text: string;
  color: 'sun' | 'mint';
  note?: string;
}

function toolsStorageKey(key: string): string {
  return `passage-tools:${key}`;
}

function readMarks(key: string | undefined): PassageMark[] {
  if (!key) return [];
  try {
    return JSON.parse(window.localStorage.getItem(toolsStorageKey(key)) ?? '[]') as PassageMark[];
  } catch {
    return [];
  }
}

function writeMarks(key: string | undefined, marks: PassageMark[]): void {
  if (!key) return;
  window.localStorage.setItem(toolsStorageKey(key), JSON.stringify(marks));
}

/** Wrap every stored highlight inside `text` with <mark> chips (longest first). */
function renderWithMarks(
  text: string,
  marks: PassageMark[],
  onRemove: (mark: PassageMark) => void,
): ReactNode {
  const applicable = marks.filter((mark) => mark.text && text.includes(mark.text));
  if (applicable.length === 0) return text;
  const ordered = [...applicable].sort((a, b) => b.text.length - a.text.length);
  const parts: ReactNode[] = [];
  let rest = text;
  let key = 0;
  while (rest.length > 0) {
    let earliest = -1;
    let hit: PassageMark | null = null;
    for (const mark of ordered) {
      const at = rest.indexOf(mark.text);
      if (at !== -1 && (earliest === -1 || at < earliest)) {
        earliest = at;
        hit = mark;
      }
    }
    if (!hit || earliest === -1) {
      parts.push(rest);
      break;
    }
    if (earliest > 0) parts.push(rest.slice(0, earliest));
    parts.push(
      <mark
        key={`mark-${key++}`}
        className={`passage-mark passage-mark--${hit.color}`}
        title={hit.note ? `Ghi chú: ${hit.note}` : 'Nhấn để bỏ highlight'}
        onClick={() => onRemove(hit!)}
      >
        {hit.text}
        {hit.note ? (
          <span className="passage-mark__note">
            <Icon name="pen" size={11} />
          </span>
        ) : null}
      </mark>,
    );
    rest = rest.slice(earliest + hit.text.length);
  }
  return parts;
}

export function PassagePane({
  sections,
  showInstructions,
  lead,
  children,
  practiceTools = false,
  storageKey,
  onLookup,
}: {
  sections: CandidateSection[];
  showInstructions?: boolean;
  /** Material that sits above the passage inside the same scroll region (audio, a figure). */
  lead?: ReactNode;
  /**
   * Extra material that belongs with the source text (a listening transcript,
   * for example). It renders inside the same scroll region as the passage so
   * the pane keeps a single scrollbar.
   */
  children?: ReactNode;
  /** Practice-only study tools: highlight, notes and double-click lookup. */
  practiceTools?: boolean;
  /** Attempt id — highlights and notes are saved per attempt on this device. */
  storageKey?: string;
  /** Open the in-exam dictionary with the double-clicked word. */
  onLookup?: (term: string) => void;
}) {
  const [marks, setMarks] = useState<PassageMark[]>(() => readMarks(storageKey));
  const [toolbar, setToolbar] = useState<{ x: number; y: number; text: string } | null>(null);
  const [noteDraft, setNoteDraft] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const persist = useCallback(
    (next: PassageMark[]) => {
      setMarks(next);
      writeMarks(storageKey, next);
    },
    [storageKey],
  );

  const addMark = useCallback(
    (text: string, color: 'sun' | 'mint', note?: string) => {
      const clean = text.trim();
      if (!clean) return;
      persist([...readMarks(storageKey), { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, text: clean, color, note }]);
      setToolbar(null);
      setNoteDraft(null);
    },
    [persist, storageKey],
  );

  const removeMark = useCallback(
    (mark: PassageMark) => {
      persist(readMarks(storageKey).filter((item) => item.id !== mark.id));
    },
    [persist, storageKey],
  );

  const onMouseUp = useCallback(() => {
    if (!practiceTools) return;
    const selection = window.getSelection();
    const text = selection?.toString() ?? '';
    if (!selection || selection.isCollapsed || text.trim().length < 2) {
      setToolbar(null);
      return;
    }
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    setToolbar({ x: rect.left + rect.width / 2, y: rect.top, text });
    setNoteDraft(null);
  }, [practiceTools]);

  const onDoubleClick = useCallback(() => {
    if (!practiceTools || !onLookup) return;
    const selection = window.getSelection();
    const word = (selection?.toString() ?? '').trim().toLowerCase().replace(/[^a-z0-9'’-]/g, '');
    if (word.length >= 2) {
      onLookup(word);
      setToolbar(null);
    }
  }, [practiceTools, onLookup]);

  const withPassages = sections.filter((section) => section.passage);
  const markMap = useMemo(() => marks, [marks]);

  if (withPassages.length === 0) {
    return (
      <div className="exam-pane__scroll">
        {lead}
        {children}
      </div>
    );
  }

  return (
    <div className="exam-pane__scroll" ref={containerRef} onMouseUp={onMouseUp} onDoubleClick={onDoubleClick}>
      {practiceTools ? (
        <p className="practice-hint tiny muted">
          <Icon name="bulb" size={12} />
          Chế độ luyện tập: bôi đen để highlight / ghi chú / tra từ — nhấp đúp vào một từ để tra nhanh.
        </p>
      ) : null}
      {lead}
      {withPassages.map((section) => (
        <article key={section.id} id={`passage-${section.id}`} className="passage-article">
          <div className="passage-article__head">
            <h2>{section.passage!.title || section.title}</h2>
            <span className="tiny muted nowrap">{section.passage!.wordCount} words</span>
          </div>
          {section.passage!.subtitle ? <p className="muted small">{section.passage!.subtitle}</p> : null}
          {showInstructions && section.instructions ? (
            <p className="small muted" style={{ whiteSpace: 'pre-wrap' }}>
              {section.instructions}
            </p>
          ) : null}
          <div className="passage">
            {section.passage!.paragraphs.map((paragraph) => (
              <div className="passage__paragraph" key={paragraph.label || paragraph.text.slice(0, 24)}>
                <span className="passage__label">{paragraph.label}</span>
                <span className="passage__text">
                  {practiceTools ? renderWithMarks(paragraph.text, markMap, removeMark) : paragraph.text}
                </span>
              </div>
            ))}
          </div>
        </article>
      ))}
      {children}

      {/* Floating selection toolbar */}
      {practiceTools && toolbar ? (
        <div
          className="practice-tools-pop"
          style={{ left: toolbar.x, top: toolbar.y - 46 }}
          onMouseDown={(event) => event.preventDefault()}
        >
          <button type="button" title="Highlight vàng" onClick={() => addMark(toolbar.text, 'sun')}>
            <Icon name="star" size={13} />
          </button>
          <button type="button" title="Highlight xanh" onClick={() => addMark(toolbar.text, 'mint')}>
            <Icon name="check" size={13} />
          </button>
          <button type="button" title="Ghi chú" onClick={() => setNoteDraft(toolbar.text)}>
            <Icon name="pen" size={13} />
          </button>
          <button
            type="button"
            title="Tra từ"
            onClick={() => {
              const word = toolbar.text.trim().toLowerCase().replace(/[^a-z0-9'’-]/g, '');
              if (onLookup && word) onLookup(word);
              setToolbar(null);
            }}
          >
            <Icon name="search" size={13} />
          </button>
        </div>
      ) : null}

      {/* Mini note editor */}
      {practiceTools && noteDraft !== null ? (
        <div
          className="practice-tools-pop practice-tools-pop--note"
          style={{ left: toolbar?.x ?? 200, top: (toolbar?.y ?? 200) - 10 }}
          onMouseDown={(event) => event.preventDefault()}
        >
          <textarea
            autoFocus
            rows={3}
            placeholder="Ghi chú của bạn về đoạn này…"
            value={noteDraft === toolbar?.text ? '' : noteDraft}
            onChange={(event) => setNoteDraft(event.target.value)}
            aria-label="Note text"
          />
          <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => setNoteDraft(null)}>
              Huỷ
            </button>
            <button
              type="button"
              className="btn btn--sm btn--primary"
              onClick={() => {
                const note = noteDraft === toolbar?.text ? '' : noteDraft;
                if (toolbar) addMark(toolbar.text, 'sun', note.trim() || undefined);
              }}
            >
              Lưu
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
