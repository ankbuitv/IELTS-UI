import { describe, expect, it } from 'vitest';
import {
  DICTATION_SETS,
  allDictationSentences,
  compareDictation,
  ipaStress,
  normaliseDictationToken,
} from '../../src/shared/dictation';

describe('dictation sets', () => {
  it('has three levels and unique ids', () => {
    expect(DICTATION_SETS.map((set) => set.level)).toEqual(['B1', 'B2', 'C1']);
    const ids = allDictationSentences().map((sentence) => sentence.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(allDictationSentences().length).toBeGreaterThanOrEqual(15);
  });
});

describe('compareDictation', () => {
  it('ignores punctuation and case', () => {
    const result = compareDictation('The train leaves at six.', 'the train leaves at six');
    expect(result.accuracy).toBe(100);
  });

  it('aligns around an extra word instead of marking the rest wrong', () => {
    const result = compareDictation('Please call extension two oh four', 'please call the extension two oh four');
    expect(result.accuracy).toBe(100);
    expect(result.extra).toEqual(['the']);
  });

  it('reports missing words and a lower score', () => {
    const result = compareDictation('The flat costs nine hundred and fifty pounds', 'the flat costs nine hundred pounds');
    expect(result.accuracy).toBeLessThan(100);
    expect(result.missing).toContain('fifty');
  });

  it('normalises thousands separators', () => {
    expect(normaliseDictationToken('1,200')).toBe('1200');
  });
});

describe('ipaStress', () => {
  it('reads the primary stress syllable', () => {
    const stress = ipaStress('/ˌedʒuˈkeɪʃən/');
    expect(stress.hasStressMark).toBe(true);
    expect(stress.stressedSyllable).toContain('keɪ');
    expect(stress.syllables).toBeGreaterThanOrEqual(3);
  });

  it('handles entries without a stress mark', () => {
    const stress = ipaStress('/kæt/');
    expect(stress.hasStressMark).toBe(false);
    expect(stress.stressedSyllable).toBeNull();
  });

  it('handles an empty phonetic', () => {
    expect(ipaStress('')).toEqual({ hasStressMark: false, stressedSyllable: null, syllables: 0 });
  });
});
