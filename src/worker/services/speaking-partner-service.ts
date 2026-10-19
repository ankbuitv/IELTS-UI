import type { Env } from '../env';
import type { AuthUser } from '../lib/auth-types';
import { ApiError } from '../lib/errors';
import { newId, nowIso, parseJson } from '../lib/ids';
import { enforceRateLimit } from '../lib/rate-limit';
import { completeJson, type ChatMessage } from '../ai/providers';
import { z } from 'zod';
import {
  SPEAKING_PARTNER_TOPICS,
  nextFallbackQuestion,
  ruleFeedback,
  ruleSummary,
  topicById,
  type PartnerSession,
  type PartnerSessionListItem,
  type PartnerSessionSummary,
  type PartnerTurn,
  type PartnerTurnFeedback,
  type SpeakingPartnerTopic,
} from '../../shared/speaking-partner';

/**
 * AI speaking partner (#35).
 *
 * One learner, one topic, one question at a time. Every candidate turn gets
 * short coaching; the session ends with a qualitative summary. The partner is
 * explicitly not a marker: it never assigns a band, and the summary says so.
 */

const MAX_ANSWER = 1500;
const HISTORY_TURNS = 12;

const PARTNER_SYSTEM_PROMPT = `You are an IELTS speaking partner for a Vietnamese learner. You rehearse one Speaking part at a time.

Rules:
- Stay in role: you are the interviewer. Ask ONE question per turn, in natural spoken English, 15–35 words.
- React to what the learner actually said before asking the next question; never ask a question they have already answered.
- Give short coaching on the learner's last answer: 2–3 concrete notes (grammar, word choice, development) and, when useful, one improved sentence as "betterPhrase".
- Never give an IELTS band or say a score is official. Never mention IELTS, British Council, IDP or Cambridge as if you were them.
- If the answer is very short, ask a follow-up that helps them extend it (a reason, an example, a comparison).
- Keep feedback honest and specific. Quote the learner's words when pointing at a mistake.

Return ONE JSON object:
{"reply": "the next question", "feedback": {"notes": ["…", "…"], "betterPhrase": "an improved version of one sentence or null", "encourage": "one short encouraging line"}}`;

const partnerResponseSchema = z.object({
  reply: z.string().trim().min(1).max(1200),
  feedback: z
    .object({
      notes: z.array(z.string().trim().min(1).max(400)).min(1).max(4),
      betterPhrase: z.string().trim().max(600).nullish(),
      encourage: z.string().trim().max(300).nullish(),
    })
    .optional(),
});

const summarySchema = z.object({
  headline: z.string().trim().min(1).max(400),
  strengths: z.array(z.string().trim().min(1).max(400)).min(1).max(5),
  improvements: z.array(z.string().trim().min(1).max(400)).min(1).max(5),
  nextSteps: z.array(z.string().trim().min(1).max(400)).min(1).max(5),
});

interface SessionRow {
  id: string;
  user_id: string;
  topic_id: string;
  topic_title: string;
  part: number;
  status: string;
  summary_json: string | null;
  created_at: string;
  updated_at: string;
}

interface TurnRow {
  id: string;
  session_id: string;
  seq: number;
  role: string;
  content: string;
  feedback_json: string | null;
  created_at: string;
}

function rowToTurn(row: TurnRow): PartnerTurn {
  return {
    id: row.id,
    seq: row.seq,
    role: row.role === 'CANDIDATE' ? 'CANDIDATE' : 'PARTNER',
    content: row.content,
    createdAt: row.created_at,
    feedback: parseJson<PartnerTurnFeedback | null>(row.feedback_json, null),
  };
}

async function loadSessionRow(env: Env, userId: string, id: string): Promise<SessionRow> {
  const row = await env.DB.prepare(
    `SELECT id, user_id, topic_id, topic_title, part, status, summary_json, created_at, updated_at
       FROM speaking_partner_sessions WHERE id = ? AND user_id = ?`,
  )
    .bind(id, userId)
    .first<SessionRow>();
  if (!row) throw ApiError.notFound('That speaking session does not exist.');
  return row;
}

async function turnsOf(env: Env, sessionId: string): Promise<PartnerTurn[]> {
  const rows = await env.DB.prepare(
    `SELECT id, session_id, seq, role, content, feedback_json, created_at
       FROM speaking_partner_turns WHERE session_id = ? ORDER BY seq`,
  )
    .bind(sessionId)
    .all<TurnRow>();
  return rows.results.map(rowToTurn);
}

export async function getSpeakingPartnerSession(env: Env, user: AuthUser, id: string): Promise<PartnerSession> {
  const row = await loadSessionRow(env, user.id, id);
  return {
    id: row.id,
    topicId: row.topic_id,
    topicTitle: row.topic_title,
    part: (row.part === 2 ? 2 : row.part === 3 ? 3 : 1) as PartnerSession['part'],
    status: row.status === 'COMPLETED' ? 'COMPLETED' : 'ACTIVE',
    turns: await turnsOf(env, row.id),
    summary: parseJson<PartnerSessionSummary | null>(row.summary_json, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listSpeakingPartnerSessions(env: Env, userId: string): Promise<PartnerSessionListItem[]> {
  const rows = await env.DB.prepare(
    `SELECT s.id, s.topic_id, s.topic_title, s.part, s.status, s.created_at, s.updated_at,
            (SELECT COUNT(*) FROM speaking_partner_turns t WHERE t.session_id = s.id) AS turn_count,
            (SELECT t.content FROM speaking_partner_turns t WHERE t.session_id = s.id ORDER BY t.seq DESC LIMIT 1) AS preview
       FROM speaking_partner_sessions s
      WHERE s.user_id = ?
      ORDER BY s.updated_at DESC
      LIMIT 40`,
  )
    .bind(userId)
    .all<{
      id: string;
      topic_id: string;
      topic_title: string;
      part: number;
      status: string;
      created_at: string;
      updated_at: string;
      turn_count: number;
      preview: string | null;
    }>();
  return rows.results.map((row) => ({
    id: row.id,
    topicId: row.topic_id,
    topicTitle: row.topic_title,
    part: (row.part === 2 ? 2 : row.part === 3 ? 3 : 1) as PartnerSessionListItem['part'],
    status: row.status === 'COMPLETED' ? 'COMPLETED' : 'ACTIVE',
    turnCount: row.turn_count,
    preview: (row.preview ?? '').slice(0, 160),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function createSpeakingPartnerSession(
  env: Env,
  user: AuthUser,
  input: { topicId: string },
): Promise<PartnerSession> {
  const topic = topicById(input.topicId);
  if (!topic) throw ApiError.validation('Choose a topic from the list.');

  await enforceRateLimit(
    env,
    { bucket: `speaking-partner-start:${user.id}`, windowSeconds: 3600, limit: 30 },
    'That is a lot of new speaking sessions in one hour. Finish one before starting another.',
  );

  const id = newId('sps');
  const timestamp = nowIso();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO speaking_partner_sessions (id, user_id, topic_id, topic_title, part, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`,
    ).bind(id, user.id, topic.id, topic.title, topic.part, timestamp, timestamp),
    env.DB.prepare(
      `INSERT INTO speaking_partner_turns (id, session_id, seq, role, content, created_at)
       VALUES (?, ?, 1, 'PARTNER', ?, ?)`,
    ).bind(newId('spt'), id, topic.prompt, timestamp),
  ]);

  return getSpeakingPartnerSession(env, user, id);
}

function ruleNextTurn(topic: SpeakingPartnerTopic, turns: PartnerTurn[], answer: string): {
  reply: string;
  feedback: PartnerTurnFeedback;
} {
  // The opening prompt is turn one, so the first follow-up is asked after it.
  const asked = Math.max(0, turns.filter((turn) => turn.role === 'PARTNER').length - 1);
  return {
    reply: nextFallbackQuestion(topic, asked),
    feedback: ruleFeedback(answer, topic),
  };
}

async function aiNextTurn(
  env: Env,
  topic: SpeakingPartnerTopic,
  turns: PartnerTurn[],
  answer: string,
): Promise<{ reply: string; feedback: PartnerTurnFeedback } | null> {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `${PARTNER_SYSTEM_PROMPT}\n\nToday's topic (Part ${topic.part}): ${topic.title}.\nTarget language: ${topic.focus}.\nLearner level: IELTS practice, band 5–7.`,
    },
    ...turns.slice(-HISTORY_TURNS).map(
      (turn): ChatMessage => ({ role: turn.role === 'CANDIDATE' ? 'user' : 'assistant', content: turn.content }),
    ),
    {
      role: 'user',
      content: `${answer}\n\n(Coach this answer and ask the next question. Return the JSON object described above.)`,
    },
  ];

  try {
    const result = await completeJson<unknown>(env, {
      messages,
      temperature: 0.7,
      maxTokens: 700,
      timeoutMs: 45_000,
    });
    const parsed = partnerResponseSchema.safeParse(result.data);
    if (!parsed.success) {
      console.warn('speaking_partner_invalid_json', parsed.error.issues[0]?.message);
      return null;
    }
    const feedback = parsed.data.feedback;
    return {
      reply: parsed.data.reply,
      feedback: {
        source: 'AI',
        notes: feedback?.notes ?? [],
        betterPhrase: feedback?.betterPhrase ?? null,
        encourage: feedback?.encourage ?? null,
      },
    };
  } catch (error) {
    console.warn(
      'speaking_partner_ai_failed',
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

export async function sendSpeakingPartnerTurn(
  env: Env,
  user: AuthUser,
  sessionId: string,
  content: string,
): Promise<PartnerSession> {
  const answer = content.trim();
  if (!answer) throw ApiError.validation('Say something before sending.');
  if (answer.length > MAX_ANSWER) {
    throw ApiError.validation(`Keep one answer under ${MAX_ANSWER} characters.`);
  }

  const session = await loadSessionRow(env, user.id, sessionId);
  if (session.status === 'COMPLETED') {
    throw ApiError.conflict('This session is finished. Start a new one to keep practising.');
  }
  const topic = topicById(session.topic_id);
  if (!topic) throw ApiError.validation('That topic is no longer available.');

  await enforceRateLimit(
    env,
    { bucket: `speaking-partner-turn:${user.id}`, windowSeconds: 3600, limit: 80 },
    'You have answered a lot in one hour. Take a short break and come back in a little while.',
  );

  const turns = await turnsOf(env, sessionId);
  const nextSeq = (turns.at(-1)?.seq ?? 0) + 1;
  const turnId = newId('spt');
  const timestamp = nowIso();
  await env.DB.prepare(
    `INSERT INTO speaking_partner_turns (id, session_id, seq, role, content, created_at)
     VALUES (?, ?, ?, 'CANDIDATE', ?, ?)`,
  )
    .bind(turnId, sessionId, nextSeq, answer, timestamp)
    .run();

  const next = (await aiNextTurn(env, topic, turns, answer)) ?? ruleNextTurn(topic, turns, answer);

  await env.DB.batch([
    env.DB.prepare('UPDATE speaking_partner_turns SET feedback_json = ? WHERE id = ?').bind(
      JSON.stringify(next.feedback),
      turnId,
    ),
    env.DB.prepare(
      `INSERT INTO speaking_partner_turns (id, session_id, seq, role, content, created_at)
       VALUES (?, ?, ?, 'PARTNER', ?, ?)`,
    ).bind(newId('spt'), sessionId, nextSeq + 1, next.reply.slice(0, 1200), nowIso()),
    env.DB.prepare('UPDATE speaking_partner_sessions SET updated_at = ? WHERE id = ?').bind(nowIso(), sessionId),
  ]);

  return getSpeakingPartnerSession(env, user, sessionId);
}

export async function summariseSpeakingPartnerSession(
  env: Env,
  user: AuthUser,
  sessionId: string,
): Promise<PartnerSession> {
  const session = await loadSessionRow(env, user.id, sessionId);
  if (session.summary_json) return getSpeakingPartnerSession(env, user, sessionId);

  const topic = topicById(session.topic_id);
  if (!topic) throw ApiError.validation('That topic is no longer available.');

  const turns = await turnsOf(env, sessionId);
  const answers = turns.filter((turn) => turn.role === 'CANDIDATE').map((turn) => turn.content);
  if (answers.length === 0) {
    throw ApiError.validation('Answer at least one question before asking for a summary.');
  }
  const notes = turns.flatMap((turn) => turn.feedback?.notes ?? []);

  let summary: PartnerSessionSummary = ruleSummary(topic, answers, notes);
  try {
    const transcript = turns
      .map((turn) => `${turn.role === 'CANDIDATE' ? 'Learner' : 'Partner'}: ${turn.content}`)
      .join('\n')
      .slice(0, 16_000);
    const result = await completeJson<unknown>(env, {
      messages: [
        {
          role: 'system',
          content: `You review a short IELTS speaking rehearsal and write a qualitative summary. Never give a band score or claim official marking.

Return JSON: {"headline": "one sentence about how the rehearsal went", "strengths": ["…"], "improvements": ["…"], "nextSteps": ["…"]}
Use 2–4 items per list. Be specific: quote or paraphrase what the learner actually said. Write in clear English at B1–B2 level. Topic: ${topic.title} (Part ${topic.part}). Focus: ${topic.focus}.`,
        },
        { role: 'user', content: transcript },
      ],
      temperature: 0.4,
      maxTokens: 800,
      timeoutMs: 60_000,
    });
    const parsed = summarySchema.safeParse(result.data);
    if (parsed.success) {
      summary = {
        headline: parsed.data.headline,
        strengths: parsed.data.strengths,
        improvements: parsed.data.improvements,
        nextSteps: parsed.data.nextSteps,
        source: 'AI',
        createdAt: nowIso(),
      };
    }
  } catch (error) {
    console.warn('speaking_partner_summary_failed', error instanceof Error ? error.message : String(error));
  }

  const timestamp = nowIso();
  await env.DB.prepare(
    `UPDATE speaking_partner_sessions
        SET summary_json = ?, status = 'COMPLETED', updated_at = ?
      WHERE id = ?`,
  )
    .bind(JSON.stringify(summary), timestamp, sessionId)
    .run();

  return getSpeakingPartnerSession(env, user, sessionId);
}

/** Topics are static; exported so the route can return them without a query. */
export function speakingPartnerTopics(): SpeakingPartnerTopic[] {
  return SPEAKING_PARTNER_TOPICS;
}
