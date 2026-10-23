/**
 * Mentor platform services.
 *
 * A mentor is a dedicated account type that coaches students one on one and in
 * small live classes. This module owns booking, the live room (presence, chat,
 * notes, WebRTC signalling envelopes relayed through D1), class-level group
 * chat, and reviews. A class also carries a durable "room session" shared by
 * every member, so the classroom gets the same call room as a 1-on-1.
 */
import type { Env } from '../env';
import type { AuthUser } from '../lib/auth-types';
import { ApiError } from '../lib/errors';
import { newId, nowIso, parseJson, clamp } from '../lib/ids';
import { recordAudit } from '../lib/audit';
import {
  MENTOR_SPECIALTIES,
  type MentorChatMessage,
  type MentorClass,
  type MentorClassMessage,
  type MentorClassStatus,
  type MentorProfileDetail,
  type MentorProfileSummary,
  type MentorSession,
  type MentorSessionStatus,
  type MentorSignal,
  type MentorSpecialty,
} from '../../shared/mentor';

interface UserRow {
  id: string;
  display_name: string;
}

interface MentorProfileRow {
  user_id: string;
  display_name: string;
  headline: string;
  bio: string;
  specialties: string;
  languages: string;
  hourly_rate_coins: number;
  years_experience: number;
  rating_avg: number;
  rating_count: number;
  students_count: number;
  sessions_count: number;
  verified: number;
  active: number;
  created_at: string;
  avatar_updated_at: string | null;
}

function parseSpecialties(value: string): MentorSpecialty[] {
  const parsed = parseJson<string[]>(value, []);
  return parsed.filter((item): item is MentorSpecialty => (MENTOR_SPECIALTIES as readonly string[]).includes(item));
}

function toSummary(row: MentorProfileRow): MentorProfileSummary {
  return {
    userId: row.user_id,
    displayName: row.display_name,
    headline: row.headline,
    bio: row.bio,
    specialties: parseSpecialties(row.specialties),
    languages: parseJson<string[]>(row.languages, []),
    hourlyRateCoins: row.hourly_rate_coins,
    yearsExperience: row.years_experience,
    ratingAvg: row.rating_avg,
    ratingCount: row.rating_count,
    studentsCount: row.students_count,
    sessionsCount: row.sessions_count,
    verified: row.verified === 1,
    active: row.active === 1,
    avatarUpdatedAt: row.avatar_updated_at,
    createdAt: row.created_at,
  };
}

const PROFILE_SELECT = `
  SELECT mp.*, p.display_name, p.avatar_updated_at
    FROM mentor_profiles mp
    JOIN user_profiles p ON p.user_id = mp.user_id`;

// ---------------------------------------------------------------------------- directory

export async function listMentors(env: Env, specialty?: string): Promise<MentorProfileSummary[]> {
  const rows = await env.DB.prepare(
    `${PROFILE_SELECT}
      WHERE mp.active = 1
      ORDER BY mp.verified DESC, mp.rating_avg DESC, mp.students_count DESC
      LIMIT 60`,
  ).all<MentorProfileRow>();
  let mentors = rows.results.map(toSummary);
  if (specialty && (MENTOR_SPECIALTIES as readonly string[]).includes(specialty)) {
    mentors = mentors.filter((mentor) => mentor.specialties.includes(specialty as MentorSpecialty));
  }
  return mentors;
}

export async function getMentorProfile(env: Env, mentorId: string, viewer: AuthUser | null): Promise<MentorProfileDetail> {
  const row = await env.DB.prepare(`${PROFILE_SELECT} WHERE mp.user_id = ?`).bind(mentorId).first<MentorProfileRow>();
  if (!row || row.active !== 1) throw ApiError.notFound('That mentor profile is not available.');

  const availability = await env.DB.prepare(
    'SELECT id, weekday, start_minute, end_minute FROM mentor_availability WHERE mentor_id = ? ORDER BY weekday, start_minute',
  )
    .bind(mentorId)
    .all<{ id: string; weekday: number; start_minute: number; end_minute: number }>();

  return {
    ...toSummary(row),
    availability: availability.results.map((slot) => ({
      id: slot.id,
      weekday: slot.weekday,
      startMinute: slot.start_minute,
      endMinute: slot.end_minute,
    })),
    viewerIsStudent: viewer?.role === 'STUDENT',
  };
}

export async function getMentorReviews(env: Env, mentorId: string) {
  const rows = await env.DB.prepare(
    `SELECT r.id, r.mentor_id, r.student_id, r.session_id, r.rating, r.comment, r.created_at,
            COALESCE(NULLIF(p.display_name, ''), 'Student') AS display_name,
            p.avatar_updated_at
       FROM mentor_reviews r
       LEFT JOIN user_profiles p ON p.user_id = r.student_id
      WHERE r.mentor_id = ?
      ORDER BY r.created_at DESC
      LIMIT 30`,
  )
    .bind(mentorId)
    .all<{
      id: string;
      mentor_id: string;
      student_id: string;
      session_id: string | null;
      rating: number;
      comment: string;
      created_at: string;
      display_name: string;
      avatar_updated_at: string | null;
    }>();

  return rows.results.map((row) => ({
    id: row.id,
    mentorId: row.mentor_id,
    studentId: row.student_id,
    studentName: row.display_name,
    studentAvatarUpdatedAt: row.avatar_updated_at,
    sessionId: row.session_id,
    rating: row.rating,
    comment: row.comment,
    createdAt: row.created_at,
  }));
}

// ---------------------------------------------------------------------------- bookings

interface SessionRow {
  id: string;
  kind: string;
  status: string;
  confirmation: string;
  mentor_id: string;
  mentor_name: string;
  mentor_avatar_at: string | null;
  student_id: string;
  student_name: string;
  student_avatar_at: string | null;
  class_id: string | null;
  class_title: string | null;
  room_session_id: string | null;
  topic: string;
  notes: string | null;
  starts_at: string;
  ends_at: string;
  started_at: string | null;
  ended_at: string | null;
  paid_coins: number;
  student_rating: number | null;
  mentor_feedback: string | null;
  created_at: string;
}

const SESSION_SELECT = `
  SELECT s.*, 
         COALESCE(NULLIF(pm.display_name, ''), 'Mentor') AS mentor_name,
         pm.avatar_updated_at AS mentor_avatar_at,
         COALESCE(NULLIF(ps.display_name, ''), 'Student') AS student_name,
         ps.avatar_updated_at AS student_avatar_at,
         mc.title AS class_title,
         (SELECT r.id FROM mentor_sessions r
           WHERE r.class_id = s.class_id AND r.student_id = r.mentor_id
           LIMIT 1) AS room_session_id
    FROM mentor_sessions s
    LEFT JOIN user_profiles pm ON pm.user_id = s.mentor_id
    LEFT JOIN user_profiles ps ON ps.user_id = s.student_id
    LEFT JOIN mentor_classes mc ON mc.id = s.class_id`;

function toSession(row: SessionRow): MentorSession {
  return {
    id: row.id,
    kind: row.kind === 'CLASS' ? 'CLASS' : 'ONE_ON_ONE',
    status: row.status as MentorSessionStatus,
    confirmation: (row.confirmation ?? 'CONFIRMED') as MentorSession['confirmation'],
    mentorId: row.mentor_id,
    mentorName: row.mentor_name,
    studentId: row.student_id,
    studentName: row.student_name,
    classId: row.class_id,
    className: row.class_title,
    roomSessionId: row.room_session_id,
    topic: row.topic,
    notes: row.notes,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    paidCoins: row.paid_coins,
    studentRating: row.student_rating,
    mentorFeedback: row.mentor_feedback,
    mentorAvatarUpdatedAt: row.mentor_avatar_at,
    studentAvatarUpdatedAt: row.student_avatar_at,
    createdAt: row.created_at,
  };
}

export async function bookSession(
  env: Env,
  viewer: AuthUser,
  mentorId: string,
  input: { startsAt: string; durationMinutes: number; topic: string },
): Promise<MentorSession> {
  if (viewer.role !== 'STUDENT' && viewer.role !== 'ADMIN') {
    throw ApiError.forbidden('Only students can book a mentor session.');
  }
  if (viewer.id === mentorId) throw ApiError.validation('You cannot book a session with yourself.');

  const mentor = await env.DB.prepare('SELECT user_id, active, hourly_rate_coins FROM mentor_profiles WHERE user_id = ?')
    .bind(mentorId)
    .first<{ user_id: string; active: number; hourly_rate_coins: number }>();
  if (!mentor || mentor.active !== 1) throw ApiError.notFound('That mentor is not taking bookings right now.');

  const startsAt = new Date(input.startsAt);
  if (Number.isNaN(startsAt.getTime())) throw ApiError.validation('Pick a valid start time.');
  const duration = clamp(Math.round(input.durationMinutes), 15, 180);
  const now = new Date();
  if (startsAt.getTime() < now.getTime() - 60_000) throw ApiError.validation('That time is already in the past.');
  if (startsAt.getTime() > now.getTime() + 1000 * 60 * 60 * 24 * 120) {
    throw ApiError.validation('Bookings open up to 120 days ahead.');
  }
  const endsAt = new Date(startsAt.getTime() + duration * 60_000);

  // Refuse double-booking either side of the call.
  const clash = await env.DB.prepare(
    `SELECT id FROM mentor_sessions
      WHERE status IN ('SCHEDULED', 'ACTIVE')
        AND (mentor_id = ? OR student_id = ?)
        AND starts_at < ? AND ends_at > ?
      LIMIT 1`,
  )
    .bind(mentorId, viewer.id, endsAt.toISOString(), startsAt.toISOString())
    .first<{ id: string }>();
  if (clash) throw ApiError.conflict('That time overlaps another session. Pick a different slot.');

  // Price in coins: charged only when the learner holds a Learn wallet that can
  // cover it — a fresh account books free rather than failing the flow.
  const quotedCoins = Math.round((mentor.hourly_rate_coins * duration) / 60);
  let paidCoins = 0;
  const wallet = await env.DB.prepare('SELECT coins FROM learn_profiles WHERE user_id = ?')
    .bind(viewer.id)
    .first<{ coins: number }>();
  if (wallet && quotedCoins > 0 && wallet.coins >= quotedCoins) {
    paidCoins = quotedCoins;
    await env.DB.prepare('UPDATE learn_profiles SET coins = coins - ?, updated_at = ? WHERE user_id = ?')
      .bind(paidCoins, nowIso(), viewer.id)
      .run();
  }

  const id = newId('msn');
  const timestamp = nowIso();
  await env.DB.prepare(
    `INSERT INTO mentor_sessions
       (id, mentor_id, student_id, class_id, kind, status, topic, starts_at, ends_at, paid_coins, created_at, updated_at)
     VALUES (?, ?, ?, NULL, 'ONE_ON_ONE', 'SCHEDULED', ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, mentorId, viewer.id, input.topic.trim() || 'Coaching session', startsAt.toISOString(), endsAt.toISOString(), paidCoins, timestamp, timestamp)
    .run();
  // The request holds its slot immediately; the mentor still has to accept it.
  await env.DB.prepare("UPDATE mentor_sessions SET confirmation = 'REQUESTED' WHERE id = ?").bind(id).run();

  await touchMentorCounters(env, mentorId);
  return getSession(env, id);
}

export async function getSession(env: Env, sessionId: string): Promise<MentorSession> {
  const row = await env.DB.prepare(`${SESSION_SELECT} WHERE s.id = ?`).bind(sessionId).first<SessionRow>();
  if (!row) throw ApiError.notFound('That session does not exist.');
  return toSession(row);
}

/** Sessions where the viewer is the mentor or the student, soonest first. */
export async function listSessionsFor(env: Env, viewer: AuthUser, scope: 'upcoming' | 'past' | 'all' = 'all'): Promise<MentorSession[]> {
  const now = nowIso();
  const window =
    scope === 'upcoming'
      ? "AND s.status IN ('SCHEDULED', 'ACTIVE') AND s.ends_at >= ?"
      : scope === 'past'
        ? "AND (s.status IN ('COMPLETED', 'CANCELLED', 'NO_SHOW') OR s.ends_at < ?)"
        : '';
  const rows = await env.DB.prepare(
    `${SESSION_SELECT}
      WHERE (s.mentor_id = ? OR s.student_id = ?) ${window}
      ORDER BY s.starts_at ${scope === 'past' ? 'DESC' : 'ASC'}
      LIMIT 100`,
  )
    .bind(viewer.id, viewer.id, ...(scope === 'all' ? [] : [now]))
    .all<SessionRow>();
  return rows.results.map(toSession);
}

/**
 * Session access: its mentor, its student, an administrator — or, for a CLASS
 * session, any member (or the mentor) of that class. The class's durable room
 * session has the mentor on both sides and is shared by every member.
 */
export async function assertSessionAccess(env: Env, session: MentorSession, viewer: AuthUser): Promise<void> {
  if (session.mentorId === viewer.id || session.studentId === viewer.id) return;
  if (viewer.role === 'ADMIN') return;
  if (session.kind === 'CLASS' && session.classId) {
    const member = await env.DB.prepare(
      'SELECT 1 AS ok FROM mentor_class_members WHERE class_id = ? AND user_id = ?',
    )
      .bind(session.classId, viewer.id)
      .first<{ ok: number }>();
    if (member) return;
    const klass = await env.DB.prepare('SELECT mentor_id FROM mentor_classes WHERE id = ?')
      .bind(session.classId)
      .first<{ mentor_id: string }>();
    if (klass && klass.mentor_id === viewer.id) return;
  }
  throw ApiError.forbidden('This session is not yours.');
}

/**
 * A breakout room is a named sub-room of the same session. The host (mentor or
 * admin) can visit any of them; everybody else must be assigned to the room
 * they ask for. `main` is always allowed once session access passed.
 */
export async function assertRoomKey(
  env: Env,
  session: MentorSession,
  viewer: AuthUser,
  roomKey: string,
): Promise<void> {
  if (!roomKey || roomKey === 'main') return;
  const room = await env.DB.prepare('SELECT id FROM class_breakouts WHERE session_id = ? AND room_key = ?')
    .bind(session.id, roomKey)
    .first<{ id: string }>();
  if (!room) throw ApiError.validation('That breakout room is no longer open.');
  if (session.mentorId === viewer.id || viewer.role === 'ADMIN') return;
  const member = await env.DB.prepare(
    'SELECT 1 AS ok FROM class_breakout_members WHERE breakout_id = ? AND user_id = ?',
  )
    .bind(room.id, viewer.id)
    .first<{ ok: number }>();
  if (!member) throw ApiError.forbidden('You are not assigned to this breakout room.');
}

export async function cancelSession(env: Env, viewer: AuthUser, sessionId: string, reason?: string): Promise<MentorSession> {
  const session = await getSession(env, sessionId);
  await assertSessionAccess(env, session, viewer);
  if (session.kind === 'CLASS') throw ApiError.conflict('Leave the class instead of cancelling its room.');
  if (session.status !== 'SCHEDULED') throw ApiError.conflict('Only scheduled sessions can be cancelled.');

  const timestamp = nowIso();
  await env.DB.prepare(
    `UPDATE mentor_sessions SET status = 'CANCELLED', notes = COALESCE(?, notes), updated_at = ? WHERE id = ?`,
  )
    .bind(reason?.trim() || null, timestamp, sessionId)
    .run();

  // Refund any coins taken at booking.
  if (session.paidCoins > 0) {
    await env.DB.prepare(
      `UPDATE learn_profiles SET coins = coins + ?, updated_at = ? WHERE user_id = ?`,
    )
      .bind(session.paidCoins, timestamp, session.studentId)
      .run();
    await env.DB.prepare('UPDATE mentor_sessions SET paid_coins = 0, updated_at = ? WHERE id = ?')
      .bind(timestamp, sessionId)
      .run();
  }

  await touchMentorCounters(env, session.mentorId);
  return getSession(env, sessionId);
}

export async function completeSession(
  env: Env,
  viewer: AuthUser,
  sessionId: string,
  feedback?: string,
): Promise<MentorSession> {
  const session = await getSession(env, sessionId);
  if (session.mentorId !== viewer.id && viewer.role !== 'ADMIN') {
    throw ApiError.forbidden('Only the mentor can complete a session.');
  }
  if (session.status === 'CANCELLED' || session.status === 'COMPLETED') {
    throw ApiError.conflict('That session is already closed.');
  }
  await env.DB.prepare(
    `UPDATE mentor_sessions
        SET status = 'COMPLETED', ended_at = COALESCE(ended_at, ?), mentor_feedback = COALESCE(?, mentor_feedback), updated_at = ?
      WHERE id = ?`,
  )
    .bind(nowIso(), feedback?.trim() || null, nowIso(), sessionId)
    .run();
  await touchMentorCounters(env, session.mentorId);
  return getSession(env, sessionId);
}

export async function reviewSession(
  env: Env,
  viewer: AuthUser,
  sessionId: string,
  rating: number,
  comment: string,
): Promise<void> {
  const session = await getSession(env, sessionId);
  if (session.studentId !== viewer.id) throw ApiError.forbidden('Only the student can review a session.');
  if (session.kind === 'CLASS') throw ApiError.conflict('Class rooms are reviewed from the 1-on-1 sessions.');
  if (session.status !== 'COMPLETED') throw ApiError.conflict('You can review a session after it is completed.');
  if (session.studentRating !== null) throw ApiError.conflict('You already reviewed this session.');

  const score = clamp(Math.round(rating), 1, 5);
  const timestamp = nowIso();
  await env.DB.prepare('UPDATE mentor_sessions SET student_rating = ?, updated_at = ? WHERE id = ?')
    .bind(score, timestamp, sessionId)
    .run();
  await env.DB.prepare(
    'INSERT INTO mentor_reviews (id, mentor_id, student_id, session_id, rating, comment, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(newId('rev'), session.mentorId, session.studentId, sessionId, score, comment.trim().slice(0, 2000), timestamp)
    .run();
  await recomputeMentorRating(env, session.mentorId);
}

// ---------------------------------------------------------------------------- live room

export interface RoomParticipant {
  userId: string;
  displayName: string;
  role: string;
  joinedAt: string;
  handRaised: boolean;
  avatarUpdatedAt: string | null;
  camOn: boolean;
  micOn: boolean;
}

/** What a participant's devices are doing right now. Presence is the heartbeat,
 * so the flags travel with every room poll — no extra round-trip. */
export interface RoomMediaState {
  cam: boolean;
  mic: boolean;
}

export async function joinRoom(
  env: Env,
  viewer: AuthUser,
  sessionId: string,
  roomKey = 'main',
  media: RoomMediaState = { cam: true, mic: true },
): Promise<{ ok: true }> {
  if (await isRoomBanned(env, sessionId, viewer.id)) {
    throw ApiError.forbidden('You were removed from this room by the mentor.');
  }
  const session = await getSession(env, sessionId);
  await assertSessionAccess(env, session, viewer);
  await assertRoomKey(env, session, viewer, roomKey);
  if (session.status === 'CANCELLED') throw ApiError.conflict('That session was cancelled.');
  if (session.status === 'COMPLETED') throw ApiError.conflict('That session is already over.');

  const timestamp = nowIso();
  await env.DB.prepare(
    `INSERT INTO mentor_room_presence (session_id, user_id, joined_at, last_seen_at, hand_raised, room_key, cam_on, mic_on)
     VALUES (?, ?, ?, ?, 0, ?, ?, ?)
     ON CONFLICT (session_id, user_id) DO UPDATE SET
       last_seen_at = excluded.last_seen_at,
       hand_raised = 0,
       room_key = excluded.room_key,
       cam_on = excluded.cam_on,
       mic_on = excluded.mic_on`,
  )
    .bind(sessionId, viewer.id, timestamp, timestamp, roomKey, media.cam ? 1 : 0, media.mic ? 1 : 0)
    .run();

  // The mentor opening the room puts the session live.
  if (viewer.id === session.mentorId && session.status === 'SCHEDULED') {
    await env.DB.prepare(
      `UPDATE mentor_sessions SET status = 'ACTIVE', started_at = COALESCE(started_at, ?), updated_at = ? WHERE id = ?`,
    )
      .bind(timestamp, timestamp, sessionId)
      .run();
  }
  return { ok: true };
}

export async function leaveRoom(env: Env, viewer: AuthUser, sessionId: string): Promise<{ ok: true }> {
  await env.DB.prepare('DELETE FROM mentor_room_presence WHERE session_id = ? AND user_id = ?')
    .bind(sessionId, viewer.id)
    .run();
  return { ok: true };
}

export async function setHandRaised(env: Env, viewer: AuthUser, sessionId: string, raised: boolean): Promise<{ ok: true }> {
  await env.DB.prepare(
    `UPDATE mentor_room_presence SET hand_raised = ?, last_seen_at = ? WHERE session_id = ? AND user_id = ?`,
  )
    .bind(raised ? 1 : 0, nowIso(), sessionId, viewer.id)
    .run();
  return { ok: true };
}

export async function roomState(
  env: Env,
  viewer: AuthUser,
  sessionId: string,
  sinceSignalId: string | null,
  roomKey = 'main',
  media: RoomMediaState = { cam: true, mic: true },
): Promise<{
  session: MentorSession;
  roomKey: string;
  participants: RoomParticipant[];
  messages: MentorChatMessage[];
  signals: MentorSignal[];
  serverTime: string;
}> {
  const session = await getSession(env, sessionId);
  await assertSessionAccess(env, session, viewer);
  await assertRoomKey(env, session, viewer, roomKey);

  const now = new Date();
  const timestamp = now.toISOString();

  // The poll itself is the heartbeat: bump this viewer so they stay listed, then
  // drop anyone silent for 30 s. (Presence used to be written only on join, so
  // everyone timed out while still talking — the counter said "0 in room" next
  // to live tiles.)
  await env.DB.prepare(
    `INSERT INTO mentor_room_presence (session_id, user_id, joined_at, last_seen_at, hand_raised, room_key, cam_on, mic_on)
     VALUES (?, ?, ?, ?, 0, ?, ?, ?)
     ON CONFLICT (session_id, user_id) DO UPDATE SET
       last_seen_at = excluded.last_seen_at,
       room_key = excluded.room_key,
       cam_on = excluded.cam_on,
       mic_on = excluded.mic_on`,
  )
    .bind(sessionId, viewer.id, timestamp, timestamp, roomKey, media.cam ? 1 : 0, media.mic ? 1 : 0)
    .run();
  await env.DB.prepare(
    'DELETE FROM mentor_room_presence WHERE session_id = ? AND last_seen_at < ?',
  )
    .bind(sessionId, new Date(now.getTime() - 30_000).toISOString())
    .run();

  const presence = await env.DB.prepare(
    `SELECT pr.user_id, pr.joined_at, pr.hand_raised, pr.cam_on, pr.mic_on,
            COALESCE(NULLIF(p.display_name, ''), u.username, u.email) AS display_name,
            p.avatar_updated_at,
            u.role
       FROM mentor_room_presence pr
       JOIN users u ON u.id = pr.user_id
       LEFT JOIN user_profiles p ON p.user_id = pr.user_id
      WHERE pr.session_id = ? AND pr.room_key = ?
      ORDER BY pr.joined_at`,
  )
    .bind(sessionId, roomKey)
    .all<{
      user_id: string;
      joined_at: string;
      hand_raised: number;
      cam_on: number;
      mic_on: number;
      display_name: string;
      role: string;
      avatar_updated_at: string | null;
    }>();

  const messages = await env.DB.prepare(
    `SELECT m.id, m.session_id, m.sender_id, m.kind, m.body, m.created_at,
            COALESCE(NULLIF(p.display_name, ''), u.username, 'Someone') AS display_name,
            p.avatar_updated_at
       FROM mentor_messages m
       JOIN users u ON u.id = m.sender_id
       LEFT JOIN user_profiles p ON p.user_id = m.sender_id
      WHERE m.session_id = ? AND m.room_key = ?
      ORDER BY m.created_at DESC
      LIMIT 80`,
  )
    .bind(sessionId, roomKey)
    .all<{
      id: string;
      session_id: string;
      sender_id: string;
      kind: string;
      body: string;
      created_at: string;
      display_name: string;
      avatar_updated_at: string | null;
    }>();

  const signalQuery = sinceSignalId
    ? env.DB.prepare(
        `SELECT id, session_id, sender_id, target_id, room_key, kind, payload, created_at
           FROM mentor_signals
          WHERE session_id = ? AND room_key = ? AND sender_id <> ? AND id > ?
          ORDER BY created_at`,
      ).bind(sessionId, roomKey, viewer.id, sinceSignalId)
    : env.DB.prepare(
        `SELECT id, session_id, sender_id, target_id, room_key, kind, payload, created_at
           FROM mentor_signals
          WHERE session_id = ? AND room_key = ? AND sender_id <> ?
          ORDER BY created_at`,
      ).bind(sessionId, roomKey, viewer.id);
  const signals = await signalQuery.all<{
    id: string;
    session_id: string;
    sender_id: string;
    target_id: string | null;
    room_key: string;
    kind: string;
    payload: string;
    created_at: string;
  }>();

  return {
    session,
    roomKey,
    participants: presence.results.map((row) => ({
      userId: row.user_id,
      displayName: row.display_name,
      role: row.role,
      joinedAt: row.joined_at,
      handRaised: row.hand_raised === 1,
      avatarUpdatedAt: row.avatar_updated_at,
      camOn: row.cam_on !== 0,
      micOn: row.mic_on !== 0,
    })),
    messages: messages.results
      .map((row) => ({
        id: row.id,
        sessionId: row.session_id,
        senderId: row.sender_id,
        senderName: row.display_name,
        senderAvatarUpdatedAt: row.avatar_updated_at,
        kind: (row.kind === 'NOTE' || row.kind === 'SYSTEM' ? row.kind : 'CHAT') as 'CHAT' | 'SYSTEM' | 'NOTE',
        body: row.body,
        createdAt: row.created_at,
      }))
      .reverse(),
    signals: signals.results.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      senderId: row.sender_id,
      targetId: row.target_id,
      roomKey: row.room_key,
      kind: row.kind as MentorSignal['kind'],
      payload: row.payload,
      createdAt: row.created_at,
    })),
    serverTime: nowIso(),
  };
}

export async function postMessage(
  env: Env,
  viewer: AuthUser,
  sessionId: string,
  body: string,
  kind: 'CHAT' | 'NOTE' = 'CHAT',
  roomKey = 'main',
): Promise<MentorChatMessage> {
  const session = await getSession(env, sessionId);
  await assertSessionAccess(env, session, viewer);
  await assertRoomKey(env, session, viewer, roomKey);
  const text = body.trim().slice(0, 4000);
  if (!text) throw ApiError.validation('Write something first.');
  const id = newId('msg');
  const timestamp = nowIso();
  await env.DB.prepare(
    'INSERT INTO mentor_messages (id, session_id, sender_id, kind, body, created_at, room_key) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(id, sessionId, viewer.id, kind, text, timestamp, roomKey)
    .run();
  return {
    id,
    sessionId,
    senderId: viewer.id,
    senderName: viewer.displayName || viewer.username || 'Someone',
    senderAvatarUpdatedAt: null,
    kind,
    body: text,
    createdAt: timestamp,
  };
}

export async function postSignal(
  env: Env,
  viewer: AuthUser,
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
    roomKey?: string;
  },
): Promise<{ ok: true; id: string }> {
  const session = await getSession(env, sessionId);
  await assertSessionAccess(env, session, viewer);
  const roomKey = signal.roomKey ?? 'main';
  await assertRoomKey(env, session, viewer, roomKey);
  if (signal.payload.length > 200_000) throw ApiError.validation('Signal payload is too large.');
  const id = newId('sig');
  await env.DB.prepare(
    'INSERT INTO mentor_signals (id, session_id, sender_id, target_id, room_key, kind, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(id, sessionId, viewer.id, signal.targetId, roomKey, signal.kind, signal.payload, nowIso())
    .run();
  // Keep the envelope table small: anything older than 10 minutes is done.
  await env.DB.prepare('DELETE FROM mentor_signals WHERE session_id = ? AND created_at < ?')
    .bind(sessionId, new Date(new Date().getTime() - 10 * 60_000).toISOString())
    .run();
  return { ok: true, id };
}

// ---------------------------------------------------------------------------- classes

interface ClassRow {
  id: string;
  mentor_id: string;
  mentor_name: string;
  mentor_avatar_at: string | null;
  title: string;
  description: string;
  level: string;
  capacity: number;
  price_coins: number;
  status: string;
  starts_at: string;
  ends_at: string;
  recurrence: string | null;
  created_at: string;
  member_count: number;
  joined: number;
  room_session_id: string | null;
}

function toClass(row: ClassRow, viewerId: string | undefined, members: MentorClass['members'] = []): MentorClass {
  return {
    id: row.id,
    mentorId: row.mentor_id,
    mentorName: row.mentor_name,
    title: row.title,
    description: row.description,
    level: row.level,
    capacity: row.capacity,
    memberCount: row.member_count,
    priceCoins: row.price_coins,
    status: row.status as MentorClassStatus,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    recurrence: row.recurrence,
    joined: viewerId ? row.joined === 1 : false,
    mentorAvatarUpdatedAt: row.mentor_avatar_at,
    roomSessionId: row.room_session_id,
    members,
    createdAt: row.created_at,
  };
}

const CLASS_SELECT = `
  SELECT c.*, 
         COALESCE(NULLIF(p.display_name, ''), 'Mentor') AS mentor_name,
         p.avatar_updated_at AS mentor_avatar_at,
         (SELECT COUNT(*) FROM mentor_class_members m WHERE m.class_id = c.id) AS member_count,
         (SELECT COUNT(*) FROM mentor_class_members m WHERE m.class_id = c.id AND m.user_id = ?) AS joined,
         (SELECT r.id FROM mentor_sessions r
           WHERE r.class_id = c.id AND r.student_id = r.mentor_id
           LIMIT 1) AS room_session_id
    FROM mentor_classes c
    LEFT JOIN user_profiles p ON p.user_id = c.mentor_id`;

async function classMembers(env: Env, classIds: string[]): Promise<Map<string, MentorClass['members']>> {
  const map = new Map<string, MentorClass['members']>();
  if (classIds.length === 0) return map;
  const placeholders = classIds.map(() => '?').join(', ');
  const rows = await env.DB.prepare(
    `SELECT m.class_id, m.user_id, m.joined_at,
            COALESCE(NULLIF(p.display_name, ''), u.username, u.email) AS display_name,
            p.avatar_updated_at
       FROM mentor_class_members m
       JOIN users u ON u.id = m.user_id
       LEFT JOIN user_profiles p ON p.user_id = m.user_id
      WHERE m.class_id IN (${placeholders})
      ORDER BY m.joined_at`,
  )
    .bind(...classIds)
    .all<{ class_id: string; user_id: string; joined_at: string; display_name: string; avatar_updated_at: string | null }>();
  for (const row of rows.results) {
    const list = map.get(row.class_id) ?? [];
    list.push({
      userId: row.user_id,
      displayName: row.display_name,
      avatarUpdatedAt: row.avatar_updated_at,
      joinedAt: row.joined_at,
    });
    map.set(row.class_id, list);
  }
  return map;
}

export async function listClasses(env: Env, viewer: AuthUser): Promise<MentorClass[]> {
  const rows = await env.DB.prepare(
    `${CLASS_SELECT}
      WHERE c.status IN ('OPEN', 'LIVE') OR c.mentor_id = ? OR EXISTS (
        SELECT 1 FROM mentor_class_members m WHERE m.class_id = c.id AND m.user_id = ?)
      ORDER BY c.starts_at ASC
      LIMIT 60`,
  )
    .bind(viewer.id, viewer.id, viewer.id)
    .all<ClassRow>();
  const members = await classMembers(env, rows.results.map((row) => row.id));
  return rows.results.map((row) => toClass(row, viewer.id, members.get(row.id) ?? []));
}

export async function getClass(env: Env, viewer: AuthUser, classId: string): Promise<MentorClass> {
  const row = await env.DB.prepare(`${CLASS_SELECT} WHERE c.id = ?`).bind(viewer.id, classId).first<ClassRow>();
  if (!row) throw ApiError.notFound('That class does not exist.');
  const members = await classMembers(env, [classId]);
  return toClass(row, viewer.id, members.get(classId) ?? []);
}

/**
 * The class's durable live room: one `mentor_sessions` row with the mentor on
 * both sides, created with the class (or lazily for older classes). Every
 * member shares it for the group call and the in-call chat.
 */
export async function ensureClassRoomSession(env: Env, classRow: { id: string; mentor_id: string; title: string; starts_at: string; ends_at: string }): Promise<string> {
  const existing = await env.DB.prepare(
    'SELECT id FROM mentor_sessions WHERE class_id = ? AND student_id = mentor_id LIMIT 1',
  )
    .bind(classRow.id)
    .first<{ id: string }>();
  if (existing) return existing.id;

  const id = newId('msn');
  const timestamp = nowIso();
  // The room outlives the class window so the chat and an overrunning call stay
  // reachable: it spans from an hour before to a week after the class.
  const starts = new Date(classRow.starts_at).toISOString();
  const ends = new Date(new Date(classRow.ends_at).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare(
    `INSERT INTO mentor_sessions
       (id, mentor_id, student_id, class_id, kind, status, topic, starts_at, ends_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'CLASS', 'SCHEDULED', ?, ?, ?, ?, ?)`,
  )
    .bind(id, classRow.mentor_id, classRow.mentor_id, classRow.id, classRow.title, starts, ends, timestamp, timestamp)
    .run();
  return id;
}

export async function createClass(
  env: Env,
  viewer: AuthUser,
  input: {
    title: string;
    description: string;
    level: string;
    capacity: number;
    priceCoins: number;
    startsAt: string;
    endsAt: string;
    recurrence: string | null;
  },
): Promise<MentorClass> {
  if (viewer.role !== 'MENTOR' && viewer.role !== 'ADMIN') {
    throw ApiError.forbidden('Only mentors can open a class.');
  }
  const title = input.title.trim();
  if (title.length < 3) throw ApiError.validation('Give the class a title.');
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
    throw ApiError.validation('Pick a valid start and end time.');
  }
  const id = newId('cls');
  const timestamp = nowIso();
  await env.DB.prepare(
    `INSERT INTO mentor_classes
       (id, mentor_id, title, description, level, capacity, price_coins, status, starts_at, ends_at, recurrence, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      viewer.id,
      title,
      input.description.trim().slice(0, 2000),
      input.level.trim() || 'All levels',
      clamp(Math.round(input.capacity), 2, 5000),
      Math.max(0, Math.round(input.priceCoins)),
      startsAt.toISOString(),
      endsAt.toISOString(),
      input.recurrence?.trim() || null,
      timestamp,
      timestamp,
    )
    .run();

  await ensureClassRoomSession(env, {
    id,
    mentor_id: viewer.id,
    title,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
  });

  return getClass(env, viewer, id);
}

async function classAccess(env: Env, classId: string, viewer: AuthUser): Promise<{ id: string; mentor_id: string; title: string; starts_at: string; ends_at: string }> {
  const row = await env.DB.prepare('SELECT id, mentor_id, title, starts_at, ends_at FROM mentor_classes WHERE id = ?')
    .bind(classId)
    .first<{ id: string; mentor_id: string; title: string; starts_at: string; ends_at: string }>();
  if (!row) throw ApiError.notFound('That class does not exist.');
  if (row.mentor_id === viewer.id || viewer.role === 'ADMIN') return row;
  const member = await env.DB.prepare('SELECT 1 AS ok FROM mentor_class_members WHERE class_id = ? AND user_id = ?')
    .bind(classId, viewer.id)
    .first<{ ok: number }>();
  if (!member) throw ApiError.forbidden('Join this class to see its chat.');
  return row;
}

export async function classMessages(env: Env, viewer: AuthUser, classId: string): Promise<MentorClassMessage[]> {
  await classAccess(env, classId, viewer);
  const rows = await env.DB.prepare(
    `SELECT m.id, m.class_id, m.sender_id, m.body, m.created_at,
            COALESCE(NULLIF(p.display_name, ''), u.username, 'Someone') AS display_name,
            p.avatar_updated_at
       FROM mentor_class_messages m
       JOIN users u ON u.id = m.sender_id
       LEFT JOIN user_profiles p ON p.user_id = m.sender_id
      WHERE m.class_id = ?
      ORDER BY m.created_at DESC
      LIMIT 100`,
  )
    .bind(classId)
    .all<{ id: string; class_id: string; sender_id: string; body: string; created_at: string; display_name: string; avatar_updated_at: string | null }>();
  return rows.results
    .map((row) => ({
      id: row.id,
      classId: row.class_id,
      senderId: row.sender_id,
      senderName: row.display_name,
      senderAvatarUpdatedAt: row.avatar_updated_at,
      body: row.body,
      createdAt: row.created_at,
    }))
    .reverse();
}

export async function postClassMessage(env: Env, viewer: AuthUser, classId: string, body: string): Promise<MentorClassMessage> {
  await classAccess(env, classId, viewer);
  const text = body.trim().slice(0, 4000);
  if (!text) throw ApiError.validation('Write something first.');
  const id = newId('cmt');
  const timestamp = nowIso();
  await env.DB.prepare(
    'INSERT INTO mentor_class_messages (id, class_id, sender_id, body, created_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(id, classId, viewer.id, text, timestamp)
    .run();
  return {
    id,
    classId,
    senderId: viewer.id,
    senderName: viewer.displayName || viewer.username || 'Someone',
    senderAvatarUpdatedAt: null,
    body: text,
    createdAt: timestamp,
  };
}

/** The shared call room of a class (created on demand for older classes). */
export async function classRoomSessionId(env: Env, viewer: AuthUser, classId: string): Promise<{ sessionId: string }> {
  const row = await classAccess(env, classId, viewer);
  const sessionId = await ensureClassRoomSession(env, row);
  return { sessionId };
}

export async function joinClass(env: Env, viewer: AuthUser, classId: string): Promise<MentorClass> {
  const row = await env.DB.prepare(`${CLASS_SELECT} WHERE c.id = ?`).bind(viewer.id, classId).first<ClassRow>();
  if (!row) throw ApiError.notFound('That class does not exist.');
  if (row.status !== 'OPEN' && row.status !== 'LIVE') throw ApiError.conflict('That class is not open.');
  if (row.member_count >= row.capacity && row.joined !== 1) throw ApiError.conflict('That class is full.');
  if (viewer.id === row.mentor_id) throw ApiError.validation('You lead this class already.');

  const timestamp = nowIso();
  await env.DB.prepare(
    'INSERT INTO mentor_class_members (class_id, user_id, joined_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING',
  )
    .bind(classId, viewer.id, timestamp)
    .run();

  // A class session row per member keeps history uniform; the shared room
  // session is what the member actually calls in. Re-joining after a leave
  // reactivates the member's cancelled row — otherwise the stale row would
  // refuse every later room open with "That session was cancelled."
  const memberRow = await env.DB.prepare(
    `SELECT id, status FROM mentor_sessions
      WHERE class_id = ? AND student_id = ?
      ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(classId, viewer.id)
    .first<{ id: string; status: string }>();
  if (!memberRow) {
    const sessionId = newId('msn');
    await env.DB.prepare(
      `INSERT INTO mentor_sessions
         (id, mentor_id, student_id, class_id, kind, status, topic, starts_at, ends_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'CLASS', 'SCHEDULED', ?, ?, ?, ?, ?)
       ON CONFLICT DO NOTHING`,
    )
      .bind(sessionId, row.mentor_id, viewer.id, classId, row.title, row.starts_at, row.ends_at, timestamp, timestamp)
      .run();
  } else if (memberRow.status === 'CANCELLED') {
    await env.DB.prepare(
      `UPDATE mentor_sessions SET status = 'SCHEDULED', updated_at = ? WHERE id = ?`,
    )
      .bind(timestamp, memberRow.id)
      .run();
  }

  await ensureClassRoomSession(env, {
    id: classId,
    mentor_id: row.mentor_id,
    title: row.title,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
  });

  return getClass(env, viewer, classId);
}

export async function leaveClass(env: Env, viewer: AuthUser, classId: string): Promise<MentorClass> {
  await env.DB.prepare('DELETE FROM mentor_class_members WHERE class_id = ? AND user_id = ?')
    .bind(classId, viewer.id)
    .run();
  await env.DB.prepare(
    "UPDATE mentor_sessions SET status = 'CANCELLED', updated_at = ? WHERE class_id = ? AND student_id = ? AND student_id <> mentor_id AND status = 'SCHEDULED'",
  )
    .bind(nowIso(), classId, viewer.id)
    .run();
  return getClass(env, viewer, classId);
}

/**
 * Deletes a classroom: its roster, class chat, every class session and the
 * in-room data those sessions carry. The mentor who leads the class or an
 * administrator may do it; one-on-one sessions are untouched.
 */
export async function deleteClass(
  env: Env,
  viewer: AuthUser,
  classId: string,
): Promise<{ ok: true; sessionsRemoved: number }> {
  const row = await env.DB.prepare('SELECT id, mentor_id, title FROM mentor_classes WHERE id = ?')
    .bind(classId)
    .first<{ id: string; mentor_id: string; title: string }>();
  if (!row) throw ApiError.notFound('That class does not exist.');
  if (viewer.role !== 'ADMIN' && row.mentor_id !== viewer.id) {
    throw ApiError.forbidden('Only the class mentor or an administrator can delete a class.');
  }

  const sessionIds = (
    await env.DB.prepare('SELECT id FROM mentor_sessions WHERE class_id = ?').bind(classId).all<{ id: string }>()
  ).results.map((entry) => entry.id);

  const statements: D1PreparedStatement[] = [];
  if (sessionIds.length > 0) {
    const placeholders = sessionIds.map(() => '?').join(',');
    // Children first and explicitly: the batch must not depend on the
    // connection's foreign-key pragma to leave no orphans behind.
    for (const sql of [
      `DELETE FROM mentor_messages WHERE session_id IN (${placeholders})`,
      `DELETE FROM mentor_room_presence WHERE session_id IN (${placeholders})`,
      `DELETE FROM mentor_room_bans WHERE session_id IN (${placeholders})`,
      `DELETE FROM mentor_signals WHERE session_id IN (${placeholders})`,
      `DELETE FROM class_poll_answers WHERE poll_id IN (SELECT id FROM class_polls WHERE session_id IN (${placeholders}))`,
      `DELETE FROM class_polls WHERE session_id IN (${placeholders})`,
      `DELETE FROM class_breakout_members WHERE breakout_id IN (SELECT id FROM class_breakouts WHERE session_id IN (${placeholders}))`,
      `DELETE FROM class_breakouts WHERE session_id IN (${placeholders})`,
      `DELETE FROM class_whiteboards WHERE session_id IN (${placeholders})`,
      // Ratings of deleted calls survive as mentor history, unlinked.
      `UPDATE mentor_reviews SET session_id = NULL WHERE session_id IN (${placeholders})`,
      `DELETE FROM mentor_sessions WHERE id IN (${placeholders})`,
    ]) {
      statements.push(env.DB.prepare(sql).bind(...sessionIds));
    }
  }
  statements.push(
    env.DB.prepare('DELETE FROM mentor_class_members WHERE class_id = ?').bind(classId),
    env.DB.prepare('DELETE FROM mentor_class_messages WHERE class_id = ?').bind(classId),
    env.DB.prepare('DELETE FROM mentor_classes WHERE id = ?').bind(classId),
  );
  await env.DB.batch(statements);

  await recordAudit(env, {
    actorUserId: viewer.id,
    action: 'CLASS_DELETE',
    entityType: 'mentor_class',
    entityId: classId,
    metadata: { title: row.title, sessionsRemoved: sessionIds.length },
  });
  return { ok: true, sessionsRemoved: sessionIds.length };
}

// ---------------------------------------------------------------------------- mentor console

export async function mentorConsole(env: Env, viewer: AuthUser) {
  if (viewer.role !== 'MENTOR' && viewer.role !== 'ADMIN') {
    throw ApiError.forbidden('Only mentors have a mentor console.');
  }
  const now = nowIso();
  const upcoming = await env.DB.prepare(
    `${SESSION_SELECT}
      WHERE s.mentor_id = ? AND s.status IN ('SCHEDULED', 'ACTIVE') AND s.ends_at >= ? AND s.student_id <> s.mentor_id
      ORDER BY s.starts_at ASC
      LIMIT 20`,
  )
    .bind(viewer.id, now)
    .all<SessionRow>();

  const stats = await env.DB.prepare(
    `SELECT
       COUNT(*) AS total_sessions,
       SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) AS completed,
       SUM(CASE WHEN status = 'COMPLETED' THEN paid_coins ELSE 0 END) AS coins_earned,
       SUM(CASE WHEN status = 'COMPLETED' AND student_rating IS NOT NULL THEN student_rating ELSE 0 END) AS rating_sum,
       SUM(CASE WHEN student_rating IS NOT NULL THEN 1 ELSE 0 END) AS rating_count
     FROM mentor_sessions WHERE mentor_id = ? AND student_id <> mentor_id`,
  )
    .bind(viewer.id)
    .first<{ total_sessions: number; completed: number; coins_earned: number; rating_sum: number; rating_count: number }>();

  const profile = await env.DB.prepare('SELECT * FROM mentor_profiles WHERE user_id = ?')
    .bind(viewer.id)
    .first<{ students_count: number; sessions_count: number; rating_avg: number; rating_count: number; headline: string; active: number }>();

  const students = await env.DB.prepare(
    `SELECT DISTINCT s.student_id AS id,
            COALESCE(NULLIF(p.display_name, ''), 'Student') AS display_name,
            p.avatar_updated_at,
            COUNT(*) AS sessions_together,
            MAX(s.starts_at) AS last_session
       FROM mentor_sessions s
       LEFT JOIN user_profiles p ON p.user_id = s.student_id
      WHERE s.mentor_id = ? AND s.student_id <> s.mentor_id
      GROUP BY s.student_id
      ORDER BY last_session DESC
      LIMIT 40`,
  )
    .bind(viewer.id)
    .all<{ id: string; display_name: string; avatar_updated_at: string | null; sessions_together: number; last_session: string }>();

  return {
    profile: profile
      ? {
          headline: profile.headline,
          active: profile.active === 1,
          studentsCount: profile.students_count,
          sessionsCount: profile.sessions_count,
          ratingAvg: profile.rating_avg,
          ratingCount: profile.rating_count,
        }
      : null,
    stats: {
      totalSessions: stats?.total_sessions ?? 0,
      completed: stats?.completed ?? 0,
      coinsEarned: stats?.coins_earned ?? 0,
      ratingAvg: stats && stats.rating_count > 0 ? Math.round((stats.rating_sum / stats.rating_count) * 10) / 10 : 0,
      ratingCount: stats?.rating_count ?? 0,
    },
    upcoming: upcoming.results.map(toSession),
    students: students.results.map((row) => ({
      id: row.id,
      displayName: row.display_name,
      avatarUpdatedAt: row.avatar_updated_at,
      sessionsTogether: row.sessions_together,
      lastSession: row.last_session,
    })),
  };
}

export async function upsertMentorProfile(
  env: Env,
  viewer: AuthUser,
  input: {
    headline: string;
    bio: string;
    specialties: string[];
    languages: string[];
    hourlyRateCoins: number;
    yearsExperience: number;
  },
): Promise<void> {
  if (viewer.role !== 'MENTOR' && viewer.role !== 'ADMIN') {
    throw ApiError.forbidden('Only mentors can edit a mentor profile.');
  }
  const timestamp = nowIso();
  const specialties = input.specialties.filter((item) => (MENTOR_SPECIALTIES as readonly string[]).includes(item));
  const languages = input.languages.map((item) => item.trim()).filter(Boolean).slice(0, 8);
  await env.DB.prepare(
    `INSERT INTO mentor_profiles
       (user_id, headline, bio, specialties, languages, hourly_rate_coins, years_experience, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET
       headline = excluded.headline,
       bio = excluded.bio,
       specialties = excluded.specialties,
       languages = excluded.languages,
       hourly_rate_coins = excluded.hourly_rate_coins,
       years_experience = excluded.years_experience,
       updated_at = excluded.updated_at`,
  )
    .bind(
      viewer.id,
      input.headline.trim().slice(0, 140),
      input.bio.trim().slice(0, 4000),
      JSON.stringify(specialties),
      JSON.stringify(languages),
      Math.max(0, Math.round(input.hourlyRateCoins)),
      clamp(Math.round(input.yearsExperience), 0, 60),
      timestamp,
      timestamp,
    )
    .run();
}

export async function setAvailability(
  env: Env,
  viewer: AuthUser,
  slots: Array<{ weekday: number; startMinute: number; endMinute: number }>,
): Promise<void> {
  if (viewer.role !== 'MENTOR' && viewer.role !== 'ADMIN') {
    throw ApiError.forbidden('Only mentors can set availability.');
  }
  const timestamp = nowIso();
  await env.DB.prepare('DELETE FROM mentor_availability WHERE mentor_id = ?').bind(viewer.id).run();
  for (const slot of slots.slice(0, 40)) {
    const weekday = clamp(Math.round(slot.weekday), 0, 6);
    const start = clamp(Math.round(slot.startMinute), 0, 1430);
    const end = clamp(Math.round(slot.endMinute), start + 10, 1440);
    await env.DB.prepare(
      'INSERT INTO mentor_availability (id, mentor_id, weekday, start_minute, end_minute, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
      .bind(newId('avl'), viewer.id, weekday, start, end, timestamp)
      .run();
  }
}

// ---------------------------------------------------------------------------- helpers

async function touchMentorCounters(env: Env, mentorId: string): Promise<void> {
  const timestamp = nowIso();
  await env.DB.prepare(
    `UPDATE mentor_profiles SET
       sessions_count = (SELECT COUNT(*) FROM mentor_sessions WHERE mentor_id = ? AND status = 'COMPLETED' AND student_id <> mentor_id),
       students_count = (SELECT COUNT(DISTINCT student_id) FROM mentor_sessions WHERE mentor_id = ? AND student_id <> mentor_id AND status IN ('COMPLETED', 'ACTIVE', 'SCHEDULED')),
       updated_at = ?
     WHERE user_id = ?`,
  )
    .bind(mentorId, mentorId, timestamp, mentorId)
    .run();
}

async function recomputeMentorRating(env: Env, mentorId: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE mentor_profiles SET
       rating_avg = COALESCE((SELECT AVG(rating * 1.0) FROM mentor_reviews WHERE mentor_id = ?), 0),
       rating_count = (SELECT COUNT(*) FROM mentor_reviews WHERE mentor_id = ?),
       updated_at = ?
     WHERE user_id = ?`,
  )
    .bind(mentorId, mentorId, nowIso(), mentorId)
    .run();
}

/** Re-exported for the routes file so user lookups stay in one place. */
export async function findUser(env: Env, userId: string): Promise<UserRow | null> {
  return env.DB.prepare(
    `SELECT u.id, COALESCE(NULLIF(p.display_name, ''), u.email) AS display_name
       FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id
      WHERE u.id = ?`,
  )
    .bind(userId)
    .first<UserRow>();
}


// ---------------------------------------------------------------- moderation

/** The mentor (or an admin) accepts a booking request. */
export async function confirmSession(env: Env, viewer: AuthUser, sessionId: string): Promise<MentorSession> {
  const session = await getSession(env, sessionId);
  if (session.mentorId !== viewer.id && viewer.role !== 'ADMIN') throw ApiError.forbidden('Only the mentor can confirm this booking.');
  if (session.confirmation !== 'REQUESTED') throw ApiError.conflict('This booking is not waiting for confirmation.');
  await env.DB.prepare(`UPDATE mentor_sessions SET confirmation = 'CONFIRMED', updated_at = ? WHERE id = ?`)
    .bind(nowIso(), sessionId)
    .run();
  await systemMessage(env, sessionId, viewer.id, 'Booking confirmed by the mentor.');
  return getSession(env, sessionId);
}

/**
 * The mentor (or the student of the session) cancels a booking. Any coins the
 * learner paid go back to their wallet.
 */
export async function declineSession(env: Env, viewer: AuthUser, sessionId: string, reason?: string): Promise<MentorSession> {
  const session = await getSession(env, sessionId);
  const isMentor = session.mentorId === viewer.id || viewer.role === 'ADMIN';
  const isStudent = session.studentId === viewer.id;
  if (!isMentor && !isStudent) throw ApiError.forbidden('This is not your session.');
  if (session.status === 'COMPLETED' || session.status === 'CANCELLED') {
    throw ApiError.conflict('This session is already closed.');
  }
  if (isStudent && session.status === 'SCHEDULED' && session.mentorId !== viewer.id) {
    // A confirmed session may still be cancelled by the learner — same refund.
  }
  await env.DB.prepare(`UPDATE mentor_sessions SET status = 'CANCELLED', confirmation = 'DECLINED', updated_at = ? WHERE id = ?`)
    .bind(nowIso(), sessionId)
    .run();
  if (session.paidCoins > 0) {
    await env.DB.prepare('UPDATE learn_profiles SET coins = coins + ?, updated_at = ? WHERE user_id = ?')
      .bind(session.paidCoins, nowIso(), session.studentId)
      .run();
  }
  await systemMessage(env, sessionId, viewer.id, reason?.trim() ? `Booking cancelled — ${reason.trim()}` : 'Booking cancelled.');
  await touchMentorCounters(env, session.mentorId);
  return getSession(env, sessionId);
}

async function systemMessage(env: Env, sessionId: string, senderId: string, body: string): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO mentor_messages (id, session_id, sender_id, kind, body, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(newId('msg'), sessionId, senderId, 'SYSTEM', body, nowIso())
    .run();
}

/** Remove someone from the room right now (their client receives a KICK signal too). */
export async function kickParticipant(
  env: Env,
  viewer: AuthUser,
  sessionId: string,
  targetId: string,
  ban: boolean,
): Promise<{ ok: true }> {
  const session = await getSession(env, sessionId);
  if (session.mentorId !== viewer.id && viewer.role !== 'ADMIN') {
    throw ApiError.forbidden('Only the mentor can manage this room.');
  }
  if (targetId === viewer.id) throw ApiError.validation('You cannot kick yourself.');
  if (targetId === session.mentorId && viewer.role !== 'ADMIN') throw ApiError.validation('The mentor cannot be kicked.');
  await env.DB.prepare('DELETE FROM mentor_room_presence WHERE session_id = ? AND user_id = ?')
    .bind(sessionId, targetId)
    .run();
  if (ban) {
    await env.DB.prepare(
      'INSERT INTO mentor_room_bans (session_id, user_id, banned_by, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING',
    )
      .bind(sessionId, targetId, viewer.id, nowIso())
      .run();
  }
  return { ok: true };
}

/** True when this user may not enter the room. */
export async function isRoomBanned(env: Env, sessionId: string, userId: string): Promise<boolean> {
  const row = await env.DB.prepare('SELECT 1 AS ok FROM mentor_room_bans WHERE session_id = ? AND user_id = ?')
    .bind(sessionId, userId)
    .first<{ ok: number }>();
  return Boolean(row);
}
