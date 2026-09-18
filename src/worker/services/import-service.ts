import { z } from 'zod';
import type { Env, ImportQueueMessage } from '../env';
import { ApiError } from '../lib/errors';
import { newId, nowIso } from '../lib/ids';
import { sha256Hex } from '../lib/crypto';
import type { AuthUser } from '../lib/auth-types';
import { extractText, kindForMime, ALLOWED_IMPORT_MIME_TYPES } from '../extract';
import { aiStatus, structureTestFromSource } from '../ai/openai';
import { isQuestionType, QUESTION_TYPE_META, type QuestionType } from '../../shared/question-types';
import { validateTestVersion, summariseIssues, type ValidationIssue } from '../../shared/validation';
import type { AnswerKey } from '../../shared/answer-key';
import { replaceVersionContent, type EditableContent, type EditableGroup } from './content-write-service';
import { loadAdminVersion, toValidationInput } from './content-service';
import { recordAudit } from '../lib/audit';
import { loadPlatformSettings } from '../lib/settings';
import type { ContentOrigin, Skill } from '../../shared/types';

// -----------------------------------------------------------------------------
// Upload
// -----------------------------------------------------------------------------
export interface CreateImportInput {
  file: File;
  title?: string;
  contentOrigin?: ContentOrigin;
  sourceTitle?: string;
  sourceUrl?: string;
  attribution?: string;
  licenseNotes?: string;
}

export async function createImport(env: Env, user: AuthUser, input: CreateImportInput): Promise<{
  importId: string;
  assetId: string;
  status: string;
}> {
  const maxBytes = Number(env.MAX_UPLOAD_BYTES || 26_214_400);
  if (input.file.size <= 0) throw ApiError.validation('The uploaded file is empty.');
  if (input.file.size > maxBytes) {
    throw ApiError.validation(`Files must be smaller than ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  }

  const mime = input.file.type || 'application/octet-stream';
  const filename = sanitiseFilename(input.file.name || 'upload');
  if (!ALLOWED_IMPORT_MIME_TYPES.includes(mime)) {
    throw ApiError.validation(`Unsupported file type "${mime}".`, { allowed: ALLOWED_IMPORT_MIME_TYPES });
  }

  const importId = newId('imp');
  const assetId = newId('ast');
  const kind = kindForMime(mime, filename);
  const extension = filename.includes('.') ? filename.split('.').pop()!.slice(0, 8) : 'bin';
  const r2Key = `imports/${importId}/source.${extension}`;
  const buffer = await input.file.arrayBuffer();
  const checksum = await sha256Hex(buffer);

  await env.CONTENT_BUCKET.put(r2Key, buffer, {
    httpMetadata: { contentType: mime, contentDisposition: `attachment; filename="${filename}"` },
    customMetadata: { importId, uploadedBy: user.id },
  });

  const timestamp = nowIso();
  const title = (input.title ?? filename.replace(/\.[^.]+$/, '')).slice(0, 200);

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO assets (id, kind, r2_key, filename, mime, size_bytes, checksum_sha256, visibility, uploaded_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'PRIVATE', ?, ?)`,
    ).bind(assetId, kind, r2Key, filename, mime, input.file.size, checksum, user.id, timestamp),
    env.DB.prepare(
      `INSERT INTO imports (id, title, filename, mime, size_bytes, r2_key, status, ai_used, created_by, created_at, updated_at,
                            content_origin, source_title, source_url, attribution, license_notes)
       VALUES (?, ?, ?, ?, ?, ?, 'UPLOADED', 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      importId,
      title,
      filename,
      mime,
      input.file.size,
      r2Key,
      user.id,
      timestamp,
      timestamp,
      input.contentOrigin ?? 'IMPORTED',
      input.sourceTitle ?? null,
      input.sourceUrl ?? null,
      input.attribution ?? null,
      input.licenseNotes ?? null,
    ),
    env.DB.prepare(
      `INSERT INTO import_jobs (id, import_id, stage, status, attempts, log_json, started_at, finished_at, created_at, updated_at)
       VALUES (?, ?, 'UPLOAD', 'SUCCEEDED', 1, ?, ?, ?, ?, ?)`,
    ).bind(
      newId('job'),
      importId,
      JSON.stringify([{ at: timestamp, message: `Stored ${filename} (${input.file.size} bytes, ${mime}).` }]),
      timestamp,
      timestamp,
      timestamp,
      timestamp,
    ),
  ]);

  await recordAudit(env, {
    actorUserId: user.id,
    action: 'IMPORT_UPLOAD',
    entityType: 'import',
    entityId: importId,
    metadata: { filename, size: input.file.size, mime },
  });

  // Queue the extraction stage when a queue binding exists; otherwise the caller
  // can run the pipeline inline (both paths execute the identical code).
  if (env.IMPORT_QUEUE) {
    await env.IMPORT_QUEUE.send({ importId, stage: 'EXTRACT', requestedBy: user.id });
  }

  return { importId, assetId, status: 'UPLOADED' };
}

function sanitiseFilename(name: string): string {
  return name.replace(/[^\w.\- ()]/g, '_').slice(0, 160);
}

// -----------------------------------------------------------------------------
// Pipeline stages
// -----------------------------------------------------------------------------
export async function runImportStage(env: Env, message: ImportQueueMessage): Promise<void> {
  const { importId, stage, requestedBy } = message;

  const row = await env.DB.prepare(
    'SELECT id, title, filename, mime, r2_key, text_r2_key FROM (SELECT id, title, filename, mime, r2_key, extracted_r2_key AS text_r2_key FROM imports WHERE id = ?)',
  )
    .bind(importId)
    .first<{ id: string; title: string; filename: string; mime: string; r2_key: string | null; text_r2_key: string | null }>();
  if (!row || !row.r2_key) throw new Error(`Import ${importId} not found`);

  const jobId = newId('job');
  const startedAt = nowIso();
  await env.DB.prepare(
    `INSERT INTO import_jobs (id, import_id, stage, status, attempts, log_json, started_at, created_at, updated_at)
     VALUES (?, ?, ?, 'RUNNING', 1, '[]', ?, ?, ?)`,
  )
    .bind(jobId, importId, stage, startedAt, startedAt, startedAt)
    .run();

  const log: Array<{ at: string; message: string }> = [];

  try {
    if (stage === 'EXTRACT') {
      await env.DB.prepare(`UPDATE imports SET status = 'PROCESSING', updated_at = ? WHERE id = ?`)
        .bind(nowIso(), importId)
        .run();

      const object = await env.CONTENT_BUCKET.get(row.r2_key);
      if (!object) throw new Error('The stored source file could not be read.');
      const bytes = new Uint8Array(await object.arrayBuffer());
      const extraction = extractText(bytes, row.mime, row.filename);
      log.push({
        at: nowIso(),
        message: `Extracted ${extraction.text.length} characters from a ${extraction.kind} file${extraction.pageCount ? ` (${extraction.pageCount} pages)` : ''}.`,
      });
      if (extraction.warning) log.push({ at: nowIso(), message: extraction.warning });

      if (extraction.text.trim().length > 0) {
        const key = `imports/${importId}/extracted.txt`;
        await env.CONTENT_BUCKET.put(key, extraction.text, { httpMetadata: { contentType: 'text/plain' } });
        await env.DB.prepare(
          `UPDATE imports SET extracted_r2_key = ?, extracted_chars = ?, status = ?, updated_at = ? WHERE id = ?`,
        )
          .bind(key, extraction.text.length, 'PROCESSING', nowIso(), importId)
          .run();
      }

      await env.DB.prepare(
        `UPDATE import_jobs SET status = 'SUCCEEDED', log_json = ?, finished_at = ?, updated_at = ? WHERE id = ?`,
      )
        .bind(JSON.stringify(log), nowIso(), nowIso(), jobId)
        .run();

      if (env.IMPORT_QUEUE) {
        await env.IMPORT_QUEUE.send({ importId, stage: 'AI_STRUCTURE', requestedBy });
      }
      return;
    }

    if (stage === 'AI_STRUCTURE') {
      const platformSettings = await loadPlatformSettings(env);
      const status = aiStatus(env);
      if (!platformSettings.aiImportEnabled) {
        await env.DB.prepare(
          `UPDATE import_jobs SET status = 'SKIPPED', error = ?, log_json = ?, finished_at = ?, updated_at = ? WHERE id = ?`,
        )
          .bind(
            'AI import is disabled in platform settings',
            JSON.stringify([...log, { at: nowIso(), message: 'AI structuring is disabled in platform settings; the import stays in review for manual structuring.' }]),
            nowIso(),
            nowIso(),
            jobId,
          )
          .run();
        await env.DB.prepare(`UPDATE imports SET status = 'REVIEW', notes = ?, updated_at = ? WHERE id = ?`)
          .bind('AI import is disabled in platform settings. Structure this import manually or enable it in Settings.', nowIso(), importId)
          .run();
        return;
      }
      if (!status.available) {
        await env.DB.prepare(
          `UPDATE import_jobs SET status = 'SKIPPED', error = ?, log_json = ?, finished_at = ?, updated_at = ? WHERE id = ?`,
        )
          .bind(status.reason ?? 'AI unavailable', JSON.stringify(log), nowIso(), nowIso(), jobId)
          .run();
        await env.DB.prepare(`UPDATE imports SET status = 'REVIEW', notes = ?, updated_at = ? WHERE id = ?`)
          .bind(status.reason ?? '', nowIso(), importId)
          .run();
        return;
      }

      let text = '';
      if (row.text_r2_key) {
        const textObject = await env.CONTENT_BUCKET.get(row.text_r2_key);
        if (textObject) text = await textObject.text();
      }
      if (!text.trim()) {
        log.push({
          at: nowIso(),
          message: 'No extractable text was found, so AI structuring was skipped. Add the content manually.',
        });
        await env.DB.prepare(
          `UPDATE import_jobs SET status = 'SKIPPED', log_json = ?, finished_at = ?, updated_at = ? WHERE id = ?`,
        )
          .bind(JSON.stringify(log), nowIso(), nowIso(), jobId)
          .run();
        await env.DB.prepare(`UPDATE imports SET status = 'REVIEW', updated_at = ? WHERE id = ?`)
          .bind(nowIso(), importId)
          .run();
        return;
      }

      const structured = await structureTestFromSource(env, {
        sourceText: text,
        filename: row.filename,
        titleHint: row.title,
      });

      const converted = convertAiPayload(structured.payload);
      log.push({
        at: nowIso(),
        message: `AI structured ${converted.content.sections.length} section(s) with ${converted.questionCount} question(s); answer key confidence: ${converted.answerKeyConfidence}.`,
      });
      for (const issue of converted.issues.slice(0, 25)) {
        log.push({ at: nowIso(), message: `${issue.level}: ${issue.message}` });
      }

      const validation = summariseIssues(converted.issues);

      await env.DB.batch([
        env.DB.prepare(
          `UPDATE imports SET status = ?, ai_used = 1, ai_model = ?, structured_payload_json = ?,
                              answer_key_confidence = ?, updated_at = ? WHERE id = ?`,
        ).bind(
          'REVIEW',
          structured.model,
          JSON.stringify(converted.content),
          converted.answerKeyConfidence,
          nowIso(),
          importId,
        ),
        env.DB.prepare(
          `INSERT INTO import_drafts (id, import_id, payload_json, validation_json, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'REVIEW', ?, ?)`,
        ).bind(
          newId('drf'),
          importId,
          JSON.stringify(converted.content),
          JSON.stringify({ issues: converted.issues, ...validation, checkedAt: nowIso() }),
          nowIso(),
          nowIso(),
        ),
        env.DB.prepare(
          `UPDATE import_jobs SET status = 'SUCCEEDED', log_json = ?, finished_at = ?, updated_at = ? WHERE id = ?`,
        ).bind(JSON.stringify(log), nowIso(), nowIso(), jobId),
      ]);

      await recordAudit(env, {
        actorUserId: requestedBy,
        action: 'IMPORT_AI_STRUCTURED',
        entityType: 'import',
        entityId: importId,
        metadata: { model: structured.model, answerKeyConfidence: converted.answerKeyConfidence },
      });
      return;
    }

    throw new Error(`Unknown import stage ${stage}`);
  } catch (error) {
    const message_ = (error as Error).message;
    log.push({ at: nowIso(), message: `${stage} failed: ${message_}` });
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE import_jobs SET status = 'FAILED', error = ?, log_json = ?, finished_at = ?, updated_at = ? WHERE id = ?`,
      ).bind(message_, JSON.stringify(log), nowIso(), nowIso(), jobId),
      env.DB.prepare(`UPDATE imports SET status = 'FAILED', notes = ?, updated_at = ? WHERE id = ?`)
        .bind(message_, nowIso(), importId),
    ]);
    throw error;
  }
}

/** Runs extraction and AI structuring synchronously (used when no queue exists). */
export async function runImportPipelineInline(env: Env, importId: string, requestedBy: string): Promise<void> {
  const errors: string[] = [];
  for (const stage of ['EXTRACT', 'AI_STRUCTURE'] as const) {
    try {
      await runImportStage(env, { importId, stage, requestedBy });
    } catch (error) {
      errors.push(`${stage}: ${(error as Error).message}`);
      break;
    }
  }
  if (errors.length > 0) throw ApiError.validation(errors.join('; '));
}

// -----------------------------------------------------------------------------
// AI payload → editable content (deterministic, zod-validated)
// -----------------------------------------------------------------------------
const optionSchema = z.object({ id: z.string().min(1), text: z.string() });

const aiPayloadSchema = z.object({
  testTitle: z.string().nullable().optional(),
  testType: z.enum(['READING', 'LISTENING', 'WRITING', 'FULL_MOCK']),
  answerKeyConfidence: z.enum(['PROVIDED', 'PARTIAL', 'ABSENT']),
  warnings: z.array(z.string()).default([]),
  passages: z.array(z.object({ title: z.string().nullable().optional(), paragraphs: z.array(z.object({ label: z.string(), text: z.string() })) })).default([]),
  sections: z.array(
    z.object({
      skill: z.enum(['READING', 'LISTENING', 'WRITING']),
      title: z.string().nullable().optional(),
      instructions: z.string().nullable().optional(),
      passageIndex: z.number().int().nullable().optional(),
      audioProvided: z.boolean().default(false),
      groups: z.array(
        z.object({
          questionType: z.string(),
          instructions: z.string().nullable().optional(),
          optionNumbering: z.enum(['roman', 'alpha', 'numeric']).nullable().optional(),
          sharedOptions: z.array(optionSchema).default([]),
          selectCount: z.number().int().nullable().optional(),
          wordLimitMax: z.number().int().nullable().optional(),
          questions: z.array(
            z.object({
              number: z.number().int(),
              prompt: z.string().default(''),
              options: z.array(optionSchema).default([]),
              answer: z.string().nullable().optional(),
              evidence: z.string().nullable().optional(),
              explanation: z.string().nullable().optional(),
            }),
          ),
        }),
      ),
    }),
  ),
});

export interface ConvertedAiPayload {
  content: EditableContent;
  issues: ValidationIssue[];
  answerKeyConfidence: 'PROVIDED' | 'PARTIAL' | 'ABSENT';
  questionCount: number;
}

export function convertAiPayload(payload: unknown): ConvertedAiPayload {
  const parsed = aiPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    const issues: ValidationIssue[] = parsed.error.issues.map((issue) => ({
      level: 'ERROR' as const,
      code: 'AI_PAYLOAD_SCHEMA',
      message: `${issue.path.join('.')}: ${issue.message}`,
    }));
    return { content: { sections: [] }, issues, answerKeyConfidence: 'ABSENT', questionCount: 0 };
  }

  const data = parsed.data;
  const issues: ValidationIssue[] = [];
  let questionCount = 0;
  let answeredQuestions = 0;
  let totalQuestions = 0;

  for (const warning of data.warnings) {
    issues.push({ level: 'WARNING', code: 'AI_WARNING', message: warning });
  }

  const sections: EditableContent['sections'] = data.sections.map((section, index) => {
    const passage = section.passageIndex !== null && section.passageIndex !== undefined
      ? data.passages[section.passageIndex]
      : undefined;
    if (section.passageIndex !== null && section.passageIndex !== undefined && !passage) {
      issues.push({
        level: 'ERROR',
        code: 'AI_MISSING_PASSAGE_REFERENCE',
        message: `Section ${index + 1} references passage ${section.passageIndex} which was not returned.`,
      });
    }

    const groups: EditableGroup[] = section.groups
      .map((group, groupIndex): EditableGroup | null => {
      const type = group.questionType;
      if (!isQuestionType(type)) {
        // The group is dropped so the draft can never carry a question type the
        // platform does not support; the ERROR keeps it out of publishing.
        issues.push({
          level: 'ERROR',
          code: 'AI_UNKNOWN_QUESTION_TYPE',
          message: `Section ${index + 1}, group ${groupIndex + 1}: unknown question type "${type}" was ignored.`,
        });
        return null;
      }
      const meta = QUESTION_TYPE_META[type as QuestionType];

      const questions = group.questions.map((question) => {
        totalQuestions += 1;
        const key = buildAnswerKey(type, question.answer ?? null, group.sharedOptions);
        if (key) answeredQuestions += 1;

        return {
          number: question.number,
          prompt: question.prompt ?? '',
          options: question.options ?? [],
          config:
            type === 'MCQ_MULTI' && group.selectCount
              ? { selectCount: group.selectCount }
              : group.wordLimitMax
                ? { wordLimit: { max: group.wordLimitMax } }
                : {},
          answerKey: key,
          evidence: question.evidence ?? null,
          explanation: question.explanation ?? null,
        };
      });

      return {
        type,
        instructions: group.instructions ?? (meta ? meta.defaultInstructions : ''),
        sharedOptions: group.sharedOptions ?? [],
        config: {
          ...(group.selectCount ? { selectCount: group.selectCount } : {}),
          ...(group.wordLimitMax ? { wordLimit: { max: group.wordLimitMax } } : {}),
          ...(group.optionNumbering ? { optionNumbering: group.optionNumbering } : {}),
        },
        questions,
      } satisfies EditableGroup;
      })
      .filter((group): group is EditableGroup => group !== null);

    questionCount += groups.reduce((total, group) => total + group.questions.length, 0);

    return {
      skill: section.skill as Skill,
      title: section.title ?? '',
      instructions: section.instructions ?? '',
      passage: passage
        ? { title: passage.title ?? '', paragraphs: passage.paragraphs.map((p) => ({ label: p.label, text: p.text })) }
        : null,
      audioAssetId: null,
      groups,
    };
  });

  // Confidence is derived from what was actually converted, never from the
  // model's own self-report: an AI claim of PROVIDED must not hide gaps.
  const derivedConfidence: 'PROVIDED' | 'PARTIAL' | 'ABSENT' =
    answeredQuestions === 0 ? 'ABSENT' : answeredQuestions < totalQuestions ? 'PARTIAL' : 'PROVIDED';

  if (derivedConfidence === 'ABSENT') {
    issues.push({
      level: 'WARNING',
      code: 'AI_NO_ANSWER_KEY',
      message:
        'The source material did not contain a usable answer key. Nothing was invented: add the official answers manually before publishing.',
    });
  } else if (derivedConfidence === 'PARTIAL') {
    issues.push({
      level: 'WARNING',
      code: 'AI_PARTIAL_ANSWER_KEY',
      message: `Answers were extracted for ${answeredQuestions} of ${totalQuestions} questions${
        data.answerKeyConfidence === 'PROVIDED' ? ' (the model reported a complete key)' : ''
      }. Nothing was filled in automatically; review the missing answers before publishing.`,
    });
  }

  return {
    content: { sections },
    issues,
    answerKeyConfidence: derivedConfidence,
    questionCount,
  };
}

function buildAnswerKey(
  type: string,
  answer: string | null,
  sharedOptions: Array<{ id: string; text: string }>,
): AnswerKey | null {
  if (!answer || !isQuestionType(type)) return null;
  const meta = QUESTION_TYPE_META[type as QuestionType];
  const values = answer
    .split('|')
    .map((value) => value.trim())
    .filter(Boolean);
  if (values.length === 0) return null;

  if (meta.textAnswer) {
    return { kind: 'TEXT', accept: values };
  }

  if (type === 'TRUE_FALSE_NOT_GIVEN') {
    const mapped = values.map((value) => value.replace(/\s+/g, '_').toUpperCase());
    const valid = mapped.filter((value) => ['TRUE', 'FALSE', 'NOT_GIVEN'].includes(value));
    return valid.length > 0 ? { kind: 'CHOICE', values: valid } : null;
  }
  if (type === 'YES_NO_NOT_GIVEN') {
    const mapped = values.map((value) => value.replace(/\s+/g, '_').toUpperCase());
    const valid = mapped.filter((value) => ['YES', 'NO', 'NOT_GIVEN'].includes(value));
    return valid.length > 0 ? { kind: 'CHOICE', values: valid } : null;
  }

  // Choice types: prefer option ids; fall back to matching option text.
  const resolved = values.map((value) => {
    const direct = sharedOptions.find((option) => option.id.toLowerCase() === value.toLowerCase());
    if (direct) return direct.id;
    const byText = sharedOptions.find((option) => option.text.trim().toLowerCase() === value.toLowerCase());
    return byText ? byText.id : value;
  });

  return { kind: 'CHOICE', values: resolved, partialCredit: type === 'MCQ_MULTI' };
}

// -----------------------------------------------------------------------------
// Review → draft test version
// -----------------------------------------------------------------------------
export interface ApplyImportResult {
  testId: string;
  versionId: string;
  totalQuestions: number;
  issues: ValidationIssue[];
  publishable: boolean;
}

export async function applyImportDraft(
  env: Env,
  user: AuthUser,
  importId: string,
  content: EditableContent,
  options: { testId?: string | null; title?: string; origin?: ContentOrigin } = {},
): Promise<ApplyImportResult> {
  const importRow = await env.DB.prepare(
    'SELECT id, title, filename, status, content_origin, source_title, source_url, attribution, license_notes, r2_key FROM imports WHERE id = ?',
  )
    .bind(importId)
    .first<{
      id: string;
      title: string;
      filename: string;
      status: string;
      content_origin: ContentOrigin;
      source_title: string | null;
      source_url: string | null;
      attribution: string | null;
      license_notes: string | null;
      r2_key: string | null;
    }>();
  if (!importRow) throw ApiError.notFound('Import not found.');
  if (importRow.status === 'PUBLISHED' || importRow.status === 'DISCARDED') {
    throw ApiError.conflict('This import has already been finalised.');
  }

  const timestamp = nowIso();
  let testId = options.testId ?? null;
  let versionId: string;

  if (testId) {
    const test = await env.DB.prepare('SELECT id, current_version_id FROM tests WHERE id = ?')
      .bind(testId)
      .first<{ id: string; current_version_id: string | null }>();
    if (!test) throw ApiError.notFound('Target test not found.');

    const latest = await env.DB.prepare(
      'SELECT MAX(version_number) AS max_version FROM test_versions WHERE test_id = ?',
    )
      .bind(testId)
      .first<{ max_version: number | null }>();
    versionId = newId('ver');
    await env.DB.prepare(
      `INSERT INTO test_versions (id, test_id, version_number, status, change_note, config_json, total_questions,
                                  created_by, created_at, updated_at)
       VALUES (?, ?, ?, 'DRAFT', ?, '{}', 0, ?, ?, ?)`,
    )
      .bind(
        versionId,
        testId,
        (latest?.max_version ?? 0) + 1,
        `Imported from ${importRow.filename}`,
        user.id,
        timestamp,
        timestamp,
      )
      .run();
  } else {
    testId = newId('tst');
    versionId = newId('ver');
    const title = (options.title ?? importRow.title ?? importRow.filename).slice(0, 200);
    const slug = await uniqueSlug(env, title);

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO tests (id, slug, title, type, status, summary, created_by, created_at, updated_at,
                            content_origin, source_title, source_url, attribution, license_notes)
         VALUES (?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        testId,
        slug,
        title,
        inferTestType(content),
        `Imported from ${importRow.filename}. Review the content and provenance before publishing.`,
        user.id,
        timestamp,
        timestamp,
        options.origin ?? importRow.content_origin,
        importRow.source_title ?? importRow.filename,
        importRow.source_url,
        importRow.attribution,
        importRow.license_notes,
      ),
      env.DB.prepare(
        `INSERT INTO test_versions (id, test_id, version_number, status, change_note, config_json, total_questions,
                                    created_by, created_at, updated_at)
         VALUES (?, ?, 1, 'DRAFT', ?, '{}', 0, ?, ?, ?)`,
      ).bind(versionId, testId, `Imported from ${importRow.filename}`, user.id, timestamp, timestamp),
    ]);
  }

  const written = await replaceVersionContent(env, versionId, content, user.id);

  const adminContent = await loadAdminVersion(env, versionId);
  const issues = validateTestVersion(toValidationInput(adminContent));
  const summary = summariseIssues(issues);

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE test_versions SET validation_json = ?, updated_at = ? WHERE id = ?`,
    ).bind(JSON.stringify({ issues, ...summary, checkedAt: nowIso() }), nowIso(), versionId),
    env.DB.prepare(
      `UPDATE imports SET status = 'PUBLISHED', target_test_id = ?, structured_payload_json = ?, updated_at = ? WHERE id = ?`,
    ).bind(testId, JSON.stringify(content), nowIso(), importId),
    env.DB.prepare(
      `UPDATE import_drafts SET test_version_id = ?, payload_json = ?, validation_json = ?, status = 'APPLIED', updated_at = ?
        WHERE import_id = ? AND status = 'REVIEW'`,
    ).bind(versionId, JSON.stringify(content), JSON.stringify({ issues, ...summary }), nowIso(), importId),
  ]);

  await recordAudit(env, {
    actorUserId: user.id,
    action: 'IMPORT_APPLY',
    entityType: 'import',
    entityId: importId,
    metadata: { testId, versionId, totalQuestions: written.totalQuestions, errors: summary.errors },
  });

  void importRow.r2_key;

  return {
    testId,
    versionId,
    totalQuestions: written.totalQuestions,
    issues,
    publishable: summary.publishable,
  };
}

function inferTestType(content: EditableContent): 'READING' | 'LISTENING' | 'WRITING' | 'FULL_MOCK' {
  const skills = new Set(content.sections.map((section) => section.skill));
  if (skills.size > 1) return 'FULL_MOCK';
  if (skills.has('LISTENING')) return 'LISTENING';
  if (skills.has('WRITING')) return 'WRITING';
  return 'READING';
}

async function uniqueSlug(env: Env, title: string): Promise<string> {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'test';
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const existing = await env.DB.prepare('SELECT id FROM tests WHERE slug = ?').bind(candidate).first<{ id: string }>();
    if (!existing) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export async function loadImportDetail(env: Env, importId: string) {
  const row = await env.DB.prepare(
    `SELECT i.*, u.email AS created_by_email,
            t.title AS target_test_title
       FROM imports i
       LEFT JOIN users u ON u.id = i.created_by
       LEFT JOIN tests t ON t.id = i.target_test_id
      WHERE i.id = ?`,
  )
    .bind(importId)
    .first<Record<string, unknown>>();
  if (!row) throw ApiError.notFound('Import not found.');

  const [jobs, drafts, asset] = await Promise.all([
    env.DB.prepare('SELECT * FROM import_jobs WHERE import_id = ? ORDER BY created_at').bind(importId).all(),
    env.DB.prepare('SELECT id, validation_json, status, test_version_id, created_at FROM import_drafts WHERE import_id = ? ORDER BY created_at DESC')
      .bind(importId)
      .all(),
    row['r2_key']
      ? env.DB.prepare('SELECT id, filename, mime, size_bytes FROM assets WHERE r2_key = ?').bind(row['r2_key']).first()
      : Promise.resolve(null),
  ]);

  return {
    import: {
      id: row['id'],
      title: row['title'],
      filename: row['filename'],
      mime: row['mime'],
      sizeBytes: row['size_bytes'],
      status: row['status'],
      aiUsed: row['ai_used'] === 1,
      aiModel: row['ai_model'],
      extractedChars: row['extracted_chars'],
      answerKeyConfidence: row['answer_key_confidence'],
      notes: row['notes'],
      createdAt: row['created_at'],
      updatedAt: row['updated_at'],
      createdBy: row['created_by_email'],
      targetTestId: row['target_test_id'],
      targetTestTitle: row['target_test_title'],
      contentOrigin: row['content_origin'],
      sourceTitle: row['source_title'],
      sourceUrl: row['source_url'],
      attribution: row['attribution'],
      licenseNotes: row['license_notes'],
      hasExtractedText: Boolean(row['extracted_r2_key']),
      structuredPayload: row['structured_payload_json']
        ? safeParseJson(row['structured_payload_json'] as string)
        : null,
    },
    asset,
    jobs: (jobs.results as Array<Record<string, unknown>>).map((job) => ({
      id: job['id'],
      stage: job['stage'],
      status: job['status'],
      attempts: job['attempts'],
      error: job['error'],
      log: safeParseJson((job['log_json'] as string) ?? '[]'),
      startedAt: job['started_at'],
      finishedAt: job['finished_at'],
    })),
    drafts: (drafts.results as Array<Record<string, unknown>>).map((draft) => ({
      id: draft['id'],
      status: draft['status'],
      testVersionId: draft['test_version_id'],
      validation: safeParseJson((draft['validation_json'] as string) ?? 'null'),
      createdAt: draft['created_at'],
    })),
  };
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
