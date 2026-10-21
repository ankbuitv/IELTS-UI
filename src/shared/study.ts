/**
 * Study groups and virtual study rooms.
 *
 * A group is persistent: a small set of learners with a shared target and a
 * weekly XP race. A room is temporary: whoever is inside runs one shared
 * pomodoro clock, and the clock is authoritative on the server so a learner
 * joining halfway through lands on the same minute as everybody else.
 *
 * This module holds only pure shapes and arithmetic; the Worker owns storage,
 * and the client renders whatever the last poll said.
 */
import type { AvatarId } from './gamification';

export const GROUP_TARGET_BANDS = [5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9] as const;
export const GROUP_NAME_MAX = 40;
export const GROUP_GOAL_MAX = 120;
export const GROUP_CAPACITY = 12;

export interface StudyGroupSummary {
  id: string;
  name: string;
  goal: string;
  targetBand: number;
  memberCount: number;
  isOwner: boolean;
  joined: boolean;
  createdAt: string;
}

export interface StudyGroupMember {
  userId: string;
  name: string;
  avatarId: AvatarId;
  level: number;
  weeklyXp: number;
  online: boolean;
  isMe: boolean;
}

export interface StudyGroupDetail extends StudyGroupSummary {
  members: StudyGroupMember[];
  /** Owner's display name, so the header reads "Mai's group". */
  ownerName: string;
}

export interface StudyBuddySuggestion {
  userId: string;
  name: string;
  avatarId: AvatarId;
  level: number;
  targetBand: number | null;
  weeklyXp: number;
  online: boolean;
  /** Why this learner is being suggested. */
  relation: 'FRIEND' | 'CLASSMATE' | 'SAME_TARGET';
}

export interface StudyGroupsOverview {
  groups: StudyGroupSummary[];
  suggestions: StudyBuddySuggestion[];
  /** Groups that are open for anyone at the learner's target band. */
  discover: StudyGroupSummary[];
}

export type PomodoroPhase = 'IDLE' | 'FOCUS' | 'BREAK';

export const ROOM_CAPACITY = 20;
export const ROOM_FOCUS_DEFAULT = 25;
export const ROOM_BREAK_DEFAULT = 5;
export const ROOM_MAX_FOCUS = 60;
export const ROOM_MAX_BREAK = 20;
/** A participant is shown as present for this long after their last heartbeat. */
export const ROOM_PRESENCE_SECONDS = 45;

export interface StudyRoomMember {
  userId: string;
  name: string;
  avatarId: AvatarId;
  online: boolean;
  isMe: boolean;
  isHost: boolean;
  /** Focus minutes this participant has logged today. */
  minutesToday: number;
}

export interface StudyRoomSummary {
  id: string;
  name: string;
  topic: string;
  hostName: string;
  phase: PomodoroPhase;
  /** Seconds left in the current phase; zero when idle. */
  secondsLeft: number;
  focusMinutes: number;
  breakMinutes: number;
  occupants: number;
  capacity: number;
  /** League season key, so the room can show the same countdown as the board. */
  seasonKey: string;
  createdAt: string;
}

export interface StudyRoomDetail extends StudyRoomSummary {
  members: StudyRoomMember[];
  isHost: boolean;
  /** Server clock at the moment of the response, for drift-free rendering. */
  serverNow: string;
}

export interface StudyRoomsOverview {
  rooms: StudyRoomSummary[];
  /** Total focus minutes this learner has logged today, across rooms. */
  minutesToday: number;
  /** A room the learner is already inside, which the UI opens first. */
  currentRoomId: string | null;
}

/** `mm:ss` for the pomodoro dial; hours are not needed for a focus block. */
export function formatPomodoro(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

/** Seconds left, measured against a server timestamp (never a local start). */
export function phaseRemaining(phase: PomodoroPhase, endsAt: string | null, nowMs: number): number {
  if (phase === 'IDLE' || !endsAt) return 0;
  return Math.max(0, Math.ceil((Date.parse(endsAt) - nowMs) / 1000));
}

export function nextPhase(phase: PomodoroPhase): PomodoroPhase {
  return phase === 'FOCUS' ? 'BREAK' : 'FOCUS';
}

export function phaseLabel(phase: PomodoroPhase): string {
  if (phase === 'FOCUS') return 'Focus';
  if (phase === 'BREAK') return 'Break';
  return 'Not started';
}

/** One sentence for the room banner. */
export function phaseHint(phase: PomodoroPhase, secondsLeft: number): string {
  if (phase === 'IDLE') return 'The host has not started a focus block yet.';
  if (phase === 'FOCUS') return `${formatPomodoro(secondsLeft)} of quiet work. Cameras off, phones down.`;
  return `${formatPomodoro(secondsLeft)} to stretch, then back to it.`;
}

export function normaliseRoomMinutes(value: number): number {
  return Math.min(ROOM_MAX_FOCUS, Math.max(5, Math.round(value)));
}

export function normaliseBreakMinutes(value: number): number {
  return Math.min(ROOM_MAX_BREAK, Math.max(1, Math.round(value)));
}
