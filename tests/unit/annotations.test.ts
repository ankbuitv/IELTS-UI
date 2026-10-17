import { describe, expect, it } from 'vitest';
import {
  markCovering,
  normaliseRange,
  segmentMarkedText,
  sortAnnotations,
  type ExamAnnotation,
} from '../../src/shared/annotations';

const mark = (patch: Partial<ExamAnnotation>): ExamAnnotation => ({
  id: 'ann-1',
  scope: 'PASSAGE',
  sectionId: 'sec-a',
  anchor: 'B',
  startOffset: 0,
  endOffset: 5,
  excerpt: 'Hello',
  color: 'yellow',
  note: null,
  ...patch,
});

describe('annotation ranges', () => {
  it('clamps a selection to the paragraph and refuses a one-character mark', () => {
    const range = normaliseRange('The quick brown fox', 4, 999);
    expect(range).toEqual({ startOffset: 4, endOffset: 19, excerpt: 'quick brown fox' });
    expect(normaliseRange('abc', 1, 2)).toBeNull();
    expect(normaliseRange('   ', 0, 3)).toBeNull();
  });

  it('keeps a reversed selection usable', () => {
    expect(normaliseRange('abcdef', 4, 1)).toEqual({ startOffset: 1, endOffset: 4, excerpt: 'bcd' });
  });

  it('truncates an absurd drag so one mark cannot hold the whole passage', () => {
    const long = 'x'.repeat(4000);
    const range = normaliseRange(long, 0, long.length, 600);
    expect(range?.excerpt).toHaveLength(600);
  });
});

describe('segmentMarkedText', () => {
  const text = 'The quick brown fox jumps over the lazy dog.';

  it('returns the paragraph untouched when nothing is marked', () => {
    expect(segmentMarkedText(text, [])).toEqual([{ text, marks: [], colors: [], annotationIds: [] }]);
  });

  it('splits a paragraph at the mark boundaries', () => {
    const segments = segmentMarkedText(text, [mark({ startOffset: 4, endOffset: 9, excerpt: 'quick' })]);
    expect(segments.map((segment) => segment.text)).toEqual(['The ', 'quick', ' brown fox jumps over the lazy dog.']);
    expect(segments[1]).toMatchObject({ marks: ['ann-1'], colors: ['yellow'] });
  });

  it('keeps overlapping marks visible on the shared run', () => {
    const segments = segmentMarkedText(text, [
      mark({ id: 'ann-a', startOffset: 0, endOffset: 10, color: 'blue' }),
      mark({ id: 'ann-b', startOffset: 4, endOffset: 15, color: 'pink', note: 'collocation?' }),
    ]);
    const overlap = segments.find((segment) => segment.text === 'quick ');
    expect(overlap?.annotationIds).toEqual(['ann-a', 'ann-b']);
    expect(overlap?.colors).toEqual(['blue', 'pink']);
  });

  it('ignores a mark that lies outside the paragraph text', () => {
    expect(segmentMarkedText('short', [mark({ startOffset: 40, endOffset: 60 })])).toEqual([
      { text: 'short', marks: [], colors: [], annotationIds: [] },
    ]);
  });
});

describe('mark lookup', () => {
  it('finds the mark covering a selection and sorts by position', () => {
    const annotations = [mark({ id: 'ann-b', startOffset: 10, endOffset: 20 }), mark({ id: 'ann-a', startOffset: 2, endOffset: 6 })];
    expect(markCovering(annotations, 12, 15)?.id).toBe('ann-b');
    expect(markCovering(annotations, 1, 40)).toBeNull();
    expect(sortAnnotations(annotations).map((row) => row.id)).toEqual(['ann-a', 'ann-b']);
  });
});
