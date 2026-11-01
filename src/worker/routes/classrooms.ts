import { Hono } from 'hono';
import { z } from 'zod';
import type { AppBindings, Env } from '../env';
import { assertCsrf, assertSameOrigin } from '../lib/http';
import { ApiError } from '../lib/errors';
import { putBlob } from '../services/blob-store';
import { parseBody } from '../lib/validate';
import { requireAuth } from '../middleware/auth';
import { currentUser } from '../middleware/auth';
import { acceptClassroomInvite, joinClassroomByCode } from '../services/teacher-service';
import { newId } from '../lib/ids';
import { nowIso } from '../lib/ids';
import { classroomCallFeedback } from '../services/call-feedback-service';

const router = new Hono<AppBindings>();

router.use('/classrooms/*', requireAuth);
router.use('/classrooms/*', async (c, next) => {
  assertSameOrigin(c);
  await next();
});

/** Students join a classroom with an invitation link token or the join code. */
router.post('/classrooms/join', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(
    c,
    z.object({
      token: z.string().min(10).max(200).optional(),
      code: z.string().min(4).max(16).optional(),
    }),
  );

  if (!body.token && !body.code) {
    return c.json({ error: { code: 'VALIDATION_FAILED', message: 'Provide an invitation token or a join code.' } }, 400);
  }

  const result = body.token
    ? await acceptClassroomInvite(c.env, user, body.token)
    : await joinClassroomByCode(c.env, user, body.code!);

  return c.json({ ok: true, ...result });
});

router.get('/classrooms/mine', requireAuth, async (c) => {
  const user = currentUser(c);
  const rows = await c.env.DB.prepare(
    `SELECT c.id, c.name, c.description, c.status, m.role, m.joined_at,
            (SELECT COUNT(*) FROM assignments a WHERE a.classroom_id = c.id AND a.status = 'ACTIVE') AS active_assignments
       FROM classroom_members m
       JOIN classrooms c ON c.id = m.classroom_id
      WHERE m.user_id = ? AND m.status = 'ACTIVE'
      ORDER BY c.name`,
  )
    .bind(user.id)
    .all<{
      id: string;
      name: string;
      description: string;
      status: string;
      role: string;
      joined_at: string;
      active_assignments: number;
    }>();

  return c.json({
    classrooms: rows.results.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      status: row.status,
      role: row.role,
      joinedAt: row.joined_at,
      activeAssignments: row.active_assignments,
    })),
  });
});

/** Membership check shared by the course chat routes. */
async function assertClassroomAccess(env: Env, classroomId: string, userId: string, role: string) {
  if (role === 'ADMIN') {
    const row = await env.DB.prepare('SELECT id FROM classrooms WHERE id = ?').bind(classroomId).first<{ id: string }>();
    if (!row) throw ApiError.notFound('That classroom does not exist.');
    return;
  }
  const member = await env.DB.prepare(
    `SELECT 1 AS ok FROM classroom_members WHERE classroom_id = ? AND user_id = ? AND status = 'ACTIVE'
     UNION SELECT 1 AS ok FROM classrooms WHERE id = ? AND teacher_id = ? LIMIT 1`,
  )
    .bind(classroomId, userId, classroomId, userId)
    .first<{ ok: number }>();
  if (!member) throw ApiError.forbidden('Join this classroom to see its chat.');
}

interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  body: string;
  createdAt: string;
  attachmentUrl?: string | null;
  attachmentName?: string | null;
}

/** Teachers open a reusable room; students may only enter an existing room. */
router.post('/classrooms/:classroomId/room', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const classroomId = c.req.param('classroomId');
  const body = await parseBody(c, z.object({ schoolId: z.string().min(1).max(100).nullable().optional() }));
  await assertClassroomAccess(c.env, classroomId, user.id, user.role);
  const klass = await c.env.DB.prepare('SELECT id, name, teacher_id, status FROM classrooms WHERE id = ?')
    .bind(classroomId).first<{ id: string; name: string; teacher_id: string; status: string }>();
  if (!klass || klass.status !== 'ACTIVE') throw ApiError.conflict('This classroom is archived.');
  const host = user.id === klass.teacher_id || user.role === 'ADMIN';
  if (body.schoolId !== undefined && user.id !== klass.teacher_id) throw ApiError.forbidden('Chỉ giáo viên chủ lớp được chọn trường.');
  if (body.schoolId) {
    const member = await c.env.DB.prepare(`SELECT 1 AS ok FROM school_members m JOIN schools s ON s.id=m.school_id
      WHERE m.school_id=? AND m.user_id=? AND m.status='ACTIVE' AND s.status='APPROVED'`).bind(body.schoolId,user.id).first();
    if (!member) throw ApiError.forbidden('Bạn không thuộc trường đã chọn hoặc trường chưa được duyệt.');
  }
  const sessionId = `classroom-room-${classroomId}`;
  const existing = await c.env.DB.prepare('SELECT session_id FROM classroom_call_rooms WHERE classroom_id = ?')
    .bind(classroomId).first<{ session_id: string }>();
  if (!existing && !host) throw ApiError.notFound('The teacher has not opened the classroom call yet.');
  if (!existing) {
    const timestamp = nowIso();
    await c.env.DB.batch([
      c.env.DB.prepare(`INSERT OR IGNORE INTO mentor_sessions
        (id, mentor_id, student_id, class_id, kind, status, topic, starts_at, ends_at, created_at, updated_at)
        VALUES (?, ?, ?, NULL, 'CLASS', 'SCHEDULED', ?, ?, ?, ?, ?)`)
        .bind(sessionId, klass.teacher_id, klass.teacher_id, klass.name, timestamp, timestamp, timestamp, timestamp),
      c.env.DB.prepare('INSERT OR IGNORE INTO classroom_call_rooms (classroom_id, session_id, created_at) VALUES (?, ?, ?)')
        .bind(classroomId, sessionId, timestamp),
    ]);
  }
  const roomId = existing?.session_id ?? sessionId;
  if (body.schoolId !== undefined) {
    const brand = await c.env.DB.prepare('SELECT school_id FROM school_call_brand WHERE session_id=?').bind(roomId).first<{school_id:string}>();
    const active = await c.env.DB.prepare('SELECT 1 AS ok FROM mentor_room_presence WHERE session_id=? AND last_seen_at>=? LIMIT 1')
      .bind(roomId,new Date(Date.now()-30000).toISOString()).first();
    if (active && (brand?.school_id ?? null) !== body.schoolId) throw ApiError.conflict('Không thể đổi trường khi phòng đang có người.');
    if (body.schoolId) await c.env.DB.prepare(`INSERT INTO school_call_brand (session_id,school_id,selected_by,updated_at) VALUES (?,?,?,?)
      ON CONFLICT(session_id) DO UPDATE SET school_id=excluded.school_id,selected_by=excluded.selected_by,updated_at=excluded.updated_at`)
      .bind(roomId,body.schoolId,user.id,nowIso()).run();
    else await c.env.DB.prepare('DELETE FROM school_call_brand WHERE session_id=?').bind(roomId).run();
  }
  // An ended class room can be opened again by the host, not by students.
  const room = await c.env.DB.prepare('SELECT status FROM mentor_sessions WHERE id = ?').bind(roomId).first<{ status: string }>();
  if (!room) throw ApiError.notFound('The classroom room is unavailable.');
  if (room.status === 'COMPLETED' || room.status === 'CANCELLED') {
    if (!host) throw ApiError.conflict('The teacher has ended this call.');
    await c.env.DB.prepare("UPDATE mentor_sessions SET status = 'SCHEDULED', started_at = NULL, ended_at = NULL, updated_at = ? WHERE id = ?")
      .bind(nowIso(), roomId).run();
  }
  return c.json({ sessionId: roomId });
});

/** Owner-only online ratings; reading them never starts a call. */
router.get('/classrooms/:classroomId/call-feedback', async (c) => {
  c.header('Cache-Control', 'no-store');
  return c.json(await classroomCallFeedback(c.env, currentUser(c), c.req.param('classroomId')));
});

/** The course chat stream, newest 100, oldest first. */
router.get('/classrooms/:classroomId/messages', requireAuth, async (c) => {
  const user = currentUser(c);
  const classroomId = c.req.param('classroomId');
  await assertClassroomAccess(c.env, classroomId, user.id, user.role);
  const rows = await c.env.DB.prepare(
    `SELECT m.id, m.sender_id, m.body, m.created_at, m.attachment_url, m.attachment_name,
            COALESCE(NULLIF(p.display_name, ''), u.username, 'Someone') AS display_name
       FROM classroom_messages m
       JOIN users u ON u.id = m.sender_id
       LEFT JOIN user_profiles p ON p.user_id = m.sender_id
      WHERE m.classroom_id = ?
      ORDER BY m.created_at DESC
      LIMIT 100`,
  )
    .bind(classroomId)
    .all<{
      id: string;
      sender_id: string;
      body: string;
      created_at: string;
      attachment_url: string | null;
      attachment_name: string | null;
      display_name: string;
    }>();
  const messages: ChatMessage[] = rows.results
    .map((row) => ({
      id: row.id,
      senderId: row.sender_id,
      senderName: row.display_name,
      body: row.body,
      createdAt: row.created_at,
      attachmentUrl: row.attachment_url,
      attachmentName: row.attachment_name,
    }))
    .reverse();
  return c.json({ messages });
});

/** Post a course chat message. */
router.post('/classrooms/:classroomId/messages', requireAuth, async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const classroomId = c.req.param('classroomId');
  await assertClassroomAccess(c.env, classroomId, user.id, user.role);
  const body = await parseBody(
    c,
    z.object({
      body: z.string().max(4000).optional().default(''),
      /** Optional file: `data:<mime>;base64,…` up to 10 MB, kept in D1. */
      attachmentName: z.string().min(1).max(160).optional(),
      attachmentMime: z.string().min(3).max(120).optional(),
      attachmentBase64: z.string().min(8).max(15_000_000).optional(),
    }),
  );
  const text = body.body.trim();
  if (Boolean(body.attachmentBase64) !== Boolean(body.attachmentName)) throw ApiError.validation('Provide both a file and its name.');
  if (!text && !body.attachmentBase64) throw ApiError.validation('Write something or attach a file.');

  let attachmentUrl: string | null = null;
  let attachmentName: string | null = null;
  if (body.attachmentBase64 && body.attachmentName) {
    const payload = body.attachmentBase64.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
    if (payload.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) throw ApiError.validation('The file encoding is invalid.');
    const size = (payload.length / 4) * 3 - (payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0);
    if (size <= 0) throw ApiError.validation('The file is empty.');
    if (size > 10_485_760) throw ApiError.validation('Attachments are limited to 10 MB.');
    const assetId = newId('ast');
    const timestamp = nowIso();
    await c.env.DB.prepare(
      `INSERT INTO assets (id, kind, storage_kind, external_url, filename, mime, size_bytes, visibility, uploaded_by, created_at, updated_at)
       VALUES (?, 'OTHER', 'OBJECT_STORAGE', NULL, ?, ?, ?, 'PRIVATE', ?, ?, ?)`,
    )
      .bind(assetId, body.attachmentName, body.attachmentMime ?? 'application/octet-stream', size, user.id, timestamp, timestamp)
      .run();
    await putBlob(c.env, 'asset_blobs', 'asset_id', assetId, payload, { mime: body.attachmentMime ?? 'application/octet-stream' });
    attachmentUrl = `/api/files/${assetId}`;
    attachmentName = body.attachmentName;
  }

  const id = newId('ccm');
  const timestamp = nowIso();
  await c.env.DB.prepare(
    'INSERT INTO classroom_messages (id, classroom_id, sender_id, body, attachment_url, attachment_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(id, classroomId, user.id, text, attachmentUrl, attachmentName, timestamp)
    .run();
  const message: ChatMessage = {
    id,
    senderId: user.id,
    senderName: user.displayName || user.username || 'Someone',
    body: text,
    createdAt: timestamp,
    attachmentUrl,
    attachmentName,
  };
  return c.json({ message }, 201);
});

export default router;
