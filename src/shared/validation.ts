/**
 * Deterministic content validation.
 *
 * Used by:
 *  - the publish gate in the admin API,
 *  - the import pipeline (after AI structuring, before admin review),
 *  - unit tests.
 *
 * Only deterministic, mechanical constraints are checked here. Anything that
 * needs judgement (is this distractor plausible?) remains an admin review task.
 */
import { isQuestionType, QUESTION_TYPE_META, type QuestionType } from './question-types';
import { isValidAnswerKeyShape, type AnswerKey } from './answer-key';
import { isSectionType, type SectionPolicy, type SectionType } from './sections';
import type { Skill } from './types';

export type ValidationLevel = 'ERROR' | 'WARNING';

export interface ValidationIssue {
  level: ValidationLevel;
  code: string;
  message: string;
  /** Where the problem lives, for the admin UI. */
  sectionId?: string | null;
  groupId?: string | null;
  questionNumber?: number | null;
}

export interface ValidationParagraph {
  label: string;
  text: string;
}

export interface ValidationPassage {
  paragraphs: ValidationParagraph[];
  /** Word count declared by the source (an import file, for example). Never trusted. */
  declaredWordCount?: number | null;
}

export interface ValidationQuestion {
  id: string;
  number: number;
  prompt: string;
  /** Candidate-visible extra body text (summary / table / flow-chart blocks). */
  bodyText?: string | null;
  /** Server-only marking evidence. A quote must exist verbatim in the passage. */
  evidence?: string | null;
  options: Array<{ id: string; text: string }>;
  config: {
    wordLimit?: { min?: number; max?: number };
    selectCount?: number;
    note?: string;
    optionNumbering?: 'roman' | 'alpha' | 'numeric';
    minimumWords?: number;
  };
  answerKey?: AnswerKey | null;
}

export interface ValidationGroup {
  id: string;
  type: string;
  instructions: string;
  sharedOptions: Array<{ id: string; text: string }>;
  rangeFrom?: number | null;
  rangeTo?: number | null;
  questions: ValidationQuestion[];
  /** Candidate-visible body blocks (summary text, table rows). */
  bodyTexts?: string[];
}

export interface ValidationSection {
  id: string;
  skill: Skill;
  orderIndex: number;
  /** Normalised structural type (READING_PASSAGE | LISTENING_PART | WRITING_TASK). */
  type?: SectionType | string | null;
  label?: string | null;
  title: string;
  instructions: string;
  hasPassage: boolean;
  passageParagraphCount: number;
  /** Present when the section has a passage; enables paragraph-level checks. */
  passage?: ValidationPassage | null;
  hasAudio: boolean;
  /** Candidate-visible prompt of a writing task section (null otherwise). */
  promptText?: string | null;
  /** Configured minimum word count of a writing task (null when undeclared). */
  minimumWords?: number | null;
  /** Segment ids of the section transcript, when present. */
  transcript?: { segments: Array<{ id: string; text: string }> } | null;
  groups: ValidationGroup[];
}

export interface ValidationInput {
  testType: 'READING' | 'LISTENING' | 'WRITING' | 'FULL_MOCK';
  title: string;
  sections: ValidationSection[];
  /** For FULL_MOCK versions: referenced component versions must be published. */
  mockComponentIssues?: ValidationIssue[];
  config?: { skillConfig?: Record<string, { durationSeconds?: number } | undefined> };
  /** 34/39: section navigation and requirement policy (audio/passage gating). */
  sectionPolicy?: Partial<SectionPolicy>;
  /** 33: question groups found in the payload but not attached to any section. */
  orphanGroups?: Array<{ id: string; questionType?: string | null }>;
}

/** Extracts `segment:ID` references from an evidence string. */
function transcriptSegmentReferences(evidence: string): string[] {
  return [...evidence.matchAll(/segment:([\w:-]+)/g)].map((match) => match[1] ?? '').filter(Boolean);
}

const WORD_LIMIT_PATTERN =
  /\b(ONE|TWO|THREE|FOUR|A|AN|NO MORE THAN)\s+(WORD|WORDS|NUMBER|NUMBERS)\b/i;

export function parseWordLimitFromInstructions(instructions: string): { min?: number; max?: number } | null {
  if (!WORD_LIMIT_PATTERN.test(instructions)) return null;
  const words: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, A: 1, AN: 1 };
  const upper = instructions.toUpperCase();
  if (/NO MORE THAN\s+(\w+)/.test(upper)) {
    const match = upper.match(/NO MORE THAN\s+(ONE|TWO|THREE|FOUR|\d+)/);
    if (match?.[1]) {
      const token = match[1];
      const max = /^\d+$/.test(token) ? Number(token) : (words[token] ?? undefined);
      return max ? { max } : null;
    }
  }
  const exact = upper.match(/\b(ONE|TWO|THREE|FOUR|\d+)\s+(?:WORD|WORDS|NUMBER|NUMBERS)\b/);
  if (exact?.[1]) {
    const token = exact[1];
    const value = /^\d+$/.test(token) ? Number(token) : (words[token] ?? undefined);
    // "ONE WORD AND/OR A NUMBER" allows one word or one number: max = 1 token.
    return value ? { min: 1, max: value } : null;
  }
  return null;
}

export function validateTestVersion(input: ValidationInput): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!input.title || input.title.trim().length < 3) {
    issues.push({ level: 'ERROR', code: 'MISSING_TEST_TITLE', message: 'The test needs a title of at least 3 characters.' });
  }

  if (input.testType !== 'FULL_MOCK' && input.sections.length === 0) {
    issues.push({ level: 'ERROR', code: 'NO_SECTIONS', message: 'The test has no sections.' });
  }

  if (input.mockComponentIssues?.length) {
    issues.push(...input.mockComponentIssues);
  }

  // ---- section structure (33) ---------------------------------------------
  issues.push(...validateSectionStructure(input));

  const skillBefore: Record<string, number> = {};
  let previousSkill: Skill | null = null;

  for (const section of input.sections) {
    const skillsBefore = skillBefore[section.skill] ?? 0;
    if (skillsBefore > 0) {
      issues.push({
        level: 'WARNING',
        code: 'SKILL_SECTIONS_NOT_CONTIGUOUS',
        message: `Sections for ${section.skill} are not contiguous; candidates would switch skills more than once.`,
        sectionId: section.id,
      });
    }
    skillBefore[section.skill] = skillsBefore + 1;
    previousSkill = section.skill;

    if (section.skill === 'READING') {
      if (!section.hasPassage && input.sectionPolicy?.requirePassageForReading !== false) {
        issues.push({
          level: 'ERROR',
          code: 'READING_SECTION_WITHOUT_PASSAGE',
          message: `Reading section "${section.title || section.id}" has no passage attached.`,
          sectionId: section.id,
        });
      } else if (section.passageParagraphCount === 0 && section.hasPassage) {
        issues.push({
          level: 'WARNING',
          code: 'PASSAGE_WITHOUT_PARAGRAPHS',
          message: `Passage for "${section.title || section.id}" contains no labelled paragraphs.`,
          sectionId: section.id,
        });
      }
    }
    if (section.skill === 'LISTENING' && !section.hasAudio && input.sectionPolicy?.requireAudioForListening !== false) {
      issues.push({
        level: 'ERROR',
        code: 'LISTENING_SECTION_WITHOUT_AUDIO',
        message: `Listening section "${section.title || section.id}" has no audio asset attached.`,
        sectionId: section.id,
      });
    }
    if (section.skill === 'WRITING' && !(section.promptText ?? '').trim()) {
      issues.push({
        level: 'ERROR',
        code: 'WRITING_TASK_WITHOUT_PROMPT',
        message: `Writing task "${section.title || section.id}" has no prompt. Add task instructions or a task question.`,
        sectionId: section.id,
      });
    }
    if (section.skill === 'WRITING' && (section.minimumWords ?? 0) > 2000) {
      issues.push({
        level: 'WARNING',
        code: 'WRITING_MINIMUM_WORDS_UNREALISTIC',
        message: `Writing task "${section.title || section.id}" declares a minimum of ${section.minimumWords} words.`,
        sectionId: section.id,
      });
    }

    // ---- transcript hygiene (33) --------------------------------------------
    issues.push(...validateTranscript(section));

    // ---- passage hygiene (imports frequently get this wrong) ----------------
    if (section.passage && section.passage.paragraphs.length > 0) {
      issues.push(...validatePassage(section));
    }

    if (section.groups.length === 0) {
      issues.push({
        level: 'ERROR',
        code: 'SECTION_WITHOUT_QUESTION_GROUPS',
        message: `Section "${section.title || section.id}" has no question groups.`,
        sectionId: section.id,
      });
    }

    let previousGroupRange: { from: number; to: number } | null = null;
    let previousRangeEnd: number | null = null;
    for (const group of section.groups) {
      if (!isQuestionType(group.type)) {
        issues.push({
          level: 'ERROR',
          code: 'INVALID_QUESTION_TYPE',
          message: `Unknown question type "${group.type}".`,
          sectionId: section.id,
          groupId: group.id,
        });
        continue;
      }
      const meta = QUESTION_TYPE_META[group.type as QuestionType];

      if (!meta.skills.includes(section.skill)) {
        issues.push({
          level: 'ERROR',
          code: 'QUESTION_TYPE_SKILL_MISMATCH',
          message: `Question type ${meta.label} cannot be used in a ${section.skill} section.`,
          sectionId: section.id,
          groupId: group.id,
        });
      }

      if (!group.instructions.trim()) {
        issues.push({
          level: 'WARNING',
          code: 'GROUP_WITHOUT_INSTRUCTIONS',
          message: 'A question group has no instructions; the default wording will be used.',
          sectionId: section.id,
          groupId: group.id,
        });
      }

      if (group.questions.length === 0) {
        issues.push({
          level: 'ERROR',
          code: 'EMPTY_QUESTION_GROUP',
          message: 'A question group contains no questions.',
          sectionId: section.id,
          groupId: group.id,
        });
        continue;
      }

      if (meta.needsSharedOptions && group.sharedOptions.length < 2) {
        issues.push({
          level: 'ERROR',
          code: 'MISSING_SHARED_OPTIONS',
          message: `${meta.label} requires an option bank of at least two entries.`,
          sectionId: section.id,
          groupId: group.id,
        });
      }

      const optionIds = group.sharedOptions.map((o) => o.id.trim()).filter(Boolean);
      if (optionIds.length !== group.sharedOptions.length) {
        issues.push({
          level: 'ERROR',
          code: 'EMPTY_SHARED_OPTION_ID',
          message: 'An option bank entry is missing its identifier (heading number or letter).',
          sectionId: section.id,
          groupId: group.id,
        });
      }
      const duplicateOption = findDuplicate(optionIds);
      if (duplicateOption) {
        issues.push({
          level: 'ERROR',
          code: 'DUPLICATE_SHARED_OPTION',
          message: `Option identifier "${duplicateOption}" is used twice in the same option bank.`,
          sectionId: section.id,
          groupId: group.id,
        });
      }

      // ---- declared range sanity -----------------------------------------
      const declaredFrom = group.rangeFrom ?? null;
      const declaredTo = group.rangeTo ?? null;
      if (declaredFrom !== null && declaredTo !== null) {
        if (declaredFrom < 1 || declaredTo < 1 || declaredTo < declaredFrom) {
          issues.push({
            level: 'ERROR',
            code: 'MALFORMED_RANGE',
            message: `Group range ${declaredFrom}–${declaredTo} is not a valid question range.`,
            sectionId: section.id,
            groupId: group.id,
          });
        } else if (previousRangeEnd !== null && declaredFrom <= previousRangeEnd) {
          issues.push({
            level: 'WARNING',
            code: 'OVERLAPPING_RANGE',
            message: `Group range ${declaredFrom}–${declaredTo} overlaps the previous group (which ends at ${previousRangeEnd}).`,
            sectionId: section.id,
            groupId: group.id,
          });
        }
      }

      // ---- student-visible text must never contain answer material --------
      issues.push(...findLeakedAnswerFields(section.id, group));

      const numbers = group.questions.map((q) => q.number);
      const expectedFrom = numbers[0] ?? 0;
      const expectedTo = numbers[numbers.length - 1] ?? 0;
      if (group.rangeFrom !== null && group.rangeFrom !== undefined && group.rangeFrom !== expectedFrom) {
        issues.push({
          level: 'WARNING',
          code: 'GROUP_RANGE_MISMATCH',
          message: `Group states questions ${group.rangeFrom}–${group.rangeTo ?? '?'} but its first question is ${expectedFrom}.`,
          sectionId: section.id,
          groupId: group.id,
        });
      }
      if (previousGroupRange && expectedFrom !== previousGroupRange.to + 1) {
        if (expectedFrom > previousGroupRange.to + 1) {
          issues.push({
            level: 'ERROR',
            code: 'MISSING_QUESTION_NUMBERS',
            message: `Questions ${previousGroupRange.to + 1}–${expectedFrom - 1} are missing before this group.`,
            sectionId: section.id,
            groupId: group.id,
          });
        }
      }
      previousGroupRange = { from: expectedFrom, to: expectedTo };
      const declaredEnd = group.rangeTo ?? null;
      previousRangeEnd = declaredEnd !== null ? Math.max(declaredEnd, expectedTo) : expectedTo;

      for (const question of group.questions) {
        issues.push(
          ...validateQuestion(section, group, question, group.type as QuestionType),
        );
      }
    }

    const allNumbers = section.groups.flatMap((g) => g.questions.map((q) => q.number)).sort((a, b) => a - b);
    const duplicateNumber = findDuplicate(allNumbers.map(String));
    if (duplicateNumber) {
      issues.push({
        level: 'ERROR',
        code: 'DUPLICATE_QUESTION_NUMBER',
        message: `Question number ${duplicateNumber} appears more than once in this section.`,
        sectionId: section.id,
      });
    }
    // The same number must not belong to two different groups of one section.
    const numberOwner = new Map<number, string>();
    for (const group of section.groups) {
      for (const question of group.questions) {
        const owner = numberOwner.get(question.number);
        if (owner !== undefined && owner !== group.id) {
          issues.push({
            level: 'ERROR',
            code: 'OVERLAPPING_GROUP_RANGES',
            message: `Question ${question.number} appears in two question groups of this section.`,
            sectionId: section.id,
            groupId: group.id,
            questionNumber: question.number,
          });
        }
        numberOwner.set(question.number, group.id);
      }
    }
    for (let i = 1; i < allNumbers.length; i += 1) {
      const current = allNumbers[i]!;
      const previous = allNumbers[i - 1]!;
      if (current === previous + 2) {
        issues.push({
          level: 'ERROR',
          code: 'MISSING_QUESTION_NUMBER',
          message: `Question number ${previous + 1} is missing from this section.`,
          sectionId: section.id,
        });
      }
    }
    if (allNumbers.length > 0 && allNumbers[0] !== 1) {
      issues.push({
        level: 'WARNING',
        code: 'SECTION_NOT_STARTING_AT_ONE',
        message: 'This section does not start at question 1. That is valid for multi-part tests but unusual for a single-skill test.',
        sectionId: section.id,
      });
    }
  }

  // ---- section order vs question order (33) --------------------------------
  issues.push(...validateSectionQuestionOrder(input.sections));

  void previousSkill;
  return issues;
}

/**
 * Structural section checks (33): duplicate ids, duplicate or missing order,
 * invalid types and question groups that are not attached to any section.
 */
function validateSectionStructure(input: ValidationInput): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const idSeen = new Set<string>();
  const orderSeen = new Set<string>();
  for (const section of input.sections) {
    if (idSeen.has(section.id)) {
      issues.push({
        level: 'ERROR',
        code: 'DUPLICATE_SECTION_ID',
        message: `Section id "${section.id}" is used by more than one section.`,
        sectionId: section.id,
      });
    }
    idSeen.add(section.id);

    if (!Number.isInteger(section.orderIndex) || section.orderIndex < 0) {
      issues.push({
        level: 'ERROR',
        code: 'MISSING_SECTION_ORDER',
        message: `Section "${section.title || section.id}" has no valid order. Every section needs a distinct, non-negative order.`,
        sectionId: section.id,
      });
    } else if (orderSeen.has(String(section.orderIndex))) {
      issues.push({
        level: 'ERROR',
        code: 'DUPLICATE_SECTION_ORDER',
        message: `Two or more sections declare order ${section.orderIndex}. Give every section a distinct order.`,
        sectionId: section.id,
      });
    }
    orderSeen.add(String(section.orderIndex));

    if (section.type != null && String(section.type).trim() !== '' && !isSectionType(String(section.type))) {
      issues.push({
        level: 'ERROR',
        code: 'INVALID_SECTION_TYPE',
        message: `Section "${section.title || section.id}" has an unknown type "${section.type}" (use READING_PASSAGE, LISTENING_PART or WRITING_TASK).`,
        sectionId: section.id,
      });
    }
  }

  for (const orphan of input.orphanGroups ?? []) {
    issues.push({
      level: 'ERROR',
      code: 'ORPHAN_QUESTION_GROUP',
      message: `Question group ${orphan.questionType ? `"${orphan.questionType}" ` : ''}(${orphan.id}) is not attached to any section. Move it inside a section or remove it.`,
      groupId: orphan.id,
    });
  }

  return issues;
}

/**
 * Section order must be consistent with question order (33): within a skill,
 * question numbers must not run backwards as the section order increases.
 */
function validateSectionQuestionOrder(sections: ValidationSection[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const lastNumberBySkill = new Map<string, { number: number; sectionId: string; title: string }>();
  for (const section of sections) {
    const numbers = section.groups
      .flatMap((group) => group.questions.map((question) => question.number))
      .sort((a, b) => a - b);
    if (numbers.length === 0) continue;
    const first = numbers[0]!;
    const previous = lastNumberBySkill.get(section.skill);
    if (previous && first <= previous.number) {
      issues.push({
        level: 'ERROR',
        code: 'SECTION_QUESTION_ORDER_CONFLICT',
        message: `Section "${section.title || section.id}" starts at question ${first}, but the previous ${section.skill.toLowerCase()} section "${previous.title}" already used numbers up to ${previous.number}. Renumber so questions follow section order.`,
        sectionId: section.id,
      });
    }
    lastNumberBySkill.set(section.skill, { number: numbers[numbers.length - 1]!, sectionId: section.id, title: section.title || section.id });
  }
  return issues;
}

/**
 * Transcript checks (33): unique non-empty segment ids and evidence that
 * references segments via `segment:ID` must point at a real segment.
 */
function validateTranscript(section: ValidationSection): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const transcript = section.transcript;

  const segmentIds = new Set<string>();
  if (transcript) {
    for (const segment of transcript.segments) {
      const id = (segment.id ?? '').trim();
      if (!id) {
        issues.push({
          level: 'ERROR',
          code: 'TRANSCRIPT_SEGMENT_WITHOUT_ID',
          message: `Transcript of "${section.title || section.id}" contains a segment without an id.`,
          sectionId: section.id,
        });
        continue;
      }
      if (segmentIds.has(id)) {
        issues.push({
          level: 'ERROR',
          code: 'DUPLICATE_TRANSCRIPT_SEGMENT',
          message: `Transcript of "${section.title || section.id}" uses segment id "${id}" twice.`,
          sectionId: section.id,
        });
      }
      segmentIds.add(id);
      if (!(segment.text ?? '').trim()) {
        issues.push({
          level: 'WARNING',
          code: 'TRANSCRIPT_SEGMENT_WITHOUT_TEXT',
          message: `Transcript segment "${id}" has no text.`,
          sectionId: section.id,
        });
      }
    }
  }

  for (const group of section.groups) {
    for (const question of group.questions) {
      const evidence = question.evidence ?? '';
      if (!evidence.includes('segment:')) continue;
      if (!transcript) {
        issues.push({
          level: 'ERROR',
          code: 'TRANSCRIPT_SEGMENT_NOT_FOUND',
          message: `Evidence for question ${question.number} references a transcript segment, but "${section.title || section.id}" has no transcript.`,
          sectionId: section.id,
          groupId: group.id,
          questionNumber: question.number,
        });
        continue;
      }
      for (const reference of transcriptSegmentReferences(evidence)) {
        if (!segmentIds.has(reference)) {
          issues.push({
            level: 'ERROR',
            code: 'TRANSCRIPT_SEGMENT_NOT_FOUND',
            message: `Evidence for question ${question.number} references transcript segment "${reference}", which does not exist in "${section.title || section.id}".`,
            sectionId: section.id,
            groupId: group.id,
            questionNumber: question.number,
          });
        }
      }
    }
  }

  return issues;
}

/**
 * Paragraph-level checks for imported passages.
 *
 * Duplicated or missing labels make matching questions unanswerable, and a
 * declared word count that disagrees with the text means the source (often an
 * AI provider) invented a number. The count is always recomputed server-side;
 * a mismatch is reported so an admin can sanity-check the import.
 */
function validatePassage(section: ValidationSection): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const paragraphs = section.passage?.paragraphs ?? [];
  const labels: string[] = [];
  const seenText = new Map<string, string>();

  for (const paragraph of paragraphs) {
    const label = (paragraph.label ?? '').trim();
    const text = (paragraph.text ?? '').trim();
    if (!text) {
      issues.push({
        level: 'WARNING',
        code: 'EMPTY_PARAGRAPH',
        message: `Paragraph ${label || '(unlabelled)'} is empty.`,
        sectionId: section.id,
      });
      continue;
    }
    if (!label) {
      issues.push({
        level: 'WARNING',
        code: 'PARAGRAPH_WITHOUT_LABEL',
        message: 'A passage paragraph has no label, so it cannot be referenced by a matching question.',
        sectionId: section.id,
      });
    } else {
      labels.push(label);
    }
    const key = text.toLowerCase();
    const previousLabel = seenText.get(key);
    if (previousLabel !== undefined) {
      issues.push({
        level: 'ERROR',
        code: 'DUPLICATE_PARAGRAPH_TEXT',
        message: `Paragraphs ${previousLabel} and ${label || '(unlabelled)'} contain exactly the same text.`,
        sectionId: section.id,
      });
    } else {
      seenText.set(key, label || '(unlabelled)');
    }
  }

  const duplicateLabel = findDuplicate(labels);
  if (duplicateLabel) {
    issues.push({
      level: 'ERROR',
      code: 'DUPLICATE_PARAGRAPH_LABEL',
      message: `Paragraph label "${duplicateLabel}" is used more than once; matching questions become ambiguous.`,
      sectionId: section.id,
    });
  }

  const computed = countWords(paragraphs.map((paragraph) => paragraph.text ?? '').join(' '));
  const declared = section.passage?.declaredWordCount ?? null;
  if (declared !== null && declared !== undefined && declared > 0) {
    const difference = Math.abs(declared - computed);
    if (difference > Math.max(5, Math.round(computed * 0.02))) {
      issues.push({
        level: 'WARNING',
        code: 'PASSAGE_WORD_COUNT_MISMATCH',
        message: `The source declares ${declared} words but the passage contains ${computed}. The stored count uses the text, not the declaration.`,
        sectionId: section.id,
      });
    }
  }
  if (section.skill === 'READING' && computed > 0 && computed < 120) {
    issues.push({
      level: 'WARNING',
      code: 'PASSAGE_VERY_SHORT',
      message: `The passage is ${computed} words long, which is short for Reading practice.`,
      sectionId: section.id,
    });
  }

  return issues;
}

/** Word counting used for passages; deliberately simple and deterministic. */
export function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((token) => /[A-Za-z0-9]/.test(token)).length;
}

const ANSWER_LEAK_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  // JSON-ish or YAML-ish keys, with or without quotes: {"answer": "B"}, answer: B
  { pattern: /(?:^|[\s"'[{,])["']?answer(?:key|s)?["']?\s*:/i, label: 'answer' },
  { pattern: /(?:^|[\s"'[{,])["']?correct(?:answer|option|choice)?["']?\s*:/i, label: 'correct answer' },
  { pattern: /(?:^|[\s"'[{,])["']?solutions?["']?\s*:/i, label: 'solution' },
  { pattern: /\[(?:ANSWER|KEY|SOLUTION)\b/i, label: 'answer marker' },
];

/**
 * Detects answer material that leaked into student-visible text.
 *
 * A candidate payload must never carry keys or explanations. Imports (and
 * hand-authored JSON) sometimes nest an `answer` field inside a passage or a
 * question body by mistake, so this scans the text a candidate would see.
 */
function findLeakedAnswerFields(sectionId: string, group: ValidationGroup): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const candidates: Array<{ text: string; where: string; questionNumber?: number }> = [
    { text: group.instructions, where: `the instructions of a ${group.type.replace(/_/g, ' ').toLowerCase()} group` },
    ...group.sharedOptions.map((option) => ({ text: option.text, where: `option ${option.id} of an option bank` })),
    ...(group.bodyTexts ?? []).map((text) => ({ text, where: 'a shared question body' })),
    ...group.questions.map((question) => ({
      text: `${question.prompt}\n${question.bodyText ?? ''}`,
      where: `the text of question ${question.number}`,
      questionNumber: question.number,
    })),
  ];

  for (const candidate of candidates) {
    for (const { pattern, label } of ANSWER_LEAK_PATTERNS) {
      if (pattern.test(candidate.text)) {
        issues.push({
          level: 'ERROR',
          code: 'LEAKED_ANSWER_FIELD',
          message: `Possible ${label} leaked into student-visible content in ${candidate.where}. Answer material belongs in the answer key, not in the question text.`,
          sectionId,
          groupId: group.id,
          questionNumber: candidate.questionNumber ?? null,
        });
        break;
      }
    }
  }

  return issues;
}

/**
 * Marking evidence that claims to quote the passage must actually quote it.
 *
 * Only explicit quotations are checked (`"…"`, `“…”`, `‘…’`, `'…'`) or text
 * introduced with a `quote:` label, because evidence is also used for free-form
 * marking notes that are not supposed to be literal extracts. Anything that is
 * presented as a quotation must exist in the passage it refers to.
 */
function validateEvidence(
  section: ValidationSection,
  group: ValidationGroup,
  question: ValidationQuestion,
  base: Record<string, unknown>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const evidence = (question.evidence ?? '').trim();
  if (!evidence) return issues;

  if (/^\s*[[{]/.test(evidence)) {
    issues.push({
      level: 'ERROR',
      code: 'MALFORMED_EVIDENCE',
      message: `Evidence for question ${question.number} looks like raw JSON. Provide the quoted sentence or a short text reference.`,
      ...base,
    });
    return issues;
  }

  const paragraphs = section.passage?.paragraphs ?? [];
  if (paragraphs.length === 0) return issues;

  const quotes = extractQuotations(evidence);
  if (quotes.length === 0) return issues;

  const normalise = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();
  const haystack = normalise(paragraphs.map((paragraph) => paragraph.text ?? '').join(' '));

  for (const quote of quotes) {
    const needle = normalise(quote);
    if (needle.length >= 12 && !haystack.includes(needle)) {
      issues.push({
        level: 'ERROR',
        code: 'EVIDENCE_QUOTE_NOT_FOUND',
        message: `The evidence quoted for question ${question.number} does not appear verbatim in the passage (“${quote.slice(0, 60)}${quote.length > 60 ? '…' : ''}”).`,
        ...base,
      });
      break;
    }
  }

  void group;
  return issues;
}

/** Pulls the quotations out of an evidence string (`"…"`, `“…”`, `‘…’`, `'…'`). */
function extractQuotations(evidence: string): string[] {
  const quotes: string[] = [];
  for (const match of evidence.matchAll(/["“]([^"”]{12,})["”]/g)) {
    if (match[1]) quotes.push(match[1]);
  }
  for (const match of evidence.matchAll(/['‘]([^'’]{12,})['’]/g)) {
    if (match[1]) quotes.push(match[1]);
  }
  return quotes;
}

function validateQuestion(
  section: ValidationSection,
  group: ValidationGroup,
  question: ValidationQuestion,
  type: QuestionType,
): ValidationIssue[] {
  const sectionId = section.id;
  const issues: ValidationIssue[] = [];
  const base = { sectionId, groupId: group.id, questionNumber: question.number };
  const meta = QUESTION_TYPE_META[type];

  // ---- word limits -------------------------------------------------------
  const limit = question.config?.wordLimit;
  if (limit) {
    const min = limit.min ?? null;
    const max = limit.max ?? null;
    if ((min !== null && min < 0) || (max !== null && max < 1) || (min !== null && max !== null && min > max)) {
      issues.push({
        level: 'ERROR',
        code: 'INVALID_WORD_LIMIT',
        message: `Question ${question.number} has an impossible word limit (${min ?? 0}–${max ?? '?'}).`,
        ...base,
      });
    } else if (max !== null && max > 2000) {
      issues.push({
        level: 'ERROR',
        code: 'INVALID_WORD_LIMIT',
        message: `Question ${question.number} allows ${max} words, which exceeds the supported maximum of 2000.`,
        ...base,
      });
    }
  }


  if (!question.prompt.trim() && meta.control !== 'ESSAY' && type !== 'MATCHING_HEADINGS') {
    issues.push({ level: 'ERROR', code: 'QUESTION_WITHOUT_PROMPT', message: `Question ${question.number} has no text.`, ...base });
  }

  if (type === 'MCQ_SINGLE' || type === 'MCQ_MULTI') {
    if (question.options.length < 2) {
      issues.push({
        level: 'ERROR',
        code: 'MCQ_WITHOUT_OPTIONS',
        message: `Question ${question.number} needs at least two options.`,
        ...base,
      });
    }
    if (type === 'MCQ_MULTI') {
      const count = question.config.selectCount ?? group.questions.length > 0 ? question.config.selectCount : undefined;
      if (!count || count < 2) {
        issues.push({
          level: 'ERROR',
          code: 'MCQ_MULTI_WITHOUT_SELECT_COUNT',
          message: `Question ${question.number} is a multiple-answer task but does not specify how many options to choose.`,
          ...base,
        });
      } else if (count > question.options.length) {
        issues.push({
          level: 'ERROR',
          code: 'MCQ_MULTI_SELECT_COUNT_TOO_LARGE',
          message: `Question ${question.number} asks for ${count} selections but only has ${question.options.length} options.`,
          ...base,
        });
      }
    }
    const optionIds = question.options.map((o) => o.id.trim());
    if (new Set(optionIds).size !== optionIds.length) {
      issues.push({
        level: 'ERROR',
        code: 'DUPLICATE_MCQ_OPTION',
        message: `Question ${question.number} repeats an option identifier.`,
        ...base,
      });
    }
  }

  if (question.answerKey) {
    if (!isValidAnswerKeyShape(question.answerKey)) {
      issues.push({
        level: 'ERROR',
        code: 'MALFORMED_ANSWER_KEY',
        message: `The stored answer for question ${question.number} is not a valid key.`,
        ...base,
      });
    } else if (question.answerKey.kind === 'CHOICE') {
      if (question.answerKey.values.length === 0) {
        issues.push({
          level: 'WARNING',
          code: 'EMPTY_ANSWER_KEY',
          message: `Question ${question.number} has an empty answer key and will be marked as a manual review item.`,
          ...base,
        });
      }
      const validIds =
        type === 'MCQ_SINGLE' || type === 'MCQ_MULTI'
          ? question.options.map((o) => o.id)
          : group.sharedOptions.map((o) => o.id);
      for (const value of question.answerKey.values) {
        if (validIds.length > 0 && !validIds.includes(value)) {
          issues.push({
            level: 'ERROR',
            code: 'ANSWER_NOT_AMONG_OPTIONS',
            message: `The answer key for question ${question.number} uses "${value}", which is not one of the available options.`,
            ...base,
          });
        }
      }
      if (type === 'MCQ_MULTI') {
        const expected = question.config.selectCount ?? question.answerKey.values.length;
        if (question.answerKey.values.length !== expected) {
          issues.push({
            level: 'ERROR',
            code: 'MCQ_MULTI_KEY_COUNT_MISMATCH',
            message: `Question ${question.number} asks for ${expected} selections but the answer key lists ${question.answerKey.values.length}.`,
            ...base,
          });
        }
      }
    } else if (question.answerKey.kind === 'TEXT') {
      if (question.answerKey.accept.length === 0) {
        issues.push({
          level: 'WARNING',
          code: 'EMPTY_ANSWER_KEY',
          message: `Question ${question.number} has no accepted answer variants yet.`,
          ...base,
        });
      }
      const limit = question.config.wordLimit?.max;
      if (limit) {
        for (const variant of question.answerKey.accept) {
          const words = variant.trim().split(/\s+/).filter(Boolean).length;
          if (words > limit) {
            issues.push({
              level: 'ERROR',
              code: 'ANSWER_EXCEEDS_WORD_LIMIT',
              message: `Accepted answer "${variant}" for question ${question.number} has ${words} words but the word limit is ${limit}.`,
              ...base,
            });
          }
        }
      }
    } else if (question.answerKey.kind === 'MANUAL' && type !== 'WRITING_TASK_1' && type !== 'WRITING_TASK_2') {
      issues.push({
        level: 'WARNING',
        code: 'MANUAL_KEY_ON_OBJECTIVE_QUESTION',
        message: `Question ${question.number} is an objective question but is marked as manually assessed.`,
        ...base,
      });
    }
  } else {
    issues.push({
      level: 'WARNING',
      code: 'MISSING_ANSWER_KEY',
      message: `Question ${question.number} has no answer key yet; publishing it would make it unmaskable.`,
      ...base,
    });
  }

  if (type === 'MCQ_SINGLE' || type === 'MCQ_MULTI') {
    const optionIds = (question.options.length > 0 ? question.options : group.sharedOptions).map((option) => option.id);
    if (question.answerKey?.kind === 'CHOICE' && optionIds.length > 0) {
      for (const value of question.answerKey.values) {
        if (!optionIds.includes(value)) {
          issues.push({
            level: 'ERROR',
            code: 'INVALID_ANSWER_VALUE',
            message: `Answer "${value}" for question ${question.number} is not one of its options (${optionIds.join(', ')}).`,
            ...base,
          });
        }
      }
    }
  }

  if (type === 'TRUE_FALSE_NOT_GIVEN' || type === 'YES_NO_NOT_GIVEN' || type === 'MATCHING_FEATURES') {
    const validIds = group.sharedOptions.length > 0
      ? group.sharedOptions.map((o) => o.id)
      : type === 'TRUE_FALSE_NOT_GIVEN'
        ? ['TRUE', 'FALSE', 'NOT_GIVEN']
        : type === 'YES_NO_NOT_GIVEN'
          ? ['YES', 'NO', 'NOT_GIVEN']
          : [];
    if (question.answerKey?.kind === 'CHOICE') {
      for (const value of question.answerKey.values) {
        if (!validIds.includes(value)) {
          issues.push({
            level: 'ERROR',
            code: 'INVALID_ANSWER_VALUE',
            message: `Answer "${value}" is not valid for question ${question.number} (expected one of ${validIds.join(', ')}).`,
            ...base,
          });
        }
      }
    }
  }

  if (meta.textAnswer) {
    const limit = question.config.wordLimit?.max ?? parseWordLimitFromInstructions(group.instructions)?.max;
    if (!limit) {
      issues.push({
        level: 'WARNING',
        code: 'MISSING_WORD_LIMIT',
        message: `Question ${question.number} has no word limit configured; marking will accept any length.`,
        ...base,
      });
    }
  }

  // Marking evidence that claims to quote the passage must actually quote it.
  issues.push(...validateEvidence(section, group, question, base));

  return issues;
}

function findDuplicate(values: string[]): string | null {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) return value;
    seen.add(value);
  }
  return null;
}

export function summariseIssues(issues: ValidationIssue[]): {
  errors: number;
  warnings: number;
  publishable: boolean;
} {
  const errors = issues.filter((i) => i.level === 'ERROR').length;
  const warnings = issues.filter((i) => i.level === 'WARNING').length;
  return { errors, warnings, publishable: errors === 0 };
}
