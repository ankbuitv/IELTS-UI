import type { Env, ImportQueueMessage } from '../env';
import { ApiError } from '../lib/errors';
import { newId, nowIso } from '../lib/ids';
import { sha256Hex } from '../lib/crypto';
import type { AuthUser } from '../lib/auth-types';
import { extractText, ALLOWED_IMPORT_MIME_TYPES } from '../extract';
import { aiStatus, structureTestFromSource } from '../ai/openai';
import { validateTestVersion, summariseIssues, type ValidationIssue } from '../../shared/validation';
import { replaceVersionContent, type EditableContent } from './content-write-service';
import { loadAdminVersion, toValidationInput } from './content-service';
import { recordAudit } from '../lib/audit';
import { loadPlatformSettings } from '../lib/settings';
import type { ContentOrigin } from '../../shared/types';
import { parseLeadingJson } from '../../shared/json';
import {
  convertAiPayload,
  inferTestType,
  withImportDefaults,
  type EditableContent as ConvertibleContent,
} from '../../shared/import-convert';

/** Re-exported for the routes and unit tests that predate the shared module. */
export { convertAiPayload };

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

export interface CreateImportResult {
  importId: string;
  status: string;
  extractedChars: number;
  structured: boolean;
}

/**
 * Accepts an uploaded source file.
 *
 * V1 has no object storage, so the file is handled entirely inside the request:
 * text is extracted, the extracted text is stored in D1 (`imports.source_text`),
 * and the original binary is discarded. A JSON upload is treated as an already
 * structured payload and goes straight to review.
 *
 * Files that cannot be turned into text without object storage (for example a
 * scanned PDF) are reported as a limitation instead of being stored as a blob.
 */
export async function createImport(env: Env, user: AuthUser, input: CreateImportInput): Promise<CreateImportResult> {
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

  const buffer = await input.file.arrayBuffer();
  const isJson = mime === 'application/json' || /\.json$/i.test(filename);

  if (isJson) {
    const decoded = new TextDecoder().decode(buffer);
    const parsed = parseLeadingJson(decoded);
    if (!parsed || !parsed.value || typeof parsed.value !== 'object') {
      throw ApiError.validation(
        'That file is not valid JSON. Paste a single test object — extra documents after the first object are ignored, but the first value still has to parse.',
      );
    }
    return createStructuredImport(env, user, {
      ...input,
      filename,
      mime,
      sizeBytes: input.file.size,
      payload: parsed.value,
      checksum: await sha256Hex(buffer),
    });
  }

  const extraction = extractText(new Uint8Array(buffer), mime, filename);
  const text = extraction.text ?? '';

  const importId = newId('imp');
  const timestamp = nowIso();
  const title = (input.title ?? filename.replace(/\.[^.]+$/, '')).slice(0, 200);

  const log = [
    {
      at: timestamp,
      message: `Read ${filename} (${input.file.size} bytes, ${mime}). The original file is processed in-request and is not retained.`,
    },
    {
      at: timestamp,
      message: `Extracted ${text.length} characters from a ${extraction.kind} file${extraction.pageCount ? ` (${extraction.pageCount} pages)` : ''}.`,
    },
  ];
  if (extraction.warning) log.push({ at: timestamp, message: extraction.warning });
  if (text.trim().length === 0) {
    log.push({
      at: timestamp,
      message:
        'No extractable text was found. Scanned documents need OCR, which V1 does not include: paste the text instead so it can be structured.',
    });
  }

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO imports (id, title, filename, mime, size_bytes, status, ai_used, created_by, created_at, updated_at,
                            content_origin, source_title, source_url, attribution, license_notes, source_text, extracted_chars)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      importId,
      title,
      filename,
      mime,
      input.file.size,
      text.trim().length > 0 ? 'PROCESSING' : 'REVIEW',
      user.id,
      timestamp,
      timestamp,
      input.contentOrigin ?? 'IMPORTED',
      input.sourceTitle ?? null,
      input.sourceUrl ?? null,
      input.attribution ?? null,
      input.licenseNotes ?? null,
      text.length > 0 ? text : null,
      text.length,
    ),
    env.DB.prepare(
      `INSERT INTO import_jobs (id, import_id, stage, status, attempts, log_json, started_at, finished_at, created_at, updated_at)
       VALUES (?, ?, 'EXTRACT', ?, 1, ?, ?, ?, ?, ?)`,
    ).bind(
      newId('job'),
      importId,
      text.trim().length > 0 ? 'SUCCEEDED' : 'SKIPPED',
      JSON.stringify(log),
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
    metadata: { filename, size: input.file.size, mime, extractedChars: text.length },
  });

  // The extraction already happened; continue with AI structuring when a queue
  // is bound, otherwise the caller runs the same pipeline inline.
  if (env.IMPORT_QUEUE && text.trim().length > 0) {
    await env.IMPORT_QUEUE.send({ importId, stage: 'AI_STRUCTURE', requestedBy: user.id });
  }

  return {
    importId,
    status: text.trim().length > 0 ? 'PROCESSING' : 'REVIEW',
    extractedChars: text.length,
    structured: false,
  };
}

export interface CreateTextImportInput {
  title?: string;
  text: string;
  contentOrigin?: ContentOrigin;
  sourceTitle?: string;
  sourceUrl?: string;
  attribution?: string;
  licenseNotes?: string;
}

/** Pasted source text: no file, no storage - the text goes straight into D1. */
export async function createTextImport(env: Env, user: AuthUser, input: CreateTextImportInput): Promise<CreateImportResult> {
  const text = (input.text ?? '').trim();
  if (text.length < 40) throw ApiError.validation('Paste at least a paragraph of source text before importing.');
  if (text.length > 400_000) throw ApiError.validation('Pasted text is limited to 400,000 characters.');

  // A pasted JSON document is treated as a structured payload. Extra text
  // after the first object (a second document, a markdown fence, commentary)
  // is ignored so a concatenated paste still imports.
  const looksJson = text.startsWith('{') || text.startsWith('[');
  if (looksJson) {
    const parsed = parseLeadingJson(text);
    if (parsed && parsed.value && typeof parsed.value === 'object') {
      return createStructuredImport(env, user, {
        ...input,
        filename: 'pasted.json',
        mime: 'application/json',
        sizeBytes: text.length,
        payload: parsed.value,
        checksum: await sha256Hex(parsed.source),
        title: input.title ?? titleFromPayload(parsed.value) ?? 'Structured JSON import',
      });
    }
    throw ApiError.validation(
      'The pasted text looks like JSON but could not be parsed. Paste a single JSON object — two documents concatenated, or trailing commentary, will fail unless the first object is complete.',
    );
  }

  const importId = newId('imp');
  const timestamp = nowIso();
  const title = (input.title ?? 'Pasted source text').slice(0, 200);

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO imports (id, title, filename, mime, size_bytes, status, ai_used, created_by, created_at, updated_at,
                            content_origin, source_title, source_url, attribution, license_notes, source_text, extracted_chars)
       VALUES (?, ?, 'pasted.txt', 'text/plain', ?, 'PROCESSING', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      importId,
      title,
      text.length,
      user.id,
      timestamp,
      timestamp,
      input.contentOrigin ?? 'IMPORTED',
      input.sourceTitle ?? null,
      input.sourceUrl ?? null,
      input.attribution ?? null,
      input.licenseNotes ?? null,
      text,
      text.length,
    ),
    env.DB.prepare(
      `INSERT INTO import_jobs (id, import_id, stage, status, attempts, log_json, started_at, finished_at, created_at, updated_at)
       VALUES (?, ?, 'EXTRACT', 'SUCCEEDED', 1, ?, ?, ?, ?, ?)`,
    ).bind(
      newId('job'),
      importId,
      JSON.stringify([{ at: timestamp, message: `Stored ${text.length} characters of pasted text.` }]),
      timestamp,
      timestamp,
      timestamp,
      timestamp,
    ),
  ]);

  await recordAudit(env, {
    actorUserId: user.id,
    action: 'IMPORT_PASTE',
    entityType: 'import',
    entityId: importId,
    metadata: { characters: text.length },
  });

  if (env.IMPORT_QUEUE) {
    await env.IMPORT_QUEUE.send({ importId, stage: 'AI_STRUCTURE', requestedBy: user.id });
  }

  return { importId, status: 'PROCESSING', extractedChars: text.length, structured: false };
}

/** A JSON document that already follows the platform's structured test format. */
async function createStructuredImport(
  env: Env,
  user: AuthUser,
  input: {
    title?: string;
    filename: string;
    mime: string;
    sizeBytes: number;
    payload: unknown;
    checksum: string;
    contentOrigin?: ContentOrigin;
    sourceTitle?: string;
    sourceUrl?: string;
    attribution?: string;
    licenseNotes?: string;
  },
): Promise<CreateImportResult> {
  const importId = newId('imp');
  const timestamp = nowIso();
  const converted = convertAiPayload(input.payload);
  const storedPayload = converted.questionCount > 0 ? converted.content : input.payload;
  const title = (input.title ?? titleFromPayload(input.payload) ?? 'Structured JSON import').slice(0, 200);
  const serialised = JSON.stringify(storedPayload);

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO imports (id, title, filename, mime, size_bytes, status, ai_used, created_by, created_at, updated_at,
                            content_origin, source_title, source_url, attribution, license_notes,
                            source_text, extracted_chars, structured_payload_json)
       VALUES (?, ?, ?, ?, ?, 'REVIEW', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      importId,
      title,
      input.filename,
      input.mime,
      input.sizeBytes,
      user.id,
      timestamp,
      timestamp,
      input.contentOrigin ?? 'IMPORTED',
      input.sourceTitle ?? null,
      input.sourceUrl ?? null,
      input.attribution ?? null,
      input.licenseNotes ?? null,
      serialised.length <= 400_000 ? serialised : null,
      serialised.length,
      serialised,
    ),
    env.DB.prepare(
      `INSERT INTO import_jobs (id, import_id, stage, status, attempts, log_json, started_at, finished_at, created_at, updated_at)
       VALUES (?, ?, 'AI_STRUCTURE', 'SKIPPED', 1, ?, ?, ?, ?, ?)`,
    ).bind(
      newId('job'),
      importId,
      JSON.stringify([
        {
          at: timestamp,
          message:
            converted.questionCount > 0
              ? `Loaded a structured JSON payload (${converted.questionCount} question(s), ${serialised.length} characters). AI structuring was not needed.`
              : `Loaded a JSON payload (${serialised.length} characters) that still needs to be structured before it can be applied.`,
        },
      ]),
      timestamp,
      timestamp,
      timestamp,
      timestamp,
    ),
  ]);

  await recordAudit(env, {
    actorUserId: user.id,
    action: 'IMPORT_JSON',
    entityType: 'import',
    entityId: importId,
    metadata: { filename: input.filename, characters: serialised.length, checksum: input.checksum },
  });

  return { importId, status: 'REVIEW', extractedChars: serialised.length, structured: true };
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
    'SELECT id, title, filename, mime, source_text, structured_payload_json FROM imports WHERE id = ?',
  )
    .bind(importId)
    .first<{
      id: string;
      title: string;
      filename: string;
      mime: string;
      source_text: string | null;
      structured_payload_json: string | null;
    }>();
  if (!row) throw new Error(`Import ${importId} not found`);

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

      const text = row.source_text ?? '';
      log.push({
        at: nowIso(),
        message:
          text.length > 0
            ? `Using the ${text.length} characters extracted when the import was received (stored in the database, no file storage involved).`
            : 'No extracted text is available for this import. Paste the source text to structure it.',
      });
      await env.DB.prepare(`UPDATE imports SET status = ?, updated_at = ? WHERE id = ?`)
        .bind(text.trim().length > 0 ? 'PROCESSING' : 'REVIEW', nowIso(), importId)
        .run();

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

      const text = row.source_text ?? '';
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


function titleFromPayload(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const record = payload as Record<string, unknown>;
  if (typeof record.testTitle === 'string' && record.testTitle.trim()) return record.testTitle.trim().slice(0, 200);
  const metadata = record.metadata as { title?: unknown } | undefined;
  if (typeof metadata?.title === 'string' && metadata.title.trim()) return metadata.title.trim().slice(0, 200);
  if (typeof record.title === 'string' && record.title.trim()) return record.title.trim().slice(0, 200);
  return undefined;
}

async function attachImportDefaults(env: Env, content: EditableContent): Promise<EditableContent> {
  // The conversion module's editable tree types groups as QuestionType, which
  // is what every import path produces; the worker tree keeps `string` for
  // legacy rows already in the database, hence the single boundary cast.
  const convertible = content as unknown as ConvertibleContent;
  const next = withImportDefaults(convertible, inferTestType(content));
  if (next.scoringProfileId) return next;
  const skill = inferTestType(next);
  if (skill !== 'READING' && skill !== 'LISTENING') return next;
  const { resolveActiveProfileId } = await import('./scoring-profile-service');
  const profileId = await resolveActiveProfileId(env, skill);
  if (!profileId) return next;
  return { ...next, scoringProfileId: profileId };
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
    'SELECT id, title, filename, status, content_origin, source_title, source_url, attribution, license_notes FROM imports WHERE id = ?',
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

  const prepared = await attachImportDefaults(env, content);
  const written = await replaceVersionContent(env, versionId, prepared, user.id);

  const adminContent = await loadAdminVersion(env, versionId);
  // Stored content is validated from the database (which recomputes word counts
  // from the text). Declared counts from the source file are compared here, so
  // an inflated AI or hand-authored number is reported instead of believed.
  const issues: ValidationIssue[] = [
    ...validateTestVersion(toValidationInput(adminContent)),
    ...declaredWordCountIssues(adminContent, prepared),
  ];
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

  return {
    testId,
    versionId,
    totalQuestions: written.totalQuestions,
    issues,
    publishable: summary.publishable,
  };
}

/** Compares a source's declared passage word count with the stored text. */
function declaredWordCountIssues(
  stored: Awaited<ReturnType<typeof loadAdminVersion>>,
  incoming: EditableContent,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const section of incoming.sections) {
    const declared = section.passage?.passageWordCount ?? null;
    if (declared === null || declared === undefined) continue;
    const match = stored.sections.find(
      (candidate) => candidate.skill === section.skill && candidate.title === section.title,
    );
    const computed = match?.passage?.wordCount ?? 0;
    if (computed === 0) continue;
    const difference = Math.abs(declared - computed);
    if (difference > Math.max(5, Math.round(computed * 0.02))) {
      issues.push({
        level: 'WARNING',
        code: 'PASSAGE_WORD_COUNT_MISMATCH',
        message: `The import declares ${declared} words for “${section.title}” but the stored passage contains ${computed}. The text is authoritative.`,
        sectionId: match?.id ?? null,
      });
    }
  }
  return issues;
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

  const [jobs, drafts] = await Promise.all([
    env.DB.prepare('SELECT * FROM import_jobs WHERE import_id = ? ORDER BY created_at').bind(importId).all(),
    env.DB.prepare('SELECT id, validation_json, status, test_version_id, created_at FROM import_drafts WHERE import_id = ? ORDER BY created_at DESC')
      .bind(importId)
      .all(),
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
      hasExtractedText: Boolean(row['source_text']),
      sourceTextChars: (row['source_text'] as string | null)?.length ?? 0,
      structuredPayload: row['structured_payload_json']
        ? safeParseJson(row['structured_payload_json'] as string)
        : null,
    },
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
