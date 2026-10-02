import { describe, expect, it } from 'vitest';
import type { AttemptState } from '../../src/client/components/exam/useExamSession';
import {
  applyDraft,
  backoffMs,
  buildDraft,
  classifySaveError,
  emptyTouched,
  mergeServerState,
  parseDraft,
  type PendingUpdate,
} from '../../src/client/components/exam/exam-sync';
import { ApiRequestError } from '../../src/client/lib/api';

/** Just the fields the merge reads; the rest of the state is irrelevant here. */
function snapshot(parts: Partial<AttemptState>): AttemptState {
  return {
    attemptId: 'att_1',
    answers: {},
    flagged: [],
    writing: [],
    status: 'IN_PROGRESS',
    submitted: false,
    remainingSeconds: 3000,
    ...parts,
  } as AttemptState;
}

/**
 * "Mất bài": the 30s poll replaced local state with the server's copy, so work
 * typed since the last save snapped back to the old value — and the next
 * keystroke then saved that old value over the real one.
 */
describe('mergeServerState', () => {
  it('keeps an answer changed locally when a stale poll still has the old one', () => {
    const touched = emptyTouched();
    touched.answers.add('q1');
    const local = snapshot({ answers: { q1: { value: 'B' } } });
    const stale = snapshot({ answers: { q1: { value: 'A' } }, remainingSeconds: 2990 });

    const merged = mergeServerState(local, stale, touched);

    expect(merged.answers.q1).toEqual({ value: 'B' });
    // …while server-driven fields still move on.
    expect(merged.remainingSeconds).toBe(2990);
  });

  it('keeps a locally cleared answer cleared', () => {
    const touched = emptyTouched();
    touched.answers.add('q1');
    const merged = mergeServerState(snapshot({}), snapshot({ answers: { q1: { value: 'A' } } }), touched);
    expect(merged.answers.q1).toBeUndefined();
  });

  it('takes answers the candidate has not touched from the server', () => {
    const merged = mergeServerState(snapshot({}), snapshot({ answers: { q9: { values: ['x'] } } }), emptyTouched());
    expect(merged.answers.q9).toEqual({ values: ['x'] });
  });

  it('never reverts a flag, in either direction', () => {
    const touched = emptyTouched();
    touched.flags.add('q1');
    touched.flags.add('q2');
    const local = snapshot({ flagged: ['q1'] }); // q1 flagged locally, q2 unflagged locally
    const stale = snapshot({ flagged: ['q2', 'q3'] });
    const merged = mergeServerState(local, stale, touched);
    expect([...merged.flagged].sort()).toEqual(['q1', 'q3']);
  });

  it('keeps an essay typed after the last save and takes other essays from the server', () => {
    const touched = emptyTouched();
    touched.writing.add('w1');
    const local = snapshot({ writing: [{ questionId: 'w1', text: 'The full essay I just typed', wordCount: 5 }] });
    const stale = snapshot({
      writing: [
        { questionId: 'w1', text: 'The full', wordCount: 2 },
        { questionId: 'w2', text: 'Task one from another device', wordCount: 5 },
      ],
    });

    const merged = mergeServerState(local, stale, touched);

    expect(merged.writing.find((entry) => entry.questionId === 'w1')?.text).toBe('The full essay I just typed');
    expect(merged.writing.find((entry) => entry.questionId === 'w2')?.text).toBe('Task one from another device');
    expect(merged.writing).toHaveLength(2);
  });

  it('returns the server snapshot unchanged on the very first load', () => {
    const first = snapshot({ answers: { q1: { value: 'A' } } });
    expect(mergeServerState(null, first, emptyTouched())).toBe(first);
  });
});

describe('exam drafts', () => {
  const answer: PendingUpdate = { response: { value: 'C' }, flagged: true };

  it('is empty when nothing is unsent', () => {
    expect(buildDraft(new Map(), new Map())).toBeNull();
  });

  it('round-trips unsent answers and essays through JSON', () => {
    const draft = buildDraft(new Map([['q1', answer]]), new Map([['w1', { text: 'Half an essay' }]]), new Date('2026-10-01T08:00:00Z'));
    expect(draft).toMatchObject({ v: 1, savedAt: '2026-10-01T08:00:00.000Z' });
    expect(parseDraft(JSON.stringify(draft))).toEqual(draft);
  });

  it('rejects unreadable drafts instead of throwing', () => {
    expect(parseDraft(null)).toBeNull();
    expect(parseDraft('not json')).toBeNull();
    expect(parseDraft('{"v":2,"answers":{},"writing":{}}')).toBeNull();
    expect(parseDraft('{"v":1,"answers":{"q1":"nope"},"writing":{"w1":42}}')).toMatchObject({ answers: {}, writing: {} });
  });

  it('restores only what differs from the server copy', () => {
    const draft = parseDraft(
      JSON.stringify(
        buildDraft(
          new Map<string, PendingUpdate>([
            ['q1', { response: { value: 'C' }, flagged: false }], // newer than the server
            ['q2', { response: { value: 'A' }, flagged: false }], // the server already has it
          ]),
          new Map([
            ['w1', { text: 'Unsaved paragraph' }],
            ['w2', { text: 'Already saved' }],
          ]),
        ),
      ),
    )!;
    const server = snapshot({
      answers: { q1: { value: 'A' }, q2: { value: 'A' } },
      writing: [{ questionId: 'w2', text: 'Already saved', wordCount: 2 }],
    });

    const applied = applyDraft(server, draft);

    expect([...applied.answers.keys()]).toEqual(['q1']);
    expect([...applied.writing.keys()]).toEqual(['w1']);
    expect(applied.state.answers.q1).toEqual({ value: 'C' });
    expect(applied.state.writing.find((entry) => entry.questionId === 'w1')).toMatchObject({
      text: 'Unsaved paragraph',
      wordCount: 2,
    });
  });
});

describe('save errors', () => {
  it('treats a refusal from the server as final, and trouble on the way as retryable', () => {
    expect(classifySaveError(new ApiRequestError(409, 'ATTEMPT_LOCKED', 'locked'))).toBe('rejected');
    expect(classifySaveError(new ApiRequestError(410, 'ATTEMPT_EXPIRED', 'expired'))).toBe('rejected');
    expect(classifySaveError(new ApiRequestError(429, 'RATE_LIMITED', 'slow down'))).toBe('transient');
    expect(classifySaveError(new ApiRequestError(503, 'STORAGE_UNAVAILABLE', 'down'))).toBe('transient');
    expect(classifySaveError(new TypeError('Failed to fetch'))).toBe('transient');
  });

  it('backs off 1.5s, 3s, 6s, 12s and then every 15s', () => {
    expect([1, 2, 3, 4, 5, 9].map(backoffMs)).toEqual([1500, 3000, 6000, 12000, 15000, 15000]);
  });
});
