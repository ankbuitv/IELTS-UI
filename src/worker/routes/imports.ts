import { Hono } from 'hono';
import { z } from 'zod';
import type { AppBindings } from '../env';
import { ApiError } from '../lib/errors';
import { assertCsrf, assertSameOrigin, clientIp } from '../lib/http';
import { parseBody } from '../lib/validate';
import { requireAuth, requireRole } from '../middleware/auth';
import { currentUser } from '../middleware/auth';
import { enforceRateLimit } from '../lib/rate-limit';
import {
  applyImportDraft,
  convertAiPayload,
  createImport,
  createTextImport,
  loadImportDetail,
  runImportPipelineInline,
} from '../services/import-service';
import { recordAudit } from '../lib/audit';
import { aiStatus } from '../ai/openai';
import { QUESTION_TYPES } from '../../shared/question-types';
import type { EditableContent } from '../services/content-write-service';
import { CONTENT_ORIGINS, SKILLS } from '../../shared/types';

const router = new Hono<AppBindings>();

router.use('*', requireAuth, requireRole('ADMIN'));
router.use('*', async (c, next) => {
  assertSameOrigin(c);
  await next();
});

const editableQuestionSchema = z.object({
  number: z.number().int().min(1).max(400),
  prompt: z.string().max(8000).default(''),
  options: z.array(z.object({ id: z.string().max(20), text: z.string().max(4000) })).max(40).default([]),
  config: z
    .object({
      wordLimit: z.object({ min: z.number().int().min(0).max(2000).optional(), max: z.number().int().min(1).max(2000).optional() }).optional(),
      selectCount: z.number().int().min(1).max(10).optional(),
      note: z.string().max(500).optional(),
      optionNumbering: z.enum(['roman', 'alpha', 'numeric']).optional(),
    })
    .default({}),
  body: z
    .object({
      kind: z.enum(['SUMMARY', 'NOTES', 'TABLE', 'FLOWCHART']),
      text: z.string().max(20_000).optional(),
      rows: z.array(z.array(z.string().max(2000))).max(60).optional(),
    })
    .nullish(),
  answerKey: z
    .union([
      z.object({ kind: z.literal('CHOICE'), values: z.array(z.string().max(500)).max(20), partialCredit: z.boolean().optional() }),
      z.object({
        kind: z.literal('TEXT'),
        accept: z.array(z.string().max(500)).max(20),
        numeric: z.boolean().optional(),
        ignoreLeadingArticle: z.boolean().optional(),
      }),
      z.object({ kind: z.literal('MANUAL') }),
    ])
    .nullish(),
  evidence: z.string().max(4000).nullish(),
  explanation: z.string().max(4000).nullish(),
});

const editableContentSchema = z.object({
  sections: z
    .array(
      z.object({
        skill: z.enum(SKILLS),
        title: z.string().max(300).default(''),
        subtitle: z.string().max(300).nullish(),
        instructions: z.string().max(8000).default(''),
        durationSeconds: z.number().int().min(30).max(36_000).nullish(),
        passage: z
          .object({
            title: z.string().max(300).default(''),
            subtitle: z.string().max(300).nullish(),
            // Declared by the source, ignored on write: the count is recomputed
            // from the text and a difference is surfaced as a warning.
            passageWordCount: z.number().int().min(0).max(50_000).nullish(),
            paragraphs: z.array(z.object({ label: z.string().max(20), text: z.string().max(60_000) })).max(200),
          })
          .nullish(),
        audioAssetId: z.string().max(64).nullish(),
        playback: z
          .object({
            maxPlays: z.number().int().min(1).max(10).optional(),
            prepSeconds: z.number().int().min(0).max(600).optional(),
            allowPause: z.boolean().optional(),
            allowSeekAfterPlay: z.boolean().optional(),
          })
          .optional(),
        groups: z
          .array(
            z.object({
              type: z.enum(QUESTION_TYPES),
              instructions: z.string().max(8000).default(''),
              sharedOptions: z.array(z.object({ id: z.string().max(20), text: z.string().max(4000) })).max(40).default([]),
              config: z
                .object({
                  wordLimit: z.object({ min: z.number().int().min(0).max(2000).optional(), max: z.number().int().min(1).max(2000).optional() }).optional(),
                  selectCount: z.number().int().min(1).max(10).optional(),
                  note: z.string().max(500).optional(),
                  optionNumbering: z.enum(['roman', 'alpha', 'numeric']).optional(),
                })
                .default({}),
              rangeFrom: z.number().int().nullish(),
              rangeTo: z.number().int().nullish(),
              questions: z.array(editableQuestionSchema).max(100),
            }),
          )
          .max(20)
          .default([]),
      }),
    )
    .max(10),
  mockComponents: z
    .array(
      z.object({
        skill: z.enum(SKILLS),
        testVersionId: z.string().min(1).max(64),
        label: z.string().max(120).default(''),
        durationSeconds: z.number().int().min(60).max(36_000),
        breakAfterSeconds: z.number().int().min(0).max(3600).default(0),
      }),
    )
    .max(8)
    .optional(),
  durationSeconds: z.number().int().min(60).max(36_000).nullish(),
  isCompleteTest: z.boolean().optional(),
  scoringProfileId: z.string().max(64).nullish(),
  config: z.record(z.string(), z.unknown()).optional(),
});

router.get('/', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT i.id, i.title, i.filename, i.mime, i.size_bytes, i.status, i.ai_used, i.ai_model, i.extracted_chars,
            i.answer_key_confidence, i.notes, i.created_at, i.updated_at, i.target_test_id, i.content_origin,
            u.email AS created_by_email, t.title AS target_test_title
       FROM imports i
       LEFT JOIN users u ON u.id = i.created_by
       LEFT JOIN tests t ON t.id = i.target_test_id
      ORDER BY i.created_at DESC LIMIT 100`,
  ).all<Record<string, unknown>>();

  return c.json({
    imports: rows.results,
    ai: aiStatus(c.env),
  });
});

router.post('/', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  await enforceRateLimit(
    c.env,
    { bucket: `import-upload:${user.id}`, windowSeconds: 3600, limit: 60 },
    'Too many uploads in the last hour.',
  );

  const form = await c.req.formData().catch(() => null);
  if (!form) throw ApiError.validation('A multipart/form-data upload is required.');

  const file = form.get('file');
  if (!(file instanceof File)) throw ApiError.validation('Attach a source file in the "file" field.');

  const result = await createImport(c.env, user, {
    file,
    title: stringField(form, 'title'),
    contentOrigin: (stringField(form, 'contentOrigin') as (typeof CONTENT_ORIGINS)[number]) ?? 'IMPORTED',
    sourceTitle: stringField(form, 'sourceTitle'),
    sourceUrl: stringField(form, 'sourceUrl'),
    attribution: stringField(form, 'attribution'),
    licenseNotes: stringField(form, 'licenseNotes'),
  });

  return c.json(result, 201);
});

/**
 * Pasted text or JSON import.
 *
 * Nothing is stored as a file: the text is kept in D1 and processed in the
 * request, which is why V1 needs no object storage for imports.
 */
router.post('/paste', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  await enforceRateLimit(
    c.env,
    { bucket: `import-upload:${user.id}`, windowSeconds: 3600, limit: 60 },
    'Too many imports in the last hour.',
  );

  const body = await parseBody(
    c,
    z.object({
      text: z.string().min(1).max(400_000),
      title: z.string().max(200).optional(),
      contentOrigin: z.enum(CONTENT_ORIGINS).optional(),
      sourceTitle: z.string().max(500).optional(),
      sourceUrl: z.string().max(1000).optional(),
      attribution: z.string().max(1000).optional(),
      licenseNotes: z.string().max(4000).optional(),
    }),
  );

  const result = await createTextImport(c.env, user, body);
  return c.json(result, 201);
});

function stringField(form: FormData, key: string): string | undefined {
  const value = form.get(key);
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 2000) : undefined;
}

router.get('/:id', async (c) => {
  return c.json(await loadImportDetail(c.env, c.req.param('id')));
});

router.get('/:id/extracted', async (c) => {
  const row = await c.env.DB.prepare('SELECT source_text, filename FROM imports WHERE id = ?')
    .bind(c.req.param('id'))
    .first<{ source_text: string | null; filename: string }>();
  if (!row) throw ApiError.notFound('Import not found.');
  if (!row.source_text) throw ApiError.notFound('No extracted text is stored for this import.');

  return c.json({ filename: row.filename, extractedChars: row.source_text.length, text: row.source_text });
});

/**
 * Runs extraction (and AI structuring when a key is configured). Rate limited:
 * this is the only endpoint that spends money on the AI provider.
 */
router.post('/:id/process', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  await enforceRateLimit(
    c.env,
    {
      bucket: `import-ai:${user.id}`,
      windowSeconds: 3600,
      limit: Number(c.env.AI_RATE_LIMIT_PER_HOUR || 30),
    },
    'AI import rate limit reached. Try again later.',
  );

  const importId = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT status FROM imports WHERE id = ?').bind(importId).first<{ status: string }>();
  if (!existing) throw ApiError.notFound('Import not found.');

  await runImportPipelineInline(c.env, importId, user.id);
  const detail = await loadImportDetail(c.env, importId);

  await recordAudit(c.env, {
    actorUserId: user.id,
    action: 'IMPORT_PROCESS',
    entityType: 'import',
    entityId: importId,
    metadata: { status: detail.import.status },
    ip: clientIp(c),
  });

  return c.json(detail);
});

/** Admin edits the structured draft before it becomes a test version. */
router.patch('/:id', async (c) => {
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(
    c,
    z.object({
      payload: editableContentSchema.optional(),
      notes: z.string().max(4000).optional(),
      contentOrigin: z.enum(CONTENT_ORIGINS).optional(),
      sourceTitle: z.string().max(500).nullable().optional(),
      sourceUrl: z.string().max(1000).nullable().optional(),
      attribution: z.string().max(1000).nullable().optional(),
      licenseNotes: z.string().max(4000).nullable().optional(),
      title: z.string().max(200).optional(),
    }),
  );

  const importId = c.req.param('id');
  const statements: D1PreparedStatement[] = [];
  const timestamp = new Date().toISOString();

  if (body.payload) {
    statements.push(
      c.env.DB.prepare('UPDATE imports SET structured_payload_json = ?, updated_at = ? WHERE id = ?').bind(
        JSON.stringify(body.payload),
        timestamp,
        importId,
      ),
    );
    statements.push(
      c.env.DB.prepare(
        `UPDATE import_drafts SET payload_json = ?, validation_json = ?, updated_at = ? WHERE import_id = ? AND status = 'REVIEW'`,
      ).bind(
        JSON.stringify(body.payload),
        JSON.stringify({
          issues: [],
          checkedAt: timestamp,
          note: 'Deterministic validation runs when the draft is applied to a test version.',
        }),
        timestamp,
        importId,
      ),
    );
  }

  const setClauses: string[] = [];
  const bindings: unknown[] = [];
  if (body.notes !== undefined) {
    setClauses.push('notes = ?');
    bindings.push(body.notes);
  }
  if (body.contentOrigin !== undefined) {
    setClauses.push('content_origin = ?');
    bindings.push(body.contentOrigin);
  }
  if (body.title !== undefined) {
    setClauses.push('title = ?');
    bindings.push(body.title);
  }
  for (const [field, column] of [
    ['sourceTitle', 'source_title'],
    ['sourceUrl', 'source_url'],
    ['attribution', 'attribution'],
    ['licenseNotes', 'license_notes'],
  ] as const) {
    const value = body[field];
    if (value !== undefined) {
      setClauses.push(`${column} = ?`);
      bindings.push(value);
    }
  }
  if (setClauses.length > 0) {
    setClauses.push('updated_at = ?');
    bindings.push(timestamp, importId);
    statements.push(c.env.DB.prepare(`UPDATE imports SET ${setClauses.join(', ')} WHERE id = ?`).bind(...bindings));
  }

  if (statements.length > 0) await c.env.DB.batch(statements);

  return c.json(await loadImportDetail(c.env, importId));
});

/** Materialises the reviewed draft into a DRAFT/REVIEW test version. */
router.post('/:id/apply', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);

  const body = await parseBody(
    c,
    z.object({
      content: editableContentSchema.optional(),
      testId: z.string().max(64).nullish(),
      title: z.string().max(200).optional(),
      origin: z.enum(CONTENT_ORIGINS).optional(),
    }),
  );

  const importId = c.req.param('id');
  let content: EditableContent | undefined = body.content as EditableContent | undefined;

  if (!content) {
    const row = await c.env.DB.prepare('SELECT structured_payload_json FROM imports WHERE id = ?')
      .bind(importId)
      .first<{ structured_payload_json: string | null }>();
    if (!row?.structured_payload_json) {
      throw ApiError.validation(
        'There is no structured draft to apply. Run the import pipeline first or paste the content manually.',
      );
    }
    const parsed = convertAiPayload(JSON.parse(row.structured_payload_json));
    content = parsed.content;
  }

  const result = await applyImportDraft(c.env, user, importId, content, {
    testId: body.testId ?? null,
    ...(body.title ? { title: body.title } : {}),
    ...(body.origin ? { origin: body.origin } : {}),
  });

  return c.json(result, 201);
});

router.post('/:id/discard', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const importId = c.req.param('id');
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE imports SET status = 'DISCARDED', updated_at = ? WHERE id = ?`).bind(
      new Date().toISOString(),
      importId,
    ),
    c.env.DB.prepare(`UPDATE import_drafts SET status = 'DISCARDED', updated_at = ? WHERE import_id = ?`).bind(
      new Date().toISOString(),
      importId,
    ),
  ]);
  await recordAudit(c.env, {
    actorUserId: user.id,
    action: 'IMPORT_DISCARD',
    entityType: 'import',
    entityId: importId,
    ip: clientIp(c),
  });
  return c.json({ ok: true });
});

export default router;
