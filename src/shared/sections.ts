/**
 * Section / Part vocabulary shared by the Worker and the browser (28–29).
 *
 * A section is a structural unit of a test version: a reading passage, a
 * listening part or a writing task. `type` gives "Part 1" structural meaning;
 * `label` is only its short display form. Nothing here contains answer
 * material.
 */
import type { Skill } from './types';

export const SECTION_TYPES = ['READING_PASSAGE', 'LISTENING_PART', 'WRITING_TASK'] as const;
export type SectionType = (typeof SECTION_TYPES)[number];

export interface SectionTypeMeta {
  type: SectionType;
  skill: Skill;
  /** Button / builder label, e.g. "Reading passage". */
  label: string;
  /** Default display label for the Nth section of this type ("Part 1"). */
  ordinalNoun: string;
}

export const SECTION_TYPE_META: Record<SectionType, SectionTypeMeta> = {
  READING_PASSAGE: {
    type: 'READING_PASSAGE',
    skill: 'READING',
    label: 'Reading passage',
    ordinalNoun: 'Passage',
  },
  LISTENING_PART: {
    type: 'LISTENING_PART',
    skill: 'LISTENING',
    label: 'Listening part',
    ordinalNoun: 'Part',
  },
  WRITING_TASK: {
    type: 'WRITING_TASK',
    skill: 'WRITING',
    label: 'Writing task',
    ordinalNoun: 'Task',
  },
};

export function isSectionType(value: string): value is SectionType {
  return (SECTION_TYPES as readonly string[]).includes(value);
}

/** snake_case / lowercase input forms are accepted in structured imports. */
export function normaliseSectionType(value: string | null | undefined): SectionType | null {
  if (!value) return null;
  const upper = value.trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (isSectionType(upper)) return upper;
  // Common aliases found in structured import payloads.
  const aliases: Record<string, SectionType> = {
    READING: 'READING_PASSAGE',
    READING_SECTION: 'READING_PASSAGE',
    PASSAGE: 'READING_PASSAGE',
    LISTENING: 'LISTENING_PART',
    LISTENING_SECTION: 'LISTENING_PART',
    PART: 'LISTENING_PART',
    WRITING: 'WRITING_TASK',
    TASK: 'WRITING_TASK',
    WRITING_SECTION: 'WRITING_TASK',
  };
  return aliases[upper] ?? null;
}

const SECTION_TYPE_BY_SKILL: Record<Skill, SectionType> = {
  READING: 'READING_PASSAGE',
  LISTENING: 'LISTENING_PART',
  WRITING: 'WRITING_TASK',
};

export function defaultSectionTypeForSkill(skill: Skill): SectionType {
  return SECTION_TYPE_BY_SKILL[skill];
}

export function sectionTypeMetaForSkill(skill: Skill): SectionTypeMeta {
  return SECTION_TYPE_META[defaultSectionTypeForSkill(skill)];
}

/**
 * The display label of a section. Falls back to a structural default
 * ("Passage 2") derived from the type and order, and finally to the title, so
 * legacy rows without an explicit label still render sensibly.
 */
export function sectionDisplayLabel(section: {
  label?: string | null;
  type?: string | null;
  skill?: Skill;
  orderIndex?: number;
  title?: string | null;
}): string {
  const explicit = section.label?.trim();
  if (explicit) return explicit;
  const type = section.type && isSectionType(section.type) ? section.type : section.skill ? defaultSectionTypeForSkill(section.skill) : null;
  if (type && typeof section.orderIndex === 'number') {
    const meta = SECTION_TYPE_META[type];
    return `${meta.ordinalNoun} ${section.orderIndex + 1}`;
  }
  return section.title?.trim() || 'Section';
}

// -----------------------------------------------------------------------------
// Listening transcripts (stored on the section, candidate-visible in review)
// -----------------------------------------------------------------------------
export interface TranscriptSegment {
  /** Stable id evidence can reference (`segment:ls1-03`). */
  id: string;
  /** Offset from the start of the recording, in seconds. */
  startSeconds: number | null;
  speaker: string | null;
  text: string;
}

export interface SectionTranscript {
  segments: TranscriptSegment[];
}

export function parseTranscript(value: string | null | undefined): SectionTranscript | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as SectionTranscript).segments)) {
      return parsed as SectionTranscript;
    }
    return null;
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------------------
// Section navigation / timing policy (34, 39) — configured per test version.
// ----------------------------------------------------------------------------
/**
 * How candidates may move between the sections/parts of one skill component:
 *  - FREE_NAVIGATION: any section at any time (reading practice default).
 *  - SEQUENTIAL_PARTS: parts advance in order; completed parts stay readable
 *    when `allowReturnToPreviousParts` is true (listening exam default).
 *  - LOCKED_PARTS: once a part is completed it can never be reopened.
 */
export const SECTION_NAVIGATION_MODES = ['FREE_NAVIGATION', 'SEQUENTIAL_PARTS', 'LOCKED_PARTS'] as const;
export type SectionNavigationMode = (typeof SECTION_NAVIGATION_MODES)[number];

export interface SectionPolicy {
  navigation: SectionNavigationMode;
  /** May candidates reopen earlier parts (only meaningful in sequential modes). */
  allowReturnToPreviousParts: boolean;
  /** Advance automatically to the next part when a part timer expires. */
  autoAdvanceOnPartTimeout: boolean;
  /** Whether listening parts require audio before the version may publish. */
  requireAudioForListening: boolean;
  /** Whether reading passages require a passage before publish. */
  requirePassageForReading: boolean;
}

export const DEFAULT_SECTION_POLICY: SectionPolicy = {
  navigation: 'FREE_NAVIGATION',
  allowReturnToPreviousParts: true,
  autoAdvanceOnPartTimeout: false,
  requireAudioForListening: true,
  requirePassageForReading: true,
};

/** Stored in `test_versions.config_json` under `sectionPolicy`. */
export function resolveSectionPolicy(raw: unknown): SectionPolicy {
  const source = (raw ?? {}) as Partial<SectionPolicy>;
  const navigation = source.navigation;
  const policy: SectionPolicy = {
    navigation:
      navigation && (SECTION_NAVIGATION_MODES as readonly string[]).includes(navigation)
        ? navigation
        : DEFAULT_SECTION_POLICY.navigation,
    allowReturnToPreviousParts:
      typeof source.allowReturnToPreviousParts === 'boolean'
        ? source.allowReturnToPreviousParts
        : DEFAULT_SECTION_POLICY.allowReturnToPreviousParts,
    autoAdvanceOnPartTimeout:
      typeof source.autoAdvanceOnPartTimeout === 'boolean'
        ? source.autoAdvanceOnPartTimeout
        : DEFAULT_SECTION_POLICY.autoAdvanceOnPartTimeout,
    requireAudioForListening:
      typeof source.requireAudioForListening === 'boolean'
        ? source.requireAudioForListening
        : DEFAULT_SECTION_POLICY.requireAudioForListening,
    requirePassageForReading:
      typeof source.requirePassageForReading === 'boolean'
        ? source.requirePassageForReading
        : DEFAULT_SECTION_POLICY.requirePassageForReading,
  };
  // LOCKED_PARTS implies no return; keep the two knobs consistent.
  if (policy.navigation === 'LOCKED_PARTS') policy.allowReturnToPreviousParts = false;
  return policy;
}

// -----------------------------------------------------------------------------
// Catalogue structure summary (42) — derived from real structured data
// -----------------------------------------------------------------------------
export interface TestStructureSummary {
  /** Number of sections with type READING_PASSAGE. */
  passages: number;
  /** Number of sections with type LISTENING_PART. */
  parts: number;
  /** Number of sections with type WRITING_TASK. */
  tasks: number;
  questions: number;
  minutes: number | null;
  /** "3 passages • 40 questions • 60 min" style line, computed never hardcoded. */
  summaryLine: string;
}

export function buildStructureSummary(input: {
  passages: number;
  parts: number;
  tasks: number;
  questions: number;
  durationSeconds: number | null;
}): TestStructureSummary {
  const minutes =
    input.durationSeconds !== null && input.durationSeconds !== undefined
      ? Math.max(1, Math.round(input.durationSeconds / 60))
      : null;
  const units: string[] = [];
  if (input.passages > 0) units.push(`${input.passages} passage${input.passages === 1 ? '' : 's'}`);
  if (input.parts > 0) units.push(`${input.parts} part${input.parts === 1 ? '' : 's'}`);
  if (input.tasks > 0) units.push(`${input.tasks} task${input.tasks === 1 ? '' : 's'}`);
  if (input.passages + input.parts + input.tasks === 0 && input.questions > 0) {
    units.push(`${input.questions} question${input.questions === 1 ? '' : 's'}`);
  }
  const parts = [...units, `${input.questions} question${input.questions === 1 ? '' : 's'}`];
  if (minutes !== null) parts.push(`~${minutes} min`);
  return {
    passages: input.passages,
    parts: input.parts,
    tasks: input.tasks,
    questions: input.questions,
    minutes,
    summaryLine: parts.join(' • '),
  };
}
