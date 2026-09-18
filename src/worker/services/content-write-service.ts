import type { Env } from '../env';
import { ApiError } from '../lib/errors';
import { newId, nowIso } from '../lib/ids';
import type { AnswerKey } from '../../shared/answer-key';
import type { CandidateQuestion, QuestionGroupConfig, SharedOption } from '../../shared/question-types';
import { isQuestionType, questionTypeMeta } from '../../shared/question-types';
import type { AudioPlaybackPolicy, PassageParagraph } from '../../shared/question-types';
import type { Skill } from '../../shared/types';

export interface EditableQuestion {
  number: number;
  prompt: string;
  options: SharedOption[];
  config: QuestionGroupConfig;
  body?: CandidateQuestion['body'];
  answerKey?: AnswerKey | null;
  evidence?: string | null;
  explanation?: string | null;
}

export interface EditableGroup {
  type: string;
  instructions: string;
  sharedOptions: SharedOption[];
  config: QuestionGroupConfig;
  rangeFrom?: number | null;
  rangeTo?: number | null;
  questions: EditableQuestion[];
}

export interface EditableSection {
  skill: Skill;
  title: string;
  subtitle?: string | null;
  instructions: string;
  durationSeconds?: number | null;
  passage?: {
    title: string;
    subtitle?: string | null;
    paragraphs: PassageParagraph[];
    /**
     * Word count declared by the source file. Never trusted or stored: the
     * canonical count is recomputed from the paragraph text on write, and a
     * difference is reported to the admin as a validation warning.
     */
    passageWordCount?: number | null;
  } | null;
  audioAssetId?: string | null;
  playback?: Partial<AudioPlaybackPolicy>;
  groups: EditableGroup[];
}

export interface EditableMockComponent {
  skill: Skill;
  testVersionId: string;
  label: string;
  durationSeconds: number;
  breakAfterSeconds: number;
}

export interface EditableContent {
  sections: EditableSection[];
  mockComponents?: EditableMockComponent[];
  durationSeconds?: number | null;
  isCompleteTest?: boolean;
  scoringProfileId?: string | null;
  config?: Record<string, unknown>;
}

const MUTABLE_STATUSES = new Set(['DRAFT', 'REVIEW']);

/**
 * Replaces the whole content tree of a version.
 *
 * Versions that are PUBLISHED or ARCHIVED are immutable: historical attempts
 * reference these rows and must never change. Editing a published test requires
 * creating a new version first.
 */
export async function replaceVersionContent(
  env: Env,
  versionId: string,
  content: EditableContent,
  actorId: string | null,
): Promise<{ totalQuestions: number; sectionIds: string[] }> {
  const version = await env.DB.prepare('SELECT id, status, test_id, version_number FROM test_versions WHERE id = ?')
    .bind(versionId)
    .first<{ id: string; status: string; test_id: string; version_number: number }>();
  if (!version) throw ApiError.notFound('Test version not found.');

  if (!MUTABLE_STATUSES.has(version.status)) {
    throw ApiError.conflict(
      `Version ${version.version_number} is ${version.status.toLowerCase()} and can no longer be edited. Create a new version to make changes; attempts already taken keep the version they used.`,
    );
  }

  await assertAssetsExist(env, content);
  await assertMockComponents(env, versionId, content);

  const timestamp = nowIso();
  const statements: D1PreparedStatement[] = [];
  const sectionIds: string[] = [];
  let totalQuestions = 0;

  // Remove the previous tree (cascades to groups, questions and answer keys).
  statements.push(env.DB.prepare('DELETE FROM sections WHERE test_version_id = ?').bind(versionId));
  statements.push(env.DB.prepare('DELETE FROM passages WHERE test_version_id = ?').bind(versionId));
  statements.push(env.DB.prepare('DELETE FROM mock_components WHERE mock_version_id = ?').bind(versionId));

  content.sections.forEach((section, sectionIndex) => {
    const sectionId = newId('sec');
    sectionIds.push(sectionId);
    let passageId: string | null = null;

    if (section.passage) {
      passageId = newId('psg');
      const wordCount = section.passage.paragraphs.reduce(
        (total, paragraph) => total + paragraph.text.trim().split(/\s+/).filter(Boolean).length,
        0,
      );
      statements.push(
        env.DB.prepare(
          `INSERT INTO passages (id, test_version_id, order_index, title, subtitle, body_json, word_count, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          passageId,
          versionId,
          sectionIndex,
          section.passage.title ?? '',
          section.passage.subtitle ?? null,
          JSON.stringify(section.passage.paragraphs ?? []),
          wordCount,
          timestamp,
          timestamp,
        ),
      );
    }

    statements.push(
      env.DB.prepare(
        `INSERT INTO sections (id, test_version_id, skill, order_index, title, subtitle, instructions, passage_id,
                               audio_asset_id, duration_seconds, config_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        sectionId,
        versionId,
        section.skill,
        sectionIndex,
        section.title ?? '',
        section.subtitle ?? null,
        section.instructions ?? '',
        passageId,
        section.audioAssetId ?? null,
        section.durationSeconds ?? null,
        JSON.stringify(section.playback ? { playback: section.playback } : {}),
        timestamp,
        timestamp,
      ),
    );

    section.groups.forEach((group, groupIndex) => {
      if (!isQuestionType(group.type)) {
        throw ApiError.validation(`Unknown question type "${group.type}".`);
      }
      const meta = questionTypeMeta(group.type);
      if (!meta.skills.includes(section.skill)) {
        throw ApiError.validation(
          `${meta.label} cannot be used in a ${section.skill} section (section "${section.title || sectionIndex + 1}").`,
        );
      }

      const groupId = newId('grp');
      const numbers = group.questions.map((question) => question.number);

      statements.push(
        env.DB.prepare(
          `INSERT INTO question_groups (id, test_version_id, section_id, order_index, question_type, instructions,
                                        shared_options_json, config_json, range_from, range_to, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          groupId,
          versionId,
          sectionId,
          groupIndex,
          group.type,
          group.instructions ?? '',
          JSON.stringify(group.sharedOptions ?? []),
          JSON.stringify(group.config ?? {}),
          group.rangeFrom ?? (numbers.length > 0 ? Math.min(...numbers) : null),
          group.rangeTo ?? (numbers.length > 0 ? Math.max(...numbers) : null),
          timestamp,
          timestamp,
        ),
      );

      for (const question of group.questions) {
        const questionId = newId('qst');
        totalQuestions += 1;
        statements.push(
          env.DB.prepare(
            `INSERT INTO questions (id, test_version_id, section_id, question_group_id, number, order_index, prompt,
                                    body_json, options_json, config_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            questionId,
            versionId,
            sectionId,
            groupId,
            question.number,
            question.number,
            question.prompt ?? '',
            JSON.stringify(question.body ?? {}),
            JSON.stringify(question.options ?? []),
            JSON.stringify(question.config ?? {}),
            timestamp,
            timestamp,
          ),
        );

        if (question.answerKey) {
          statements.push(
            env.DB.prepare(
              `INSERT INTO answer_keys (id, question_id, test_version_id, answer_json, evidence, explanation, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            ).bind(
              newId('key'),
              questionId,
              versionId,
              JSON.stringify(question.answerKey),
              question.evidence ?? null,
              question.explanation ?? null,
              timestamp,
              timestamp,
            ),
          );
        }
      }
    });
  });

  for (const [index, component] of (content.mockComponents ?? []).entries()) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO mock_components (id, mock_version_id, order_index, skill, test_version_id, label, duration_seconds,
                                      break_after_seconds, config_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?)`,
      ).bind(
        newId('mcp'),
        versionId,
        index,
        component.skill,
        component.testVersionId,
        component.label ?? '',
        component.durationSeconds,
        component.breakAfterSeconds ?? 0,
        timestamp,
        timestamp,
      ),
    );
  }

  statements.push(
    env.DB.prepare(
      `UPDATE test_versions
          SET total_questions = ?, duration_seconds = COALESCE(?, duration_seconds),
              is_complete_test = COALESCE(?, is_complete_test),
              scoring_profile_id = COALESCE(?, scoring_profile_id),
              config_json = COALESCE(?, config_json),
              updated_at = ?
        WHERE id = ?`,
    ).bind(
      totalQuestions,
      content.durationSeconds ?? null,
      content.isCompleteTest === undefined ? null : content.isCompleteTest ? 1 : 0,
      content.scoringProfileId ?? null,
      content.config ? JSON.stringify(content.config) : null,
      timestamp,
      versionId,
    ),
  );

  for (let i = 0; i < statements.length; i += 40) {
    await env.DB.batch(statements.slice(i, i + 40));
  }

  void actorId;
  return { totalQuestions, sectionIds };
}

async function assertAssetsExist(env: Env, content: EditableContent): Promise<void> {
  const assetIds = content.sections.map((section) => section.audioAssetId).filter((id): id is string => Boolean(id));
  if (assetIds.length === 0) return;

  const placeholders = assetIds.map(() => '?').join(',');
  const rows = await env.DB.prepare(`SELECT id, kind FROM assets WHERE id IN (${placeholders})`)
    .bind(...assetIds)
    .all<{ id: string; kind: string }>();
  const byId = new Map(rows.results.map((row) => [row.id, row.kind]));

  for (const assetId of assetIds) {
    const kind = byId.get(assetId);
    if (!kind) throw ApiError.validation('One of the referenced audio assets no longer exists.');
    if (kind !== 'AUDIO') throw ApiError.validation('A section can only reference an audio asset.');
  }
}

async function assertMockComponents(env: Env, versionId: string, content: EditableContent): Promise<void> {
  if (!content.mockComponents || content.mockComponents.length === 0) return;

  for (const component of content.mockComponents) {
    if (component.testVersionId === versionId) {
      throw ApiError.validation('A full mock cannot reference itself as a component.');
    }
    const row = await env.DB.prepare('SELECT id, status FROM test_versions WHERE id = ?')
      .bind(component.testVersionId)
      .first<{ id: string; status: string }>();
    if (!row) throw ApiError.validation('A full-mock component references a version that no longer exists.');
    if (row.status !== 'PUBLISHED' && row.status !== 'ARCHIVED') {
      throw ApiError.validation('Full-mock components must reference published or archived skill versions.');
    }
  }
}
