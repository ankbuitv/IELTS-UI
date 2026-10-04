/**
 * Reading and validating a stored lesson body.
 *
 * One normaliser, used from both directions: the catalogue runs it on the way
 * out so a malformed row degrades instead of throwing in the player, and the
 * generator runs it on the way in so nothing an AI produced reaches the
 * database unless it can actually be turned into exercises. Keeping it here
 * (pure, no I/O) is what lets a unit test cover both paths at once.
 *
 * The rule throughout: drop the entries that cannot be played, keep the ones
 * that can, and return null only when nothing is left. A lesson that lost two
 * of six items is still worth more than a 500.
 */
import {
  isLessonKind,
  type LessonPayload,
  type LessonWord,
  type ParaphraseItem,
  type ReadingQuestion,
  type SpeakingItem,
  type WritingItem,
} from './learn';

function text(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function listOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** A word is usable when it has a term and a meaning; the rest falls back to sensible blanks. */
export function normaliseWord(raw: unknown): LessonWord | null {
  const value = record(raw);
  if (!value) return null;
  const term = text(value.term, 80);
  const meaning = text(value.meaning, 240);
  if (!term || !meaning) return null;
  const example = text(value.example, 240) || `${term}.`;
  const exampleVi = text(value.exampleVi ?? value.example_vi, 320);
  return { term, pos: text(value.pos, 24) || 'word', meaning, vi: text(value.vi ?? value.meaningVi ?? value.meaning_vi, 120), example, ...(exampleVi ? { exampleVi } : {}) };
}

function normaliseVocab(raw: unknown): LessonPayload | null {
  const words = listOf(record(raw)?.words)
    .map(normaliseWord)
    .filter((word): word is LessonWord => word !== null);
  return words.length > 0 ? { kind: 'VOCAB', words } : null;
}

function normaliseParaphrase(raw: unknown): LessonPayload | null {
  const items: ParaphraseItem[] = [];
  for (const entry of listOf(record(raw)?.items)) {
    const value = record(entry);
    if (!value) continue;
    const original = text(value.original, 320);
    const answer = text(value.answer, 320);
    const distractors = listOf(value.distractors)
      .map((item) => text(item, 320))
      .filter(Boolean)
      .slice(0, 3);
    // Three wrong options are the exercise: with fewer it is a coin toss, so drop it.
    if (!original || !answer || distractors.length < 3) continue;
    if (distractors.includes(answer)) continue;
    const originalVi = text(value.originalVi ?? value.original_vi, 320);
    const answerVi = text(value.answerVi ?? value.answer_vi, 320);
    items.push({ original, answer, distractors, note: text(value.note, 320), ...(originalVi ? { originalVi } : {}), ...(answerVi ? { answerVi } : {}) });
  }
  return items.length > 0 ? { kind: 'PARAPHRASE', items } : null;
}

function normaliseReading(raw: unknown): LessonPayload | null {
  const source = record(raw);
  if (!source) return null;
  const passage = text(source.passage, 4_000);
  if (!passage) return null;
  const questions: ReadingQuestion[] = [];
  for (const entry of listOf(source.questions)) {
    const value = record(entry);
    if (!value) continue;
    const stem = text(value.stem, 320);
    const options = listOf(value.options).map((option) => text(option, 320)).filter(Boolean);
    const answer = Number(value.answer);
    // Four distinct options with the answer inside them, or the question cannot be asked.
    if (!stem || options.length < 4 || !Number.isInteger(answer) || answer < 0 || answer >= options.length) continue;
    if (new Set(options).size !== options.length) continue;
    const evidenceVi = text(value.evidenceVi ?? value.evidence_vi, 320);
    questions.push({ stem, options: options.slice(0, 4), answer, evidence: text(value.evidence, 320), ...(evidenceVi ? { evidenceVi } : {}) });
  }
  return questions.length > 0 ? { kind: 'READING', passage, questions } : null;
}

function normaliseWriting(raw: unknown): LessonPayload | null {
  const items: WritingItem[] = [];
  for (const entry of listOf(record(raw)?.items)) {
    const value = record(entry);
    if (!value) continue;
    const instruction = text(value.instruction, 320);
    const model = text(value.model, 320);
    if (!instruction || !model) continue;
    const modelVi = text(value.modelVi ?? value.model_vi, 320);
    items.push({ instruction, model, hint: text(value.hint, 160), ...(modelVi ? { modelVi } : {}) });
  }
  return items.length > 0 ? { kind: 'WRITING', items } : null;
}

function normaliseSpeaking(raw: unknown): LessonPayload | null {
  const items: SpeakingItem[] = [];
  for (const entry of listOf(record(raw)?.items)) {
    const value = record(entry);
    if (!value) continue;
    const question = text(value.question, 320);
    const sample = text(value.sample, 600);
    if (!question || !sample) continue;
    const sampleVi = text(value.sampleVi ?? value.sample_vi, 600);
    items.push({ question, cue: text(value.cue, 240), sample, ...(sampleVi ? { sampleVi } : {}) });
  }
  return items.length > 0 ? { kind: 'SPEAKING', items } : null;
}

/**
 * Cleans a stored or generated body, or returns null when nothing in it can be
 * played. An unknown kind is null too: better to hide a lesson than to guess.
 */
export function normaliseLessonPayload(kind: unknown, raw: unknown): LessonPayload | null {
  if (!isLessonKind(kind)) return null;
  switch (kind) {
    case 'VOCAB':
      return normaliseVocab(raw);
    case 'PARAPHRASE':
      return normaliseParaphrase(raw);
    case 'READING':
      return normaliseReading(raw);
    case 'WRITING':
      return normaliseWriting(raw);
    case 'SPEAKING':
      return normaliseSpeaking(raw);
    default:
      return null;
  }
}

/** How many things the learner will actually meet in a lesson. */
export function lessonItemCount(payload: LessonPayload): number {
  switch (payload.kind) {
    case 'VOCAB':
      return payload.words.length;
    case 'PARAPHRASE':
    case 'WRITING':
    case 'SPEAKING':
      return payload.items.length;
    case 'READING':
      return payload.questions.length;
  }
}

/** A one-line taste of a lesson, for the popup on the path. */
export function lessonPreview(payload: LessonPayload): string {
  switch (payload.kind) {
    case 'VOCAB':
      return payload.words.map((word) => word.term).join(' · ');
    case 'PARAPHRASE':
      return payload.items[0]?.original ?? '';
    case 'READING':
      return `${payload.questions.length} questions · ${payload.passage.split(/\s+/).length} words`;
    case 'WRITING':
      return payload.items[0]?.instruction ?? '';
    case 'SPEAKING':
      return payload.items[0]?.question ?? '';
  }
}
