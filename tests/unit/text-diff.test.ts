import { describe, expect, it } from 'vitest';
import { correctedText, inlineCorrections } from '../../src/shared/text-diff';

describe('inlineCorrections', () => {
  it('places a correction in reading order and keeps the rest unchanged', () => {
    const diff = inlineCorrections('I go to school yesterday and I was happy.', [
      { original: 'go', suggestion: 'went', reason: 'Past tense' },
    ]);
    expect(diff.applied).toBe(1);
    expect(diff.unplaced).toHaveLength(0);
    expect(diff.segments.map((segment) => `${segment.kind}:${segment.text}`)).toEqual([
      'SAME:I ',
      'DELETE:go',
      'INSERT:went',
      'SAME: to school yesterday and I was happy.',
    ]);
  });

  it('applies several corrections without overlapping', () => {
    const diff = inlineCorrections('The goverment should invests more in education.', [
      { original: 'goverment', suggestion: 'government' },
      { original: 'invests', suggestion: 'invest' },
    ]);
    expect(diff.applied).toBe(2);
    expect(correctedText('The goverment should invests more in education.', [
      { original: 'goverment', suggestion: 'government' },
      { original: 'invests', suggestion: 'invest' },
    ])).toBe('The government should invest more in education.');
  });

  it('reports a quote that is not in the text instead of forcing it in', () => {
    const diff = inlineCorrections('A short essay.', [{ original: 'a long quote', suggestion: 'x' }]);
    expect(diff.applied).toBe(0);
    expect(diff.unplaced).toHaveLength(1);
    expect(diff.segments).toEqual([{ kind: 'SAME', text: 'A short essay.' }]);
  });

  it('tolerates curly quotes and collapsed whitespace', () => {
    const diff = inlineCorrections('He said “it\ndoes not matter”.', [
      { original: 'it does not matter', suggestion: 'it doesn’t matter' },
    ]);
    expect(diff.applied).toBe(1);
  });

  it('ignores one-character quotes and only matches whole words', () => {
    expect(inlineCorrections('This is fine.', [{ original: 'a', suggestion: 'b' }]).applied).toBe(0);
    const inside = inlineCorrections('This is fine.', [{ original: 'is', suggestion: 'was' }]);
    expect(inside.applied).toBe(1);
    expect(inside.segments[1]).toMatchObject({ kind: 'DELETE', text: 'is' });
  });
});
