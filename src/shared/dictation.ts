/**
 * #10 Dictation and shadowing, and #3 Pronunciation coach (V1).
 *
 * The sentences are written for the listening traps IELTS actually uses:
 * numbers, spelled names, similar-sounding words and connected speech.
 * Comparison is word-level and honest about it — a transcript can show that a
 * word was missed or misheard, but it cannot score individual phonemes.
 */

export interface DictationSentence {
  id: string;
  text: string;
  /** What the sentence is testing, shown after the check. */
  trap: string;
}

export interface DictationSet {
  id: string;
  title: string;
  level: 'B1' | 'B2' | 'C1';
  sentences: DictationSentence[];
}

export const DICTATION_SETS: DictationSet[] = [
  {
    id: 'numbers',
    title: 'Numbers, dates and spelling',
    level: 'B1',
    sentences: [
      { id: 'n1', text: 'The workshop starts at half past eight on the fourteenth of March.', trap: 'Time + ordinal date' },
      { id: 'n2', text: 'Please call extension two oh four if the delivery is late.', trap: 'Spoken digits' },
      { id: 'n3', text: 'The flat costs nine hundred and fifty pounds a month, including bills.', trap: 'Large number + price' },
      { id: 'n4', text: 'Her surname is Kaur, spelled K-A-U-R.', trap: 'Spelled name' },
      { id: 'n5', text: 'The train leaves from platform twelve at seventeen minutes past six.', trap: 'Platform + clock time' },
      { id: 'n6', text: 'We need about three and a half metres of cable, not three.', trap: 'Fraction contrast' },
    ],
  },
  {
    id: 'campus',
    title: 'Campus and services',
    level: 'B2',
    sentences: [
      { id: 'c1', text: 'Students must register for the laboratory session before the end of the second week.', trap: 'Deadline' },
      { id: 'c2', text: 'The library closes early on Fridays because the staff attend a training session.', trap: 'Reason + exception' },
      { id: 'c3', text: 'You can borrow up to six books, but reference material must stay in the building.', trap: 'Quantity + contrast' },
      { id: 'c4', text: 'The careers adviser recommends booking an appointment rather than dropping in.', trap: 'Recommendation' },
      { id: 'c5', text: 'There is a small charge for printing, although scanning is free.', trap: 'Concession' },
      { id: 'c6', text: 'The lecture has been moved to the lecture theatre opposite the main entrance.', trap: 'Direction' },
    ],
  },
  {
    id: 'connected',
    title: 'Connected speech',
    level: 'C1',
    sentences: [
      { id: 's1', text: 'I would have gone to the seminar if I had known it was on.', trap: 'Weak forms: would have' },
      { id: 's2', text: 'She is supposed to be presenting the findings at the end of the month.', trap: 'Linking + stress' },
      { id: 's3', text: 'The research suggests that people are more likely to recycle when bins are nearby.', trap: 'That-clause + comparison' },
      { id: 's4', text: 'It is not so much the cost that worries me as the amount of time it takes.', trap: 'Not so much … as' },
      { id: 's5', text: 'Had they consulted the residents, the council might have avoided the delay.', trap: 'Inverted conditional' },
      { id: 's6', text: 'What matters most is whether the scheme can be sustained in the long term.', trap: 'Nominal clause' },
    ],
  },
];

export function allDictationSentences(): DictationSentence[] {
  return DICTATION_SETS.flatMap((set) => set.sentences);
}

export function dictationSentenceById(id: string): DictationSentence | null {
  return allDictationSentences().find((sentence) => sentence.id === id) ?? null;
}

export interface WordComparison {
  target: string;
  typed: string;
  matched: boolean;
}

export interface DictationComparison {
  words: WordComparison[];
  matched: number;
  total: number;
  /** Matched / total, 0–100. */
  accuracy: number;
  missing: string[];
  extra: string[];
}

/** Normalises a token for comparison: case, punctuation, digits and contractions. */
export function normaliseDictationToken(token: string): string {
  return token
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    .replace(/^(\d+),(\d{3})$/, '$1$2');
}

/**
 * Word-by-word comparison using the longest common subsequence, so an extra
 * word does not mark every later word wrong (a plain index-by-index diff would).
 */
export function compareDictation(target: string, typed: string): DictationComparison {
  const targetTokens = target.split(/\s+/).filter(Boolean);
  const typedTokens = typed.split(/\s+/).filter(Boolean);
  const a = targetTokens.map(normaliseDictationToken);
  const b = typedTokens.map(normaliseDictationToken);

  const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      table[i]![j] = a[i - 1] === b[j - 1] ? table[i - 1]![j - 1]! + 1 : Math.max(table[i - 1]![j]!, table[i]![j - 1]!);
    }
  }

  const matchedA = new Set<number>();
  const matchedB = new Set<number>();
  let i = a.length;
  let j = b.length;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      matchedA.add(i - 1);
      matchedB.add(j - 1);
      i -= 1;
      j -= 1;
    } else if (table[i - 1]![j]! >= table[i]![j - 1]!) i -= 1;
    else j -= 1;
  }

  const words: WordComparison[] = targetTokens.map((word, index) => ({
    target: word,
    typed: typedTokens[index] ?? '',
    matched: matchedA.has(index),
  }));

  const missing = a.filter((_, index) => !matchedA.has(index));
  const extra = b.filter((_, index) => !matchedB.has(index));
  const matched = matchedA.size;

  return {
    words,
    matched,
    total: targetTokens.length,
    accuracy: targetTokens.length > 0 ? Math.round((matched / targetTokens.length) * 100) : 0,
    missing,
    extra,
  };
}

/** Splits IPA into syllables and reads the primary-stress marker the dictionary provides. */
export function ipaStress(ipa: string): {
  hasStressMark: boolean;
  stressedSyllable: string | null;
  syllables: number;
} {
  const clean = ipa.replace(/^\/|\/$/g, '').trim();
  if (!clean) return { hasStressMark: false, stressedSyllable: null, syllables: 0 };
  // Count vowel groups rather than dots: most dictionary entries do not mark
  // every syllable boundary, but every syllable has one vowel nucleus.
  const vowelGroups = clean.match(/[aeiouæɑɒɔəɜɛɪʊʌɐɵœøɨɯɤy]+/g) ?? [];
  const syllables = Math.max(1, vowelGroups.length || clean.split(/[.ˌ]/).filter((part) => part.replace(/[ˈ\s]/g, '').length > 0).length);
  const marker = clean.indexOf('ˈ');
  if (marker < 0) return { hasStressMark: false, stressedSyllable: null, syllables: Math.max(1, syllables) };
  const after = clean.slice(marker + 1);
  const end = after.search(/[.ˌ\s]/);
  const stressedSyllable = (end === -1 ? after : after.slice(0, end)).trim();
  return { hasStressMark: true, stressedSyllable: stressedSyllable || null, syllables: Math.max(1, syllables) };
}
