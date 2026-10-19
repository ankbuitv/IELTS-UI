/** Shared shapes for the live classroom: polls, breakouts, whiteboard. */

export type PollKind = 'QUIZ' | 'POLL';
export type PollStatus = 'OPEN' | 'CLOSED';

export interface ClassPollOption {
  index: number;
  text: string;
  votes: number;
}

export interface ClassPoll {
  id: string;
  sessionId: string;
  roomKey: string;
  createdBy: string;
  kind: PollKind;
  question: string;
  options: ClassPollOption[];
  /** Revealed to participants only once the poll is closed. */
  correctIndex: number | null;
  status: PollStatus;
  totalVotes: number;
  myChoice: number | null;
  createdAt: string;
  closedAt: string | null;
}

export interface CreatePollInput {
  question: string;
  options: string[];
  kind?: PollKind;
  correctIndex?: number | null;
}

export interface BreakoutMember {
  userId: string;
  displayName: string;
  avatarUpdatedAt: string | null;
}

export interface BreakoutRoom {
  id: string;
  name: string;
  roomKey: string;
  endsAt: string | null;
  members: BreakoutMember[];
}

export interface BreakoutState {
  rooms: BreakoutRoom[];
  myRoom: BreakoutRoom | null;
  /** Earliest end time across open breakouts. */
  endsAt: string | null;
  open: boolean;
}

export interface WhiteboardStroke {
  color: string;
  width: number;
  /** Normalised points (0..1) so every screen draws the same picture. */
  points: Array<[number, number]>;
}

export interface WhiteboardState {
  revision: number;
  strokes: WhiteboardStroke[];
  updatedAt: string | null;
  updatedBy: string | null;
  saved: boolean;
}

export interface DigestAttemptSummary {
  skill: string;
  count: number;
  averageBand: number | null;
  bestBand: number | null;
}

export interface WeeklyDigest {
  weekKey: string;
  name: string;
  attempts: number;
  band: number | null;
  previousBand: number | null;
  skills: DigestAttemptSummary[];
  sessionsAttended: number;
  upcomingSessions: Array<{ id: string; title: string; startsAt: string }>;
  streakDays: number;
  coinsEarned: number;
}

export interface MentorEarningRow {
  sessionId: string;
  studentName: string;
  studentId: string;
  topic: string;
  startsAt: string;
  endsAt: string;
  minutes: number;
  coins: number;
  status: string;
  invoiceNumber: string;
}

export interface MentorEarnings {
  from: string;
  to: string;
  rows: MentorEarningRow[];
  totals: {
    completedSessions: number;
    scheduledSessions: number;
    completedHours: number;
    earnedCoins: number;
    pendingCoins: number;
  };
  byMonth: Array<{ month: string; coins: number; sessions: number }>;
}
