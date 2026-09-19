/**
 * Candidate-visible test payload.
 *
 * This is the ONLY shape in which test content reaches a browser. It contains
 * no answer keys, no evidence and no explanations; those live server-side in
 * `answer_keys` and are only ever exposed through a result view that has passed
 * the release-policy check.
 */
import type { CandidateSection } from './question-types';
import type { Skill } from './types';
import type { TestType } from './types';

/** Server-tracked per-section attempt progress/timing, sent to the exam UI (38/39). */
export interface AttemptSectionState {
  sectionId: string;
  orderIndex: number;
  skill: Skill;
  label: string;
  title: string;
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'EXPIRED';
  durationSeconds: number | null;
  startedAt: string | null;
  deadlineAt: string | null;
  remainingSeconds: number | null;
  totalQuestions: number;
  answeredCount: number;
  flaggedCount: number;
}

export interface CandidateTestPayload {
  testId: string;
  versionId: string;
  versionNumber: number;
  title: string;
  type: TestType;
  summary: string;
  totalQuestions: number;
  durationSeconds: number | null;
  isCompleteTest: boolean;
  sections: CandidateSection[];
}

export interface CandidateQuestionReview {
  questionId: string;
  number: number;
  prompt: string;
  candidateAnswer: { value?: string; values?: string[] } | null;
  correctAnswer: string | null;
  isCorrect: boolean | null;
  points: number | null;
  pointsPossible: number;
  questionType: string;
  evidence: string | null;
  explanation: string | null;
}
