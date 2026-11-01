import type { Env } from '../env';
import type { AuthUser } from '../lib/auth-types';
import { ApiError } from '../lib/errors';
import { newId, nowIso } from '../lib/ids';
import { notifyMany } from './notification-service';
import { requireClassroomAccess } from './teacher-service';

type Occurrence = { startsAt: string; endsAt: string };
type EventInput = Occurrence & { title: string; kind?: 'REGULAR' | 'MAKEUP'; note?: string; occurrences?: Occurrence[] };

export async function listTeachingSchedule(env: Env, user: AuthUser, classId: string) {
  await requireClassroomAccess(env, user, classId);
  return (await env.DB.prepare(`SELECT e.id,e.title,e.starts_at,e.ends_at,e.teacher_id,e.series_id,e.kind,e.note,COALESCE(NULLIF(p.display_name,''),u.email) AS teacher_name FROM classroom_teaching_events e JOIN users u ON u.id=e.teacher_id LEFT JOIN user_profiles p ON p.user_id=e.teacher_id WHERE e.classroom_id=? ORDER BY e.starts_at DESC LIMIT 200`).bind(classId).all()).results;
}

function validateTime(value: Occurrence): Occurrence {
  const start = new Date(value.startsAt), end = new Date(value.endsAt);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start || end.getTime() - start.getTime() > 24 * 3600000) throw ApiError.validation('Thời gian dạy không hợp lệ.');
  return { startsAt: start.toISOString(), endsAt: end.toISOString() };
}

async function notifyClass(env: Env, classId: string, title: string, body: string) {
  try {
    const recipients = await env.DB.prepare(`SELECT u.id FROM classroom_members m JOIN users u ON u.id=m.user_id AND u.status='ACTIVE' WHERE m.classroom_id=? AND m.role='STUDENT' AND m.status='ACTIVE' LIMIT 500`).bind(classId).all<{id:string}>();
    await notifyMany(env, recipients.results.map(row => row.id), { kind: 'CLASS', title, body, href: `/classrooms/${encodeURIComponent(classId)}` });
  } catch (error) { console.error('teaching_schedule_notification_failed', (error as Error).message); }
}

export async function createTeachingEvent(env: Env, user: AuthUser, classId: string, input: EventInput) {
  const classroom = await requireClassroomAccess(env, user, classId);
  if (classroom.status !== 'ACTIVE') throw ApiError.conflict('Lớp đã lưu trữ.');
  const occurrences = [input, ...(input.occurrences ?? [])].map(validateTime);
  if (occurrences.length > 24 || occurrences.some((v, i) => i > 0 && v.startsAt <= occurrences[i - 1]!.startsAt) || new Date(occurrences.at(-1)!.startsAt).getTime() - new Date(occurrences[0]!.startsAt).getTime() > 2 * 366 * 86400000) throw ApiError.validation('Lịch lặp phải theo thứ tự, tối đa 24 buổi trong hai năm.');
  const kind = input.kind ?? 'REGULAR', note = input.note?.trim() ?? '';
  if (kind === 'MAKEUP' && !note) throw ApiError.validation('Vui lòng nhập lý do dạy bù.');
  const seriesId = occurrences.length > 1 ? newId('series') : null;
  const ids = occurrences.map(() => newId('teach'));
  const teacherId = user.role === 'ADMIN' ? classroom.teacher_id : user.id;
  const now = nowIso();
  await env.DB.batch(occurrences.map((event, i) => env.DB.prepare('INSERT INTO classroom_teaching_events(id,classroom_id,teacher_id,title,starts_at,ends_at,created_at,series_id,kind,note) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(ids[i], classId, teacherId, input.title, event.startsAt, event.endsAt, now, seriesId, kind, note)));
  if (kind === 'MAKEUP') await notifyClass(env, classId, 'Lớp có lịch dạy bù', `${input.title} · ${note}`);
  return { id: ids[0]!, count: occurrences.length, seriesId };
}

export async function updateTeachingEvent(env: Env, user: AuthUser, classId: string, id: string, input: EventInput) {
  const classroom = await requireClassroomAccess(env, user, classId);
  if (classroom.status !== 'ACTIVE') throw ApiError.conflict('Lớp đã lưu trữ.');
  const time = validateTime(input), kind = input.kind ?? 'REGULAR', note = input.note?.trim() ?? '';
  if (kind === 'MAKEUP' && !note) throw ApiError.validation('Vui lòng nhập lý do dạy bù.');
  const result = await env.DB.prepare(`UPDATE classroom_teaching_events SET title=?,starts_at=?,ends_at=?,kind=?,note=? WHERE id=? AND classroom_id=? AND (teacher_id=? OR ?=1)`).bind(input.title, time.startsAt, time.endsAt, kind, note, id, classId, user.id, +(user.role === 'ADMIN' || classroom.teacher_id === user.id)).run();
  if (!result.meta.changes) throw ApiError.notFound();
  await notifyClass(env, classId, kind === 'MAKEUP' ? 'Lịch dạy bù đã thay đổi' : 'Lịch dạy đã thay đổi', `${input.title}${note ? ` · ${note}` : ''}`);
}

export async function deleteTeachingEvent(env: Env, user: AuthUser, classId: string, id: string) {
  const c = await requireClassroomAccess(env, user, classId);
  if (c.status !== 'ACTIVE') throw ApiError.conflict('Lớp đã lưu trữ.');
  const result = await env.DB.prepare('DELETE FROM classroom_teaching_events WHERE id=? AND classroom_id=? AND (teacher_id=? OR ?=1)').bind(id, classId, user.id, +(user.role === 'ADMIN' || c.teacher_id === user.id)).run();
  if (!result.meta.changes) throw ApiError.notFound();
}
