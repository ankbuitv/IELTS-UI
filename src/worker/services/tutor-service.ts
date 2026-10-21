import type { Env } from '../env';
import type { AuthUser } from '../lib/auth-types';
import { ApiError } from '../lib/errors';
import { newId, nowIso } from '../lib/ids';
import { enforceRateLimit } from '../lib/rate-limit';
import { completeChat, type ChatMessage } from '../ai/providers';
import { AI_NOT_CONFIGURED_MESSAGE } from '../ai/judges';
import type { TutorConversation, TutorFocus, TutorMessage, TutorThread } from '../../shared/tutor';

/**
 * AI tutor: a study chat, not a marker. It answers questions about IELTS,
 * vocabulary and grammar and gives one next step. Bands are never invented —
 * practice papers are scored by the judge pipeline and the learner is pointed
 * there when they ask for a score.
 */

const MAX_MESSAGE = 4000;
const HISTORY_TURNS = 16;

const SYSTEM_PROMPT = `You are the AI tutor inside AI Eo, an IELTS study platform for Vietnamese learners.

What you do:
- Answer questions about IELTS Writing, Speaking, Reading, Listening, vocabulary and study habits.
- Correct the learner's English when they make mistakes: show the corrected sentence, then one short reason.
- Explain in Vietnamese when the learner writes in Vietnamese; always give English examples.
- Finish with ONE concrete next step (a sentence to rewrite, a 2-minute speaking prompt, 10 words to review).
- When you give a structure, make it usable immediately: numbered steps, at most 3.

What you never do:
- Never invent an IELTS band or say a score is official. If asked to score a full task, say the practice papers are marked by the AI judges and point to /practice; you may comment on one sentence.
- Never claim to be IELTS, the British Council, IDP or Cambridge.
- Never write a full essay for the learner. Offer an outline and ask them to write one paragraph, then give feedback.
- Keep normal answers under 180 words. Be warm, direct and specific. No filler.`;

function rowToConversation(row: {
  id: string;
  title: string;
  focus_skill: string;
  created_at: string;
  updated_at: string;
  message_count?: number;
  preview?: string | null;
}): TutorConversation {
  return {
    id: row.id,
    title: row.title,
    focusSkill: (row.focus_skill as TutorFocus) ?? 'ANY',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messageCount: row.message_count ?? 0,
    preview: row.preview ?? '',
  };
}

export async function listTutorConversations(env: Env, userId: string): Promise<TutorConversation[]> {
  const rows = await env.DB.prepare(
    `SELECT c.id, c.title, c.focus_skill, c.created_at, c.updated_at,
            (SELECT COUNT(*) FROM tutor_messages m WHERE m.conversation_id = c.id) AS message_count,
            (SELECT m.content FROM tutor_messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS preview
       FROM tutor_conversations c
      WHERE c.user_id = ?
      ORDER BY c.updated_at DESC
      LIMIT 60`,
  )
    .bind(userId)
    .all<{
      id: string;
      title: string;
      focus_skill: string;
      created_at: string;
      updated_at: string;
      message_count: number;
      preview: string | null;
    }>();
  return rows.results.map(rowToConversation);
}

async function findConversation(env: Env, userId: string, id: string) {
  const row = await env.DB.prepare(
    `SELECT c.id, c.title, c.focus_skill, c.created_at, c.updated_at,
            (SELECT COUNT(*) FROM tutor_messages m WHERE m.conversation_id = c.id) AS message_count,
            (SELECT m.content FROM tutor_messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS preview
       FROM tutor_conversations c
      WHERE c.id = ? AND c.user_id = ?`,
  )
    .bind(id, userId)
    .first<{
      id: string;
      title: string;
      focus_skill: string;
      created_at: string;
      updated_at: string;
      message_count: number;
      preview: string | null;
    }>();
  if (!row) throw ApiError.notFound('That conversation no longer exists.');
  return rowToConversation(row);
}

async function messagesOf(env: Env, conversationId: string): Promise<TutorMessage[]> {
  const rows = await env.DB.prepare(
    `SELECT id, role, content, created_at FROM tutor_messages
      WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 200`,
  )
    .bind(conversationId)
    .all<{ id: string; role: 'user' | 'assistant'; content: string; created_at: string }>();
  return rows.results.map((row) => ({
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
  }));
}

export async function getTutorThread(env: Env, user: AuthUser, id: string): Promise<TutorThread> {
  const conversation = await findConversation(env, user.id, id);
  return { conversation, messages: await messagesOf(env, conversation.id) };
}

export async function createTutorConversation(
  env: Env,
  user: AuthUser,
  input: { title?: string; focusSkill?: TutorFocus } = {},
): Promise<TutorConversation> {
  const now = nowIso();
  const id = newId('tut');
  const title = (input.title ?? '').trim().slice(0, 80) || 'New chat';
  const focus = input.focusSkill ?? 'ANY';
  await env.DB.prepare(
    `INSERT INTO tutor_conversations (id, user_id, title, focus_skill, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, user.id, title, focus, now, now)
    .run();
  return {
    id,
    title,
    focusSkill: focus,
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
    preview: '',
  };
}

export async function deleteTutorConversation(env: Env, user: AuthUser, id: string): Promise<void> {
  await findConversation(env, user.id, id);
  await env.DB.prepare('DELETE FROM tutor_conversations WHERE id = ? AND user_id = ?').bind(id, user.id).run();
}

/** A short, factual context block so the tutor can refer to the learner's week. */
async function learnerContext(env: Env, userId: string): Promise<string> {
  const [attempts, due] = await Promise.all([
    env.DB.prepare(
      `SELECT AVG(estimated_band) AS band, COUNT(*) AS n
         FROM attempts
        WHERE user_id = ? AND submitted_at IS NOT NULL AND submitted_at >= ?`,
    )
      .bind(userId, new Date(Date.now() - 30 * 86_400_000).toISOString())
      .first<{ band: number | null; n: number }>(),
    env.DB.prepare(
      `SELECT COUNT(*) AS n FROM vocabulary_entries WHERE user_id = ? AND (due_at IS NULL OR due_at <= ?)`,
    )
      .bind(userId, nowIso())
      .first<{ n: number }>(),
  ]);
  const parts: string[] = [];
  if (attempts?.band != null) parts.push(`Average practice band in the last 30 days: ${attempts.band.toFixed(1)} (${attempts.n} tests).`);
  else parts.push('No practice test in the last 30 days.');
  if ((due?.n ?? 0) > 0) parts.push(`${due?.n} vocabulary words are due for review.`);
  return parts.join(' ');
}

export async function sendTutorMessage(
  env: Env,
  user: AuthUser,
  conversationId: string,
  content: string,
): Promise<TutorThread> {
  const text = content.trim();
  if (!text) throw ApiError.validation('Write a question first.');
  if (text.length > MAX_MESSAGE) throw ApiError.validation(`Keep one message under ${MAX_MESSAGE} characters.`);
  const conversation = await findConversation(env, user.id, conversationId);

  await enforceRateLimit(
    env,
    { bucket: `tutor:${user.id}`, windowSeconds: 3600, limit: 60 },
    'You have asked a lot in one hour. Take a short break and come back in a little while.',
  );

  const history = await messagesOf(env, conversationId);
  const now = nowIso();
  await env.DB.prepare(
    'INSERT INTO tutor_messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(newId('tum'), conversationId, 'user', text, now)
    .run();

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `${SYSTEM_PROMPT}\n\nLearner context: ${await learnerContext(env, user.id)}\nFocus: ${conversation.focusSkill}.`,
    },
    ...history.slice(-HISTORY_TURNS).map((message) => ({ role: message.role, content: message.content }) as ChatMessage),
    { role: 'user', content: text },
  ];

  let answer: string;
  try {
    const result = await completeChat(env, {
      messages,
      temperature: 0.5,
      maxTokens: 900,
      timeoutMs: 60_000,
    });
    answer = result.text.trim();
  } catch (error) {
    console.error('ai_tutor_failed', error instanceof Error ? error.message : error);
    if (error instanceof ApiError && error.code === 'AI_UNAVAILABLE') {
      // Give the learner an actionable message without naming a vendor.
      if (/no AI provider|not configured|disabled|API key/i.test(error.message)) {
        throw new ApiError(
          'AI_UNAVAILABLE',
          'AI Tutor chưa được bật trên hệ thống. Hỏi quản trị viên bật AI provider trong Admin → Settings → AI providers.',
        );
      }
      if (error.message === AI_NOT_CONFIGURED_MESSAGE) throw error;
    }
    throw new ApiError(
      'AI_UNAVAILABLE',
      'The AI tutor is busy right now. Your message is saved — try again in a minute.',
    );
  }
  if (!answer) {
    throw new ApiError('AI_UNAVAILABLE', 'The AI tutor returned an empty answer. Try asking in another way.');
  }

  await env.DB.prepare(
    'INSERT INTO tutor_messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(newId('tum'), conversationId, 'assistant', answer.slice(0, 12_000), nowIso())
    .run();

  // The first question names the thread, like every chat product.
  const title =
    conversation.messageCount === 0 || conversation.title === 'New chat'
      ? text.replace(/\s+/g, ' ').slice(0, 72)
      : conversation.title;
  await env.DB.prepare('UPDATE tutor_conversations SET title = ?, updated_at = ? WHERE id = ?')
    .bind(title, nowIso(), conversationId)
    .run();

  return getTutorThread(env, user, conversationId);
}
