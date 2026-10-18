import { api } from './api';
import type {
  MentorChatMessage,
  MentorClass,
  MentorClassMessage,
  MentorProfileDetail,
  MentorProfileSummary,
  MentorRoomState,
  MentorSession,
  MentorSpecialty,
} from '@shared/mentor';

/** One place where the mentor HTTP surface is called from the browser. */
export const mentorApi = {
  directory: (specialty?: MentorSpecialty | '') =>
    api.get<{ mentors: MentorProfileSummary[] }>(
      specialty ? `/api/mentor/directory?specialty=${encodeURIComponent(specialty)}` : '/api/mentor/directory',
    ),
  profile: (mentorId: string) =>
    api.get<{ mentor: MentorProfileDetail; reviews: MentorReviewView[] }>(
      `/api/mentor/${encodeURIComponent(mentorId)}`,
    ),
  book: (mentorId: string, input: { startsAt: string; durationMinutes: number; topic: string }) =>
    api.post<{ session: MentorSession }>(`/api/mentor/${encodeURIComponent(mentorId)}/book`, input),
  sessions: (scope: 'upcoming' | 'past' | 'all' = 'all') =>
    api.get<{ sessions: MentorSession[] }>(`/api/mentor/me/sessions?scope=${scope}`),
  cancel: (sessionId: string, reason?: string) =>
    api.post<{ session: MentorSession }>(`/api/mentor/sessions/${encodeURIComponent(sessionId)}/cancel`, { reason }),
  complete: (sessionId: string, feedback?: string) =>
    api.post<{ session: MentorSession }>(`/api/mentor/sessions/${encodeURIComponent(sessionId)}/complete`, { feedback }),
  review: (sessionId: string, rating: number, comment?: string) =>
    api.post<{ ok: true }>(`/api/mentor/sessions/${encodeURIComponent(sessionId)}/review`, { rating, comment }),

  // Live room
  room: (sessionId: string, since?: string) =>
    api.get<MentorRoomState>(
      `/api/mentor/sessions/${encodeURIComponent(sessionId)}/room${since ? `?since=${encodeURIComponent(since)}` : ''}`,
    ),
  join: (sessionId: string) => api.post<{ ok: true }>(`/api/mentor/sessions/${encodeURIComponent(sessionId)}/join`, {}),
  leave: (sessionId: string) => api.post<{ ok: true }>(`/api/mentor/sessions/${encodeURIComponent(sessionId)}/leave`, {}),
  confirm: (sessionId: string) =>
    api.post<{ session: MentorSession }>(`/api/mentor/sessions/${encodeURIComponent(sessionId)}/confirm`, {}),
  decline: (sessionId: string, reason?: string) =>
    api.post<{ session: MentorSession }>(`/api/mentor/sessions/${encodeURIComponent(sessionId)}/decline`, reason ? { reason } : {}),
  kick: (sessionId: string, userId: string, ban = false) =>
    api.post<{ ok: true }>(`/api/mentor/sessions/${encodeURIComponent(sessionId)}/kick`, { userId, ban }),
  raiseHand: (sessionId: string, raised: boolean) =>
    api.post<{ ok: true }>(`/api/mentor/sessions/${encodeURIComponent(sessionId)}/hand`, { raised }),
  sendMessage: (sessionId: string, body: string, kind: 'CHAT' | 'NOTE' = 'CHAT') =>
    api.post<{ message: MentorChatMessage }>(`/api/mentor/sessions/${encodeURIComponent(sessionId)}/messages`, { body, kind }),
  signal: (
    sessionId: string,
    signal: {
      kind: 'OFFER' | 'ANSWER' | 'CANDIDATE' | 'BYE' | 'HAND' | 'MUTE_MIC' | 'UNMUTE_MIC' | 'KICK' | 'REACTION';
      targetId: string | null;
      payload: string;
    },
  ) => api.post<{ ok: true; id: string }>(`/api/mentor/sessions/${encodeURIComponent(sessionId)}/signal`, signal),

  // Classes
  classes: () => api.get<{ classes: MentorClass[] }>('/api/mentor/classes/list'),
  classDetail: (classId: string) =>
    api.get<{ class: MentorClass }>(`/api/mentor/classes/${encodeURIComponent(classId)}`),
  classMessages: (classId: string) =>
    api.get<{ messages: MentorClassMessage[] }>(`/api/mentor/classes/${encodeURIComponent(classId)}/messages`),
  postClassMessage: (classId: string, body: string) =>
    api.post<{ message: MentorClassMessage }>(`/api/mentor/classes/${encodeURIComponent(classId)}/messages`, { body }),
  classRoom: (classId: string) =>
    api.get<{ sessionId: string }>(`/api/mentor/classes/${encodeURIComponent(classId)}/room`),
  createClass: (input: {
    title: string;
    description: string;
    level: string;
    capacity: number;
    priceCoins: number;
    startsAt: string;
    endsAt: string;
    recurrence?: string | null;
  }) => api.post<{ class: MentorClass }>('/api/mentor/classes', input),
  joinClass: (classId: string) =>
    api.post<{ class: MentorClass }>(`/api/mentor/classes/${encodeURIComponent(classId)}/join`, {}),
  leaveClass: (classId: string) =>
    api.post<{ class: MentorClass }>(`/api/mentor/classes/${encodeURIComponent(classId)}/leave`, {}),

  // Mentor console
  console: () => api.get<MentorConsoleResponse>('/api/mentor/console/overview'),
  saveProfile: (input: {
    headline: string;
    bio: string;
    specialties: string[];
    languages: string[];
    hourlyRateCoins: number;
    yearsExperience: number;
  }) => api.post<{ ok: true }>('/api/mentor/profile', input),
  saveAvailability: (slots: Array<{ weekday: number; startMinute: number; endMinute: number }>) =>
    api.put<{ ok: true }>('/api/mentor/availability', { slots }),
};

export interface MentorReviewView {
  id: string;
  mentorId: string;
  studentId: string;
  studentName: string;
  sessionId: string | null;
  rating: number;
  comment: string;
  createdAt: string;
}

export interface MentorConsoleResponse {
  profile: {
    headline: string;
    active: boolean;
    studentsCount: number;
    sessionsCount: number;
    ratingAvg: number;
    ratingCount: number;
  } | null;
  stats: {
    totalSessions: number;
    completed: number;
    coinsEarned: number;
    ratingAvg: number;
    ratingCount: number;
  };
  upcoming: MentorSession[];
  students: Array<{ id: string; displayName: string; sessionsTogether: number; lastSession: string }>;
}
