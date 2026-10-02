import type { CandidateResponse } from '@shared/answer-key';
import { ApiRequestError } from '../../lib/api';
import { countWords } from '../../lib/format';
import type { AttemptState } from './useExamSession';

/**
 * The pure half of the exam autosave: how a server snapshot is folded into what
 * the candidate has already typed, and how unsent work survives a closed tab.
 *
 * The bug this exists for ("mất bài"): the 30-second poll used to replace the
 * whole local state with the server's copy, so anything typed since the last
 * successful save — a half-written essay, a changed answer — snapped back to the
 * old value, and the next keystroke then saved that old value over the real one.
 */

export interface PendingUpdate {
  response: CandidateResponse | null;
  flagged: boolean;
}

/** Everything the candidate has changed in this tab; the server never reverts it. */
export interface TouchedSets {
  answers: Set<string>;
  flags: Set<string>;
  writing: Set<string>;
}

export function emptyTouched(): TouchedSets {
  return { answers: new Set(), flags: new Set(), writing: new Set() };
}

/**
 * Folds a fresh server snapshot into the current local state.
 *
 * Server-driven fields (clock, section progress, status, integrity, content)
 * come from the snapshot. Answers, flags and writing the candidate has touched
 * stay as they are locally: after a local change the local copy is by
 * definition at least as new as anything the server can hold for that item.
 * Items the candidate has not touched (for example answered on another device)
 * are taken from the server.
 */
export function mergeServerState(current: AttemptState | null, next: AttemptState, touched: TouchedSets): AttemptState {
  if (!current) return next;

  const answers = { ...next.answers };
  for (const questionId of touched.answers) {
    const local = current.answers[questionId];
    if (local === undefined) delete answers[questionId];
    else answers[questionId] = local;
  }

  const flagged = new Set(next.flagged);
  for (const questionId of touched.flags) {
    if (current.flagged.includes(questionId)) flagged.add(questionId);
    else flagged.delete(questionId);
  }

  const writing = next.writing.filter((entry) => !touched.writing.has(entry.questionId));
  for (const entry of current.writing) {
    if (touched.writing.has(entry.questionId)) writing.push(entry);
  }

  return { ...next, answers, flagged: [...flagged], writing };
}

/* ------------------------------------------------------------------ drafts */

/** What is kept in localStorage while work is unacknowledged by the server. */
export interface ExamDraft {
  v: 1;
  savedAt: string;
  answers: Record<string, PendingUpdate>;
  writing: Record<string, string>;
}

export const draftStorageKey = (attemptId: string): string => `aieo.exam-draft.${attemptId}`;

/** `null` when there is nothing unsent, so the caller can delete the key. */
export function buildDraft(
  unacked: ReadonlyMap<string, PendingUpdate>,
  writing: ReadonlyMap<string, { text: string }>,
  now: Date = new Date(),
): ExamDraft | null {
  if (unacked.size === 0 && writing.size === 0) return null;
  return {
    v: 1,
    savedAt: now.toISOString(),
    answers: Object.fromEntries(unacked),
    writing: Object.fromEntries([...writing].map(([questionId, entry]) => [questionId, entry.text])),
  };
}

export function parseDraft(raw: string | null): ExamDraft | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<ExamDraft> | null;
    if (!value || value.v !== 1 || typeof value.answers !== 'object' || typeof value.writing !== 'object') return null;
    const answers: Record<string, PendingUpdate> = {};
    for (const [questionId, update] of Object.entries(value.answers ?? {})) {
      if (update && typeof update === 'object' && 'flagged' in update && 'response' in update) {
        answers[questionId] = { response: update.response ?? null, flagged: Boolean(update.flagged) };
      }
    }
    const writing: Record<string, string> = {};
    for (const [questionId, text] of Object.entries(value.writing ?? {})) {
      if (typeof text === 'string') writing[questionId] = text;
    }
    return { v: 1, savedAt: String(value.savedAt ?? ''), answers, writing };
  } catch {
    return null;
  }
}

/**
 * Puts a saved draft back on top of the first server snapshot. Only entries
 * that differ from the server copy are restored, so a draft that was in fact
 * saved just before the tab closed is dropped instead of re-sent.
 */
export function applyDraft(
  next: AttemptState,
  draft: ExamDraft,
): { state: AttemptState; answers: Map<string, PendingUpdate>; writing: Map<string, string> } {
  const answers = new Map<string, PendingUpdate>();
  const writing = new Map<string, string>();
  const nextAnswers = { ...next.answers };
  const flagged = new Set(next.flagged);

  for (const [questionId, update] of Object.entries(draft.answers)) {
    const server = next.answers[questionId] ?? null;
    const sameResponse = JSON.stringify(server) === JSON.stringify(update.response);
    const sameFlag = next.flagged.includes(questionId) === update.flagged;
    if (sameResponse && sameFlag) continue;
    answers.set(questionId, update);
    if (update.response === null) delete nextAnswers[questionId];
    else nextAnswers[questionId] = update.response;
    if (update.flagged) flagged.add(questionId);
    else flagged.delete(questionId);
  }

  const nextWriting = [...next.writing];
  for (const [questionId, text] of Object.entries(draft.writing)) {
    const index = nextWriting.findIndex((entry) => entry.questionId === questionId);
    if ((index === -1 ? '' : nextWriting[index]!.text) === text) continue;
    writing.set(questionId, text);
    const entry = { questionId, text, wordCount: countWords(text) };
    if (index === -1) nextWriting.push(entry);
    else nextWriting[index] = entry;
  }

  return { state: { ...next, answers: nextAnswers, flagged: [...flagged], writing: nextWriting }, answers, writing };
}

/* ------------------------------------------------------------ save errors */

/**
 * `rejected`: the server understood and said no (attempt locked, expired, bad
 * request) — retrying will not help, so the candidate is told.
 * `transient`: network or server trouble — keep the work and retry.
 */
export function classifySaveError(error: unknown): 'rejected' | 'transient' {
  if (error instanceof ApiRequestError && error.status >= 400 && error.status < 500) {
    return error.status === 408 || error.status === 425 || error.status === 429 ? 'transient' : 'rejected';
  }
  return 'transient';
}

/** 1.5s, 3s, 6s, 12s, then every 15s. */
export function backoffMs(failures: number): number {
  return Math.min(15_000, 1_500 * 2 ** Math.max(0, failures - 1));
}
