import type { Env } from '../env';
import { ApiError } from '../lib/errors';
import { newId, nowIso } from '../lib/ids';
import type { AuthUser } from '../lib/auth-types';
import { findSpeakingTopicSet, partPromptText, SPEAKING_PART_META, SPEAKING_TOPIC_SETS } from '../../shared/speaking';
import { loadSpeakingScore, scoreSpeakingSessionWithAi, type AiGradeResult } from './ai-marking-service';
import { deleteBlob, getBlob, putBlob } from './blob-store';

/**
 * Speaking practice.
 *
 * A session is a small state machine: IN_PROGRESS → SUBMITTED → MARKED. The
 * candidate records each part (browser-side MediaRecorder), the browser also
 * produces a transcript (Web Speech API) which is what the AI grades, and the
 * audio itself is stored only when the candidate leaves recording enabled so a
 * teacher can listen and correct the pronunciation criterion.
 *
 * The AI estimate never blocks: if no provider is configured the session is
 * still saved and a teacher can mark it, exactly like Writing.
 */

/** Base64 characters accepted per part (~6 MB of audio). */
const MAX_AUDIO_BASE64 = 8_000_000;

export interface SpeakingResponseInput {
  part: number;
  transcript?: string;
  durationSeconds?: number;
  /** `data:audio/webm;base64,...` or the bare base64 payload. */
  audioBase64?: string | null;
  mime?: string | null;
}

export interface SpeakingSessionView {
  session: {
    id: string;
    status: 'IN_PROGRESS' | 'SUBMITTED' | 'MARKED' | 'FAILED';
    mode: 'PRACTICE' | 'MOCK';
    topicSetId: string;
    topicTitle: string;
    partCount: number;
    overallBand: number | null;
    feedback: string;
    markedAt: string | null;
    providerModel: string | null;
    /** 'AI' when the marking machine produced the band, 'TEACHER' when a human did. */
    scoreSource: 'AI' | 'TEACHER' | null;
    createdAt: string;
  };
  topic: {
    id: string;
    title: string;
    part1: string[];
    part2: { cue: string; bullets: string[] };
    part3: string[];
  } | null;
  responses: Array<{
    part: number;
    promptText: string;
    transcript: string;
    durationSeconds: number;
    words: number;
    hasAudio: boolean;
  }>;
  score: AiGradeResult | null;
}

export async function createSpeakingSession(
  env: Env,
  user: AuthUser,
  input: { topicSetId?: string; mode?: 'PRACTICE' | 'MOCK' },
): Promise<SpeakingSessionView> {
  const topic =
    (input.topicSetId ? findSpeakingTopicSet(input.topicSetId) : undefined) ??
    SPEAKING_TOPIC_SETS[Math.floor(Math.random() * SPEAKING_TOPIC_SETS.length)]!;

  const timestamp = nowIso();
  const sessionId = newId('spk');
  await env.DB.prepare(
    `INSERT INTO speaking_sessions (id, user_id, mode, status, topic_set_id, topic_title, part_count, created_at, updated_at)
     VALUES (?, ?, ?, 'IN_PROGRESS', ?, ?, 3, ?, ?)`,
  )
    .bind(sessionId, user.id, input.mode ?? 'PRACTICE', topic.id, topic.title, timestamp, timestamp)
    .run();

  return requireSession(env, user, sessionId);
}

export async function loadSpeakingSession(env: Env, user: AuthUser, sessionId: string): Promise<SpeakingSessionView> {
  return requireSession(env, user, sessionId);
}

export async function listSpeakingSessions(
  env: Env,
  user: AuthUser,
  limit = 25,
): Promise<Array<{ id: string; topicTitle: string; status: string; overallBand: number | null; createdAt: string; markedAt: string | null }>> {
  const rows = await env.DB.prepare(
    `SELECT id, topic_title, status, overall_band, created_at, marked_at
       FROM speaking_sessions WHERE user_id = ?
      ORDER BY created_at DESC LIMIT ?`,
  )
    .bind(user.id, Math.min(Math.max(limit, 1), 100))
    .all<{ id: string; topic_title: string; status: string; overall_band: number | null; created_at: string; marked_at: string | null }>();
  return rows.results.map((row) => ({
    id: row.id,
    topicTitle: row.topic_title,
    status: row.status,
    overallBand: row.overall_band,
    createdAt: row.created_at,
    markedAt: row.marked_at,
  }));
}

/** Saves (or replaces) one part of the session. */
export async function saveSpeakingResponse(
  env: Env,
  user: AuthUser,
  sessionId: string,
  input: SpeakingResponseInput,
): Promise<SpeakingSessionView> {
  const session = await requireOwnedSession(env, user, sessionId);
  if (session.status === 'MARKED') {
    throw ApiError.conflict('This session has already been marked and cannot be changed.');
  }
  if (![1, 2, 3].includes(input.part)) throw ApiError.validation('A speaking response belongs to part 1, 2 or 3.');

  const topic = findSpeakingTopicSet(session.topic_set_id);
  const promptText = topic ? partPromptText(topic, input.part) : '';
  const transcript = (input.transcript ?? '').slice(0, 20_000);
  const durationSeconds = Math.max(0, Math.min(3600, Math.round((input.durationSeconds ?? 0) * 10) / 10));
  const words = transcript.trim() ? transcript.trim().split(/\s+/).length : 0;

  const existing = await env.DB.prepare('SELECT id FROM speaking_responses WHERE session_id = ? AND part = ?')
    .bind(sessionId, input.part)
    .first<{ id: string }>();

  const timestamp = nowIso();
  const responseId = existing?.id ?? newId('spr');

  if (existing) {
    await env.DB.prepare(
      `UPDATE speaking_responses
          SET transcript = ?, duration_seconds = ?, words = ?, prompt_text = ?, updated_at = ?
        WHERE id = ?`,
    )
      .bind(transcript, durationSeconds, words, promptText, timestamp, responseId)
      .run();
  } else {
    await env.DB.prepare(
      `INSERT INTO speaking_responses (id, session_id, part, prompt_text, transcript, duration_seconds, words, mime, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(responseId, sessionId, input.part, promptText, transcript, durationSeconds, words, input.mime ?? null, timestamp, timestamp)
      .run();
  }

  if (input.audioBase64 !== undefined && input.audioBase64 !== null) {
    const payload = input.audioBase64.replace(/^data:[^;]+;base64,/, '').trim();
    if (!payload) {
      await deleteBlob(env, 'speaking_recording_blobs', 'response_id', responseId);
    } else {
      if (payload.length > MAX_AUDIO_BASE64) {
        throw ApiError.validation('That recording is too large to store. Record a shorter take or leave recording off.');
      }
      await putBlob(env, 'speaking_recording_blobs', 'response_id', responseId, payload, {
        mime: input.mime ?? 'audio/webm',
      });
    }
  }

  await env.DB.prepare('UPDATE speaking_sessions SET updated_at = ?, status = CASE WHEN status = \'IN_PROGRESS\' THEN \'SUBMITTED\' ELSE status END WHERE id = ?')
    .bind(timestamp, sessionId)
    .run();

  return requireSession(env, user, sessionId);
}

/**
 * Submits the session and asks the AI grader for an estimate when a provider is
 * available. When it is not, the session is still submitted so a teacher can
 * mark it — the same policy as Writing.
 */
export async function submitSpeakingSession(
  env: Env,
  user: AuthUser,
  sessionId: string,
  options: { providerId?: string } = {},
): Promise<SpeakingSessionView & { aiError: string | null }> {
  await requireOwnedSession(env, user, sessionId);

  let aiError: string | null = null;
  try {
    await scoreSpeakingSessionWithAi(env, sessionId, options);
  } catch (error) {
    aiError = error instanceof ApiError ? error.message : 'The AI provider could not mark this session.';
    const timestamp = nowIso();
    await env.DB.prepare(
      "UPDATE speaking_sessions SET status = 'SUBMITTED', updated_at = ? WHERE id = ? AND status != 'MARKED'",
    )
      .bind(timestamp, sessionId)
      .run();
  }

  return { ...(await requireSession(env, user, sessionId)), aiError };
}

/** A teacher or admin can re-mark any session (for example after enabling a provider). */
export async function markSpeakingSessionAsStaff(
  env: Env,
  sessionId: string,
  options: { providerId?: string } = {},
): Promise<AiGradeResult> {
  const row = await env.DB.prepare('SELECT id FROM speaking_sessions WHERE id = ?').bind(sessionId).first<{ id: string }>();
  if (!row) throw ApiError.notFound('Speaking session not found.');
  return scoreSpeakingSessionWithAi(env, sessionId, options);
}

export interface SpeakingQueueItem {
  sessionId: string;
  studentId: string;
  studentEmail: string;
  studentName: string;
  topicTitle: string;
  mode: string;
  status: string;
  overallBand: number | null;
  scoreSource: 'AI' | 'TEACHER' | null;
  providerModel: string | null;
  feedback: string;
  parts: number;
  audioParts: number;
  words: number;
  createdAt: string;
  markedAt: string | null;
}

/**
 * Speaking sessions for staff review, newest first. A teacher sees their own
 * classrooms' candidates; an administrator sees everyone. The AI grades first,
 * so this queue is normally a spot-check list rather than a backlog.
 */
export async function listSpeakingQueue(
  env: Env,
  user: AuthUser,
  options: { unmarkedOnly?: boolean; limit?: number } = {},
): Promise<{ sessions: SpeakingQueueItem[]; unmarkedCount: number }> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const teacherFilter =
    user.role === 'ADMIN'
      ? ''
      : `AND (
           EXISTS (
             SELECT 1 FROM classroom_members student
             JOIN classrooms c ON c.id = student.classroom_id
            WHERE student.user_id = s.user_id AND student.status = 'ACTIVE'
              AND (c.teacher_id = ?
                   OR EXISTS (
                     SELECT 1 FROM classroom_members ct
                      WHERE ct.classroom_id = c.id AND ct.user_id = ?
                        AND ct.role = 'CO_TEACHER' AND ct.status = 'ACTIVE'
                   ))
           )
         )`;
  const unmarkedFilter = options.unmarkedOnly ? 'AND s.overall_band IS NULL' : '';
  const bindings = user.role === 'ADMIN' ? [] : [user.id, user.id];

  const rows = await env.DB.prepare(
    `SELECT s.id, s.user_id, s.mode, s.status, s.topic_title, s.overall_band, s.score_source, s.provider_model,
            s.feedback, s.created_at, s.marked_at,
            u.email, p.display_name,
            (SELECT COUNT(*) FROM speaking_responses r WHERE r.session_id = s.id) AS parts,
            (SELECT COUNT(*) FROM speaking_responses r
               JOIN speaking_recording_blobs b ON b.response_id = r.id
              WHERE r.session_id = s.id) AS audio_parts,
            (SELECT COALESCE(SUM(r.words), 0) FROM speaking_responses r WHERE r.session_id = s.id) AS words
       FROM speaking_sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN user_profiles p ON p.user_id = u.id
      WHERE s.status != 'IN_PROGRESS'
        ${teacherFilter}
        ${unmarkedFilter}
      ORDER BY CASE WHEN s.overall_band IS NULL THEN 0 ELSE 1 END, COALESCE(s.marked_at, s.created_at) DESC
      LIMIT ${limit}`,
  )
    .bind(...bindings)
    .all<{
      id: string;
      user_id: string;
      mode: string;
      status: string;
      topic_title: string;
      overall_band: number | null;
      score_source: 'AI' | 'TEACHER' | null;
      provider_model: string | null;
      feedback: string;
      created_at: string;
      marked_at: string | null;
      email: string;
      display_name: string | null;
      parts: number;
      audio_parts: number;
      words: number;
    }>();

  const unmarked = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM speaking_sessions s
      WHERE s.status != 'IN_PROGRESS' AND s.overall_band IS NULL ${teacherFilter}`,
  )
    .bind(...bindings)
    .first<{ n: number }>();

  return {
    unmarkedCount: unmarked?.n ?? 0,
    sessions: rows.results.map((row) => ({
      sessionId: row.id,
      studentId: row.user_id,
      studentEmail: row.email,
      studentName: row.display_name ?? row.email,
      topicTitle: row.topic_title,
      mode: row.mode,
      status: row.status,
      overallBand: row.overall_band,
      scoreSource: row.score_source ?? (row.overall_band !== null ? 'AI' : null),
      providerModel: row.provider_model,
      feedback: row.feedback,
      parts: row.parts,
      audioParts: row.audio_parts,
      words: row.words,
      createdAt: row.created_at,
      markedAt: row.marked_at,
    })),
  };
}

/** A teacher's (or admin's) own band for a session. Always wins over the AI. */
export async function setSpeakingBand(
  env: Env,
  user: AuthUser,
  sessionId: string,
  input: { band: number | null; feedback?: string },
): Promise<SpeakingSessionView> {
  const session = await requireOwnedSession(env, user, sessionId);
  const band =
    input.band === null || Number.isNaN(input.band)
      ? null
      : Math.min(9, Math.max(0, Math.round(input.band * 2) / 2));
  const timestamp = nowIso();
  await env.DB.prepare(
    `UPDATE speaking_sessions
        SET overall_band = ?, feedback = ?, score_source = ?, scored_by = ?, scored_at = ?, marked_at = ?,
            status = CASE WHEN ? IS NULL THEN 'SUBMITTED' ELSE 'MARKED' END, updated_at = ?
      WHERE id = ?`,
  )
    .bind(
      band,
      (input.feedback ?? '').slice(0, 4000),
      band === null ? null : 'TEACHER',
      user.id,
      timestamp,
      timestamp,
      band,
      timestamp,
      session.id,
    )
    .run();
  return requireSession(env, user, sessionId);
}

export async function deleteSpeakingSession(env: Env, user: AuthUser, sessionId: string): Promise<void> {
  const session = await requireOwnedSession(env, user, sessionId);
  await env.DB.prepare('DELETE FROM speaking_sessions WHERE id = ?').bind(session.id).run();
}

/** The stored recording, for the candidate or for staff. */
export async function loadSpeakingAudio(
  env: Env,
  sessionId: string,
  part: number,
): Promise<{ base64: string; mime: string; bytes: number } | null> {
  const row = await env.DB.prepare(
    'SELECT id FROM speaking_responses WHERE session_id = ? AND part = ?',
  )
    .bind(sessionId, part)
    .first<{ id: string }>();
  if (!row) return null;
  const stored = await getBlob(env, 'speaking_recording_blobs', 'response_id', row.id);
  if (!stored) return null;
  return stored;
}

async function requireOwnedSession(
  env: Env,
  user: AuthUser,
  sessionId: string,
): Promise<{ id: string; user_id: string; status: string; topic_set_id: string }> {
  const session = await env.DB.prepare(
    'SELECT id, user_id, status, topic_set_id FROM speaking_sessions WHERE id = ?',
  )
    .bind(sessionId)
    .first<{ id: string; user_id: string; status: string; topic_set_id: string }>();
  if (!session) throw ApiError.notFound('Speaking session not found.');
  if (session.user_id !== user.id && user.role === 'STUDENT') {
    throw ApiError.forbidden('That speaking session belongs to another candidate.');
  }
  return session;
}

async function requireSession(env: Env, user: AuthUser, sessionId: string): Promise<SpeakingSessionView> {
  const session = await requireOwnedSession(env, user, sessionId);
  const row = await env.DB.prepare(
    `SELECT id, status, mode, topic_set_id, topic_title, part_count, overall_band, feedback, marked_at,
            provider_model, score_source, created_at
       FROM speaking_sessions WHERE id = ?`,
  )
    .bind(session.id)
    .first<{
      id: string;
      status: SpeakingSessionView['session']['status'];
      mode: SpeakingSessionView['session']['mode'];
      topic_set_id: string;
      topic_title: string;
      part_count: number;
      overall_band: number | null;
      feedback: string;
      marked_at: string | null;
      provider_model: string | null;
      score_source: 'AI' | 'TEACHER' | null;
      created_at: string;
    }>();
  if (!row) throw ApiError.notFound('Speaking session not found.');

  const responses = await env.DB.prepare(
    `SELECT r.part, r.prompt_text, r.transcript, r.duration_seconds, r.words,
            EXISTS(SELECT 1 FROM speaking_recording_blobs b WHERE b.response_id = r.id) AS has_audio
       FROM speaking_responses r WHERE r.session_id = ? ORDER BY r.part`,
  )
    .bind(session.id)
    .all<{ part: number; prompt_text: string; transcript: string; duration_seconds: number; words: number; has_audio: number }>();

  const topic = findSpeakingTopicSet(row.topic_set_id) ?? null;
  return {
    session: {
      id: row.id,
      status: row.status,
      mode: row.mode,
      topicSetId: row.topic_set_id,
      topicTitle: row.topic_title,
      partCount: row.part_count,
      overallBand: row.overall_band,
      feedback: row.feedback,
      markedAt: row.marked_at,
      providerModel: row.provider_model,
      scoreSource: row.score_source ?? (row.overall_band !== null ? 'AI' : null),
      createdAt: row.created_at,
    },
    topic: topic
      ? { id: topic.id, title: topic.title, part1: topic.part1, part2: topic.part2, part3: topic.part3 }
      : null,
    responses: responses.results.map((response) => ({
      part: response.part,
      promptText: response.prompt_text,
      transcript: response.transcript,
      durationSeconds: response.duration_seconds,
      words: response.words,
      hasAudio: response.has_audio === 1,
    })),
    score: await loadSpeakingScore(env, session.id),
  };
}

/** Metadata used by the client picker. */
export function speakingCatalog(): Array<{ id: string; title: string; summary: string; partCount: number }> {
  return SPEAKING_TOPIC_SETS.map((set) => ({
    id: set.id,
    title: set.title,
    summary: set.summary,
    partCount: 3,
  }));
}

export const SPEAKING_PARTS = SPEAKING_PART_META;
