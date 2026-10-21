/** #5 + #9 payload shared by the API and the analytics page. */
import type { EstimateSkill } from './bands';
import type { BandPoint } from './projection';
import type { QuestionTime } from './time-analysis';

export interface SkillHistory {
  skill: EstimateSkill;
  points: BandPoint[];
}

export interface AttemptTimeSummary {
  attemptId: string;
  testType: string;
  title: string;
  submittedAt: string | null;
  answered: number;
  unanswered: number;
  averageSeconds: number;
  correctAverage: number | null;
  incorrectAverage: number | null;
  slowest: QuestionTime[];
}

export interface StudentInsights {
  history: SkillHistory[];
  time: {
    attempts: AttemptTimeSummary[];
    overall: {
      attempts: number;
      answered: number;
      averageSeconds: number;
      /** True when there is enough data to compare correct/incorrect. */
      hasAccuracySignal: boolean;
      correctAverage: number | null;
      incorrectAverage: number | null;
    };
    /** Plain-language description of how the numbers are estimated. */
    method: string;
  };
}
