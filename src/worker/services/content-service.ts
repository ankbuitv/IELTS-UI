import type { Env } from '../env';
import { ApiError } from '../lib/errors';
import { resolveAssetUrl } from './media-service';
import { newId, nowIso, parseJson } from '../lib/ids';
import type {
  AnswerKey,
} from '../../shared/answer-key';
import { DEFAULT_AUDIO_POLICY, type AudioPlaybackPolicy } from '../../shared/question-types';
import type {
  CandidateAudio,
  CandidatePassage,
  CandidateQuestion,
  CandidateQuestionGroup,
  CandidateSection,
  PassageParagraph,
  QuestionGroupConfig,
  SharedOption,
} from '../../shared/question-types';
import { isQuestionType, type QuestionType } from '../../shared/question-types';
import type { Skill, TestStatus, TestType } from '../../shared/types';
import {
  summariseIssues,
  validateTestVersion,
  type ValidationIssue,
  type ValidationInput,
} from '../../shared/validation';

// -----------------------------------------------------------------------------
// Row shapes
// -----------------------------------------------------------------------------
interface TestRow {
  id: string;
  slug: string;
  title: string;
  type: TestType;
  status: TestStatus;
  summary: string;
  current_version_id: string | null;
  content_origin: string;
  created_at: string;
  updated_at: string;
}

interface VersionRow {
  id: string;
  test_id: string;
  version_number: number;
  status: TestStatus;
  change_note: string;
  config_json: string;
  total_questions: number;
  duration_seconds: number | null;
  is_complete_test: number;
  scoring_profile_id: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  frozen_snapshot_json: string | null;
}

interface SectionRow {
  id: string;
  skill: Skill;
  order_index: number;
  title: string;
  subtitle: string | null;
  instructions: string;
  passage_id: string | null;
  audio_asset_id: string | null;
  duration_seconds: number | null;
  config_json: string;
}

interface PassageRow {
  id: string;
  order_index: number;
  title: string;
  subtitle: string | null;
  body_json: string;
  word_count: number;
}

interface GroupRow {
  id: string;
  section_id: string;
  order_index: number;
  question_type: string;
  instructions: string;
  shared_options_json: string;
  config_json: string;
  range_from: number | null;
  range_to: number | null;
}

interface QuestionRow {
  id: string;
  section_id: string;
  question_group_id: string;
  number: number;
  order_index: number;
  prompt: string;
  body_json: string;
  options_json: string;
  config_json: string;
}

interface AnswerKeyRow {
  question_id: string;
  answer_json: string;
  evidence: string | null;
  explanation: string | null;
}

interface AssetRow {
  id: string;
  kind: string;
  storage_kind: string;
  external_url: string | null;
  r2_key: string | null;
  filename: string;
  mime: string;
  size_bytes: number;
  duration_seconds: number | null;
  alt_text: string | null;
  visibility: string;
  test_version_id: string | null;
}

// -----------------------------------------------------------------------------
// Candidate-facing payload (NEVER contains answer material)
// -----------------------------------------------------------------------------
export interface CandidateTestPayload {
  testId: string;
  versionId: string;
  versionNumber: number;
  title: string;
  type: TestType;
  summary: string;
  totalQuestions: number;
  durationSeconds: number | null;
  isCompleteTest: boolean;
  sections: CandidateSection[];
}

export interface LoadCandidateOptions {
  /** Include audio URLs (needs an asset base path). */
  fileBasePath?: string;
}

export async function loadCandidateTest(
  env: Env,
  versionId: string,
  options: LoadCandidateOptions = {},
): Promise<{ test: TestRow; version: VersionRow; payload: CandidateTestPayload }> {
  const version = await env.DB.prepare('SELECT * FROM test_versions WHERE id = ?').bind(versionId).first<VersionRow>();
  if (!version) throw ApiError.notFound('Test version not found.');
  const test = await env.DB.prepare('SELECT * FROM tests WHERE id = ?').bind(version.test_id).first<TestRow>();
  if (!test) throw ApiError.notFound('Test not found.');

  const [sections, passages, groups, questions, assets] = await Promise.all([
    env.DB.prepare('SELECT * FROM sections WHERE test_version_id = ? ORDER BY order_index, id')
      .bind(versionId)
      .all<SectionRow>(),
    env.DB.prepare('SELECT id, order_index, title, subtitle, body_json, word_count FROM passages WHERE test_version_id = ?')
      .bind(versionId)
      .all<PassageRow>(),
    env.DB.prepare('SELECT * FROM question_groups WHERE test_version_id = ? ORDER BY order_index, id')
      .bind(versionId)
      .all<GroupRow>(),
    // NOTE: explicitly enumerated columns - answer_keys are never selected here.
    env.DB.prepare(
      `SELECT id, section_id, question_group_id, number, order_index, prompt, body_json, options_json, config_json
         FROM questions WHERE test_version_id = ? ORDER BY number`,
    )
      .bind(versionId)
      .all<QuestionRow>(),
    env.DB.prepare(
      `SELECT id, kind, storage_kind, external_url, r2_key, filename, mime, size_bytes, duration_seconds, alt_text,
              visibility, test_version_id
         FROM assets
        WHERE test_version_id = ?
           OR id IN (SELECT audio_asset_id FROM sections WHERE test_version_id = ? AND audio_asset_id IS NOT NULL)`,
    )
      .bind(versionId, versionId)
      .all<AssetRow>(),
  ]);

  const passageById = new Map(passages.results.map((p) => [p.id, p]));
  const assetById = new Map(assets.results.map((a) => [a.id, a]));
  const questionsByGroup = new Map<string, QuestionRow[]>();
  for (const question of questions.results) {
    const list = questionsByGroup.get(question.question_group_id) ?? [];
    list.push(question);
    questionsByGroup.set(question.question_group_id, list);
  }
  const groupsBySection = new Map<string, GroupRow[]>();
  for (const group of groups.results) {
    const list = groupsBySection.get(group.section_id) ?? [];
    list.push(group);
    groupsBySection.set(group.section_id, list);
  }

  const basePath = options.fileBasePath ?? '/api/files';
  const candidateSections: CandidateSection[] = sections.results.map((section, index) => {
    const sectionGroups = groupsBySection.get(section.id) ?? [];
    const candidateGroups: CandidateQuestionGroup[] = sectionGroups.map((group) => {
      const rows = (questionsByGroup.get(group.id) ?? []).sort((a, b) => a.number - b.number);
      const config = parseJson<QuestionGroupConfig>(group.config_json, {});
      return {
        id: group.id,
        type: (isQuestionType(group.question_type) ? group.question_type : 'SHORT_ANSWER') as QuestionType,
        instructions: group.instructions,
        sharedOptions: parseJson<SharedOption[]>(group.shared_options_json, []),
        config,
        rangeFrom: group.range_from,
        rangeTo: group.range_to,
        questions: rows.map((row) => toCandidateQuestion(row, config)),
      };
    });

    const writingTasks = candidateGroups
      .flatMap((group) => (group.type === 'WRITING_TASK_1' || group.type === 'WRITING_TASK_2' ? group.questions : []))
      .sort((a, b) => a.number - b.number);

    const passageRow = section.passage_id ? passageById.get(section.passage_id) : undefined;
    const passage: CandidatePassage | null = passageRow
      ? {
          id: passageRow.id,
          title: passageRow.title,
          subtitle: passageRow.subtitle,
          paragraphs: parseJson<PassageParagraph[]>(passageRow.body_json, []),
          wordCount: passageRow.word_count,
        }
      : null;

    const audioRow = section.audio_asset_id ? assetById.get(section.audio_asset_id) : undefined;
    const sectionConfig = parseJson<{ playback?: Partial<AudioPlaybackPolicy> }>(section.config_json, {});
    // Play the HTTPS origin directly so the exam player does not depend on a
    // 302 from /api/files (audio elements drop auth headers on redirect).
    const resolvedUrl = audioRow ? resolveAssetUrl(audioRow) : null;
    const audio: CandidateAudio | null = audioRow && resolvedUrl
      ? {
          assetId: audioRow.id,
          url: resolvedUrl.startsWith('/') ? `${basePath}/${audioRow.id}` : resolvedUrl,
          durationSeconds: audioRow.duration_seconds,
          playback: { ...DEFAULT_AUDIO_POLICY, ...(sectionConfig.playback ?? {}) },
        }
      : null;

    return {
      id: section.id,
      skill: section.skill,
      orderIndex: index,
      title: section.title,
      subtitle: section.subtitle,
      instructions: section.instructions,
      durationSeconds: section.duration_seconds,
      passage,
      audio,
      groups: candidateGroups,
      writingTasks,
      questionNumbers: candidateGroups.flatMap((g) => g.questions.map((q) => q.number)).sort((a, b) => a - b),
    } satisfies CandidateSection;
  });

  return {
    test,
    version,
    payload: {
      testId: test.id,
      versionId: version.id,
      versionNumber: version.version_number,
      title: test.title,
      type: test.type,
      summary: test.summary,
      totalQuestions: version.total_questions,
      durationSeconds: version.duration_seconds,
      isCompleteTest: version.is_complete_test === 1,
      sections: candidateSections,
    },
  };
}

function toCandidateQuestion(row: QuestionRow, groupConfig: QuestionGroupConfig): CandidateQuestion {
  const ownConfig = parseJson<QuestionGroupConfig>(row.config_json, {});
  const body = parseJson<CandidateQuestion['body']>(row.body_json, null);
  return {
    id: row.id,
    number: row.number,
    prompt: row.prompt,
    options: parseJson<SharedOption[]>(row.options_json, []),
    config: { ...groupConfig, ...ownConfig },
    body: body && Object.keys(body as object).length > 0 ? body : null,
  };
}

// -----------------------------------------------------------------------------
// Admin-facing content tree (includes protected answer keys)
// -----------------------------------------------------------------------------
export interface AdminQuestion extends QuestionRow {
  config: QuestionGroupConfig;
  options: SharedOption[];
  body: CandidateQuestion['body'];
  answerKey: AnswerKey | null;
  evidence: string | null;
  explanation: string | null;
}

export interface AdminGroup {
  id: string;
  sectionId: string;
  orderIndex: number;
  type: QuestionType;
  instructions: string;
  sharedOptions: SharedOption[];
  config: QuestionGroupConfig;
  rangeFrom: number | null;
  rangeTo: number | null;
  questions: AdminQuestion[];
}

export interface AdminSection {
  id: string;
  skill: Skill;
  orderIndex: number;
  title: string;
  subtitle: string | null;
  instructions: string;
  durationSeconds: number | null;
  passage: {
    id: string;
    title: string;
    subtitle: string | null;
    paragraphs: PassageParagraph[];
    wordCount: number;
  } | null;
  audioAssetId: string | null;
  audioAsset: AssetRow | null;
  playback: Partial<AudioPlaybackPolicy>;
  groups: AdminGroup[];
}

export interface AdminVersionContent {
  test: { id: string; slug: string; title: string; type: TestType; status: TestStatus; summary: string; contentOrigin: string;
    sourceTitle: string | null; sourceUrl: string | null; attribution: string | null; licenseNotes: string | null };
  version: {
    id: string;
    testId: string;
    versionNumber: number;
    status: TestStatus;
    changeNote: string;
    config: Record<string, unknown>;
    totalQuestions: number;
    durationSeconds: number | null;
    isCompleteTest: boolean;
    scoringProfileId: string | null;
    publishedAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
  sections: AdminSection[];
  assets: AssetRow[];
  mockComponents: Array<{
    id: string;
    orderIndex: number;
    skill: Skill;
    testVersionId: string;
    label: string;
    durationSeconds: number;
    breakAfterSeconds: number;
    referenceTitle?: string;
  }>;
}

export async function loadAdminVersion(env: Env, versionId: string): Promise<AdminVersionContent> {
  const version = await env.DB.prepare('SELECT * FROM test_versions WHERE id = ?').bind(versionId).first<VersionRow>();
  if (!version) throw ApiError.notFound('Test version not found.');
  const test = await env.DB.prepare('SELECT * FROM tests WHERE id = ?').bind(version.test_id).first<
    TestRow & {
      source_title: string | null;
      source_url: string | null;
      attribution: string | null;
      license_notes: string | null;
    }
  >();
  if (!test) throw ApiError.notFound('Test not found.');

  const [sections, passages, groups, questions, keys, assets, components] = await Promise.all([
    env.DB.prepare('SELECT * FROM sections WHERE test_version_id = ? ORDER BY order_index, id').bind(versionId).all<SectionRow>(),
    env.DB.prepare('SELECT * FROM passages WHERE test_version_id = ?').bind(versionId).all<PassageRow>(),
    env.DB.prepare('SELECT * FROM question_groups WHERE test_version_id = ? ORDER BY order_index, id').bind(versionId).all<GroupRow>(),
    env.DB.prepare('SELECT * FROM questions WHERE test_version_id = ? ORDER BY number').bind(versionId).all<QuestionRow>(),
    env.DB.prepare('SELECT question_id, answer_json, evidence, explanation FROM answer_keys WHERE test_version_id = ?')
      .bind(versionId)
      .all<AnswerKeyRow>(),
    env.DB.prepare(
      `SELECT id, kind, storage_kind, external_url, r2_key, filename, mime, size_bytes, duration_seconds, alt_text,
              visibility, test_version_id
         FROM assets
        WHERE kind = 'AUDIO'
           OR test_version_id = ?
           OR id IN (SELECT audio_asset_id FROM sections WHERE test_version_id = ? AND audio_asset_id IS NOT NULL)
        ORDER BY created_at DESC
        LIMIT 120`,
    )
      .bind(versionId, versionId)
      .all<AssetRow>(),
    env.DB.prepare('SELECT * FROM mock_components WHERE mock_version_id = ? ORDER BY order_index').bind(versionId).all<{
      id: string;
      order_index: number;
      skill: Skill;
      test_version_id: string;
      label: string;
      duration_seconds: number;
      break_after_seconds: number;
    }>(),
  ]);

  const keyByQuestion = new Map(keys.results.map((k) => [k.question_id, k]));
  const passageById = new Map(passages.results.map((p) => [p.id, p]));
  const assetById = new Map(assets.results.map((a) => [a.id, a]));

  const componentTitles: Record<string, string> = {};
  for (const component of components.results) {
    const row = await env.DB.prepare(
      `SELECT t.title, v.version_number FROM test_versions v JOIN tests t ON t.id = v.test_id WHERE v.id = ?`,
    )
      .bind(component.test_version_id)
      .first<{ title: string; version_number: number }>();
    if (row) componentTitles[component.test_version_id] = `${row.title} (v${row.version_number})`;
  }

  const adminSections: AdminSection[] = sections.results.map((section) => {
    const sectionGroups = groups.results.filter((g) => g.section_id === section.id);
    const passageRow = section.passage_id ? passageById.get(section.passage_id) : undefined;
    const audioRow = section.audio_asset_id ? assetById.get(section.audio_asset_id) : undefined;
    const sectionConfig = parseJson<{ playback?: Partial<AudioPlaybackPolicy> }>(section.config_json, {});
    return {
      id: section.id,
      skill: section.skill,
      orderIndex: section.order_index,
      title: section.title,
      subtitle: section.subtitle,
      instructions: section.instructions,
      durationSeconds: section.duration_seconds,
      passage: passageRow
        ? {
            id: passageRow.id,
            title: passageRow.title,
            subtitle: passageRow.subtitle,
            paragraphs: parseJson<PassageParagraph[]>(passageRow.body_json, []),
            wordCount: passageRow.word_count,
          }
        : null,
      audioAssetId: section.audio_asset_id,
      audioAsset: audioRow ?? null,
      playback: sectionConfig.playback ?? {},
      groups: sectionGroups.map((group) => {
        const groupQuestions = questions.results
          .filter((q) => q.question_group_id === group.id)
          .sort((a, b) => a.number - b.number);
        const key = keyByQuestion;
        return {
          id: group.id,
          sectionId: group.section_id,
          orderIndex: group.order_index,
          type: (isQuestionType(group.question_type) ? group.question_type : 'SHORT_ANSWER') as QuestionType,
          instructions: group.instructions,
          sharedOptions: parseJson<SharedOption[]>(group.shared_options_json, []),
          config: parseJson<QuestionGroupConfig>(group.config_json, {}),
          rangeFrom: group.range_from,
          rangeTo: group.range_to,
          questions: groupQuestions.map((question) => {
            const answerKeyRow = key.get(question.id);
            const body = parseJson<CandidateQuestion['body']>(question.body_json, null);
            return {
              ...question,
              config: parseJson<QuestionGroupConfig>(question.config_json, {}),
              options: parseJson<SharedOption[]>(question.options_json, []),
              body: body && Object.keys(body as object).length > 0 ? body : null,
              answerKey: answerKeyRow ? (parseJson<AnswerKey | null>(answerKeyRow.answer_json, null) as AnswerKey | null) : null,
              evidence: answerKeyRow?.evidence ?? null,
              explanation: answerKeyRow?.explanation ?? null,
            } satisfies AdminQuestion;
          }),
        } satisfies AdminGroup;
      }),
    } satisfies AdminSection;
  });

  return {
    test: {
      id: test.id,
      slug: test.slug,
      title: test.title,
      type: test.type,
      status: test.status,
      summary: test.summary,
      contentOrigin: test.content_origin,
      sourceTitle: test.source_title,
      sourceUrl: test.source_url,
      attribution: test.attribution,
      licenseNotes: test.license_notes,
    },
    version: {
      id: version.id,
      testId: version.test_id,
      versionNumber: version.version_number,
      status: version.status,
      changeNote: version.change_note,
      config: parseJson<Record<string, unknown>>(version.config_json, {}),
      totalQuestions: version.total_questions,
      durationSeconds: version.duration_seconds,
      isCompleteTest: version.is_complete_test === 1,
      scoringProfileId: version.scoring_profile_id,
      publishedAt: version.published_at,
      createdAt: version.created_at,
      updatedAt: version.updated_at,
    },
    sections: adminSections,
    assets: assets.results,
    mockComponents: components.results.map((component) => ({
      id: component.id,
      orderIndex: component.order_index,
      skill: component.skill,
      testVersionId: component.test_version_id,
      label: component.label,
      durationSeconds: component.duration_seconds,
      breakAfterSeconds: component.break_after_seconds,
      referenceTitle: componentTitles[component.test_version_id],
    })),
  };
}

// -----------------------------------------------------------------------------
// Validation
// -----------------------------------------------------------------------------
/** Flattens a question body into the text a candidate would actually read. */
function questionBodyText(body: AdminQuestion['body']): string | null {
  if (!body) return null;
  const parts: string[] = [];
  if (typeof body.text === 'string') parts.push(body.text);
  if (Array.isArray(body.rows)) {
    for (const row of body.rows) {
      if (Array.isArray(row)) parts.push(row.join(' '));
    }
  }
  const text = parts.join('\n').trim();
  return text.length > 0 ? text : null;
}

export function toValidationInput(content: AdminVersionContent): ValidationInput {
  const mockComponentIssues: ValidationIssue[] =
    content.test.type === 'FULL_MOCK'
      ? content.mockComponents.length === 0
        ? [
            {
              level: 'ERROR',
              code: 'MOCK_WITHOUT_COMPONENTS',
              message: 'A full mock needs at least one Listening, Reading or Writing component.',
            },
          ]
        : []
      : [];

  return {
    testType: content.test.type,
    title: content.test.title,
    sections: content.sections.map((section) => ({
      id: section.id,
      skill: section.skill,
      orderIndex: section.orderIndex,
      title: section.title,
      instructions: section.instructions,
      hasPassage: Boolean(section.passage && section.passage.paragraphs.length >= 0 && section.passage.id),
      passageParagraphCount: section.passage?.paragraphs.length ?? 0,
      // Paragraph-level checks (duplicate labels, duplicated text, declared vs
      // computed word count) need the passage body, not just a count.
      passage: section.passage
        ? {
            paragraphs: section.passage.paragraphs.map((paragraph) => ({
              label: paragraph.label ?? '',
              text: paragraph.text ?? '',
            })),
            declaredWordCount: section.passage.wordCount ?? null,
          }
        : null,
      hasAudio: Boolean(section.audioAssetId),
      groups: section.groups.map((group) => ({
        id: group.id,
        type: group.type,
        instructions: group.instructions,
        sharedOptions: group.sharedOptions,
        rangeFrom: group.rangeFrom,
        rangeTo: group.rangeTo,
        bodyTexts: group.questions
          .map((question) => questionBodyText(question.body))
          .filter((value): value is string => Boolean(value)),
        questions: group.questions.map((question) => ({
          id: question.id,
          number: question.number,
          prompt: question.prompt,
          bodyText: questionBodyText(question.body),
          evidence: question.evidence ?? null,
          options: question.options,
          config: question.config,
          answerKey: question.answerKey,
        })),
      })),
    })),
    mockComponentIssues,
  };
}

export async function validateVersion(env: Env, versionId: string): Promise<{
  issues: ValidationIssue[];
  errors: number;
  warnings: number;
  publishable: boolean;
}> {
  const content = await loadAdminVersion(env, versionId);
  const issues = validateTestVersion(toValidationInput(content));
  const summary = summariseIssues(issues);
  await env.DB.prepare('UPDATE test_versions SET validation_json = ?, updated_at = ? WHERE id = ?')
    .bind(JSON.stringify({ issues, ...summary, checkedAt: nowIso() }), nowIso(), versionId)
    .run();
  return { issues, ...summary };
}

// -----------------------------------------------------------------------------
// Version lifecycle
// -----------------------------------------------------------------------------
export async function cloneVersionContent(env: Env, fromVersionId: string, toVersionId: string): Promise<void> {
  const content = await loadAdminVersion(env, fromVersionId);
  const timestamp = nowIso();
  const statements: D1PreparedStatement[] = [];

  for (const section of content.sections) {
    const newSectionId = newId('sec');
    let newPassageId: string | null = null;

    if (section.passage) {
      newPassageId = newId('psg');
      statements.push(
        env.DB.prepare(
          `INSERT INTO passages (id, test_version_id, order_index, title, subtitle, body_json, word_count, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          newPassageId,
          toVersionId,
          section.orderIndex,
          section.passage.title,
          section.passage.subtitle,
          JSON.stringify(section.passage.paragraphs),
          section.passage.wordCount,
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
        newSectionId,
        toVersionId,
        section.skill,
        section.orderIndex,
        section.title,
        section.subtitle,
        section.instructions,
        newPassageId,
        section.audioAssetId,
        section.durationSeconds,
        JSON.stringify(section.playback ? { playback: section.playback } : {}),
        timestamp,
        timestamp,
      ),
    );

    for (const group of section.groups) {
      const newGroupId = newId('grp');
      statements.push(
        env.DB.prepare(
          `INSERT INTO question_groups (id, test_version_id, section_id, order_index, question_type, instructions,
                                        shared_options_json, config_json, range_from, range_to, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          newGroupId,
          toVersionId,
          newSectionId,
          group.orderIndex,
          group.type,
          group.instructions,
          JSON.stringify(group.sharedOptions),
          JSON.stringify(group.config),
          group.rangeFrom,
          group.rangeTo,
          timestamp,
          timestamp,
        ),
      );

      for (const question of group.questions) {
        const newQuestionId = newId('qst');
        statements.push(
          env.DB.prepare(
            `INSERT INTO questions (id, test_version_id, section_id, question_group_id, number, order_index, prompt,
                                    body_json, options_json, config_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            newQuestionId,
            toVersionId,
            newSectionId,
            newGroupId,
            question.number,
            question.number,
            question.prompt,
            JSON.stringify(question.body ?? {}),
            JSON.stringify(question.options),
            JSON.stringify(question.config),
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
              newQuestionId,
              toVersionId,
              JSON.stringify(question.answerKey),
              question.evidence,
              question.explanation,
              timestamp,
              timestamp,
            ),
          );
        }
      }
    }
  }

  for (const component of content.mockComponents) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO mock_components (id, mock_version_id, order_index, skill, test_version_id, label, duration_seconds,
                                      break_after_seconds, config_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?)`,
      ).bind(
        newId('mcp'),
        toVersionId,
        component.orderIndex,
        component.skill,
        component.testVersionId,
        component.label,
        component.durationSeconds,
        component.breakAfterSeconds,
        timestamp,
        timestamp,
      ),
    );
  }

  statements.push(
    env.DB.prepare('UPDATE test_versions SET total_questions = ?, updated_at = ? WHERE id = ?').bind(
      content.version.totalQuestions,
      timestamp,
      toVersionId,
    ),
  );

  // D1 batch statements run in an implicit transaction.
  for (let i = 0; i < statements.length; i += 40) {
    await env.DB.batch(statements.slice(i, i + 40));
  }
}

export async function recountQuestions(env: Env, versionId: string): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS count FROM questions WHERE test_version_id = ?')
    .bind(versionId)
    .first<{ count: number }>();
  const count = row?.count ?? 0;
  await env.DB.prepare('UPDATE test_versions SET total_questions = ?, updated_at = ? WHERE id = ?')
    .bind(count, nowIso(), versionId)
    .run();
  return count;
}

export function buildFrozenSnapshot(content: AdminVersionContent): Record<string, unknown> {
  // Canonical, answer-key-inclusive snapshot captured at publish time. Stored
  // server-side only and never returned to candidate clients.
  return {
    capturedAt: nowIso(),
    test: content.test,
    version: {
      id: content.version.id,
      versionNumber: content.version.versionNumber,
      config: content.version.config,
      durationSeconds: content.version.durationSeconds,
      isCompleteTest: content.version.isCompleteTest,
      scoringProfileId: content.version.scoringProfileId,
    },
    sections: content.sections.map((section) => ({
      id: section.id,
      skill: section.skill,
      orderIndex: section.orderIndex,
      title: section.title,
      subtitle: section.subtitle,
      instructions: section.instructions,
      durationSeconds: section.durationSeconds,
      passage: section.passage,
      audioAssetId: section.audioAssetId,
      playback: section.playback,
      groups: section.groups.map((group) => ({
        id: group.id,
        orderIndex: group.orderIndex,
        type: group.type,
        instructions: group.instructions,
        sharedOptions: group.sharedOptions,
        config: group.config,
        rangeFrom: group.rangeFrom,
        rangeTo: group.rangeTo,
        questions: group.questions.map((question) => ({
          id: question.id,
          number: question.number,
          prompt: question.prompt,
          body: question.body,
          options: question.options,
          config: question.config,
          answerKey: question.answerKey,
          evidence: question.evidence,
          explanation: question.explanation,
        })),
      })),
    })),
    mockComponents: content.mockComponents,
  };
}

export function wordCountOfParagraphs(paragraphs: PassageParagraph[]): number {
  return paragraphs.reduce((total, paragraph) => {
    const words = paragraph.text.trim().split(/\s+/).filter(Boolean).length;
    return total + words;
  }, 0);
}
