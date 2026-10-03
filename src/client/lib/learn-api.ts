import { api, queryString } from './api';
import type {
  CatalogueResponse,
  DailyWordsResult,
  DictionaryEntry,
  LearnBand,
  LearnOverview,
  LearnProfile,
  LessonCompletionResult,
  LessonPlayPayload,
  LessonWord,
  PlanItemStatus,
  PlanItemView,
  PlanView,
} from '@shared/learn';

/** The learner's own calendar day (`YYYY-MM-DD`), so a streak follows their midnight. */
export function localDay(date: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export interface ReviewWord {
  id: string;
  term: string;
  pos: string;
  phonetic: string;
  meaning: string;
  meaningVi: string;
  example: string;
  level: number | null;
}

export interface ReviewCompletion {
  xpGained: number;
  reviewed: number;
  profile: LearnProfile;
  streak: number;
  streakIncreased: boolean;
  goalReached: boolean;
}

export const learnApi = {
  overview: () => api.get<LearnOverview>(`/api/learn/overview${queryString({ day: localDay() })}`),
  /** The path: every band summarised plus the lessons of one band. */
  catalogue: (band?: LearnBand) =>
    api.get<CatalogueResponse>(`/api/learn/catalogue${queryString(band === undefined ? {} : { band })}`),
  /** One lesson with the words the exercise engine builds it from. */
  lesson: (lessonId: string) => api.get<{ lesson: LessonPlayPayload }>(`/api/learn/lessons/${encodeURIComponent(lessonId)}`),
  dailyWords: (extra = false) => api.post<DailyWordsResult>('/api/learn/daily-words', { day: localDay(), ...(extra ? { extra: true } : {}) }),
  completeLesson: (input: { lessonId: string; correct: number; total: number; mistakes: string[] }) =>
    api.post<LessonCompletionResult>('/api/learn/lessons/complete', { ...input, day: localDay() }),
  /** The due words plus the wrong-option pool for them, both from the catalogue. */
  reviewWords: () => api.get<{ words: ReviewWord[]; pool: LessonWord[] }>('/api/learn/review'),
  completeReview: (results: Array<{ id: string; correct: boolean }>) =>
    api.post<ReviewCompletion>('/api/learn/review/complete', { results, day: localDay() }),
  setBand: (band: LearnBand) => api.put<{ ok: true }>('/api/learn/band', { band }),
  setGoal: (goalXp: number) => api.put<{ ok: true }>('/api/learn/goal', { goalXp }),
  /** The active study plan, or null when the learner has not built one. */
  plan: () => api.get<{ plan: PlanView | null }>(`/api/learn/plan${queryString({ day: localDay() })}`),
  /** Builds a plan and makes it the active one. */
  buildPlan: (input: { targetBand: LearnBand; examDay: string | null; minutesPerDay: number }) =>
    api.post<{ plan: PlanView }>(`/api/learn/plan${queryString({ day: localDay() })}`, input),
  setPlanItem: (id: string, status: PlanItemStatus) => api.post<{ item: PlanItemView }>(`/api/learn/plan/items/${encodeURIComponent(id)}`, { status }),
  personalLesson: () => api.get<{ lesson: { lessonId: string; title: string; createdAt: string; today: boolean } | null }>(
    `/api/learn/personal-lesson${queryString({ day: localDay() })}`,
  ),
  buildPersonalLesson: () => api.post<{ lessonId: string; title: string }>('/api/learn/personal-lesson', { day: localDay() }),
  lookup: (term: string) => api.get<{ entry: DictionaryEntry }>(`/api/dictionary/lookup${queryString({ term })}`),
};
