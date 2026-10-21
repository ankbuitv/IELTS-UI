/**
 * #9 Time analytics.
 *
 * The platform stores when each answer was saved (`attempt_answers.answered_at`)
 * and how long each section ran. That is enough to see where the clock went
 * without tracking every keystroke: the gap between two saved answers is the
 * time spent on the later question. Gaps over five minutes (a break) and
 * sub-second gaps (a bulk save) are ignored, and the method is stated in the UI
 * so the numbers are read as estimates.
 */

export interface AnswerMoment {
  number: number;
  prompt: string;
  /** ISO timestamp when the answer was last saved; null when unanswered. */
  answeredAt: string | null;
  isCorrect: boolean | null;
}

export interface QuestionTime {
  number: number;
  prompt: string;
  seconds: number;
  isCorrect: boolean | null;
}

export interface TimeReport {
  perQuestion: QuestionTime[];
  /** Sum of attributed seconds, excluding ignored gaps. */
  totalSeconds: number;
  averageSeconds: number;
  /** Slowest questions, longest first. */
  slowest: QuestionTime[];
  /** Average seconds on correct vs incorrect questions (null when no data). */
  correctAverage: number | null;
  incorrectAverage: number | null;
  answered: number;
  unanswered: number;
}

const MAX_GAP_SECONDS = 300;
const MIN_GAP_SECONDS = 1;
const SLOWEST = 3;

export function summariseAnswerTimes(answers: AnswerMoment[], sectionStartAt?: string | null): TimeReport {
  const ordered = answers
    .slice()
    .sort((a, b) => {
      const left = a.answeredAt ? new Date(a.answeredAt).getTime() : Number.POSITIVE_INFINITY;
      const right = b.answeredAt ? new Date(b.answeredAt).getTime() : Number.POSITIVE_INFINITY;
      return left - right || a.number - b.number;
    });

  const start = sectionStartAt ? new Date(sectionStartAt).getTime() : Number.NaN;
  const perQuestion: QuestionTime[] = [];
  let cursor = Number.isFinite(start) ? start : null;

  for (const answer of ordered) {
    if (!answer.answeredAt) continue;
    const at = new Date(answer.answeredAt).getTime();
    if (!Number.isFinite(at)) continue;

    let seconds = 0;
    if (cursor !== null) {
      const gap = (at - cursor) / 1000;
      if (gap >= MIN_GAP_SECONDS && gap <= MAX_GAP_SECONDS) seconds = Math.round(gap);
    }
    cursor = Math.max(cursor ?? at, at);

    perQuestion.push({
      number: answer.number,
      prompt: answer.prompt.slice(0, 140),
      seconds,
      isCorrect: answer.isCorrect,
    });
  }

  const timed = perQuestion.filter((question) => question.seconds > 0);
  const totalSeconds = timed.reduce((total, question) => total + question.seconds, 0);
  const correct = timed.filter((question) => question.isCorrect === true);
  const incorrect = timed.filter((question) => question.isCorrect === false);
  const mean = (items: QuestionTime[]) =>
    items.length > 0 ? Math.round(items.reduce((total, item) => total + item.seconds, 0) / items.length) : null;

  return {
    perQuestion,
    totalSeconds,
    averageSeconds: timed.length > 0 ? Math.round(totalSeconds / timed.length) : 0,
    slowest: timed.slice().sort((a, b) => b.seconds - a.seconds).slice(0, SLOWEST),
    correctAverage: mean(correct),
    incorrectAverage: mean(incorrect),
    answered: perQuestion.length,
    unanswered: answers.filter((answer) => !answer.answeredAt).length,
  };
}
