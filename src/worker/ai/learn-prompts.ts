/**
 * Prompts that generate lesson content.
 *
 * The shape follows the rest of the platform's AI prompts (`coach-prompts.ts`):
 * a `TASK_KIND` line, hard rules, an explicit JSON contract and "output only the
 * JSON object". Every kind is asked for a fixed number of items so a generated
 * lesson is the same size as a hand-written one, and every kind is told which
 * band it is writing for, because "band 5.5" and "band 7.5" are not adjectives —
 * they are the difference between "the price went up" and "the figure rose
 * twofold".
 *
 * Nothing here names a model, and the stored result never does either: a
 * learner sees `origin = ADMIN_AI`, an administrator sees who generated it.
 *
 * Generated output is not trusted. It is normalised by
 * `normaliseLessonPayload` before it reaches the database, and it is stored as a
 * DRAFT unless the administrator publishes it, so a bad batch costs nothing.
 */
import { LEARN_BAND_LABELS, type LearnBand, type LessonKind } from '../../shared/learn';
import type { ChatMessageInput } from './coach-prompts';

export interface LessonGenerationInput {
  kind: LessonKind;
  band: LearnBand;
  /** How many lessons to write in one call. */
  count: number;
  /** Items per lesson. */
  items: number;
  /** The unit the lessons will be filed under. */
  unitTitle: string;
  /** Lesson titles that already exist at this band, so nothing is duplicated. */
  avoidTitles: string[];
  /** Vocabulary already taught at this band, so words are not repeated. */
  avoidTerms: string[];
}

const SHARED_RULES = `You write original teaching material for an IELTS practice platform. Most learners are Vietnamese speakers of English.
GENERAL RULES
1. Write at exactly the band you are given. Band 4 to 5 is common everyday language; band 6 to 6.5 is the language of Task 1 and Task 2; band 7 to 8 is precise, less common, academic language.
2. Everything must be original. Never reproduce a passage, question or sentence from a real IELTS paper or any published coursebook.
3. Vietnamese glosses and instructions must be natural Vietnamese, not word-for-word translation.
4. Titles are short (at most 5 words) and describe a topic or a skill, never "Lesson 1".
5. Never repeat anything on the DO NOT REPEAT lists.
6. Output ONLY one JSON object. No markdown, no code fences, no commentary before or after.`;

const CONTRACTS: Record<LessonKind, { contract: string; kindRules: string }> = {
  VOCAB: {
    kindRules: `VOCABULARY RULES
- Six words per lesson, all from the same topic or the same word family.
- "meaning" is a short English definition using common words (at most 14 words).
- "vi" is a short, natural Vietnamese translation of the definition, not a transliteration.
- "example" is ONE natural sentence of at most 16 words that contains "term" EXACTLY as written in "term", in that form, and only once. This is required: the sentence is turned into a fill-in-the-blank.
- "exampleVi" is a natural Vietnamese translation of the whole example sentence.
- Vary the parts of speech. Include at most one multi-word item, and if you do, "term" is the whole phrase.`,
    contract: `{"lessons":[{"title":"...","blurb":"...","words":[{"term":"...","pos":"noun|verb|adjective|adverb|phrase","meaning":"...","vi":"...","example":"...","exampleVi":"..."}]}]}`,
  },
  PARAPHRASE: {
    kindRules: `PARAPHRASE RULES
- Each item is one original sentence and three wrong restatements; produce the exact item count requested in OUTPUT.
- "answer" must keep the meaning of "original" while changing the wording (different verb, different structure, or a nominalisation).
- Include natural Vietnamese translations in "originalVi" and "answerVi" so the source and correct restatement are clear.
- Each of the three "distractors" must look plausible but change the meaning in ONE specific way: the opposite, a stronger or weaker claim, or a different subject or time. Never a grammar error.
- "note" says in one sentence why the answer holds and what the distractors got wrong.`,
    contract: `{"lessons":[{"title":"...","blurb":"...","items":[{"original":"...","originalVi":"...","answer":"...","answerVi":"...","distractors":["...","...","..."],"note":"..."}]}]}`,
  },
  READING: {
    kindRules: `READING RULES
- Each lesson is one original passage of about 450 to 650 words, on an academic or semi-academic topic, with exactly the number of questions requested in OUTPUT. This should be a short reading drill, not a full-length test.
- Every question must be answerable from the passage alone, and only from the passage.
- The four "options" must be the same kind of thing (all noun phrases, or all full clauses) and similar in length.
- "answer" is the zero-based index of the correct option.
- "evidence" quotes the exact words from the passage that support the answer; "evidenceVi" translates those words naturally into Vietnamese.
- Mix question types: main idea, detail, inference, and meaning-of-a-word-or-phrase.`,
    contract: `{"lessons":[{"title":"...","blurb":"...","passage":"...","questions":[{"stem":"...","options":["...","...","...","..."],"answer":0,"evidence":"...","evidenceVi":"..."}]}]}`,
  },
  WRITING: {
    kindRules: `WRITING RULES
- Include a real, original IELTS-style Task 1 or Task 2 prompt in "taskPrompt" and state "taskType" as "TASK_1" or "TASK_2".
- Produce exactly the number of sentence exercises requested in OUTPUT. Each item practises a useful sentence-level skill for answering that task (overview, comparison, position, reason, example, concession, or conclusion).
- "instruction" is Vietnamese and tells the learner what to write; it may name a structure without giving away the full model.
- "model" is one natural, grammatical English sentence of at most 24 words that could genuinely appear in an IELTS response; "modelVi" translates it naturally into Vietnamese.
- "hint" names the key idea or structure in at most 8 words.
- Task 1 must be self-contained because no chart image is attached: include every relevant category, unit, time period and figure directly in "taskPrompt" as concise prose or an inline text table. Label invented values as fictional practice data; never ask the learner to make up missing figures.
- For a process or map prompt, describe each stage or before/after change completely in "taskPrompt". For Task 2, write a concrete, original question with all required parts.
- Do not request citations, external research or unsupported statistics as a way to raise the IELTS score.`,
    contract: `{"lessons":[{"title":"...","blurb":"...","taskType":"TASK_1|TASK_2","taskPrompt":"...","items":[{"instruction":"...","model":"...","modelVi":"...","hint":"..."}]}]}`,
  },
  SPEAKING: {
    kindRules: `SPEAKING RULES
- Produce exactly the number of items requested in OUTPUT, all from one Part 1, Part 2 or Part 3 theme. Say which in the lesson blurb.
- "question" is what an examiner would actually ask, word for word.
- "cue" lists in at most 12 words what a good answer covers.
- "sample" is a model spoken answer of 35 to 60 words: natural, with the connectives and hedging of real speech, not a written paragraph.
- "sampleVi" is a natural Vietnamese translation of the complete sample answer.
- Never ask about the learner's income, health conditions, religion or politics.`,
    contract: `{"lessons":[{"title":"...","blurb":"...","items":[{"question":"...","cue":"...","sample":"...","sampleVi":"..."}]}]}`,
  },
};

export function buildLessonGenerationMessages(input: LessonGenerationInput): ChatMessageInput[] {
  const spec = CONTRACTS[input.kind];
  const band = input.band.toFixed(1);
  return [
    {
      role: 'system',
      content: `TASK_KIND: LESSON_GENERATE_${input.kind}
${SHARED_RULES}

${spec.kindRules}

OUTPUT
${input.count} lessons in the "lessons" array.
${input.kind === 'VOCAB' ? 'Each vocabulary lesson must contain exactly 6 words; the player turns these into about 30 varied exercises.' : `Every lesson must contain exactly ${input.items} playable items (${input.items} questions/prompts). Do not stop early or return examples.`}
Output ONLY this JSON object:
${spec.contract}`,
    },
    {
      role: 'user',
      content: `Band: ${band} (${LEARN_BAND_LABELS[input.band]})
Lesson type: ${input.kind}
Unit these lessons belong to: ${input.unitTitle}
Number of lessons to write: ${input.count}
DO NOT REPEAT these lesson titles: ${input.avoidTitles.slice(0, 60).join('; ') || 'none'}
DO NOT REPEAT these vocabulary items: ${input.avoidTerms.slice(0, 200).join(', ') || 'none'}`,
    },
  ];
}

export interface EverydayLessonGenerationInput {
  band: LearnBand;
  kinds: LessonKind[];
  topics: string[];
  day: string;
}

/**
 * Six varied, private daily lessons. The chosen types rotate by day, and every
 * generated item includes a Vietnamese gloss so the exercises remain useful
 * even if the translation provider is temporarily unavailable.
 */
export function buildEverydayLessonMessages(input: EverydayLessonGenerationInput): ChatMessageInput[] {
  const lessonBrief = input.kinds
    .map((kind, index) => `${index + 1}. ${kind} about “${input.topics[index] ?? 'everyday life'}”`)
    .join('\n');
  return [
    {
      role: 'system',
      content: `TASK_KIND: EVERYDAY_LESSONS
${SHARED_RULES}

DAILY LESSON RULES
- Create exactly six original lessons, one for each numbered request, using the requested kind exactly.
- VOCAB is the exception: provide exactly six distinct target words with useful Vietnamese glosses and natural example sentences. The player builds 30 varied recall exercises from those six words.
- Every PARAPHRASE, READING, WRITING and SPEAKING lesson must contain exactly 30 playable items. Do not stop early or return sample subsets.
- All lessons should be practical IELTS English at the requested band, not obscure drills. Give each a short, distinctive title and one-sentence blurb. Do not repeat a topic or target phrase inside the batch.
- VOCAB payload: {"words":[{"term":"...","pos":"noun|verb|adjective|adverb|phrase","meaning":"...","vi":"...","example":"...","exampleVi":"..."}]}. Each sentence contains its term exactly once.
- PARAPHRASE payload: {"items":[{"original":"...","originalVi":"...","answer":"...","answerVi":"...","distractors":["...","...","..."],"note":"..."}]}. Make exactly 30 items; the answer keeps the meaning and each distractor changes one specific detail.
- READING payload: {"passage":"...","questions":[{"stem":"...","options":["...","...","...","..."],"answer":0,"evidence":"exact words from the passage","evidenceVi":"..."}]}. Use one original passage of 450 to 650 words and exactly 30 answerable questions. Evidence must be copied verbatim from the passage.
- WRITING payload: {"taskType":"TASK_1|TASK_2","taskPrompt":"...","items":[{"instruction":"Vietnamese task instruction","model":"...","modelVi":"...","hint":"..."}]}. Include a full, original IELTS Writing task prompt and exactly 30 sentence exercises that practise answering it. For Task 1 include every category, unit, time period and figure directly in the prompt; label invented values as fictional practice data. For maps or processes, describe all stages or changes. For Task 2, include all parts of a complete essay question. Each instruction must be a specific task, not a topic label. Never require citations, external research or invented statistics.
- SPEAKING payload: {"items":[{"question":"...","cue":"...","sample":"...","sampleVi":"..."}]}. Make exactly 30 natural examiner-style questions with concise cues and spoken model answers.
- Output ONLY this JSON object, no markdown:
{"lessons":[{"title":"...","blurb":"...","kind":"VOCAB|PARAPHRASE|READING|WRITING|SPEAKING","payload":{}}]}`,
    },
    {
      role: 'user',
      content: `Candidate band: ${input.band.toFixed(1)} (${LEARN_BAND_LABELS[input.band]})\nLocal day: ${input.day}\nCreate exactly these six lessons in this order:\n${lessonBrief}`,
    },
  ];
}

export interface PersonalLessonInput {
  band: LearnBand;
  /** Words the learner has recently missed. */
  missed: Array<{ term: string; meaning: string; meaningVi: string; example: string }>;
}

/**
 * A revision lesson built from what this one learner keeps getting wrong.
 *
 * This is the only lesson generation aimed at a single person, which is why it
 * gets its own prompt: the words are already known, so the job is not to choose
 * them but to make them stick, in the learner's own weak spots.
 */
export function buildPersonalLessonMessages(input: PersonalLessonInput): ChatMessageInput[] {
  const words = input.missed
    .slice(0, 8)
    .map((word) => `- ${word.term} (${word.meaning} / ${word.meaningVi}) e.g. ${word.example}`)
    .join('\n');
  return [
    {
      role: 'system',
      content: `TASK_KIND: PERSONAL_REVISION
${SHARED_RULES}

PERSONAL REVISION RULES
- Write exactly ONE lesson that revises the words listed below. The learner has already met them and got them wrong.
- Do not add words that are not on the list.
- Six items, each a sentence the learner must complete or restate using one of the listed words.
- "instruction" is Vietnamese and names the word to use.
- "model" is the English sentence, at most 18 words, containing that word exactly.
- "hint" is a short Vietnamese nudge, never the answer.

OUTPUT
Output ONLY this JSON object:
{"lesson":{"title":"...","blurb":"...","items":[{"instruction":"...","model":"...","hint":"..."}]}}`,
    },
    {
      role: 'user',
      content: `Band: ${input.band.toFixed(1)} (${LEARN_BAND_LABELS[input.band]})
Words this learner keeps missing:
${words}`,
    },
  ];
}
