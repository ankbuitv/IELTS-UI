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

export interface ValidationQuestion {
  id: string;
  number: number;
  prompt: string;
  options: Array<{ id: string; text: string }>;
  config: {
    wordLimit?: { min?: number; max?: number };
    selectCount?: number;
    note?: string;
    optionNumbering?: 'roman' | 'alpha' | 'numeric';
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
}

export interface ValidationSection {
  id: string;
  skill: Skill;
  orderIndex: number;
  title: string;
  instructions: string;
  hasPassage: boolean;
  passageParagraphCount: number;
  hasAudio: boolean;
  groups: ValidationGroup[];
}

export interface ValidationInput {
  testType: 'READING' | 'LISTENING' | 'WRITING' | 'FULL_MOCK';
  title: string;
  sections: ValidationSection[];
  /** For FULL_MOCK versions: referenced component versions must be published. */
  mockComponentIssues?: ValidationIssue[];
  config?: { skillConfig?: Record<string, { durationSeconds?: number } | undefined> };
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
      if (!section.hasPassage) {
        issues.push({
          level: 'ERROR',
          code: 'READING_SECTION_WITHOUT_PASSAGE',
          message: `Reading section "${section.title || section.id}" has no passage attached.`,
          sectionId: section.id,
        });
      } else if (section.passageParagraphCount === 0) {
        issues.push({
          level: 'WARNING',
          code: 'PASSAGE_WITHOUT_PARAGRAPHS',
          message: `Passage for "${section.title || section.id}" contains no labelled paragraphs.`,
          sectionId: section.id,
        });
      }
    }
    if (section.skill === 'LISTENING' && !section.hasAudio) {
      issues.push({
        level: 'ERROR',
        code: 'LISTENING_SECTION_WITHOUT_AUDIO',
        message: `Listening section "${section.title || section.id}" has no audio asset attached.`,
        sectionId: section.id,
      });
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

      for (const question of group.questions) {
        issues.push(
          ...validateQuestion(section.id, group, question, group.type as QuestionType),
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

  void previousSkill;
  return issues;
}

function validateQuestion(
  sectionId: string,
  group: ValidationGroup,
  question: ValidationQuestion,
  type: QuestionType,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const base = { sectionId, groupId: group.id, questionNumber: question.number };
  const meta = QUESTION_TYPE_META[type];

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
