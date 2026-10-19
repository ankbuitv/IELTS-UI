import type { CandidateResponse } from '@shared/answer-key';

/** The minimum a question needs to take part in "is it answered?" checks. */
export interface CoverageQuestion {
  id: string;
  number: number;
}

/** True when an answer holds something a marker could score. */
export function responseHasContent(response: CandidateResponse | null | undefined): boolean {
  if (!response) return false;
  if ('values' in response) {
    return response.values.some((value) => String(value ?? '').trim().length > 0);
  }
  return String(response.value ?? '').trim().length > 0;
}

/**
 * Ids of questions that are still empty.
 *
 * Keyed by question id, never by number: imported papers sometimes restart
 * numbering inside a part, and two questions that are both "1" used to collapse
 * into one answered question — a candidate who filled everything was still told
 * some questions were missing. Writing tasks count only once they have text.
 */
export function missingQuestionIds(
  questions: CoverageQuestion[],
  input: {
    answers: Record<string, CandidateResponse | undefined>;
    writing: Record<string, string>;
    essayIds: Set<string>;
  },
): string[] {
  return questions
    .filter((question) => {
      if (input.essayIds.has(question.id)) return (input.writing[question.id] ?? '').trim().length === 0;
      return !responseHasContent(input.answers[question.id]);
    })
    .map((question) => question.id);
}
