import {getClassChatMute,setClassChatMute} from '../services/classroom-chat-mutes';
import {listUnreadMarks,markUnread,unmarkUnread} from '../services/classroom-unread';
import {mentionable,resolveMentionTargets,mentionStatements} from '../services/classroom-mentions';
import {assertThreadRoot,listThread} from '../services/classroom-threads';
import {listMessagePins,pinMessage,unpinMessage} from '../services/classroom-message-pins';
import {assertClassroomChatAccess,searchClassroomMessages} from '../services/classroom-message-search';
import {listStudentWorksheets,studentWorksheetDetail,submitWorksheet} from '../services/class-worksheet-service';
import {listStudentSupport,bookSupport,cancelStudentBooking} from '../services/teacher-support-service';
import {assignmentEligible} from '../services/assignment-audience';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppBindings } from '../env';
import { assertCsrf, assertSameOrigin } from '../lib/http';
import { ApiError } from '../lib/errors';
import { putBlob } from '../services/blob-store';
import { parseBody } from '../lib/validate';
import { requireAuth } from '../middleware/auth';
import { currentUser } from '../middleware/auth';
import { acceptClassroomInvite, joinClassroomByCode } from '../services/teacher-service';
import { newId } from '../lib/ids';
import { nowIso } from '../lib/ids';
import {studentTermReports} from '../services/class-term-report-service';
import {listSharedResources,readSharedResource,setClassResourcePin} from '../services/teacher-resources-service';
import { listClassroomBoard,createAnnouncement,pinAnnouncement,deleteAnnouncement,readAnnouncement,createPoll,closePoll,votePoll } from '../services/classroom-board-service';
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
            (SELECT COUNT(*) FROM assignments a WHERE a.classroom_id = c.id AND a.status = 'ACTIVE' AND (m.role!='STUDENT' OR ${assignmentEligible('a','m.user_id')})) AS active_assignments
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

interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  body: string;
  createdAt: string;
  attachmentUrl?: string | null;
  attachmentName?: string | null;
}

router.get('/classrooms/:classroomId/worksheets',async c=>c.json({worksheets:await listStudentWorksheets(c.env,currentUser(c),c.req.param('classroomId'))}));
router.get('/classrooms/:classroomId/worksheets/:worksheetId',async c=>c.json(await studentWorksheetDetail(c.env,currentUser(c),c.req.param('classroomId'),c.req.param('worksheetId'))));
router.post('/classrooms/:classroomId/worksheets/:worksheetId/submit',async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);const body=await parseBody(c,z.object({answers:z.array(z.object({questionId:z.string().min(1),answer:z.string().max(8000)})).min(1).max(20)}));return c.json(await submitWorksheet(c.env,currentUser(c),c.req.param('classroomId'),c.req.param('worksheetId'),body.answers),201);});

router.get('/classrooms/:classroomId/support',async c=>c.json({slots:await listStudentSupport(c.env,currentUser(c),c.req.param('classroomId'))}));
router.post('/classrooms/:classroomId/support/:slotId/book',async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);const body=await parseBody(c,z.object({note:z.string().trim().max(500).default('')}));await bookSupport(c.env,currentUser(c),c.req.param('classroomId'),c.req.param('slotId'),body.note);return c.json({ok:true});});
router.post('/classrooms/:classroomId/support/:slotId/cancel',async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);await cancelStudentBooking(c.env,currentUser(c),c.req.param('classroomId'),c.req.param('slotId'));return c.json({ok:true});});

router.get('/classrooms/:classroomId/term-reports',async c=>c.json({reports:await studentTermReports(c.env,currentUser(c),c.req.param('classroomId'))}));

router.get('/classrooms/:classroomId/resources',async c=>c.json({files:await listSharedResources(c.env,currentUser(c),c.req.param('classroomId'))}));
router.put('/classrooms/:classroomId/resources/:id/pin',async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);const body=await parseBody(c,z.object({pinned:z.boolean()}));await setClassResourcePin(c.env,currentUser(c),c.req.param('classroomId'),c.req.param('id'),body.pinned);return c.json({ok:true});});
router.get('/classrooms/:classroomId/resources/:id',async c=>c.json({file:await readSharedResource(c.env,currentUser(c),c.req.param('classroomId'),c.req.param('id'))}));

router.get('/classrooms/:classroomId/board', async c=>c.json(await listClassroomBoard(c.env,currentUser(c),c.req.param('classroomId'))));
router.post('/classrooms/:classroomId/announcements', async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);const body=await parseBody(c,z.object({title:z.string().trim().min(1).max(150),body:z.string().trim().min(1).max(5000)}));return c.json({id:await createAnnouncement(c.env,currentUser(c),c.req.param('classroomId'),body.title,body.body)},201);});
router.patch('/classrooms/:classroomId/announcements/:id', async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);const body=await parseBody(c,z.object({pinned:z.boolean()}));await pinAnnouncement(c.env,currentUser(c),c.req.param('classroomId'),c.req.param('id'),body.pinned);return c.json({ok:true});});
router.delete('/classrooms/:classroomId/announcements/:id', async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);await deleteAnnouncement(c.env,currentUser(c),c.req.param('classroomId'),c.req.param('id'));return c.json({ok:true});});
router.post('/classrooms/:classroomId/announcements/:id/read', async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);await readAnnouncement(c.env,currentUser(c),c.req.param('classroomId'),c.req.param('id'));return c.json({ok:true});});
router.post('/classrooms/:classroomId/polls', async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);const body=await parseBody(c,z.object({question:z.string().trim().min(1).max(300),choices:z.array(z.string().trim().min(1).max(150)).min(2).max(6)}));return c.json({id:await createPoll(c.env,currentUser(c),c.req.param('classroomId'),body.question,body.choices)},201);});
router.post('/classrooms/:classroomId/polls/:id/close', async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);await closePoll(c.env,currentUser(c),c.req.param('classroomId'),c.req.param('id'));return c.json({ok:true});});
router.put('/classrooms/:classroomId/polls/:id/vote', async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);const body=await parseBody(c,z.object({choice:z.number().int().min(0).max(5)}));await votePoll(c.env,currentUser(c),c.req.param('classroomId'),c.req.param('id'),body.choice);return c.json({ok:true});});

/** Teachers open a reusable room; students may only enter an existing room. */
router.post('/classrooms/:classroomId/room', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const classroomId = c.req.param('classroomId');
  const body = await parseBody(c, z.object({ schoolId: z.string().min(1).max(100).nullable().optional() }));
  await assertClassroomChatAccess(c.env, classroomId, user);
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
    if (active && (brand?.school_id ?? null) !== body.schoolId) throw ApiError.conflict('Không thể đổi tư cách khi phòng đang có người.');
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

router.get('/classrooms/:classroomId/chat-mute',async c=>{c.header('Cache-Control','no-store');return c.json(await getClassChatMute(c.env,currentUser(c),c.req.param('classroomId')));});
router.put('/classrooms/:classroomId/chat-mute',async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);const body=await parseBody(c,z.object({minutes:z.number().int().min(1).max(10080).nullable()}));await setClassChatMute(c.env,currentUser(c),c.req.param('classroomId'),body.minutes);return c.json({ok:true});});
router.get('/classrooms/:classroomId/unread-marks',async c=>{c.header('Cache-Control','no-store');return c.json({messages:await listUnreadMarks(c.env,currentUser(c),c.req.param('classroomId'))});});
router.put('/classrooms/:classroomId/unread-marks/:messageId',async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);await markUnread(c.env,currentUser(c),c.req.param('classroomId'),c.req.param('messageId'));return c.json({ok:true});});
router.delete('/classrooms/:classroomId/unread-marks/:messageId',async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);await unmarkUnread(c.env,currentUser(c),c.req.param('classroomId'),c.req.param('messageId'));return c.json({ok:true});});
router.get('/classrooms/:classroomId/mentionable',async c=>{c.header('Cache-Control','no-store');return c.json({members:await mentionable(c.env,currentUser(c),c.req.param('classroomId'))});});
router.get('/classrooms/:classroomId/messages/:rootId/replies',async c=>{c.header('Cache-Control','no-store');return c.json(await listThread(c.env,currentUser(c),c.req.param('classroomId'),c.req.param('rootId')));});
router.get('/classrooms/:classroomId/message-pins',async c=>{c.header('Cache-Control','no-store');return c.json(await listMessagePins(c.env,currentUser(c),c.req.param('classroomId')));});
router.put('/classrooms/:classroomId/message-pins/:messageId',async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);await pinMessage(c.env,currentUser(c),c.req.param('classroomId'),c.req.param('messageId'));return c.json({ok:true});});
router.delete('/classrooms/:classroomId/message-pins/:messageId',async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);await unpinMessage(c.env,currentUser(c),c.req.param('classroomId'),c.req.param('messageId'));return c.json({ok:true});});

/** Search all classroom history with a stable cursor; only authorized members can read it. */
router.get('/classrooms/:classroomId/messages/search',async c=>{
 const query=c.req.query('q')??'',time=c.req.query('beforeTime'),id=c.req.query('beforeId');
 if((time&&!id)||(id&&!time))throw ApiError.validation('Vị trí tìm kiếm không hợp lệ.');
 c.header('Cache-Control','no-store');
 return c.json(await searchClassroomMessages(c.env,currentUser(c),c.req.param('classroomId'),query,time&&id?{time,id}:undefined));
});

/** The course chat stream, newest 100, oldest first. */
router.get('/classrooms/:classroomId/messages', requireAuth, async (c) => {
  const user = currentUser(c);
  const classroomId = c.req.param('classroomId');
  await assertClassroomChatAccess(c.env, classroomId, user);
  const rows = await c.env.DB.prepare(
    `SELECT m.id, m.sender_id, m.body, m.created_at, m.attachment_url, m.attachment_name,
            COALESCE(NULLIF(TRIM(p.display_name), ''), NULLIF(TRIM(u.username), ''), NULLIF(substr(u.email, 1, instr(u.email, '@') - 1), ''), 'Học viên') AS display_name
       FROM classroom_messages m
       JOIN users u ON u.id = m.sender_id
       LEFT JOIN user_profiles p ON p.user_id = m.sender_id
      WHERE m.classroom_id = ? AND NOT EXISTS(SELECT 1 FROM classroom_message_replies reply WHERE reply.message_id=m.id)
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
  await assertClassroomChatAccess(c.env, classroomId, user);
  const body = await parseBody(
    c,
    z.object({
      body: z.string().max(4000).optional().default(''),
      replyTo: z.string().min(1).max(100).optional(),
      mentions: z.array(z.string().min(1).max(100)).max(10).optional().default([]),
      /** Optional file: `data:<mime>;base64,…` up to 10 MB, kept in D1. */
      attachmentName: z.string().min(1).max(160).optional(),
      attachmentMime: z.string().min(3).max(120).optional(),
      attachmentBase64: z.string().min(8).max(15_000_000).optional(),
    }),
  );
  const targets=await resolveMentionTargets(c.env,user,classroomId,body.mentions);
  const prefix=targets.map(person=>`@${person.name}`).join(' ');
  const text = [prefix,body.body.trim()].filter(Boolean).join(' ');
  if(text.length>4000)throw ApiError.validation('Nội dung và tên được nhắc đến không được quá 4000 ký tự.');
  if (Boolean(body.attachmentBase64) !== Boolean(body.attachmentName)) throw ApiError.validation('Provide both a file and its name.');
  if (!text && !body.attachmentBase64) throw ApiError.validation('Write something or attach a file.');
  if(body.replyTo)await assertThreadRoot(c.env,classroomId,body.replyTo);

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
  const insert=c.env.DB.prepare('INSERT INTO classroom_messages (id, classroom_id, sender_id, body, attachment_url, attachment_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, classroomId, user.id, text, attachmentUrl, attachmentName, timestamp);
  const operations=[insert,...(body.replyTo?[c.env.DB.prepare('INSERT INTO classroom_message_replies(message_id,classroom_id,root_id,created_at) VALUES(?,?,?,?)').bind(id,classroomId,body.replyTo,timestamp)]:[]),...mentionStatements(c.env,classroomId,id,targets,timestamp)];
  try{if(operations.length>1)await c.env.DB.batch(operations);else await insert.run();}catch(error){if((error as Error).message.includes('CHECK constraint failed'))throw ApiError.conflict('Thành viên được đề cập không còn thuộc lớp; hãy chọn lại.');throw error;}
  const message: ChatMessage = {
    id,
    senderId: user.id,
    senderName: user.displayName?.trim() || user.username?.trim() || user.email.split('@')[0] || 'Học viên',
    body: text,
    createdAt: timestamp,
    attachmentUrl,
    attachmentName,
  };
  return c.json({ message }, 201);
});

export default router;
