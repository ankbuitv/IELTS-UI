/**
 * Lesson engine: turns a handful of words into a Duolingo-style set of short
 * exercises, and checks the answers. Pure functions only, so it runs the same
 * in the browser and in unit tests, and the same `seed` always builds the same
 * lesson.
 *
 * Exercise kinds
 *   choose  pick the meaning of a word
 *   fill    pick the word that completes a sentence
 *   listen  hear a word (speech synthesis), pick what was said
 *   type    type the word from its meaning
 *   order   put the words of a sentence in order
 *   match   pair four words with their meanings
 */
import type {
  LessonPayload,
  LessonWord as LearnWord,
  ParaphrasePayload,
  ReadingPayload,
  SpeakingPayload,
  WritingPayload,
} from './learn';

export interface ExplainWord {
  term: string;
  pos: string;
  meaning: string;
  vi: string;
  example: string;
}

interface ExerciseBase {
  id: string;
  /** The term(s) the exercise tests: a miss sends them to the notebook. */
  terms: string[];
  /** Shown after the answer so every exercise teaches something. */
  explain: ExplainWord;
}

export interface ChooseExercise extends ExerciseBase {
  kind: 'choose';
  prompt: string;
  options: string[];
  answer: number;
}

export interface FillExercise extends ExerciseBase {
  kind: 'fill';
  /** The sentence with `____` where the word goes. */
  sentence: string;
  options: string[];
  answer: number;
}

export interface ListenExercise extends ExerciseBase {
  kind: 'listen';
  /** What the speech synthesiser says. */
  speak: string;
  options: string[];
  answer: number;
}

export interface TypeExercise extends ExerciseBase {
  kind: 'type';
  prompt: string;
  /** Vietnamese hint. */
  hint: string;
  answer: string;
  /** "_ _ _ _ _" style mask shown as a clue. */
  mask: string;
}

export interface OrderExercise extends ExerciseBase {
  kind: 'order';
  prompt: string;
  /** Shuffled words. */
  tokens: string[];
  /** The correct order. */
  answer: string[];
}

export interface MatchExercise extends ExerciseBase {
  kind: 'match';
  prompt: string;
  pairs: Array<{ id: string; term: string; meaning: string }>;
  /** Shuffled order of the meanings column, as indices into `pairs`. */
  meaningOrder: number[];
}

export interface ParaphraseExercise extends ExerciseBase {
  kind: 'paraphrase';
  /** The sentence to restate. */
  prompt: string;
  options: string[];
  answer: number;
  /** Why the answer holds and the others do not. */
  note: string;
}

export interface ReadExercise extends ExerciseBase {
  kind: 'read';
  passage: string;
  stem: string;
  options: string[];
  answer: number;
  /** The line of the passage the answer comes from. */
  evidence: string;
}

export interface WriteExercise extends ExerciseBase {
  kind: 'write';
  /** Vietnamese instruction telling the learner what to say. */
  instruction: string;
  hint: string;
  /** The English sentence they are aiming at. */
  answer: string;
}

export interface SpeakExercise extends ExerciseBase {
  kind: 'speak';
  question: string;
  /** What a good answer has to cover. */
  cue: string;
  /** A model answer, revealed after the learner has tried. */
  sample: string;
}

export type Exercise =
  | ChooseExercise
  | FillExercise
  | ListenExercise
  | TypeExercise
  | OrderExercise
  | MatchExercise
  | ParaphraseExercise
  | ReadExercise
  | WriteExercise
  | SpeakExercise;
export type ExerciseKind = Exercise['kind'];

// ------------------------------------------------------------------ random
/** Small deterministic generator (mulberry32) seeded from a string. */
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i += 1) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let state = h >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

// ------------------------------------------------------------------ helpers
const BLANK = '____';

/** Replaces the first occurrence of `term` in `sentence` with a blank, keeping the sentence's own capital. */
export function blankOut(sentence: string, term: string): string | null {
  const index = sentence.toLowerCase().indexOf(term.toLowerCase());
  if (index < 0) return null;
  return `${sentence.slice(0, index)}${BLANK}${sentence.slice(index + term.length)}`;
}

/** The words of a sentence without losing its punctuation (it stays glued to the word). */
export function sentenceTokens(sentence: string): string[] {
  return sentence.trim().split(/\s+/).filter(Boolean);
}

function maskFor(term: string): string {
  return term
    .split('')
    .map((char, index) => (char === ' ' ? '  ' : index === 0 ? char.toUpperCase() : '_'))
    .join(' ');
}

function explainOf(word: LearnWord): ExplainWord {
  return { term: word.term, pos: word.pos, meaning: word.meaning, vi: word.vi, example: word.example };
}

/** Distractors: other words, preferring the same part of speech so the answer is not obvious by form. */
function pickDistractors(word: LearnWord, pool: readonly LearnWord[], count: number, random: () => number): LearnWord[] {
  const others = pool.filter((candidate) => candidate.term.toLowerCase() !== word.term.toLowerCase());
  const samePos = shuffle(
    others.filter((candidate) => candidate.pos === word.pos),
    random,
  );
  const rest = shuffle(
    others.filter((candidate) => candidate.pos !== word.pos),
    random,
  );
  const picked: LearnWord[] = [];
  const seen = new Set<string>();
  for (const candidate of [...samePos, ...rest]) {
    const key = candidate.term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(candidate);
    if (picked.length === count) break;
  }
  return picked;
}

function withAnswer<T>(correct: T, wrong: T[], random: () => number): { options: T[]; answer: number } {
  const options = shuffle([correct, ...wrong], random);
  return { options, answer: options.indexOf(correct) };
}

// ---------------------------------------------------------------- builders
export function buildChoose(word: LearnWord, pool: readonly LearnWord[], random: () => number, id: string): ChooseExercise {
  const wrong = pickDistractors(word, pool, 3, random).map((candidate) => candidate.meaning);
  const { options, answer } = withAnswer(word.meaning, wrong, random);
  return {
    kind: 'choose',
    id,
    terms: [word.term],
    explain: explainOf(word),
    prompt: `What does “${word.term}” mean?`,
    options,
    answer,
  };
}

export function buildFill(word: LearnWord, pool: readonly LearnWord[], random: () => number, id: string): FillExercise | null {
  const sentence = blankOut(word.example, word.term);
  if (!sentence) return null;
  const wrong = pickDistractors(word, pool, 3, random).map((candidate) => candidate.term);
  const { options, answer } = withAnswer(word.term, wrong, random);
  return { kind: 'fill', id, terms: [word.term], explain: explainOf(word), sentence, options, answer };
}

export function buildListen(word: LearnWord, pool: readonly LearnWord[], random: () => number, id: string): ListenExercise {
  const wrong = pickDistractors(word, pool, 3, random).map((candidate) => candidate.term);
  const { options, answer } = withAnswer(word.term, wrong, random);
  return { kind: 'listen', id, terms: [word.term], explain: explainOf(word), speak: word.term, options, answer };
}

export function buildType(word: LearnWord, id: string): TypeExercise {
  return {
    kind: 'type',
    id,
    terms: [word.term],
    explain: explainOf(word),
    prompt: `Type the English word for: ${word.meaning}`,
    hint: word.vi,
    answer: word.term,
    mask: maskFor(word.term),
  };
}

export function buildOrder(word: LearnWord, random: () => number, id: string): OrderExercise | null {
  const answer = sentenceTokens(word.example);
  if (answer.length < 4 || answer.length > 14) return null;
  let tokens = shuffle(answer, random);
  // A shuffle that lands on the original order would be a free answer.
  for (let attempt = 0; attempt < 4 && tokens.join(' ') === answer.join(' '); attempt += 1) tokens = shuffle(answer, random);
  return {
    kind: 'order',
    id,
    terms: [word.term],
    explain: explainOf(word),
    prompt: `Put the words in order (uses “${word.term}”)`,
    tokens,
    answer,
  };
}

export function buildMatch(words: readonly LearnWord[], random: () => number, id: string): MatchExercise | null {
  const chosen = words.slice(0, 4);
  if (chosen.length < 3) return null;
  const pairs = chosen.map((word, index) => ({ id: `${id}-${index}`, term: word.term, meaning: word.meaning }));
  return {
    kind: 'match',
    id,
    terms: chosen.map((word) => word.term),
    explain: explainOf(chosen[0]!),
    prompt: 'Match each word with its meaning',
    pairs,
    meaningOrder: shuffle(
      pairs.map((_, index) => index),
      random,
    ),
  };
}

// ------------------------------------------------------------------ lesson
export interface BuildLessonOptions {
  /** Extra words used for distractors, normally the other words at the same band. */
  pool?: readonly LearnWord[];
}

/**
 * A lesson of about ten exercises. Recognition comes first (choose, match),
 * then recall (fill, listen, type, order), so each word is met more than once.
 */
export function buildLesson(words: readonly LearnWord[], seed: string, options: BuildLessonOptions = {}): Exercise[] {
  const random = seededRandom(seed);
  const own = words.filter((word) => word.term.trim() && word.meaning.trim());
  if (own.length === 0) return [];
  // Distractor pool: the lesson's own words first, then whatever the caller
  // supplies (the catalogue sends the words of the same band). There is no
  // built-in fallback: importing the seed content here would pull every lesson
  // back into the browser bundle, which is the whole thing this avoids.
  const pool: LearnWord[] = [...own];
  for (const word of options.pool ?? []) {
    if (!pool.some((existing) => existing.term.toLowerCase() === word.term.toLowerCase())) pool.push(word);
  }

  const order = shuffle(own, random);
  const n = order.length;
  const at = (index: number) => order[((index % n) + n) % n]!;
  const exercises: Exercise[] = [];
  const push = (exercise: Exercise | null) => {
    if (exercise) exercises.push(exercise);
  };
  let counter = 0;
  const nextId = (kind: string) => `${seed}:${kind}:${counter++}`;

  for (let i = 0; i < Math.min(n, 4); i += 1) push(buildChoose(at(i), pool, random, nextId('choose')));
  push(buildMatch(shuffle(order, random), random, nextId('match')));
  for (let i = 2; i < 5; i += 1) push(buildFill(at(i), pool, random, nextId('fill')) ?? buildChoose(at(i), pool, random, nextId('choose')));
  push(buildListen(at(n - 1), pool, random, nextId('listen')));
  push(buildType(at(0), nextId('type')));
  if (n > 2) push(buildType(at(n - 2), nextId('type')));
  const orderable = order.find((word) => buildOrder(word, () => 0.5, 'probe'));
  if (orderable) push(buildOrder(orderable, random, nextId('order')));
  return exercises;
}

/** A review lesson built from the learner's notebook: every word is both recognised and recalled. */
export function buildReviewLesson(words: readonly LearnWord[], seed: string, extraPool: readonly LearnWord[] = []): Exercise[] {
  const random = seededRandom(seed);
  const pool = [...words, ...extraPool];
  const exercises: Exercise[] = [];
  words.forEach((word, index) => {
    exercises.push(buildChoose(word, pool, random, `${seed}:rc:${index}`));
    exercises.push(index % 2 === 0 ? buildType(word, `${seed}:rt:${index}`) : (buildFill(word, pool, random, `${seed}:rf:${index}`) ?? buildType(word, `${seed}:rt:${index}`)));
  });
  return exercises;
}

// ------------------------------------------------------- the other four kinds
/**
 * A paraphrase item carries its own three wrong sentences, because a
 * plausible near-miss cannot be picked out of a word bank: "the price fell"
 * and "the price fell sharply" differ in exactly the way the exercise tests.
 */
export function buildParaphraseLesson(items: ParaphrasePayload['items'], seed: string): Exercise[] {
  const random = seededRandom(seed);
  const exercises: Exercise[] = [];
  items.forEach((item, index) => {
    if (!item.original.trim() || !item.answer.trim() || item.distractors.length < 3) return;
    const options = shuffle([item.answer, ...item.distractors.slice(0, 3)], random);
    exercises.push({
      kind: 'paraphrase',
      id: `${seed}:pp:${index}`,
      terms: [],
      // `explain` carries the item so the feedback panel has something to show.
      explain: { term: item.original, pos: 'sentence', meaning: item.note, vi: '', example: item.answer },
      prompt: item.original,
      options,
      answer: options.indexOf(item.answer),
      note: item.note,
    });
  });
  return exercises;
}

/** One exercise per question; the passage travels with it so the player can keep it on screen. */
export function buildReadingLesson(payload: ReadingPayload, seed: string): Exercise[] {
  const exercises: Exercise[] = [];
  const passage = (payload.passage ?? '').trim();
  if (!passage) return exercises;
  payload.questions.forEach((question, index) => {
    if (!question.stem.trim() || question.options.length < 4) return;
    if (question.answer < 0 || question.answer >= question.options.length) return;
    exercises.push({
      kind: 'read',
      id: `${seed}:rd:${index}`,
      terms: [],
      explain: { term: question.stem, pos: 'question', meaning: question.evidence, vi: '', example: '' },
      passage,
      stem: question.stem,
      options: question.options,
      answer: question.answer,
      evidence: question.evidence,
    });
  });
  return exercises;
}

export function buildWritingLesson(items: WritingPayload['items'], seed: string): Exercise[] {
  const exercises: Exercise[] = [];
  items.forEach((item, index) => {
    if (!item.model.trim() || !item.instruction.trim()) return;
    exercises.push({
      kind: 'write',
      id: `${seed}:wr:${index}`,
      terms: [],
      explain: { term: item.model, pos: 'sentence', meaning: item.instruction, vi: item.hint, example: item.model },
      instruction: item.instruction,
      hint: item.hint,
      answer: item.model,
    });
  });
  return exercises;
}

export function buildSpeakingLesson(items: SpeakingPayload['items'], seed: string): Exercise[] {
  const exercises: Exercise[] = [];
  items.forEach((item, index) => {
    if (!item.question.trim() || !item.sample.trim()) return;
    exercises.push({
      kind: 'speak',
      id: `${seed}:sp:${index}`,
      terms: [],
      explain: { term: item.question, pos: 'question', meaning: item.cue, vi: '', example: item.sample },
      question: item.question,
      cue: item.cue,
      sample: item.sample,
    });
  });
  return exercises;
}

/**
 * Builds a lesson from a stored body, whatever kind it is.
 *
 * This is the single place that knows the kind-to-exercise mapping, so the
 * client and any future server-side check agree on what a lesson contains.
 */
export function buildLessonFromPayload(
  payload: LessonPayload,
  seed: string,
  options: { pool?: readonly LearnWord[] } = {},
): Exercise[] {
  switch (payload.kind) {
    case 'VOCAB':
      return buildLesson(payload.words, seed, { pool: options.pool });
    case 'PARAPHRASE':
      return buildParaphraseLesson(payload.items, seed);
    case 'READING':
      return buildReadingLesson(payload, seed);
    case 'WRITING':
      return buildWritingLesson(payload.items, seed);
    case 'SPEAKING':
      return buildSpeakingLesson(payload.items, seed);
  }
}

// ----------------------------------------------------------------- checking
export function normaliseAnswer(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0]!;
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const saved = previous[j]!;
      previous[j] = Math.min(previous[j]! + 1, previous[j - 1]! + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = saved;
    }
  }
  return previous[b.length]!;
}

/**
 * A typed answer is right when it matches. One slip is forgiven in a word of
 * seven letters or more (a typo is not a vocabulary gap) and flagged `almost`
 * so the learner still sees the correct spelling.
 */
export function checkTyped(typed: string, answer: string): { correct: boolean; almost: boolean } {
  const given = normaliseAnswer(typed);
  const target = normaliseAnswer(answer);
  if (!given) return { correct: false, almost: false };
  if (given === target) return { correct: true, almost: false };
  if (target.length >= 7 && editDistance(given, target) <= 1) return { correct: true, almost: true };
  return { correct: false, almost: false };
}

/**
 * A written sentence is right when it matches the model closely enough.
 *
 * One slip is forgiven in a single word, but a sentence is dozens of characters
 * long, so the allowance scales with it — roughly one per fourteen characters.
 * Punctuation and a missing final period are not vocabulary gaps either.
 */
export function checkSentence(typed: string, model: string): { correct: boolean; almost: boolean } {
  const clean = (value: string) => normaliseAnswer(value).replace(/[.,;:!?]+$/g, '').replace(/\s+/g, ' ').trim();
  const given = clean(typed);
  const target = clean(model);
  if (!given || !target) return { correct: false, almost: false };
  if (given === target) return { correct: true, almost: false };
  const tolerance = Math.max(1, Math.floor(target.length / 14));
  if (editDistance(given, target) <= tolerance) return { correct: true, almost: true };
  return { correct: false, almost: false };
}

export function checkOrder(tokens: readonly string[], answer: readonly string[]): boolean {
  return tokens.length === answer.length && tokens.every((token, index) => token === answer[index]);
}

/** The text of the correct answer, for the "Correct answer" panel after a miss. */
export function correctAnswerText(exercise: Exercise): string {
  switch (exercise.kind) {
    case 'choose':
    case 'fill':
    case 'listen':
      return exercise.options[exercise.answer] ?? '';
    case 'type':
      return exercise.answer;
    case 'order':
      return exercise.answer.join(' ');
    case 'match':
      return exercise.pairs.map((pair) => `${pair.term} = ${pair.meaning}`).join('; ');
    case 'paraphrase':
    case 'read':
      return exercise.options[exercise.answer] ?? '';
    case 'write':
      return exercise.answer;
    case 'speak':
      return exercise.sample;
    default:
      return '';
  }
}

export const MAX_HEARTS = 5;

export interface LessonScore {
  /** Exercises answered right on the first try. */
  correct: number;
  total: number;
  mistakes: string[];
}

/** Tallies a finished lesson from the per-exercise outcomes (`true` = right first time). */
export function scoreLesson(outcomes: ReadonlyArray<{ terms: string[]; firstTryCorrect: boolean }>): LessonScore {
  const mistakes = new Set<string>();
  let correct = 0;
  for (const outcome of outcomes) {
    if (outcome.firstTryCorrect) correct += 1;
    else for (const term of outcome.terms) mistakes.add(term);
  }
  return { correct, total: outcomes.length, mistakes: [...mistakes] };
}
