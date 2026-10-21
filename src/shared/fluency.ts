/**
 * #4 Fluency metrics for a speaking attempt.
 *
 * Everything is derived from the transcript and the recorded duration that the
 * speaking session already stores — no audio model is involved. Metrics are
 * labelled as transcript-based in the UI: a transcript cannot hear hesitation
 * sounds at the phoneme level, but it does expose fillers, repetition, pace and
 * vocabulary range.
 */

export interface FluencyInput {
  transcript: string;
  durationSeconds: number;
}

export interface FluencyReport {
  words: number;
  seconds: number;
  /** Words per minute over the spoken time; 0 when there is no transcript. */
  wordsPerMinute: number;
  /** 120–160 wpm is the comfortable band for IELTS Part 2 delivery. */
  pace: 'SLOW' | 'STEADY' | 'FAST' | 'UNKNOWN';
  fillerCount: number;
  fillers: Array<{ word: string; count: number }>;
  /** Content words used more than twice (excluding common function words). */
  repeated: Array<{ word: string; count: number }>;
  /** Unique content words / content words, 0–1. */
  lexicalVariety: number;
  /** A short, actionable sentence for the learner. */
  advice: string;
}

const FILLER_WORDS = ['um', 'uh', 'erm', 'er', 'ah', 'like', 'basically', 'actually', 'sort of', 'kind of', 'you know', 'i mean'];
const STOP_WORDS = new Set(
  'a an the and or but so because if when while that this these those i you he she it we they my your his her its our their is are was were be been being am do does did have has had to of in on at for with from by about as not no yes very really just also too can could would should will may might'.split(
    ' ',
  ),
);

export function analyseFluency(input: FluencyInput): FluencyReport {
  const transcript = input.transcript.trim();
  const tokens = transcript
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.replace(/[^\p{L}\p{N}']/gu, ''))
    .filter(Boolean);
  const words = tokens.length;
  const seconds = Math.max(0, Math.round(input.durationSeconds));
  const wordsPerMinute = seconds > 0 && words > 0 ? Math.round((words / seconds) * 60) : 0;

  const pace: FluencyReport['pace'] =
    wordsPerMinute === 0 ? 'UNKNOWN' : wordsPerMinute < 110 ? 'SLOW' : wordsPerMinute > 170 ? 'FAST' : 'STEADY';

  const lower = transcript.toLowerCase();
  const fillers = FILLER_WORDS.map((filler) => {
    const matches = lower.match(new RegExp(`\\b${filler.replace(/ /g, '\\s+')}\\b`, 'g'));
    return { word: filler, count: matches?.length ?? 0 };
  })
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count);
  const fillerCount = fillers.reduce((total, entry) => total + entry.count, 0);

  const contentCounts = new Map<string, number>();
  for (const token of tokens) {
    if (STOP_WORDS.has(token) || token.length < 3) continue;
    contentCounts.set(token, (contentCounts.get(token) ?? 0) + 1);
  }
  const contentTotal = [...contentCounts.values()].reduce((total, count) => total + count, 0);
  const repeated = [...contentCounts.entries()]
    .filter(([, count]) => count > 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word, count]) => ({ word, count }));
  const lexicalVariety = contentTotal > 0 ? Math.round((contentCounts.size / contentTotal) * 100) / 100 : 0;

  let advice: string;
  if (words === 0) advice = 'There is no transcript yet — record or type your answer to see fluency feedback.';
  else if (seconds === 0) advice = 'Save the recording with its duration to calculate your speaking pace.';
  else if (pace === 'SLOW') advice = 'Your pace is below 110 words per minute. Practise the same answer once more, aiming for 120–160.';
  else if (pace === 'FAST') advice = 'You spoke above 170 words per minute. Slow down slightly so the examiner can follow every idea.';
  else if (fillerCount >= Math.max(3, words * 0.04)) advice = `You used ${fillerCount} fillers. Replace them with a short pause — silence sounds more confident than “um”.`;
  else if (repeated.length > 0) advice = `“${repeated[0]!.word}” appears ${repeated[0]!.count} times. Keep it once and paraphrase the rest.`;
  else if (lexicalVariety < 0.5) advice = 'Your vocabulary repeats. Add one precise synonym or an example to show more range.';
  else advice = 'Good pace and variety. Keep extending answers with a reason and an example.';

  return { words, seconds, wordsPerMinute, pace, fillerCount, fillers, repeated, lexicalVariety, advice };
}
