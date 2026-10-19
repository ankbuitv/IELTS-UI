import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api';
import {
  normaliseRange,
  type ExamAnnotation,
  type AnnotationColor,
} from '@shared/annotations';

export interface PendingSelection {
  sectionId: string;
  anchor: string;
  startOffset: number;
  endOffset: number;
  text: string;
  /** Where to float the toolbar (viewport coordinates). */
  rect: { top: number; left: number; width: number; height: number };
  /** Set when the user clicked an existing mark instead of selecting text. */
  annotationId?: string;
}

export interface AnnotationsApi {
  enabled: boolean;
  annotations: ExamAnnotation[];
  /** Marks for one paragraph, keyed `sectionId:anchor`. */
  forParagraph: (sectionId: string, anchor: string) => ExamAnnotation[];
  pending: PendingSelection | null;
  setPending: (selection: PendingSelection | null) => void;
  addMark: (input: { sectionId: string; anchor: string; startOffset: number; endOffset: number; text: string; color: AnnotationColor; note?: string | null }) => void;
  recolour: (annotationId: string, color: AnnotationColor) => void;
  setNote: (annotationId: string, note: string | null) => void;
  remove: (annotationId: string) => void;
  removePending: () => void;
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  /** Marks waiting to reach the server (the device is offline or mid-retry). */
  queued: number;
  syncError: boolean;
}

/** A write that has happened locally but not yet on the server. */
type PendingOp = { method: 'PUT'; path: string; body: unknown } | { method: 'DELETE'; path: string };

const draftKey = (attemptId: string) => `annotations:${attemptId}`;

function readDraft(attemptId: string): ExamAnnotation[] | null {
  try {
    const raw = window.localStorage.getItem(draftKey(attemptId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ExamAnnotation[]) : null;
  } catch {
    return null;
  }
}

function writeDraft(attemptId: string, annotations: ExamAnnotation[]): void {
  try {
    window.localStorage.setItem(draftKey(attemptId), JSON.stringify(annotations));
  } catch {
    // Private mode or a full quota: the server copy is what matters.
  }
}

/**
 * Highlighter state for one attempt.
 *
 * The local list is the source the paper renders from, so marking feels
 * immediate even on a bad connection: every change is written to
 * `localStorage` first and pushed to the server in a small debounced queue. On
 * resume the server wins (it is where another device's marks would be), unless
 * this device still has unsent changes.
 */
export function useAnnotations(options: { attemptId: string; enabled: boolean }): AnnotationsApi {
  const { attemptId, enabled } = options;
  const [annotations, setAnnotations] = useState<ExamAnnotation[]>([]);
  const [pending, setPending] = useState<PendingSelection | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [queued, setQueued] = useState(0);
  const [syncError, setSyncError] = useState(false);
  const listRef = useRef<ExamAnnotation[]>([]);
  const queue = useRef<PendingOp[]>([]);
  const timer = useRef<number | null>(null);
  const hydrated = useRef(false);

  const commit = useCallback(
    (next: ExamAnnotation[]) => {
      listRef.current = next;
      setAnnotations(next);
      writeDraft(attemptId, next);
    },
    [attemptId],
  );

  const flush = useCallback(async () => {
    if (queue.current.length === 0) return;
    const batch = queue.current.splice(0, queue.current.length);
    setQueued(queue.current.length);
    let failed = false;
    for (let index = 0; index < batch.length; index += 1) {
      const op = batch[index]!;
      const path = `/api/attempts/${attemptId}${op.path}`;
      try {
        if (op.method === 'PUT') await api.put(path, op.body);
        else await api.delete(path);
      } catch {
        failed = true;
        // The op that failed is put back (its save may have landed and only the
        // response was lost: saves are keyed by id, so retrying is harmless).
        queue.current.unshift(...batch.slice(index));
        break;
      }
    }
    setQueued(queue.current.length);
    setSyncError(failed);
  }, [attemptId]);

  const enqueue = useCallback(
    (op: PendingOp) => {
      queue.current.push(op);
      setQueued(queue.current.length);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        timer.current = null;
        void flush();
      }, 700);
    },
    [flush],
  );

  // Load once per attempt.
  useEffect(() => {
    if (!enabled || hydrated.current) return;
    hydrated.current = true;
    const local = readDraft(attemptId);
    void (async () => {
      try {
        const result = await api.get<{ annotations: ExamAnnotation[] }>(`/api/attempts/${attemptId}/annotations`);
        const server = Array.isArray(result.annotations) ? result.annotations : [];
        const unsent = local && local.length > 0 && server.length === 0 ? local : null;
        const next = unsent ?? server;
        commit(next);
        if (unsent) {
          queue.current.push({ method: 'PUT', path: '/annotations/replace', body: { annotations: unsent } });
          void flush();
        }
      } catch {
        if (local) commit(local);
      }
    })();
  }, [attemptId, enabled, commit, flush]);

  // Nothing else will push a lone highlight, so also try on the way back online
  // and when the tab is hidden (the exam is about to be left).
  useEffect(() => {
    if (!enabled) return undefined;
    const onOnline = () => void flush();
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flush();
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onHide);
    const interval = window.setInterval(() => void flush(), 15_000);
    return () => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onHide);
      window.clearInterval(interval);
    };
  }, [enabled, flush]);

  const byParagraph = useMemo(() => {
    const map = new Map<string, ExamAnnotation[]>();
    for (const annotation of annotations) {
      const key = `${annotation.sectionId}:${annotation.anchor}`;
      const bucket = map.get(key);
      if (bucket) bucket.push(annotation);
      else map.set(key, [annotation]);
    }
    return map;
  }, [annotations]);

  const forParagraph = useCallback(
    (sectionId: string, anchor: string) => byParagraph.get(`${sectionId}:${anchor}`) ?? [],
    [byParagraph],
  );

  const addMark: AnnotationsApi['addMark'] = useCallback(
    ({ sectionId, anchor, startOffset, endOffset, text, color, note }) => {
      const range = normaliseRange(text, startOffset, endOffset);
      if (!range) return;
      const id = `local-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
      const annotation: ExamAnnotation = {
        id,
        scope: 'PASSAGE',
        sectionId,
        anchor,
        startOffset: range.startOffset,
        endOffset: range.endOffset,
        excerpt: range.excerpt,
        color,
        note: note && note.trim() ? note.trim().slice(0, 800) : null,
      };
      commit([...listRef.current, annotation]);
      enqueue({ method: 'PUT', path: '/annotations', body: annotation });
      setPending(null);
      window.getSelection()?.removeAllRanges();
    },
    [commit, enqueue],
  );

  const patchAnnotation = useCallback(
    (annotationId: string, patch: Partial<ExamAnnotation>) => {
      const current = listRef.current.find((row) => row.id === annotationId) ?? null;
      if (!current) return;
      const next = { ...current, ...patch };
      commit(listRef.current.map((row) => (row.id === annotationId ? next : row)));
      enqueue({ method: 'PUT', path: '/annotations', body: next });
    },
    [commit, enqueue],
  );

  const recolour = useCallback((annotationId: string, color: AnnotationColor) => patchAnnotation(annotationId, { color }), [patchAnnotation]);
  const setNote = useCallback((annotationId: string, note: string | null) => patchAnnotation(annotationId, { note }), [patchAnnotation]);

  const remove = useCallback(
    (annotationId: string) => {
      commit(listRef.current.filter((row) => row.id !== annotationId));
      enqueue({ method: 'DELETE', path: `/annotations/${encodeURIComponent(annotationId)}` });
    },
    [commit, enqueue],
  );

  const removePending = useCallback(() => {
    if (pending?.annotationId) remove(pending.annotationId);
    setPending(null);
  }, [pending, remove]);

  return {
    enabled,
    annotations,
    forParagraph,
    pending,
    setPending,
    addMark,
    recolour,
    setNote,
    remove,
    removePending,
    panelOpen,
    setPanelOpen,
    queued,
    syncError,
  };
}

/**
 * Character offset of a (node, offset) pair inside a container, by walking the
 * container's text nodes. The paragraph is one text node until marks are drawn
 * inside it, after which the offsets have to be re-based this way.
 */
export function globalOffset(container: Element, node: Node, nodeOffset: number): number {
  let total = 0;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    if (current === node) return total + nodeOffset;
    total += current.textContent?.length ?? 0;
    current = walker.nextNode();
  }
  // A range ending at the container itself (an element offset) lands at the end.
  return node === container ? total : total + nodeOffset;
}
