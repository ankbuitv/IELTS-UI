import { useEffect, useState } from 'react';
import {
  ANNOTATION_COLORS,
  ANNOTATION_COLOR_LABELS,
  segmentMarkedText,
  type AnnotationColor,
  type ExamAnnotation,
} from '@shared/annotations';
import { Icon } from '../Icon';
import { globalOffset, type AnnotationsApi, type PendingSelection } from './useAnnotations';

/**
 * A paragraph of the paper with the candidate's marks drawn inside it.
 *
 * The text is split at mark boundaries (see `segmentMarkedText`), so a run can
 * carry several colours and each run knows which marks it belongs to. The whole
 * element stays one logical text stream: `globalOffset` can therefore turn a DOM
 * selection back into the character range that the server stores.
 */
export function AnnotatedText({
  text,
  annotations,
  sectionId,
  anchor,
  interactive,
}: {
  text: string;
  annotations: ExamAnnotation[];
  sectionId: string;
  anchor: string;
  interactive: boolean;
}) {
  const segments = annotations.length > 0 ? segmentMarkedText(text, annotations) : null;
  return (
    <span
      className={`annotated${interactive ? ' annotated--interactive' : ''}`}
      data-annotate={anchor}
      data-section={sectionId}
    >
      {!segments
        ? text
        : segments.map((segment, index) =>
            segment.marks.length === 0 ? (
              <span key={index}>{segment.text}</span>
            ) : (
              <mark
                key={index}
                className={`annotated__mark ${segment.colors.map((color) => `mark--${color}`).join(' ')}`}
                data-annotation-id={segment.marks[segment.marks.length - 1]}
                title={segment.marks.length > 1 ? `${segment.marks.length} marks here` : undefined}
              >
                {segment.text}
              </mark>
            ),
          )}
    </span>
  );
}

/**
 * Watches text selection inside the material pane and turns a selection into a
 * pending mark. Only whole selections that sit inside one paragraph are taken —
 * the anchor model is per-paragraph, and a multi-paragraph drag would silently
 * lose part of the mark.
 */
export function useAnnotationSelection(options: {
  enabled: boolean;
  rootRef: React.RefObject<HTMLElement | null>;
  onPick: (selection: PendingSelection | null) => void;
}) {
  const { enabled, rootRef, onPick } = options;

  useEffect(() => {
    if (!enabled) {
      onPick(null);
      return undefined;
    }
    const resolve = () => {
      const root = rootRef.current;
      const selection = window.getSelection();
      if (!root || !selection || selection.rangeCount === 0) {
        onPick(null);
        return;
      }
      const range = selection.getRangeAt(0);
      const start = range.startContainer;
      if (range.collapsed) {
        // A click on a mark opens the toolbar for that mark so it can be
        // recoloured, annotated or removed without selecting anything.
        const target = start.nodeType === 3 ? start.parentElement : (start as HTMLElement);
        const mark = target?.closest<HTMLElement>('[data-annotation-id]');
        const holder = mark?.closest<HTMLElement>('[data-annotate]');
        if (mark && holder) {
          const rect = mark.getBoundingClientRect();
          onPick({
            sectionId: holder.dataset.section ?? '',
            anchor: holder.dataset.annotate ?? '',
            startOffset: 0,
            endOffset: 0,
            text: mark.textContent ?? '',
            rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
            annotationId: mark.dataset.annotationId,
          });
        } else {
          onPick(null);
        }
        return;
      }
      const paragraph = start.nodeType === 3 ? start.parentElement?.closest<HTMLElement>('[data-annotate]') : null;
      const other = range.endContainer.nodeType === 3
        ? range.endContainer.parentElement?.closest<HTMLElement>('[data-annotate]')
        : null;
      if (!paragraph || paragraph !== other || !root.contains(paragraph)) {
        onPick(null);
        return;
      }
      const a = globalOffset(paragraph, range.startContainer, range.startOffset);
      const b = globalOffset(paragraph, range.endContainer, range.endOffset);
      const text = paragraph.textContent ?? '';
      const rect = range.getBoundingClientRect();
      const startOffset = Math.min(a, b);
      const endOffset = Math.max(a, b);
      if (endOffset - startOffset < 2) {
        onPick(null);
        return;
      }
      onPick({
        sectionId: paragraph.dataset.section ?? '',
        anchor: paragraph.dataset.annotate ?? '',
        startOffset,
        endOffset,
        text: text.slice(startOffset, endOffset),
        rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
      });
    };

    let frame = 0;
    const schedule = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(resolve);
    };
    document.addEventListener('selectionchange', schedule);
    document.addEventListener('pointerup', schedule);
    document.addEventListener('keyup', schedule);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('selectionchange', schedule);
      document.removeEventListener('pointerup', schedule);
      document.removeEventListener('keyup', schedule);
    };
  }, [enabled, rootRef, onPick]);
}

/**
 * The floating bar over a selection: four highlight colours, a note, remove.
 *
 * Positioned in viewport coordinates because the paper scrolls underneath it.
 * `translate(-50%, -100%)` keeps the arithmetic simple; the horizontal clamp
 * stops it hanging off the edge of a phone.
 */
export function AnnotationToolbar({ annotations }: { annotations: AnnotationsApi }) {
  const pending = annotations.pending;
  const [noteKey, setNoteKey] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  // The selection is identified by the mark it would edit, so opening the note
  // editor for one selection does not leave it open for the next one.
  const key = pending
    ? (pending.annotationId ?? `${pending.sectionId}:${pending.anchor}:${pending.startOffset}:${pending.endOffset}`)
    : null;
  const editingNote = pending !== null && noteKey === key;
  const existing = pending?.annotationId
    ? (annotations.annotations.find((row) => row.id === pending.annotationId) ?? null)
    : null;

  const close = () => {
    setNoteKey(null);
    annotations.setPending(null);
  };

  const pick = (color: AnnotationColor) => {
    if (!pending) return;
    if (pending.annotationId) annotations.recolour(pending.annotationId, color);
    else
      annotations.addMark({
        sectionId: pending.sectionId,
        anchor: pending.anchor,
        startOffset: pending.startOffset,
        endOffset: pending.endOffset,
        text: pending.text,
        color,
      });
    setNoteKey(null);
  };

  if (!pending) return null;

  const left = Math.max(110, Math.min(window.innerWidth - 110, pending.rect.left + pending.rect.width / 2));
  const above = pending.rect.top > 130;
  const top = above ? pending.rect.top - 10 : pending.rect.top + pending.rect.height + 12;

  return (
    <div
      className={`annot-bar${editingNote ? ' annot-bar--wide' : ''}`}
      style={{ top, left }}
      role="toolbar"
      aria-label="Highlight selection"
      onPointerDown={(event) => event.stopPropagation()}
    >
      {editingNote ? (
        <form
          className="annot-bar__note"
          onSubmit={(event) => {
            event.preventDefault();
            if (pending.annotationId) annotations.setNote(pending.annotationId, draft.trim() || null);
            else
              annotations.addMark({
                sectionId: pending.sectionId,
                anchor: pending.anchor,
                startOffset: pending.startOffset,
                endOffset: pending.endOffset,
                text: pending.text,
                color: 'yellow',
                note: draft,
              });
            close();
          }}
        >
          <textarea
            className="annot-bar__input"
            value={draft}
            maxLength={800}
            rows={3}
            autoFocus
            placeholder="Why did you mark this? (kept with the highlight)"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) event.currentTarget.form?.requestSubmit();
              if (event.key === 'Escape') {
                event.stopPropagation();
                close();
              }
            }}
          />
          <div className="annot-bar__row annot-bar__row--end">
            <button type="button" className="annot-bar__action" onClick={() => setNoteKey(null)}>
              Back
            </button>
            <button type="submit" className="annot-bar__action annot-bar__action--primary">
              Save note
            </button>
          </div>
        </form>
      ) : (
        <div className="annot-bar__row">
          {ANNOTATION_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              className={`annot-bar__swatch mark--${color}`}
              title={ANNOTATION_COLOR_LABELS[color]}
              aria-label={ANNOTATION_COLOR_LABELS[color]}
              onClick={() => pick(color)}
            />
          ))}
          <span className="annot-bar__sep" aria-hidden="true" />
          <button
            type="button"
            className="annot-bar__action"
            onClick={() => {
              setDraft(existing?.note ?? '');
              setNoteKey(key);
            }}
          >
            <Icon name="pen" size={14} />
            Note
          </button>
          {pending.annotationId ? (
            <button
              type="button"
              className="annot-bar__action annot-bar__action--danger"
              onClick={() => {
                annotations.removePending();
                setNoteKey(null);
              }}
            >
              <Icon name="trash" size={14} />
              Remove
            </button>
          ) : null}
          <button type="button" className="annot-bar__action annot-bar__action--quiet" onClick={close} aria-label="Dismiss">
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The note pad: every mark the candidate has made, newest paragraph first,
 * grouped by passage. Clicking a row scrolls the paper to that mark and flashes
 * it, which is how you find "where did I write that down" in 900 words.
 */
export function AnnotationNotesPanel({ annotations, onClose }: { annotations: AnnotationsApi; onClose: () => void }) {
  const rows = [...annotations.annotations].reverse();
  return (
    <aside className="annot-panel" aria-label="Highlights and notes">
      <div className="annot-panel__head">
        <h2>
          <Icon name="pen" size={16} />
          Highlights
          <span className="annot-panel__count">{rows.length}</span>
        </h2>
        <button type="button" className="annot-panel__close" onClick={onClose} aria-label="Close">
          <Icon name="close" size={16} />
        </button>
      </div>
      <p className="annot-panel__hint">
        Marks are saved as you make them, on this device and on the server. {annotations.queued > 0 ? `Waiting to sync: ${annotations.queued}.` : 'Everything is synced.'}
      </p>
      {rows.length === 0 ? (
        <div className="annot-panel__empty">
          <p>Nothing marked yet. Select any words in the text and a bar appears — four colours plus a note.</p>
        </div>
      ) : null}
      <ul className="annot-panel__list">
        {rows.map((row) => (
          <li key={row.id} className="annot-item">
            <button
              type="button"
              className="annot-item__body"
              onClick={() => {
                const target = document.querySelector<HTMLElement>(`mark[data-annotation-id="${CSS.escape(row.id)}"]`);
                target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
                target?.classList.add('annotated__mark--flash');
                window.setTimeout(() => target?.classList.remove('annotated__mark--flash'), 1200);
              }}
            >
              <span className={`annot-item__chip mark--${row.color}`} aria-hidden="true" />
              <span className="annot-item__text">
                <span className="annot-item__excerpt">
                  <b>{row.anchor}</b> “{row.excerpt}”
                </span>
                {row.note ? <span className="annot-item__note">{row.note}</span> : null}
                <span className="annot-item__meta">
                  {ANNOTATION_COLOR_LABELS[row.color]} · {row.excerpt.length} characters
                </span>
              </span>
            </button>
            <button type="button" className="annot-item__remove" onClick={() => annotations.remove(row.id)} aria-label="Delete mark">
              <Icon name="trash" size={14} />
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
