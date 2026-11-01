import type { Env } from '../env';
import type { AuthUser } from '../lib/auth-types';
import { ApiError } from '../lib/errors';
import { newId, nowIso } from '../lib/ids';
import { assertSessionAccess, getSession } from './mentor-service';

async function hostSession(env: Env, viewer: AuthUser, sessionId: string) {
  const session = await getSession(env, sessionId);
  await assertSessionAccess(env, session, viewer);
  if (viewer.id !== session.mentorId && viewer.role !== 'ADMIN') throw ApiError.forbidden('Only the host can see call reports.');
  return session;
}

export async function callReport(env: Env, viewer: AuthUser, sessionId: string) {
  await hostSession(env, viewer, sessionId);
  const attendance = await env.DB.prepare(`SELECT a.id, a.user_id AS userId, a.joined_at AS joinedAt,
    a.last_seen_at AS lastSeenAt, a.left_at AS leftAt, COALESCE(NULLIF(p.display_name,''), u.username, 'Someone') AS name
    FROM call_attendance a JOIN users u ON u.id = a.user_id LEFT JOIN user_profiles p ON p.user_id = a.user_id
    WHERE a.session_id = ? ORDER BY a.joined_at DESC LIMIT 200`).bind(sessionId).all();
  const feedback = await env.DB.prepare(`SELECT f.id, f.rating, f.comment, f.created_at AS createdAt,
    COALESCE(NULLIF(p.display_name,''), u.username, 'Someone') AS name FROM call_feedback f
    JOIN users u ON u.id = f.user_id LEFT JOIN user_profiles p ON p.user_id = f.user_id
    WHERE f.session_id = ? ORDER BY f.created_at DESC LIMIT 100`).bind(sessionId).all();
  return { attendance: attendance.results, feedback: feedback.results };
}

export async function submitCallFeedback(env: Env, viewer: AuthUser, sessionId: string, rating: number, comment: string) {
  const session = await getSession(env, sessionId);
  await assertSessionAccess(env, session, viewer);
  if (viewer.id === session.mentorId || viewer.role === 'ADMIN') throw ApiError.forbidden('Only participants can submit feedback.');
  const attendance = await env.DB.prepare(`SELECT id FROM call_attendance WHERE session_id = ? AND user_id = ? AND left_at IS NOT NULL ORDER BY joined_at DESC LIMIT 1`)
    .bind(sessionId, viewer.id).first<{ id: string }>();
  if (!attendance) throw ApiError.forbidden('Join and leave the call before submitting feedback.');
  const existing = await env.DB.prepare('SELECT id FROM call_feedback WHERE attendance_id = ?').bind(attendance.id).first<{ id: string }>();
  if (existing) throw ApiError.conflict('You already sent feedback for this visit.');
  await env.DB.prepare('INSERT INTO call_feedback (id,session_id,attendance_id,user_id,rating,comment,created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(newId('cfb'), sessionId, attendance.id, viewer.id, rating, comment.trim(), nowIso()).run();
}
