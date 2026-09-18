/**
 * Candidate-visible test payload.
 *
 * This is the ONLY shape in which test content reaches a browser. It contains
 * no answer keys, no evidence and no explanations; those live server-side in
 * `answer_keys` and are only ever exposed through a result view that has passed
 * the release-policy check.
 */
import type { CandidateSection } from './question-types';
import type { TestType } from './types';

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
