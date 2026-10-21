/**
 * #2 Inline sentence diff for marked writing.
 *
 * Judge corrections quote the learner's exact words, so each correction can be
 * placed back into the essay: unchanged text stays, the original phrase is
 * struck through and the suggestion is inserted next to it. Overlaps are
 * impossible by construction (the cursor only moves forward), and a correction
 * whose original cannot be found is reported separately instead of being forced
 * into the wrong place.
 */

export interface CorrectionLike {
  original: string;
  suggestion: string;
  reason?: string;
  /** False = stylistic suggestion, not an error (the API omits it when unsure). */
  isActualError?: boolean;
}

export type DiffSegmentKind = 'SAME' | 'DELETE' | 'INSERT';

export interface DiffSegment {
  kind: DiffSegmentKind;
  text: string;
  /** Index of the correction that produced a DELETE/INSERT pair. */
  correctionIndex?: number;
  reason?: string;
}

export interface InlineDiff {
  segments: DiffSegment[];
  applied: number;
  /** Corrections whose quoted original was not present in the text. */
  unplaced: CorrectionLike[];
}

/**
 * Applies corrections to the text in reading order.
 *
 * Matching tries the exact quote first, then a whitespace-normalised,
 * case-insensitive match for each paragraph so a quote copied across a line
 * break still lands. Very short quotes (< 3 characters) are not inlined: they
 * would match half the essay.
 */
export function inlineCorrections(text: string, corrections: CorrectionLike[]): InlineDiff {
  const usable = corrections.filter(
    (correction) => correction.original.trim().length >= 2 && correction.suggestion !== undefined,
  );

  const segments: DiffSegment[] = [];
  const unplaced: CorrectionLike[] = [];
  let cursor = 0;
  let applied = 0;

  usable.forEach((correction) => {
    const original = correction.original.trim();
    const found = findQuote(text, original, cursor);
    if (!found) {
      unplaced.push(correction);
      return;
    }
    if (found.index > cursor) segments.push({ kind: 'SAME', text: text.slice(cursor, found.index) });
    segments.push({
      kind: 'DELETE',
      text: text.slice(found.index, found.index + found.length),
      correctionIndex: applied,
      reason: correction.reason,
    });
    segments.push({
      kind: 'INSERT',
      text: correction.suggestion,
      correctionIndex: applied,
      reason: correction.reason,
    });
    cursor = found.index + found.length;
    applied += 1;
  });

  if (cursor < text.length) segments.push({ kind: 'SAME', text: text.slice(cursor) });
  return { segments, applied, unplaced };
}

/**
 * Locates a quote at or after `from`. Falls back to a whitespace/case-tolerant
 * search when the exact quote is not found, because judge output sometimes
 * normalises curly quotes or collapses a line break.
 */
function findQuote(text: string, quote: string, from: number): { index: number; length: number } | null {
  const singleWord = /^[\p{L}\p{N}'-]+$/u.test(quote);
  let exact = text.indexOf(quote, from);
  while (exact >= 0) {
    const before = exact > 0 ? text[exact - 1]! : '';
    const after = text[exact + quote.length] ?? '';
    const bounded = !singleWord || (!/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after));
    if (bounded) return { index: exact, length: quote.length };
    exact = text.indexOf(quote, exact + 1);
  }

  const normalise = (value: string) =>
    value
      .toLowerCase()
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/\s+/g, ' ')
      .trim();

  const haystack = normalise(text.slice(from));
  const needle = normalise(quote);
  const at = haystack.indexOf(needle);
  if (at < 0) return null;

  // Map the normalised index back to the original string by walking both.
  let originalStart = -1;
  let normalisedIndex = 0;
  let previousWasSpace = true;
  for (let index = 0; index < text.length - from; index += 1) {
    const character = text[from + index]!;
    const isSpace = /\s/.test(character);
    if (isSpace && previousWasSpace) continue;
    if (normalisedIndex === at && originalStart < 0) originalStart = from + index;
    if (!isSpace) previousWasSpace = false;
    else previousWasSpace = true;
    normalisedIndex += 1;
    if (normalisedIndex > at + needle.length) break;
  }
  if (originalStart < 0) return null;

  // Take the quote's length in the original, trimmed to the next word boundary.
  let end = originalStart;
  let counted = 0;
  while (end < text.length && counted < needle.length) {
    if (!/\s/.test(text[end]!)) counted += 1;
    end += 1;
  }
  return { index: originalStart, length: Math.max(1, end - originalStart) };
}

/** Plain-text version, useful for copy/export and for tests. */
export function correctedText(text: string, corrections: CorrectionLike[]): string {
  const diff = inlineCorrections(text, corrections);
  return diff.segments
    .filter((segment) => segment.kind !== 'DELETE')
    .map((segment) => segment.text)
    .join('');
}
