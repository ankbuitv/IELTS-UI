import { api, queryString } from './api';
import type {
  DailyWordsResult,
  DictionaryEntry,
  LearnLevel,
  LearnOverview,
  LearnProfile,
  LessonCompletionResult,
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
  dailyWords: (extra = false) => api.post<DailyWordsResult>('/api/learn/daily-words', { day: localDay(), ...(extra ? { extra: true } : {}) }),
  completeLesson: (input: { lessonId: string; correct: number; total: number; mistakes: string[] }) =>
    api.post<LessonCompletionResult>('/api/learn/lessons/complete', { ...input, day: localDay() }),
  reviewWords: () => api.get<{ words: ReviewWord[] }>('/api/learn/review'),
  completeReview: (results: Array<{ id: string; correct: boolean }>) =>
    api.post<ReviewCompletion>('/api/learn/review/complete', { results, day: localDay() }),
  setLevel: (level: LearnLevel) => api.put<{ ok: true }>('/api/learn/level', { level }),
  setGoal: (goalXp: number) => api.put<{ ok: true }>('/api/learn/goal', { goalXp }),
  lookup: (term: string) => api.get<{ entry: DictionaryEntry }>(`/api/dictionary/lookup${queryString({ term })}`),
};
