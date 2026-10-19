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
import type {
  BreakoutState,
  ClassPoll,
  CreatePollInput,
  MentorEarnings,
  WhiteboardState,
  WhiteboardStroke,
} from '@shared/live';

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
  room: (sessionId: string, since?: string, room = 'main') => {
    const params = new URLSearchParams();
    if (since) params.set('since', since);
    if (room && room !== 'main') params.set('room', room);
    const query = params.toString();
    return api.get<MentorRoomState>(
      `/api/mentor/sessions/${encodeURIComponent(sessionId)}/room${query ? `?${query}` : ''}`,
    );
  },
  join: (sessionId: string, room = 'main') =>
    api.post<{ ok: true }>(
      `/api/mentor/sessions/${encodeURIComponent(sessionId)}/join${room && room !== 'main' ? `?room=${encodeURIComponent(room)}` : ''}`,
      {},
    ),
  leave: (sessionId: string) => api.post<{ ok: true }>(`/api/mentor/sessions/${encodeURIComponent(sessionId)}/leave`, {}),
  confirm: (sessionId: string) =>
    api.post<{ session: MentorSession }>(`/api/mentor/sessions/${encodeURIComponent(sessionId)}/confirm`, {}),
  decline: (sessionId: string, reason?: string) =>
    api.post<{ session: MentorSession }>(`/api/mentor/sessions/${encodeURIComponent(sessionId)}/decline`, reason ? { reason } : {}),
  kick: (sessionId: string, userId: string, ban = false) =>
    api.post<{ ok: true }>(`/api/mentor/sessions/${encodeURIComponent(sessionId)}/kick`, { userId, ban }),
  raiseHand: (sessionId: string, raised: boolean) =>
    api.post<{ ok: true }>(`/api/mentor/sessions/${encodeURIComponent(sessionId)}/hand`, { raised }),
  sendMessage: (sessionId: string, body: string, kind: 'CHAT' | 'NOTE' = 'CHAT', room = 'main') =>
    api.post<{ message: MentorChatMessage }>(`/api/mentor/sessions/${encodeURIComponent(sessionId)}/messages`, {
      body,
      kind,
      room,
    }),
  signal: (
    sessionId: string,
    signal: {
      kind:
        | 'OFFER'
        | 'ANSWER'
        | 'CANDIDATE'
        | 'BYE'
        | 'HAND'
        | 'MUTE_MIC'
        | 'UNMUTE_MIC'
        | 'KICK'
        | 'REACTION'
        | 'WHITEBOARD';
      targetId: string | null;
      payload: string;
      room?: string;
    },
  ) => api.post<{ ok: true; id: string }>(`/api/mentor/sessions/${encodeURIComponent(sessionId)}/signal`, signal),

  // Live classroom extras
  polls: (sessionId: string, room = 'main') =>
    api.get<{ polls: ClassPoll[] }>(
      `/api/mentor/sessions/${encodeURIComponent(sessionId)}/polls${room !== 'main' ? `?room=${encodeURIComponent(room)}` : ''}`,
    ),
  createPoll: (sessionId: string, room: string, input: CreatePollInput) =>
    api.post<{ poll: ClassPoll }>(`/api/mentor/sessions/${encodeURIComponent(sessionId)}/polls`, { ...input, room }),
  answerPoll: (sessionId: string, pollId: string, choiceIndex: number) =>
    api.post<{ poll: ClassPoll }>(
      `/api/mentor/sessions/${encodeURIComponent(sessionId)}/polls/${encodeURIComponent(pollId)}/answer`,
      { choiceIndex },
    ),
  closePoll: (sessionId: string, pollId: string) =>
    api.post<{ poll: ClassPoll }>(
      `/api/mentor/sessions/${encodeURIComponent(sessionId)}/polls/${encodeURIComponent(pollId)}/close`,
      {},
    ),
  breakouts: (sessionId: string) =>
    api.get<BreakoutState>(`/api/mentor/sessions/${encodeURIComponent(sessionId)}/breakouts`),
  createBreakouts: (sessionId: string, count: number, minutes: number) =>
    api.post<BreakoutState>(`/api/mentor/sessions/${encodeURIComponent(sessionId)}/breakouts`, { count, minutes }),
  closeBreakouts: (sessionId: string) =>
    api.post<BreakoutState>(`/api/mentor/sessions/${encodeURIComponent(sessionId)}/breakouts/close`, {}),
  whiteboard: (sessionId: string, room = 'main') =>
    api.get<WhiteboardState>(
      `/api/mentor/sessions/${encodeURIComponent(sessionId)}/whiteboard${room !== 'main' ? `?room=${encodeURIComponent(room)}` : ''}`,
    ),
  saveWhiteboard: (sessionId: string, room: string, revision: number, strokes: WhiteboardStroke[]) =>
    api.put<WhiteboardState>(`/api/mentor/sessions/${encodeURIComponent(sessionId)}/whiteboard`, {
      room,
      revision,
      strokes,
    }),

  // Earnings
  earnings: (from?: string, to?: string) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const query = params.toString();
    return api.get<MentorEarnings>(`/api/mentor/me/earnings${query ? `?${query}` : ''}`);
  },
  invoice: (sessionId: string) =>
    api.get<{
      number: string;
      mentorName: string;
      studentName: string;
      topic: string;
      startsAt: string;
      endsAt: string;
      minutes: number;
      coins: number;
      status: string;
      issuedAt: string;
    }>(`/api/mentor/me/earnings/${encodeURIComponent(sessionId)}/invoice`),

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
