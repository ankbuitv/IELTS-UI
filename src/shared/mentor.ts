/**
 * Mentor platform — shared vocabulary between the Worker and the browser.
 *
 * A mentor is a dedicated account type (`MENTOR`) that coaches students one on
 * one and in small live classes: booking slots, a live call room with chat, and
 * session feedback. Nothing here may touch answer material.
 */

export const MENTOR_SESSION_STATUSES = [
  'REQUESTED',
  'SCHEDULED',
  'ACTIVE',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
] as const;
export type MentorSessionStatus = (typeof MENTOR_SESSION_STATUSES)[number];

export const MENTOR_SESSION_KINDS = ['ONE_ON_ONE', 'CLASS'] as const;
export type MentorSessionKind = (typeof MENTOR_SESSION_KINDS)[number];

export const MENTOR_CLASS_STATUSES = ['DRAFT', 'OPEN', 'LIVE', 'COMPLETED', 'CANCELLED'] as const;
export type MentorClassStatus = (typeof MENTOR_CLASS_STATUSES)[number];

export const MENTOR_SPECIALTIES = [
  'SPEAKING',
  'WRITING',
  'READING',
  'LISTENING',
  'VOCABULARY',
  'GRAMMAR',
  'INTERVIEW',
  'BAND_7_PLUS',
] as const;
export type MentorSpecialty = (typeof MENTOR_SPECIALTIES)[number];

export const MENTOR_SPECIALTY_LABELS: Record<MentorSpecialty, string> = {
  SPEAKING: 'Speaking',
  WRITING: 'Writing',
  READING: 'Reading',
  LISTENING: 'Listening',
  VOCABULARY: 'Vocabulary',
  GRAMMAR: 'Grammar',
  INTERVIEW: 'Interview prep',
  BAND_7_PLUS: 'Band 7.0+',
};

export const MENTOR_SESSION_STATUS_LABELS: Record<MentorSessionStatus, string> = {
  REQUESTED: 'Waiting for confirmation',
  SCHEDULED: 'Scheduled',
  ACTIVE: 'Live now',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  NO_SHOW: 'No show',
};

/** Minutes-of-day slots a mentor offers, one row per weekday window. */
export interface MentorAvailabilitySlot {
  id: string;
  weekday: number; // 0 = Sunday, matching Date#getDay()
  startMinute: number;
  endMinute: number;
}

export interface MentorProfileSummary {
  userId: string;
  displayName: string;
  headline: string;
  bio: string;
  specialties: MentorSpecialty[];
  languages: string[];
  hourlyRateCoins: number;
  yearsExperience: number;
  ratingAvg: number;
  ratingCount: number;
  studentsCount: number;
  sessionsCount: number;
  verified: boolean;
  active: boolean;
  /** Cache-buster for `/api/files/avatar/:userId?v=…`, null when there is no picture. */
  avatarUpdatedAt: string | null;
  createdAt: string;
}

export interface MentorProfileDetail extends MentorProfileSummary {
  availability: MentorAvailabilitySlot[];
  /** The signed-in viewer's relationship to this mentor, when there is one. */
  viewerIsStudent: boolean;
}

export interface MentorSession {
  id: string;
  kind: MentorSessionKind;
  status: MentorSessionStatus;
  /**
   * Whether the mentor accepted this booking. `REQUESTED` bookings are
   * already SCHEDULED (the slot is held) but await the mentor's answer.
   */
  confirmation: 'REQUESTED' | 'CONFIRMED' | 'DECLINED' | 'NONE';
  mentorId: string;
  mentorName: string;
  studentId: string;
  studentName: string;
  classId: string | null;
  className: string | null;
  topic: string;
  notes: string | null;
  startsAt: string;
  endsAt: string;
  startedAt: string | null;
  endedAt: string | null;
  paidCoins: number;
  studentRating: number | null;
  mentorFeedback: string | null;
  mentorAvatarUpdatedAt: string | null;
  studentAvatarUpdatedAt: string | null;
  /** For CLASS sessions: the durable room session id shared by every member. */
  roomSessionId: string | null;
  createdAt: string;
}

export interface MentorReview {
  id: string;
  mentorId: string;
  studentId: string;
  studentName: string;
  studentAvatarUpdatedAt: string | null;
  sessionId: string | null;
  rating: number;
  comment: string;
  createdAt: string;
}

export interface MentorClass {
  id: string;
  mentorId: string;
  mentorName: string;
  title: string;
  description: string;
  level: string;
  capacity: number;
  memberCount: number;
  priceCoins: number;
  status: MentorClassStatus;
  startsAt: string;
  endsAt: string;
  recurrence: string | null;
  joined: boolean;
  mentorAvatarUpdatedAt: string | null;
  /** The class's durable live-room session (chat + group call). */
  roomSessionId: string | null;
  members: Array<{ userId: string; displayName: string; avatarUpdatedAt: string | null; joinedAt: string }>;
  createdAt: string;
}

export interface MentorChatMessage {
  id: string;
  sessionId: string | null;
  senderId: string;
  senderName: string;
  senderAvatarUpdatedAt: string | null;
  kind: 'CHAT' | 'SYSTEM' | 'NOTE';
  body: string;
  createdAt: string;
}

export interface MentorDirectoryResponse {
  mentors: MentorProfileSummary[];
}

/** A message in a class's persistent group chat. */
export interface MentorClassMessage {
  id: string;
  classId: string;
  senderId: string;
  senderName: string;
  senderAvatarUpdatedAt: string | null;
  body: string;
  createdAt: string;
}

export interface MentorSessionsResponse {
  sessions: MentorSession[];
}

export interface MentorClassesResponse {
  classes: MentorClass[];
}

export interface RoomParticipant {
  userId: string;
  displayName: string;
  role: string;
  joinedAt: string;
  handRaised: boolean;
  avatarUpdatedAt: string | null;
  /** Presence heartbeat flags: false means the tile should show an avatar. */
  camOn: boolean;
  micOn: boolean;
}

export interface MentorRoomState {
  session: MentorSession;
  /** Room the state was requested for (main or a breakout key). */
  roomKey: string;
  participants: RoomParticipant[];
  messages: MentorChatMessage[];
  /** WebRTC signalling envelopes for the viewer since `since`. */
  signals: MentorSignal[];
  serverTime: string;
}

export interface MentorSignal {
  id: string;
  sessionId: string;
  senderId: string;
  targetId: string | null;
  /** `main` or a breakout room key. Signalling never crosses rooms. */
  roomKey: string;
  kind: 'OFFER' | 'ANSWER' | 'CANDIDATE' | 'BYE' | 'HAND' | 'MUTE_MIC' | 'UNMUTE_MIC' | 'KICK' | 'REACTION' | 'WHITEBOARD';
  payload: string;
  createdAt: string;
}

/** Booking shape the client posts to `POST /api/mentor/:mentorId/book`. */
export interface MentorBookingRequest {
  startsAt: string;
  durationMinutes: number;
  topic: string;
}

/** A ten-minute slot grid is enough for a demo schedule and stays readable. */
export const SLOT_MINUTES = 30;

export function formatMinuteOfDay(minute: number): string {
  const hour = Math.floor(minute / 60);
  const min = minute % 60;
  return `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

export function mentorRatingLabel(rating: number): string {
  if (rating >= 4.8) return 'Outstanding';
  if (rating >= 4.4) return 'Excellent';
  if (rating >= 3.9) return 'Very good';
  if (rating >= 3) return 'Good';
  return 'New mentor';
}
