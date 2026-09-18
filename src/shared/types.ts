/**
 * Shared domain vocabulary used by both the Worker (authoritative) and the
 * React client. Nothing in this file may contain answer material: it is bundled
 * into the browser.
 */

export const ROLES = ['STUDENT', 'TEACHER', 'ADMIN'] as const;
export type Role = (typeof ROLES)[number];

export const TEST_TYPES = ['READING', 'LISTENING', 'WRITING', 'FULL_MOCK'] as const;
export type TestType = (typeof TEST_TYPES)[number];

export const SKILLS = ['READING', 'LISTENING', 'WRITING'] as const;
export type Skill = (typeof SKILLS)[number];

export const TEST_STATUSES = ['DRAFT', 'REVIEW', 'PUBLISHED', 'ARCHIVED'] as const;
export type TestStatus = (typeof TEST_STATUSES)[number];

export const EXAM_MODES = ['PRACTICE', 'STANDARD_EXAM', 'STRICT_EXAM'] as const;
export type ExamMode = (typeof EXAM_MODES)[number];

export const RESULT_VISIBILITIES = [
  'IMMEDIATE',
  'AFTER_DEADLINE',
  'SCORE_ONLY',
  'NO_REVIEW',
] as const;
export type ResultVisibility = (typeof RESULT_VISIBILITIES)[number];

export const TIMING_POLICIES = ['EXAM_DURATION', 'UNTIMED', 'CUSTOM'] as const;
export type TimingPolicy = (typeof TIMING_POLICIES)[number];

export const ATTEMPT_STATUSES = ['IN_PROGRESS', 'SUBMITTED', 'EXPIRED', 'ABANDONED'] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

export const CONTENT_ORIGINS = [
  'ORIGINAL',
  'LICENSED',
  'AI_GENERATED',
  'IMPORTED',
  'OFFICIAL_PROVIDER',
] as const;
export type ContentOrigin = (typeof CONTENT_ORIGINS)[number];

export const ASSIGNMENT_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'SUBMITTED', 'OVERDUE'] as const;
export type AssignmentProgressStatus = (typeof ASSIGNMENT_STATUSES)[number];

/** Keys stored in `test_versions.config_json`. */
export interface TestVersionConfig {
  /** Default mode offered when this test is started outside an assignment. */
  defaultMode?: ExamMode;
  /** Default result release policy for self-service practice attempts. */
  defaultResultVisibility?: ResultVisibility;
  /** Per-skill overrides, e.g. `{ READING: { durationSeconds: 3600 } }`. */
  skillConfig?: Partial<Record<Skill, { durationSeconds?: number; instructions?: string }>>;
  allowSelfService?: boolean;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
