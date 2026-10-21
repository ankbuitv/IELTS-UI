/**
 * #38 Word-level transcript timing.
 *
 * Listening transcripts carry segment-level anchors (`startSeconds`) and, when
 * an institution supplies them, nothing finer. To let a candidate jump to the
 * exact word that proves an answer — and to look that word up without leaving
 * the review — the transcript is expanded into per-word timings.
 *
 * The mapping is deterministic:
 *  - a segment with an explicit anchor is honoured;
 *  - silent segments are spaced from their neighbours, so anchors win;
 *  - remaining time is spent proportionally to word length (longer words are
 *    spoken for longer), which lands within a word or two of the real position;
 *  - when the audio duration is unknown, a 2.6-words-per-second reading pace is
 *    used, so "listen from here" still starts near the right line.
 *
 * The audio duration from the player is the single best input: it makes the
 * whole transcript fit the recording instead of drifting.
 */

export interface TimingSegment {
  id: string;
  startSeconds: number | null;
  text: string;
}

export interface TranscriptWordTiming {
  segmentId: string;
  /** Index of the word inside its segment. */
  index: number;
  /** The word as printed (punctuation kept for display). */
  word: string;
  /** Lowercase, punctuation-free form for dictionary lookups and matching. */
  normalized: string;
  startSeconds: number;
  endSeconds: number;
}

const DEFAULT_WORDS_PER_SECOND = 2.6;

function weightOf(word: string): number {
  const letters = word.replace(/[^\p{L}\p{N}]/gu, '').length;
  return Math.max(1, letters);
}

/** The dictionary-ready form of a printed token. */
export function normaliseWord(word: string): string {
  return word
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, '')
    .replace(/'s$/, '');
}

export function buildWordTimings(
  segments: TimingSegment[],
  options: { durationSeconds?: number | null; wordsPerSecond?: number } = {},
): TranscriptWordTiming[] {
  const rate = options.wordsPerSecond && options.wordsPerSecond > 0 ? options.wordsPerSecond : DEFAULT_WORDS_PER_SECOND;
  const duration = options.durationSeconds && options.durationSeconds > 0 ? options.durationSeconds : null;

  const tokensPerSegment = segments.map((segment) => segment.text.split(/\s+/).filter(Boolean));
  const weightsPerSegment = tokensPerSegment.map((tokens) =>
    tokens.reduce((total, token) => total + weightOf(token), 0),
  );
  const totalWeight = weightsPerSegment.reduce((total, weight) => total + weight, 0);
  if (totalWeight === 0) return [];

  const anchors = segments.map((segment, index) =>
    segment.startSeconds !== null && Number.isFinite(segment.startSeconds) && segment.startSeconds >= 0
      ? { index, seconds: segment.startSeconds }
      : null,
  );
  const known = anchors.filter((anchor): anchor is { index: number; seconds: number } => anchor !== null);

  // Start time (seconds) of every segment.
  const segmentStart: number[] = new Array(segments.length).fill(0);

  if (known.length === 0) {
    if (duration) {
      let carried = 0;
      for (let index = 0; index < segments.length; index += 1) {
        segmentStart[index] = (carried / totalWeight) * duration;
        carried += weightsPerSegment[index]!;
      }
    } else {
      let carried = 0;
      for (let index = 0; index < segments.length; index += 1) {
        segmentStart[index] = carried / rate;
        carried += weightsPerSegment[index]! / rate;
      }
    }
  } else {
    // Before the first anchor: step back from it at the reading pace.
    const first = known[0]!;
    let weightBefore = 0;
    for (let index = 0; index < first.index; index += 1) weightBefore += weightsPerSegment[index]!;
    const startOfFirst = Math.max(0, first.seconds - weightBefore / rate);
    let carried = 0;
    for (let index = 0; index < first.index; index += 1) {
      segmentStart[index] = startOfFirst + carried / rate;
      carried += weightsPerSegment[index]!;
    }
    segmentStart[first.index] = first.seconds;

    // Between anchors: interpolate by weight.
    for (let k = 0; k < known.length - 1; k += 1) {
      const from = known[k]!;
      const to = known[k + 1]!;
      let weightBetween = 0;
      for (let index = from.index; index < to.index; index += 1) weightBetween += weightsPerSegment[index]!;
      const span = Math.max(0, to.seconds - from.seconds);
      const fallbackSpan = weightBetween / rate;
      const useSpan = span > 0 ? span : fallbackSpan;
      let carried2 = 0;
      for (let index = from.index; index < to.index; index += 1) {
        segmentStart[index] = from.seconds + (weightBetween > 0 ? (carried2 / weightBetween) * useSpan : 0);
        carried2 += weightsPerSegment[index]!;
      }
      segmentStart[to.index] = to.seconds;
    }

    // After the last anchor: continue at the reading pace.
    const last = known[known.length - 1]!;
    let carried3 = 0;
    for (let index = last.index; index < segments.length; index += 1) {
      segmentStart[index] = last.seconds + carried3 / rate;
      carried3 += weightsPerSegment[index]!;
    }
  }

  const timings: TranscriptWordTiming[] = [];
  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
    const tokens = tokensPerSegment[segmentIndex]!;
    const weights = tokens.map(weightOf);
    const segmentWeight = weights.reduce((total, weight) => total + weight, 0);
    const start = segmentStart[segmentIndex]!;
    const nextStart = segmentStart[segmentIndex + 1];
    const spoken = segmentWeight / rate;
    const end =
      nextStart !== undefined && nextStart > start
        ? nextStart
        : duration && start + spoken > duration
          ? duration
          : start + spoken;
    const span = Math.max(0.05, end - start);
    let carried = 0;
    tokens.forEach((word, index) => {
      const wordStart = start + (segmentWeight > 0 ? (carried / segmentWeight) * span : 0);
      carried += weights[index]!;
      const wordEnd = start + (segmentWeight > 0 ? (carried / segmentWeight) * span : span);
      timings.push({
        segmentId: segments[segmentIndex]!.id,
        index,
        word,
        normalized: normaliseWord(word),
        startSeconds: Math.round(wordStart * 100) / 100,
        endSeconds: Math.round(Math.max(wordEnd, wordStart + 0.05) * 100) / 100,
      });
    });
  }

  return timings;
}

/**
 * Where the evidence of a question starts inside its segment.
 *
 * Evidence is authored as `segment:ls1-03 "…quoted sentence…"`, so the quote is
 * matched against the transcript words. The longest run of matching words wins;
 * when nothing matches (paraphrased evidence) the segment start is returned.
 */
export function findEvidenceStart(
  timings: TranscriptWordTiming[],
  segmentId: string,
  evidence: string | null | undefined,
): number | null {
  const segmentWords = timings.filter((timing) => timing.segmentId === segmentId);
  if (segmentWords.length === 0) return null;

  const quote = (evidence ?? '')
    .replace(/segment:[A-Za-z0-9_-]+/g, ' ')
    .replace(/^[\s"'“”‘’…–—-]+|[\s"'“”‘’…–—-]+$/g, '')
    .trim();
  const needle = quote
    .split(/\s+/)
    .map(normaliseWord)
    .filter((word) => word.length > 1);

  if (needle.length === 0) return segmentWords[0]!.startSeconds;

  const haystack = segmentWords.map((timing) => timing.normalized);
  let bestIndex = -1;
  let bestScore = 0;

  // Walk each plausible start and count how far the quote continues with at
  // most one skipped word. A quote that starts mid-sentence therefore beats an
  // accidental match on a common word earlier in the segment.
  for (let start = 0; start < haystack.length; start += 1) {
    if (haystack[start] !== needle[0]) continue;
    let matched = 1;
    let cursor = start + 1;
    for (let target = 1; target < needle.length; target += 1) {
      if (haystack[cursor] === needle[target]) {
        matched += 1;
        cursor += 1;
        continue;
      }
      if (haystack[cursor + 1] === needle[target]) {
        matched += 1;
        cursor += 2;
        continue;
      }
      break;
    }
    if (matched > bestScore || (matched === bestScore && bestIndex >= 0 && start < bestIndex)) {
      bestScore = matched;
      bestIndex = start;
    }
  }

  const threshold = Math.max(2, Math.ceil(needle.length * 0.5));
  if (bestIndex >= 0 && bestScore >= threshold) return segmentWords[bestIndex]!.startSeconds;
  return segmentWords[0]!.startSeconds;
}

/** All timings for one segment, in spoken order. */
export function wordTimingsForSegment(
  timings: TranscriptWordTiming[],
  segmentId: string,
): TranscriptWordTiming[] {
  return timings.filter((timing) => timing.segmentId === segmentId);
}
