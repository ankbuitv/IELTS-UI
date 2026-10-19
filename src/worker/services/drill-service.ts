import type { Env } from '../env';
import type { AuthUser } from '../lib/auth-types';
import { ApiError } from '../lib/errors';
import { isPro } from './billing-service';
import { newId, nowIso, parseJson } from '../lib/ids';
import { enforceRateLimit } from '../lib/rate-limit';
import { gradeAnswer, type AnswerKey, type CandidateResponse } from '../../shared/answer-key';
import { isQuestionType, QUESTION_TYPE_META, type QuestionGroupConfig } from '../../shared/question-types';
import type { DrillAnswer, DrillGroup, DrillResult, DrillSession, DrillTypeInfo } from '../../shared/drills';

/**
 * #6 Question-type drills.
 *
 * Practising one format at a time is the fastest way to fix a specific weakness
 * ("I always lose marks on Matching Headings"). A drill takes up to two groups
 * of the chosen type from current published papers, with their passage or
 * transcript as context, and grades the answers with the same answer-key code as
 * a full attempt.
 */

const MAX_QUESTIONS = 8;
const MAX_GROUPS = 2;
const MAX_CONTEXT = 6000;

interface GroupRow {
  id: string;
  section_id: string;
  question_type: string;
  instructions: string;
  shared_options_json: string;
  config_json: string;
}

export async function listDrillTypes(env: Env): Promise<DrillTypeInfo[]> {
  const rows = await env.DB.prepare(
    `SELECT qg.question_type AS type, COUNT(DISTINCT qg.id) AS groups, COUNT(q.id) AS questions
       FROM question_groups qg
       JOIN questions q ON q.question_group_id = qg.id
       JOIN answer_keys ak ON ak.question_id = q.id
       JOIN test_versions v ON v.id = qg.test_version_id
       JOIN tests t ON t.id = v.test_id AND t.current_version_id = v.id
      WHERE v.status = 'PUBLISHED'
      GROUP BY qg.question_type
      HAVING COUNT(q.id) >= 3
      ORDER BY questions DESC`,
  ).all<{ type: string; groups: number; questions: number }>();

  return (rows.results ?? [])
    .filter((row) => isQuestionType(row.type) && QUESTION_TYPE_META[row.type].skills[0] !== 'WRITING')
    .map((row) => {
      const type = row.type as DrillTypeInfo['type'];
      const meta = QUESTION_TYPE_META[type];
      return {
        type,
        label: meta.label,
        groups: row.groups,
        questions: row.questions,
        skill: meta.skills.includes('LISTENING') && !meta.skills.includes('READING') ? 'LISTENING' : 'READING',
      };
    });
}

async function contextFor(
  env: Env,
  sectionId: string,
): Promise<{ title: string; text: string; audioUrl: string | null }> {
  const row = await env.DB.prepare(
    `SELECT s.title, s.transcript_json, s.passage_id, s.audio_asset_id, p.title AS passage_title, p.body_json,
            a.external_url, a.id AS asset_id
       FROM sections s
       LEFT JOIN passages p ON p.id = s.passage_id
       LEFT JOIN assets a ON a.id = s.audio_asset_id
      WHERE s.id = ?`,
  )
    .bind(sectionId)
    .first<{
      title: string;
      transcript_json: string | null;
      passage_id: string | null;
      audio_asset_id: string | null;
      passage_title: string | null;
      body_json: string | null;
      external_url: string | null;
      asset_id: string | null;
    }>();
  if (!row) return { title: '', text: '', audioUrl: null };

  const paragraphs = parseJson<Array<{ label?: string; text?: string }>>(row.body_json, []);
  const transcript = parseJson<{ segments?: Array<{ speaker?: string | null; text?: string }> } | null>(
    row.transcript_json,
    null,
  );

  const text = paragraphs.length
    ? paragraphs
        .map((paragraph) => `${paragraph.label ? `${paragraph.label}. ` : ''}${paragraph.text ?? ''}`)
        .join('\n\n')
    : (transcript?.segments ?? [])
        .map((segment) => `${segment.speaker ? `${segment.speaker}: ` : ''}${segment.text ?? ''}`)
        .join('\n');

  const audioUrl = row.asset_id
    ? row.external_url
      ? row.external_url.startsWith('/')
        ? row.external_url
        : row.external_url
      : `/api/files/${row.asset_id}`
    : null;

  return {
    title: row.passage_title || row.title || 'Context',
    text: text.slice(0, MAX_CONTEXT),
    audioUrl,
  };
}

export const FREE_DRILLS_PER_DAY = 5;

export async function startDrill(
  env: Env,
  user: AuthUser,
  input: { questionType: string },
): Promise<DrillSession> {
  if (!isQuestionType(input.questionType) || QUESTION_TYPE_META[input.questionType].skills[0] === 'WRITING') {
    throw ApiError.validation('Choose a question type from the list.');
  }
  await enforceRateLimit(
    env,
    { bucket: `drill-start:${user.id}`, windowSeconds: 3600, limit: 30 },
    'That is a lot of drills in one hour. Review the last one before starting another.',
  );

  if (!(await isPro(env, user.id))) {
    const dayStart = `${nowIso().slice(0, 10)}T00:00:00.000Z`;
    const used = await env.DB.prepare('SELECT COUNT(*) AS n FROM drill_attempts WHERE user_id = ? AND created_at >= ?')
      .bind(user.id, dayStart)
      .first<{ n: number }>();
    if ((used?.n ?? 0) >= FREE_DRILLS_PER_DAY) {
      throw ApiError.conflict(`The free plan includes ${FREE_DRILLS_PER_DAY} drills a day. Pro makes them unlimited.`);
    }
  }

  const groups = await env.DB.prepare(
    `SELECT qg.id, qg.section_id, qg.question_type, qg.instructions, qg.shared_options_json, qg.config_json
       FROM question_groups qg
       JOIN questions q ON q.question_group_id = qg.id
       JOIN answer_keys ak ON ak.question_id = q.id
       JOIN test_versions v ON v.id = qg.test_version_id
       JOIN tests t ON t.id = v.test_id AND t.current_version_id = v.id
      WHERE v.status = 'PUBLISHED' AND qg.question_type = ?
      GROUP BY qg.id
      HAVING COUNT(q.id) >= 3
      ORDER BY RANDOM()
      LIMIT ?`,
  )
    .bind(input.questionType, MAX_GROUPS)
    .all<GroupRow>();

  if (!groups.results?.length) {
    throw ApiError.validation('No published paper has this question type yet. Try another drill.');
  }

  const payload: DrillGroup[] = [];
  let remaining = MAX_QUESTIONS;

  for (const group of groups.results) {
    if (remaining <= 0) break;
    const questions = await env.DB.prepare(
      `SELECT q.id, q.number, q.prompt, q.options_json, q.config_json
         FROM questions q JOIN answer_keys ak ON ak.question_id = q.id
        WHERE q.question_group_id = ?
        ORDER BY q.order_index, q.number
        LIMIT ?`,
    )
      .bind(group.id, Math.min(6, remaining))
      .all<{ id: string; number: number; prompt: string; options_json: string; config_json: string }>();
    if (!questions.results?.length) continue;

    const context = await contextFor(env, group.section_id);
    payload.push({
      id: group.id,
      type: group.question_type as DrillGroup['type'],
      instructions: group.instructions,
      sharedOptions: parseJson(group.shared_options_json, []),
      config: parseJson<Record<string, unknown>>(group.config_json, {}),
      contextTitle: context.title,
      contextText: context.text,
      audioUrl: context.audioUrl,
      questions: questions.results.map((question) => ({
        id: question.id,
        number: question.number,
        prompt: question.prompt,
        options: parseJson(question.options_json, []),
        config: parseJson<Record<string, unknown>>(question.config_json, {}),
      })),
    });
    remaining -= questions.results.length;
  }

  if (payload.length === 0) throw ApiError.validation('This drill could not load any questions.');

  const id = newId('drl');
  const timestamp = nowIso();
  await env.DB.prepare(
    `INSERT INTO drill_attempts (id, user_id, question_type, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(id, user.id, input.questionType, JSON.stringify(payload), timestamp)
    .run();

  return { id, type: input.questionType as DrillSession['type'], groups: payload, createdAt: timestamp };
}

function optionLabel(
  group: DrillGroup,
  questionId: string,
  id: string,
): string {
  const question = group.questions.find((item) => item.id === questionId);
  const option = question?.options.find((item) => item.id === id) ?? group.sharedOptions.find((item) => item.id === id);
  return option ? `${id}. ${option.text}` : id;
}

export async function submitDrill(
  env: Env,
  user: AuthUser,
  drillId: string,
  answers: Record<string, DrillAnswer>,
): Promise<DrillResult> {
  const row = await env.DB.prepare(
    'SELECT id, payload_json, submitted_at FROM drill_attempts WHERE id = ? AND user_id = ?',
  )
    .bind(drillId, user.id)
    .first<{ id: string; payload_json: string; submitted_at: string | null }>();
  if (!row) throw ApiError.notFound('That drill does not exist.');
  if (row.submitted_at) throw ApiError.conflict('This drill has already been submitted.');

  const payload = parseJson<DrillGroup[]>(row.payload_json, []);
  const questionIds = payload.flatMap((group) => group.questions.map((question) => question.id));
  if (questionIds.length === 0) throw ApiError.validation('This drill has no questions to mark.');

  const placeholders = questionIds.map(() => '?').join(',');
  const keys = await env.DB.prepare(
    `SELECT q.id, q.question_group_id, ak.answer_json, ak.evidence, ak.explanation,
            qg.question_type, qg.config_json AS group_config_json, q.config_json AS question_config_json
       FROM questions q
       JOIN answer_keys ak ON ak.question_id = q.id
       JOIN question_groups qg ON qg.id = q.question_group_id
      WHERE q.id IN (${placeholders})`,
  )
    .bind(...questionIds)
    .all<{
      id: string;
      question_group_id: string;
      answer_json: string;
      evidence: string | null;
      explanation: string | null;
      question_type: string;
      group_config_json: string;
      question_config_json: string;
    }>();

  const keyByQuestion = new Map((keys.results ?? []).map((item) => [item.id, item]));
  const results: DrillResult['questions'] = [];
  let correct = 0;

  for (const group of payload) {
    for (const question of group.questions) {
      const keyRow = keyByQuestion.get(question.id);
      if (!keyRow || !isQuestionType(keyRow.question_type)) continue;
      const key = parseJson<AnswerKey | null>(keyRow.answer_json, null);
      if (!key) continue;

      const answer = answers[question.id];
      const response: CandidateResponse | null = answer
        ? answer.values && answer.values.length > 0
          ? { values: answer.values }
          : typeof answer.value === 'string' && answer.value.trim()
            ? { value: answer.value }
            : null
        : null;

      const config: QuestionGroupConfig = {
        ...parseJson<QuestionGroupConfig>(keyRow.group_config_json, {}),
        ...parseJson<QuestionGroupConfig>(keyRow.question_config_json, {}),
      };
      const graded = gradeAnswer(keyRow.question_type, key, response, config);
      if (graded.correct) correct += 1;

      const candidateAnswer = answer?.values?.length
        ? answer.values.map((id) => optionLabel(group, question.id, id)).join(', ')
        : answer?.value?.trim()
          ? key.kind === 'CHOICE'
            ? optionLabel(group, question.id, answer.value.trim())
            : answer.value.trim()
          : '';
      const correctAnswer =
        key.kind === 'CHOICE'
          ? key.values.map((id) => optionLabel(group, question.id, id)).join(', ')
          : key.kind === 'TEXT'
            ? key.accept.join(' / ')
            : 'Teacher marked';

      results.push({
        questionId: question.id,
        number: question.number,
        prompt: question.prompt,
        correct: graded.correct,
        candidateAnswer,
        correctAnswer,
        evidence: keyRow.evidence,
        explanation: keyRow.explanation,
      });
    }
  }

  const submittedAt = nowIso();
  await env.DB.prepare(
    `UPDATE drill_attempts SET answers_json = ?, correct = ?, total = ?, submitted_at = ? WHERE id = ?`,
  )
    .bind(JSON.stringify(answers), correct, results.length, submittedAt, drillId)
    .run();

  return {
    id: drillId,
    type: payload[0]?.type ?? 'MCQ_SINGLE',
    correct,
    total: results.length,
    questions: results,
    submittedAt,
  };
}
