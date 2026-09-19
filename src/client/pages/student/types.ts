export interface SkillPerformance {
  skill: string;
  sessions: number;
  rawScore: number;
  totalQuestions: number;
  accuracy: number | null;
  averageBand: number | null;
  bestBand: number | null;
  latestBand: number | null;
  writingScores: number;
  averageWritingBand: number | null;
}

export interface TaskTypePerformance {
  questionType: string;
  label: string;
  answered: number;
  correct: number;
  accuracy: number | null;
}

export interface AttemptSummary {
  attemptId: string;
  testId: string;
  testTitle: string;
  testType: string;
  mode: string;
  status: string;
  versionNumber: number;
  startedAt: string;
  submittedAt: string | null;
  rawScore: number | null;
  totalQuestions: number | null;
  estimatedBand: number | null;
  durationSeconds: number | null;
  assignmentId: string | null;
  assignmentTitle: string | null;
  resultVisibility: string;
}

export interface TrendPoint {
  date: string;
  attemptId: string;
  testType: string;
  skills: Array<{ skill: string; rawScore: number; totalQuestions: number; band: number | null }>;
  rawScore: number | null;
  totalQuestions: number | null;
  estimatedBand: number | null;
}

export interface AssignmentSummary {
  assignmentId: string;
  classroomId: string;
  classroomName: string;
  title: string;
  instructions: string;
  testId: string;
  testTitle: string;
  testType: string;
  versionNumber: number;
  startAt: string | null;
  deadlineAt: string | null;
  maxAttempts: number;
  attemptsUsed: number;
  mode: string;
  timingPolicy: string;
  resultVisibility: string;
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'SUBMITTED' | 'OVERDUE';
  inProgressAttemptId: string | null;
  lastSubmittedAt: string | null;
  bestRawScore: number | null;
  bestTotalQuestions: number | null;
  bestBand: number | null;
}

export interface SectionPerformance {
  sectionId: string;
  label: string;
  title: string;
  skill: string;
  type: string;
  attempts: number;
  answered: number;
  correct: number;
  accuracy: number | null;
  unanswered: number;
  averageSeconds: number | null;
}

export interface StudentDashboard {
  assignments: AssignmentSummary[];
  upcomingDeadlines: AssignmentSummary[];
  recentAttempts: AttemptSummary[];
  skillPerformance: SkillPerformance[];
  sectionPerformance: SectionPerformance[];
  taskTypes: TaskTypePerformance[];
  trends: TrendPoint[];
  mockHistory: AttemptSummary[];
  practiceHistory: AttemptSummary[];
  totals: { attempts: number; submitted: number; inProgress: number; fullMocks: number };
}

export interface CatalogTest {
  id: string;
  slug: string;
  title: string;
  type: string;
  summary: string;
  contentOrigin: string;
  updatedAt: string;
  versionId: string;
  versionNumber: number;
  totalQuestions: number;
  durationSeconds: number | null;
  isCompleteTest: boolean;
  mockComponentCount: number;
  requiresAccessCode: boolean;
  unlocked: boolean;
  /** "3 passages • 40 questions • 60 min" — computed from the real content. */
  structure?: {
    passages: number;
    parts: number;
    tasks: number;
    questions: number;
    minutes: number | null;
    summaryLine: string;
  };
}
