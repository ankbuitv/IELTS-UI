import type { Env } from '../env';
import type { AuthUser } from '../lib/auth-types';
import { ApiError } from '../lib/errors';
import { newId, nowIso, parseJson } from '../lib/ids';
import { assertRoomKey, assertSessionAccess, getSession } from './mentor-service';
import type { MentorSession } from '../../shared/mentor';
import type {
  BreakoutRoom,
  BreakoutState,
  ClassPoll,
  CreatePollInput,
  PollKind,
  WhiteboardState,
  WhiteboardStroke,
} from '../../shared/live';

/**
 * Live classroom extras layered on top of the call room: polls/quizzes,
 * breakout rooms and the shared whiteboard. Everything is scoped to a session
 * (and, for breakouts and boards, to the room key inside it).
 */

function isHost(session: MentorSession, viewer: AuthUser): boolean {
  return session.mentorId === viewer.id || viewer.role === 'ADMIN';
}

async function sessionFor(env: Env, viewer: AuthUser, sessionId: string, roomKey: string): Promise<MentorSession> {
  const session = await getSession(env, sessionId);
  await assertSessionAccess(env, session, viewer);
  await assertRoomKey(env, session, viewer, roomKey);
  return session;
}

// ------------------------------------------------------------------------- polls

interface PollRow {
  id: string;
  session_id: string;
  room_key: string;
  created_by: string;
  kind: string;
  question: string;
  options_json: string;
  correct_index: number | null;
  status: string;
  created_at: string;
  closed_at: string | null;
}

function toPoll(row: PollRow, mine: number | null, votes: Map<number, number>, reveal: boolean): ClassPoll {
  const texts = parseJson<string[]>(row.options_json, []);
  const total = [...votes.values()].reduce((sum, value) => sum + value, 0);
  return {
    id: row.id,
    sessionId: row.session_id,
    roomKey: row.room_key,
    createdBy: row.created_by,
    kind: (row.kind as PollKind) ?? 'QUIZ',
    question: row.question,
    options: texts.map((text, index) => ({ index, text, votes: votes.get(index) ?? 0 })),
    correctIndex: reveal ? row.correct_index : null,
    status: row.status === 'CLOSED' ? 'CLOSED' : 'OPEN',
    totalVotes: total,
    myChoice: mine,
    createdAt: row.created_at,
    closedAt: row.closed_at,
  };
}

const POLL_SELECT = `
  SELECT p.*,
         (SELECT choice_index FROM class_poll_answers a WHERE a.poll_id = p.id AND a.user_id = ?) AS my_choice
    FROM class_polls p
   WHERE p.session_id = ? AND p.room_key = ?
   ORDER BY p.created_at DESC
   LIMIT 12`;

async function hydratePolls(
  env: Env,
  rows: Array<PollRow & { my_choice: number | null }>,
  host: boolean,
): Promise<ClassPoll[]> {
  if (rows.length === 0) return [];
  const placeholders = rows.map(() => '?').join(', ');
  const counts = await env.DB.prepare(
    `SELECT poll_id, choice_index, COUNT(*) AS n
       FROM class_poll_answers
      WHERE poll_id IN (${placeholders})
      GROUP BY poll_id, choice_index`,
  )
    .bind(...rows.map((row) => row.id))
    .all<{ poll_id: string; choice_index: number; n: number }>();
  const byPoll = new Map<string, Map<number, number>>();
  for (const count of counts.results) {
    if (!byPoll.has(count.poll_id)) byPoll.set(count.poll_id, new Map());
    byPoll.get(count.poll_id)!.set(count.choice_index, count.n);
  }
  return rows.map((row) =>
    toPoll(row, row.my_choice, byPoll.get(row.id) ?? new Map(), host || row.status === 'CLOSED'),
  );
}

export async function listPolls(
  env: Env,
  viewer: AuthUser,
  sessionId: string,
  roomKey = 'main',
): Promise<ClassPoll[]> {
  const session = await sessionFor(env, viewer, sessionId, roomKey);
  const rows = await env.DB.prepare(POLL_SELECT)
    .bind(viewer.id, sessionId, roomKey)
    .all<PollRow & { my_choice: number | null }>();
  return hydratePolls(env, rows.results, isHost(session, viewer));
}

export async function createPoll(
  env: Env,
  viewer: AuthUser,
  sessionId: string,
  roomKey: string,
  input: CreatePollInput,
): Promise<ClassPoll> {
  const session = await sessionFor(env, viewer, sessionId, roomKey);
  if (!isHost(session, viewer)) throw ApiError.forbidden('Only the mentor can launch a poll.');
  const question = input.question.trim();
  const options = input.options.map((option) => option.trim());
  if (question.length < 3) throw ApiError.validation('Write the poll question first.');
  if (options.length < 2 || options.length > 6 || options.some(option => !option || option.length > 160)) throw ApiError.validation('A poll needs two to six non-empty options.');
  const correct = input.kind === 'POLL' ? null : input.correctIndex ?? null;
  if (input.kind !== 'POLL' && correct === null) throw ApiError.validation('Choose the correct answer for the quiz.');
  if (correct !== null && (correct < 0 || correct >= options.length)) {
    throw ApiError.validation('The correct answer is not one of the options.');
  }
  const id = newId('poll');
  const result = await env.DB.prepare(
    `INSERT INTO class_polls (id, session_id, room_key, created_by, kind, question, options_json, correct_index, status, created_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?
     WHERE EXISTS (SELECT 1 FROM mentor_room_presence WHERE session_id = ? AND room_key = ? AND user_id = ?)
       AND NOT EXISTS (SELECT 1 FROM class_polls WHERE session_id = ? AND room_key = ? AND status = 'OPEN')`,
  )
    .bind(id, sessionId, roomKey, viewer.id, input.kind === 'POLL' ? 'POLL' : 'QUIZ', question, JSON.stringify(options), correct, nowIso(), sessionId, roomKey, viewer.id, sessionId, roomKey)
    .run();
  if (!result.meta.changes) throw ApiError.conflict('Join this room and close the current question before launching another.');
  const row = await env.DB.prepare('SELECT * FROM class_polls WHERE id = ?')
    .bind(id)
    .first<PollRow>();
  if (!row) throw ApiError.notFound('Poll not found.');
  return toPoll(row, null, new Map(), true);
}

export async function answerPoll(
  env: Env,
  viewer: AuthUser,
  sessionId: string,
  pollId: string,
  choiceIndex: number,
): Promise<ClassPoll> {
  const session = await getSession(env, sessionId);
  await assertSessionAccess(env, session, viewer);
  const row = await env.DB.prepare('SELECT * FROM class_polls WHERE id = ? AND session_id = ?')
    .bind(pollId, sessionId)
    .first<PollRow>();
  if (!row) throw ApiError.notFound('Poll not found.');
  if (row.status !== 'OPEN') throw ApiError.conflict('This poll is closed.');
  await assertRoomKey(env, session, viewer, row.room_key);
  const count = parseJson<string[]>(row.options_json, []).length;
  if (choiceIndex < 0 || choiceIndex >= count) throw ApiError.validation('Pick one of the options.');
  if (isHost(session, viewer)) throw ApiError.forbidden('The host cannot answer their own poll.');
  const result = await env.DB.prepare(
    `INSERT INTO class_poll_answers (poll_id, user_id, choice_index, created_at)
     SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM class_polls p JOIN mentor_room_presence pr
       ON pr.session_id=p.session_id AND pr.room_key=p.room_key
       WHERE p.id=? AND p.session_id=? AND p.status='OPEN' AND pr.user_id=?)
     ON CONFLICT (poll_id, user_id) DO NOTHING`,
  )
    .bind(pollId, viewer.id, choiceIndex, nowIso(), pollId, sessionId, viewer.id)
    .run();
  if (!result.meta.changes) throw ApiError.conflict('Poll closed, already answered, or you are not in the room.');
  const votes = await env.DB.prepare(
    'SELECT choice_index, COUNT(*) AS n FROM class_poll_answers WHERE poll_id = ? GROUP BY choice_index',
  )
    .bind(pollId)
    .all<{ choice_index: number; n: number }>();
  return toPoll(
    row,
    choiceIndex,
    new Map(votes.results.map((vote) => [vote.choice_index, vote.n])),
    isHost(session, viewer),
  );
}

export async function closePoll(
  env: Env,
  viewer: AuthUser,
  sessionId: string,
  pollId: string,
): Promise<ClassPoll> {
  const session = await getSession(env, sessionId);
  await assertSessionAccess(env, session, viewer);
  if (!isHost(session, viewer)) throw ApiError.forbidden('Only the mentor can close a poll.');
  const row = await env.DB.prepare('SELECT * FROM class_polls WHERE id = ? AND session_id = ?')
    .bind(pollId, sessionId)
    .first<PollRow>();
  if (!row) throw ApiError.notFound('Poll not found.');
  const closedAt = nowIso();
  const result = await env.DB.prepare(`UPDATE class_polls SET status = 'CLOSED', closed_at = ? WHERE id = ? AND session_id = ? AND status = 'OPEN'
    AND EXISTS (SELECT 1 FROM mentor_room_presence WHERE session_id = ? AND room_key = ? AND user_id = ?)`)
    .bind(closedAt, pollId, sessionId, sessionId, row.room_key, viewer.id)
    .run();
  if (!result.meta.changes) throw ApiError.conflict('Poll already closed or you are not in the room.');
  const votes = await env.DB.prepare(
    'SELECT choice_index, COUNT(*) AS n FROM class_poll_answers WHERE poll_id = ? GROUP BY choice_index',
  )
    .bind(pollId)
    .all<{ choice_index: number; n: number }>();
  const mine = await env.DB.prepare('SELECT choice_index FROM class_poll_answers WHERE poll_id = ? AND user_id = ?')
    .bind(pollId, viewer.id)
    .first<{ choice_index: number }>();
  return toPoll(
    { ...row, status: 'CLOSED', closed_at: closedAt },
    mine?.choice_index ?? null,
    new Map(votes.results.map((vote) => [vote.choice_index, vote.n])),
    true,
  );
}

// ---------------------------------------------------------------------- breakouts

interface BreakoutRow {
  id: string;
  session_id: string;
  name: string;
  room_key: string;
  ends_at: string | null;
  created_at: string;
}

async function breakoutRooms(env: Env, sessionId: string): Promise<BreakoutRoom[]> {
  const rows = await env.DB.prepare(
    'SELECT id, session_id, name, room_key, ends_at, created_at FROM class_breakouts WHERE session_id = ? AND (ends_at IS NULL OR ends_at > ?) ORDER BY name',
  )
    .bind(sessionId, nowIso())
    .all<BreakoutRow>();
  if (rows.results.length === 0) return [];
  const placeholders = rows.results.map(() => '?').join(', ');
  const members = await env.DB.prepare(
    `SELECT m.breakout_id, m.user_id,
            COALESCE(NULLIF(p.display_name, ''), u.username, u.email) AS display_name,
            p.avatar_updated_at
       FROM class_breakout_members m
       JOIN users u ON u.id = m.user_id
       LEFT JOIN user_profiles p ON p.user_id = m.user_id
      WHERE m.breakout_id IN (${placeholders})
      ORDER BY m.assigned_at`,
  )
    .bind(...rows.results.map((row) => row.id))
    .all<{ breakout_id: string; user_id: string; display_name: string; avatar_updated_at: string | null }>();
  const byRoom = new Map<string, BreakoutRoom['members']>();
  for (const member of members.results) {
    if (!byRoom.has(member.breakout_id)) byRoom.set(member.breakout_id, []);
    byRoom.get(member.breakout_id)!.push({
      userId: member.user_id,
      displayName: member.display_name,
      avatarUpdatedAt: member.avatar_updated_at,
    });
  }
  return rows.results.map((row) => ({
    id: row.id,
    name: row.name,
    roomKey: row.room_key,
    endsAt: row.ends_at,
    members: byRoom.get(row.id) ?? [],
  }));
}

export async function listBreakouts(
  env: Env,
  viewer: AuthUser,
  sessionId: string,
): Promise<BreakoutState> {
  const session = await getSession(env, sessionId);
  await assertSessionAccess(env, session, viewer);
  const rooms = await breakoutRooms(env, sessionId);
  const mine = rooms.find((room) => room.members.some((member) => member.userId === viewer.id)) ?? null;
  return {
    rooms,
    myRoom: mine,
    endsAt: rooms.map((room) => room.endsAt).filter((value): value is string => Boolean(value)).sort()[0] ?? null,
    open: rooms.length > 0,
  };
}

export async function createBreakouts(
  env: Env,
  viewer: AuthUser,
  sessionId: string,
  input: { count: number; minutes: number },
): Promise<BreakoutState> {
  const session = await getSession(env, sessionId);
  await assertSessionAccess(env, session, viewer);
  if (!isHost(session, viewer)) throw ApiError.forbidden('Only the mentor can open breakout rooms.');
  const count = Math.max(2, Math.min(4, Math.round(input.count)));
  const minutes = Math.max(5, Math.min(60, Math.round(input.minutes)));

  const presence = await env.DB.prepare(
    `SELECT pr.user_id
       FROM mentor_room_presence pr
      WHERE pr.session_id = ? AND pr.room_key = 'main' AND pr.user_id <> ? AND pr.last_seen_at >= ?
      ORDER BY pr.joined_at, pr.user_id LIMIT 200`,
  )
    .bind(sessionId, session.mentorId, new Date(Date.now()-30_000).toISOString())
    .all<{ user_id: string }>();
  const students = presence.results.map((row) => row.user_id);
  if (students.length < 2) throw ApiError.conflict('At least two participants must be in the room to split them up.');

  // Atomic batch: a racing request cannot replace an active set or leave a
  // partially assigned set. Expired sets are removed only when opening anew.
  const endsAt = new Date(Date.now() + minutes * 60_000).toISOString();
  const createdAt = nowIso();
  const rooms = Array.from({length:count}, (_, index) => { const id = newId('brk'); return {id, name:`Room ${index+1}`, key:`breakout-${id}`}; });
  const first = rooms[0]!;
  const statements = [
    env.DB.prepare('DELETE FROM class_breakouts WHERE session_id=? AND ends_at IS NOT NULL AND ends_at <= ?').bind(sessionId,createdAt),
    env.DB.prepare(`INSERT INTO class_breakouts (id,session_id,name,room_key,ends_at,created_at)
      SELECT ?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM class_breakouts WHERE session_id=?)
      AND EXISTS (SELECT 1 FROM mentor_room_presence WHERE session_id=? AND room_key='main' AND user_id=? AND last_seen_at>=?)`)
      .bind(first.id,sessionId,first.name,first.key,endsAt,createdAt,sessionId,sessionId,viewer.id,new Date(Date.now()-30_000).toISOString()),
    ...rooms.slice(1).map(room => env.DB.prepare(`INSERT INTO class_breakouts (id,session_id,name,room_key,ends_at,created_at)
      SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM class_breakouts WHERE id=?)`)
      .bind(room.id,sessionId,room.name,room.key,endsAt,createdAt,first.id)),
    ...students.map((student,index) => env.DB.prepare(`INSERT INTO class_breakout_members (breakout_id,user_id,assigned_at)
      SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM class_breakouts WHERE id=?)`)
      .bind(rooms[index%rooms.length]!.id,student,createdAt,first.id)),
    env.DB.prepare(`INSERT INTO mentor_messages (id,session_id,sender_id,kind,body,created_at,room_key)
      SELECT ?,?,?,'SYSTEM',?,?,'main' WHERE EXISTS (SELECT 1 FROM class_breakouts WHERE id=?)`)
      .bind(newId('msg'),sessionId,viewer.id,`Breakout rooms opened for ${minutes} minutes.`,createdAt,first.id),
  ];
  const results = await env.DB.batch(statements);
  if (!results[1]?.meta.changes) throw ApiError.conflict('Join the main room and close the current breakout rooms first.');
  return listBreakouts(env, viewer, sessionId);
}

export async function closeBreakouts(
  env: Env,
  viewer: AuthUser,
  sessionId: string,
): Promise<BreakoutState> {
  const session = await getSession(env, sessionId);
  await assertSessionAccess(env, session, viewer);
  if (!isHost(session, viewer)) throw ApiError.forbidden('Only the mentor can close breakout rooms.');
  await env.DB.prepare('DELETE FROM class_breakouts WHERE session_id = ?').bind(sessionId).run();
  return { rooms: [], myRoom: null, endsAt: null, open: false };
}

/** Host announcement copied into the main room and each currently open room. */
export async function broadcastBreakouts(env:Env, viewer:AuthUser, sessionId:string, roomKey:string, body:string):Promise<{sent:number}> {
  const session=await sessionFor(env,viewer,sessionId,roomKey);
  if (!isHost(session,viewer)) throw ApiError.forbidden('Only the host can broadcast to breakout rooms.');
  const text=body.trim(); if (!text || text.length>500) throw ApiError.validation('Write a message of at most 500 characters.');
  const rooms=await breakoutRooms(env,sessionId);
  if (!rooms.length) throw ApiError.conflict('No breakout rooms are open.');
  const timestamp=nowIso(), targets=['main',...rooms.map(r=>r.roomKey)];
  const statements=targets.map(target=>env.DB.prepare(`INSERT INTO mentor_messages(id,session_id,sender_id,kind,body,created_at,room_key)
    SELECT ?,?,?,'SYSTEM',?,?,? WHERE EXISTS(SELECT 1 FROM mentor_room_presence WHERE session_id=? AND room_key=? AND user_id=? AND last_seen_at>=?)
      AND EXISTS (SELECT 1 FROM class_breakouts WHERE session_id=? AND (ends_at IS NULL OR ends_at > ?))
      AND (?='main' OR EXISTS (SELECT 1 FROM class_breakouts WHERE session_id=? AND room_key=? AND (ends_at IS NULL OR ends_at > ?)))`)
    .bind(newId('msg'),sessionId,viewer.id,`Thông báo tới các nhóm: ${text}`,timestamp,target,sessionId,roomKey,viewer.id,new Date(Date.now()-30_000).toISOString(),sessionId,timestamp,target,sessionId,target,timestamp));
  const results=await env.DB.batch(statements); const sent=results.reduce((n,result)=>n+result.meta.changes,0);
  if (!sent) throw ApiError.conflict('Join the call and open breakout rooms before broadcasting.');
  return {sent};
}

// --------------------------------------------------------------------- whiteboard

const MAX_STROKES = 600;
const MAX_POINTS = 800;

function sanitizeStrokes(input: unknown): WhiteboardStroke[] {
  if (!Array.isArray(input)) return [];
  const strokes: WhiteboardStroke[] = [];
  for (const raw of input.slice(0, MAX_STROKES)) {
    if (!raw || typeof raw !== 'object') continue;
    const stroke = raw as Partial<WhiteboardStroke>;
    if (!Array.isArray(stroke.points) || stroke.points.length < 2) continue;
    const points: Array<[number, number]> = [];
    for (const point of stroke.points.slice(0, MAX_POINTS)) {
      if (!Array.isArray(point) || point.length < 2) continue;
      const x = Number(point[0]);
      const y = Number(point[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      points.push([Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y))]);
    }
    if (points.length < 2) continue;
    const color = typeof stroke.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(stroke.color) ? stroke.color : '#f5f3ff';
    const width = Math.max(1, Math.min(24, Number(stroke.width) || 3));
    strokes.push({ color, width, points });
  }
  return strokes;
}

async function readBoard(env: Env, sessionId: string, roomKey: string): Promise<WhiteboardState> {
  const row = await env.DB.prepare(
    'SELECT revision, strokes_json, updated_by, updated_at FROM class_whiteboards WHERE session_id = ? AND room_key = ?',
  )
    .bind(sessionId, roomKey)
    .first<{ revision: number; strokes_json: string; updated_by: string | null; updated_at: string }>();
  if (!row) return { revision: 0, strokes: [], updatedAt: null, updatedBy: null, saved: true };
  return {
    revision: row.revision,
    strokes: parseJson<WhiteboardStroke[]>(row.strokes_json, []),
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
    saved: true,
  };
}

export async function getWhiteboard(
  env: Env,
  viewer: AuthUser,
  sessionId: string,
  roomKey = 'main',
): Promise<WhiteboardState> {
  await sessionFor(env, viewer, sessionId, roomKey);
  return readBoard(env, sessionId, roomKey);
}

export async function saveWhiteboard(
  env: Env,
  viewer: AuthUser,
  sessionId: string,
  roomKey: string,
  baseRevision: number,
  input: unknown,
): Promise<WhiteboardState> {
  const session = await sessionFor(env, viewer, sessionId, roomKey);
  const strokes = sanitizeStrokes(input);
  const current = await readBoard(env, sessionId, roomKey);
  if (baseRevision !== current.revision) return { ...current, saved: false };
  if (!isHost(session, viewer)) {
    // Learners may append one stroke or undo the last, but cannot clear or
    // replace earlier work. Compare canonical JSON from validated strokes.
    const append = strokes.length === current.strokes.length + 1 && JSON.stringify(strokes.slice(0,-1)) === JSON.stringify(current.strokes);
    const undo = strokes.length > 0 && strokes.length === current.strokes.length - 1 && JSON.stringify(strokes) === JSON.stringify(current.strokes.slice(0,-1));
    if (!append && !undo) throw ApiError.forbidden('Only the host can clear or replace earlier strokes.');
  }
  const revision = current.revision + 1;
  const updatedAt = nowIso();
  let changed: number;
  if (current.updatedAt === null) {
    const result = await env.DB.prepare(
      `INSERT INTO class_whiteboards (session_id, room_key, revision, strokes_json, updated_by, updated_at)
       SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS
         (SELECT 1 FROM mentor_room_presence WHERE session_id=? AND room_key=? AND user_id=?)
       ON CONFLICT (session_id, room_key) DO NOTHING`,
    ).bind(sessionId, roomKey, revision, JSON.stringify(strokes), viewer.id, updatedAt, sessionId, roomKey, viewer.id).run();
    changed = result.meta.changes;
  } else {
    const result = await env.DB.prepare(
      `UPDATE class_whiteboards SET revision = ?, strokes_json = ?, updated_by = ?, updated_at = ?
       WHERE session_id = ? AND room_key = ? AND revision = ? AND EXISTS
         (SELECT 1 FROM mentor_room_presence WHERE session_id=? AND room_key=? AND user_id=?)`,
    ).bind(revision, JSON.stringify(strokes), viewer.id, updatedAt, sessionId, roomKey, baseRevision, sessionId, roomKey, viewer.id).run();
    changed = result.meta.changes;
  }
  if (!changed) {
    const present = await env.DB.prepare('SELECT 1 AS ok FROM mentor_room_presence WHERE session_id=? AND room_key=? AND user_id=?').bind(sessionId,roomKey,viewer.id).first();
    if (!present) throw ApiError.conflict('Join the room before writing on the board.');
    return { ...(await readBoard(env,sessionId,roomKey)), saved:false };
  }
  return readBoard(env, sessionId, roomKey);
}

// ---------------------------------------------------------------------- live Q&A
async function liveQuestionAccess(env:Env,viewer:AuthUser,sessionId:string,room:string){const session=await sessionFor(env,viewer,sessionId,room);const presence=await env.DB.prepare('SELECT 1 FROM mentor_room_presence WHERE session_id=? AND room_key=? AND user_id=? AND last_seen_at>=?').bind(sessionId,room,viewer.id,new Date(Date.now()-30000).toISOString()).first();if(!presence)throw ApiError.forbidden('Bạn cần ở trong phòng để sử dụng bảng câu hỏi.');return session;}
export async function liveQuestions(env:Env,viewer:AuthUser,sessionId:string,room:string){await liveQuestionAccess(env,viewer,sessionId,room);return(await env.DB.prepare(`SELECT q.id,q.author_id,q.body,q.status,q.created_at,COALESCE(NULLIF(p.display_name,''),u.username,'Thành viên') AS author FROM live_room_questions q JOIN users u ON u.id=q.author_id LEFT JOIN user_profiles p ON p.user_id=u.id WHERE q.session_id=? AND q.room_key=? ORDER BY CASE q.status WHEN 'OPEN' THEN 0 ELSE 1 END,q.created_at,q.id LIMIT 200`).bind(sessionId,room).all()).results;}
export async function askLiveQuestion(env:Env,viewer:AuthUser,sessionId:string,room:string,body:string){await liveQuestionAccess(env,viewer,sessionId,room);if(!body.trim()||body.trim().length>1000)throw ApiError.validation('Câu hỏi cần 1–1000 ký tự.');const now=nowIso();const result=await env.DB.prepare(`INSERT INTO live_room_questions(id,session_id,room_key,author_id,body,created_at,updated_at) SELECT ?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM live_room_questions WHERE session_id=? AND room_key=?)<200 AND EXISTS(SELECT 1 FROM mentor_room_presence WHERE session_id=? AND room_key=? AND user_id=? AND last_seen_at>=?)`).bind(newId('lq'),sessionId,room,viewer.id,body.trim(),now,now,sessionId,room,sessionId,room,viewer.id,new Date(Date.now()-30000).toISOString()).run();if(!result.meta.changes)throw ApiError.conflict('Bảng đã đầy hoặc bạn đã rời phòng.');}
export async function changeLiveQuestion(env:Env,viewer:AuthUser,sessionId:string,room:string,id:string,status:'OPEN'|'ANSWERED'|'DELETE'){const session=await liveQuestionAccess(env,viewer,sessionId,room);const host=isHost(session,viewer);if(status!=='DELETE'&&!host)throw ApiError.forbidden('Chỉ chủ phòng được đánh dấu câu hỏi.');const presence=`EXISTS(SELECT 1 FROM mentor_room_presence WHERE session_id=? AND room_key=? AND user_id=? AND last_seen_at>=?)`,since=new Date(Date.now()-30000).toISOString();const stmt=status==='DELETE'?env.DB.prepare(`DELETE FROM live_room_questions WHERE id=? AND session_id=? AND room_key=? AND (?=1 OR author_id=?) AND ${presence}`).bind(id,sessionId,room,+host,viewer.id,sessionId,room,viewer.id,since):env.DB.prepare(`UPDATE live_room_questions SET status=?,updated_at=? WHERE id=? AND session_id=? AND room_key=? AND ${presence}`).bind(status,nowIso(),id,sessionId,room,sessionId,room,viewer.id,since);if(!(await stmt.run()).meta.changes)throw ApiError.notFound();}
