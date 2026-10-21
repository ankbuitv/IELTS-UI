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
  const options = input.options.map((option) => option.trim()).filter(Boolean).slice(0, 6);
  if (question.length < 3) throw ApiError.validation('Write the poll question first.');
  if (options.length < 2) throw ApiError.validation('A poll needs at least two options.');
  const correct = input.correctIndex ?? null;
  if (correct !== null && (correct < 0 || correct >= options.length)) {
    throw ApiError.validation('The correct answer is not one of the options.');
  }
  const id = newId('poll');
  await env.DB.prepare(
    `INSERT INTO class_polls (id, session_id, room_key, created_by, kind, question, options_json, correct_index, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?)`,
  )
    .bind(id, sessionId, roomKey, viewer.id, input.kind === 'POLL' ? 'POLL' : 'QUIZ', question, JSON.stringify(options), correct, nowIso())
    .run();
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
  await env.DB.prepare(
    `INSERT INTO class_poll_answers (poll_id, user_id, choice_index, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (poll_id, user_id) DO UPDATE SET choice_index = excluded.choice_index, created_at = excluded.created_at`,
  )
    .bind(pollId, viewer.id, choiceIndex, nowIso())
    .run();
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
  await env.DB.prepare("UPDATE class_polls SET status = 'CLOSED', closed_at = ? WHERE id = ?")
    .bind(nowIso(), pollId)
    .run();
  const votes = await env.DB.prepare(
    'SELECT choice_index, COUNT(*) AS n FROM class_poll_answers WHERE poll_id = ? GROUP BY choice_index',
  )
    .bind(pollId)
    .all<{ choice_index: number; n: number }>();
  const mine = await env.DB.prepare('SELECT choice_index FROM class_poll_answers WHERE poll_id = ? AND user_id = ?')
    .bind(pollId, viewer.id)
    .first<{ choice_index: number }>();
  return toPoll(
    { ...row, status: 'CLOSED', closed_at: nowIso() },
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
    'SELECT id, session_id, name, room_key, ends_at, created_at FROM class_breakouts WHERE session_id = ? ORDER BY name',
  )
    .bind(sessionId)
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
      WHERE pr.session_id = ? AND pr.room_key = 'main' AND pr.user_id <> ?
      ORDER BY pr.joined_at`,
  )
    .bind(sessionId, session.mentorId)
    .all<{ user_id: string }>();
  const students = presence.results.map((row) => row.user_id);
  if (students.length < 2) throw ApiError.conflict('At least two participants must be in the room to split them up.');

  // Recreating replaces the previous set of rooms (and their assignments).
  await env.DB.prepare('DELETE FROM class_breakouts WHERE session_id = ?').bind(sessionId).run();
  const endsAt = new Date(Date.now() + minutes * 60_000).toISOString();
  const createdAt = nowIso();
  const rooms: Array<{ id: string; name: string; key: string }> = [];
  for (let index = 0; index < count; index += 1) {
    const id = newId('brk');
    const key = `breakout-${index + 1}`;
    await env.DB.prepare(
      'INSERT INTO class_breakouts (id, session_id, name, room_key, ends_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
      .bind(id, sessionId, `Room ${index + 1}`, key, endsAt, createdAt)
      .run();
    rooms.push({ id, name: `Room ${index + 1}`, key });
  }
  for (let index = 0; index < students.length; index += 1) {
    await env.DB.prepare(
      'INSERT INTO class_breakout_members (breakout_id, user_id, assigned_at) VALUES (?, ?, ?)',
    )
      .bind(rooms[index % rooms.length]!.id, students[index]!, createdAt)
      .run();
  }
  await env.DB.prepare(
    `INSERT INTO mentor_messages (id, session_id, sender_id, kind, body, created_at, room_key) VALUES (?, ?, ?, 'SYSTEM', ?, ?, 'main')`,
  )
    .bind(newId('msg'), sessionId, viewer.id, `Breakout rooms opened for ${minutes} minutes.`, createdAt)
    .run();
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
  if (strokes.length === 0 && current.strokes.length > 0 && !isHost(session, viewer)) {
    throw ApiError.forbidden('Only the mentor can clear the whiteboard.');
  }
  if (baseRevision !== current.revision) return { ...current, saved: false };
  const revision = current.revision + 1;
  const updatedAt = nowIso();
  if (current.updatedAt === null) {
    await env.DB.prepare(
      `INSERT INTO class_whiteboards (session_id, room_key, revision, strokes_json, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (session_id, room_key) DO NOTHING`,
    )
      .bind(sessionId, roomKey, revision, JSON.stringify(strokes), viewer.id, updatedAt)
      .run();
  } else {
    await env.DB.prepare(
      `UPDATE class_whiteboards
          SET revision = ?, strokes_json = ?, updated_by = ?, updated_at = ?
        WHERE session_id = ? AND room_key = ? AND revision = ?`,
    )
      .bind(revision, JSON.stringify(strokes), viewer.id, updatedAt, sessionId, roomKey, baseRevision)
      .run();
  }
  return readBoard(env, sessionId, roomKey);
}
