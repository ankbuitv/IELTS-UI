/**
 * #6 Question-type drills.
 *
 * A drill is one question format, taken from published papers, with just enough
 * context to answer it (the passage or the listening transcript for its group).
 * Answers are graded server-side with the same answer-key code as a full paper.
 */
import type { QuestionType } from './question-types';

import type { CandidateResponse } from './answer-key';

export interface DrillTypeInfo {
  type: QuestionType;
  label: string;
  groups: number;
  questions: number;
  skill: 'READING' | 'LISTENING';
}

export interface DrillQuestion {
  id: string;
  number: number;
  prompt: string;
  options: Array<{ id: string; text: string }>;
  config: Record<string, unknown>;
}

export interface DrillGroup {
  id: string;
  type: QuestionType;
  instructions: string;
  sharedOptions: Array<{ id: string; text: string }>;
  config: Record<string, unknown>;
  contextTitle: string;
  contextText: string;
  audioUrl: string | null;
  questions: DrillQuestion[];
}

export interface DrillSession {
  id: string;
  type: QuestionType;
  groups: DrillGroup[];
  createdAt: string;
}

/** What the browser sends back: option id(s) or typed text. */
export interface DrillAnswer {
  value?: string;
  values?: string[];
}

export interface DrillQuestionResult {
  questionId: string;
  number: number;
  prompt: string;
  correct: boolean;
  candidateAnswer: string;
  correctAnswer: string;
  evidence: string | null;
  explanation: string | null;
}

/**
 * Payload accepted by `POST /api/student/drills/:id/submit`. Only answered
 * questions are sent: a blank response must not overwrite an earlier one with
 * an empty string, and the worker treats a missing key as unanswered.
 */
export type DrillSubmission = Record<string, { value?: string; values?: string[] }>;

/** Count questions that carry a usable answer. */
export function countAnsweredDrillQuestions(answers: Record<string, CandidateResponse | null>): number {
  return Object.values(answers).filter(isAnsweredDrillResponse).length;
}

/** A response counts only when it has non-whitespace text or a non-empty list. */
export function isAnsweredDrillResponse(answer: CandidateResponse | null | undefined): boolean {
  if (!answer) return false;
  if ('values' in answer) return Array.isArray(answer.values) && answer.values.length > 0;
  if ('value' in answer) return typeof answer.value === 'string' && answer.value.trim().length > 0;
  return false;
}

/** Convert client responses into the wire shape, dropping blanks. */
export function toDrillSubmission(answers: Record<string, CandidateResponse | null>): DrillSubmission {
  const payload: DrillSubmission = {};
  for (const [questionId, answer] of Object.entries(answers)) {
    if (!isAnsweredDrillResponse(answer) || !answer) continue;
    if ('values' in answer) payload[questionId] = { values: [...answer.values] };
    else payload[questionId] = { value: answer.value.trim() };
  }
  return payload;
}

export interface DrillResult {
  id: string;
  type: QuestionType;
  correct: number;
  total: number;
  questions: DrillQuestionResult[];
  submittedAt: string;
}
