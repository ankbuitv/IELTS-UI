import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, describeError, queryString } from '../../lib/api';
import { useAsync } from '../../hooks/useAsync';
import {
  Badge,
  Button,
  Card,
  ConfirmButton,
  EmptyState,
  Field,
  KeyValue,
  Loading,
  Modal,
  Notice,
  Select,
  Stat,
  Tabs,
  TextArea,
  TextInput,
  useToast,
} from '../../components/ui';
import { formatDateTime } from '../../lib/format';

interface ImportRow {
  id: string;
  title: string;
  filename: string;
  mime: string;
  size_bytes: number;
  status: string;
  ai_used: number;
  ai_model: string | null;
  extracted_chars: number | null;
  answer_key_confidence: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
  target_test_id: string | null;
  content_origin: string;
  created_by_email: string | null;
  target_test_title: string | null;
}

interface ImportDetail {
  import: {
    id: string;
    title: string;
    filename: string;
    mime: string;
    sizeBytes: number;
    status: string;
    aiUsed: boolean;
    aiModel: string | null;
    extractedChars: number | null;
    answerKeyConfidence: string | null;
    notes: string;
    createdAt: string;
    updatedAt: string;
    createdBy: string | null;
    targetTestId: string | null;
    targetTestTitle: string | null;
    contentOrigin: string;
    sourceTitle: string | null;
    sourceUrl: string | null;
    attribution: string | null;
    licenseNotes: string | null;
    hasExtractedText: boolean;
    sourceTextChars: number;
    structuredPayload: unknown;
  };
  jobs: Array<{
    id: string;
    stage: string;
    status: string;
    attempts: number;
    error: string | null;
    log: unknown;
    startedAt: string | null;
    finishedAt: string | null;
  }>;
  drafts: Array<{ id: string; status: string; testVersionId: string | null; validation: unknown; createdAt: string }>;
}

/** Import pipeline status: queued neutral, working cyan, review amber, done emerald. */
const STATUS_TONES: Record<string, 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'dim'> = {
  UPLOADED: 'neutral',
  PROCESSING: 'accent',
  REVIEW: 'warning',
  PUBLISHED: 'success',
  DISCARDED: 'dim',
  FAILED: 'danger',
  SKIPPED: 'neutral',
};

export function AdminImportsPage() {
  const toast = useToast();
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  const query = queryString({ status: status || undefined });
  const { data, loading, error, reload } = useAsync<{
    imports: ImportRow[];
    ai: { available: boolean; model?: string; reason?: string };
  }>(() => api.get(`/api/admin/imports${query}`), [query]);

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Imports</h1>
          <p className="page-head__meta">
            UPLOAD → EXTRACT → AI STRUCTURE → VALIDATE → ADMIN REVIEW → PUBLISH. Nothing is ever published automatically.
          </p>
        </div>
        <Button variant="primary" onClick={() => setUploadOpen(true)}>
          New import
        </Button>
      </div>

      {data && !data.ai.available ? (
        <Notice tone="info" title="AI structuring is unavailable">
          {data.ai.reason} Extraction and manual structured entry still work; uploads wait in review until you build the
          content by hand or configure an API key.
        </Notice>
      ) : null}

      <Card>
        <div className="filter-bar">
          <label className="field">
            <span className="field__label">Status</span>
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">All statuses</option>
              <option value="UPLOADED">Uploaded</option>
              <option value="REVIEW">In review</option>
              <option value="PUBLISHED">Applied</option>
              <option value="FAILED">Failed</option>
              <option value="DISCARDED">Discarded</option>
            </select>
          </label>
          <span className="tiny muted" style={{ alignSelf: 'flex-end', paddingBottom: 8 }}>
            Paste reading JSON or text directly, or upload PDF, DOCX, TXT, MD or CSV (25 MB). Text is extracted during
            the request and kept in the database; the original file is not retained. OCR is not available, so scanned
            PDFs without a text layer cannot be extracted.
          </span>
        </div>
      </Card>

      {loading ? <Loading /> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}

      <Card flush>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Source</th>
                <th>Status</th>
                <th>AI</th>
                <th className="num">Extracted</th>
                <th>Answer key</th>
                <th>Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data?.imports.map((row) => (
                <tr key={row.id}>
                  <td>
                    {row.title}
                    <div className="tiny muted">
                      {row.filename} · {(row.size_bytes / 1024).toFixed(0)} KB ·{' '}
                      {row.content_origin.replace(/_/g, ' ').toLowerCase()}
                    </div>
                  </td>
                  <td>
                    <Badge tone={STATUS_TONES[row.status] ?? 'neutral'}>{row.status.toLowerCase()}</Badge>
                  </td>
                  <td className="tiny">
                    {row.ai_used ? `used${row.ai_model ? ` (${row.ai_model})` : ''}` : 'not used'}
                  </td>
                  <td className="num">{row.extracted_chars ?? '—'}</td>
                  <td>
                    {row.answer_key_confidence ? (
                      <Badge tone={row.answer_key_confidence === 'ABSENT' ? 'warning' : 'neutral'}>
                        {row.answer_key_confidence.toLowerCase().replace(/_/g, ' ')}
                      </Badge>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="nowrap">{formatDateTime(row.created_at)}</td>
                  <td className="right">
                    <Button size="sm" onClick={() => setSelected(row.id)}>
                      Review
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data && data.imports.length === 0 ? (
          <EmptyState title="No imports yet">Paste reading JSON or text, or upload a source document, to begin.</EmptyState>
        ) : null}
      </Card>

      <Modal
        open={uploadOpen}
        wide
        title="New import"
        onClose={() => setUploadOpen(false)}
        actions={<Button onClick={() => setUploadOpen(false)}>Close</Button>}
      >
        <ImportStartForm
          onCreated={async (importId) => {
            await reload();
            setUploadOpen(false);
            setSelected(importId);
            toast.push('Import created. Review the extracted text and run AI structuring if needed.', 'success');
          }}
          onError={(message) => toast.push(message, 'error')}
        />
      </Modal>

      <Modal
        open={Boolean(selected)}
        wide
        title="Import review"
        onClose={() => setSelected(null)}
        actions={<Button onClick={() => setSelected(null)}>Close</Button>}
      >
        {selected ? (
          <ImportDetailView
            importId={selected}
            onChanged={reload}
            onApplied={async (testId) => {
              await reload();
              toast.push(`Draft created for review. Test ${testId} is still unpublished.`, 'success');
            }}
          />
        ) : null}
      </Modal>
    </div>
  );
}

function ImportStartForm({
  onCreated,
  onError,
}: {
  onCreated: (importId: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [mode, setMode] = useState<'paste' | 'file'>('paste');
  const [busy, setBusy] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState({
    title: '',
    contentOrigin: 'IMPORTED',
    sourceTitle: '',
    sourceUrl: '',
    attribution: '',
    licenseNotes: '',
  });

  const looksLikeJson = /^\s*[[{]/.test(pasteText);

  const provenance = (
    <>
      <Field label="Where does this material come from?" required>
        {(id) => (
          <Select id={id} value={form.contentOrigin} onChange={(event) => setForm({ ...form, contentOrigin: event.target.value })}>
            <option value="ORIGINAL">Original — written by us</option>
            <option value="LICENSED">Licensed — we hold the rights</option>
            <option value="IMPORTED">Imported — rights cleared by the institution</option>
            <option value="AI_GENERATED">AI generated — reviewed by a human</option>
            <option value="OFFICIAL_PROVIDER">Official provider material (our own licence)</option>
          </Select>
        )}
      </Field>
      <div className="grid grid--2">
        <Field label="Source title">{(id) => <TextInput id={id} value={form.sourceTitle} onChange={(event) => setForm({ ...form, sourceTitle: event.target.value })} />}</Field>
        <Field label="Source URL">{(id) => <TextInput id={id} value={form.sourceUrl} onChange={(event) => setForm({ ...form, sourceUrl: event.target.value })} />}</Field>
      </div>
      <Field label="Attribution">{(id) => <TextInput id={id} value={form.attribution} onChange={(event) => setForm({ ...form, attribution: event.target.value })} />}</Field>
      <Field label="Licence notes">{(id) => <TextArea id={id} rows={2} value={form.licenseNotes} onChange={(event) => setForm({ ...form, licenseNotes: event.target.value })} />}</Field>
    </>
  );

  return (
    <div>
      <Tabs
        value={mode}
        onChange={setMode}
        tabs={[
          { id: 'paste', label: 'Paste text or JSON' },
          { id: 'file', label: 'Upload a document' },
        ]}
      />

      {mode === 'paste' ? (
        <>
          <Field
            label="Paste reading JSON, plain text or an AI response"
            required
            hint="A JSON object with a testType is validated and turned into a draft immediately. Plain text is stored for AI structuring or manual editing."
          >
            {(id) => (
              <TextArea
                id={id}
                rows={12}
                value={pasteText}
                onChange={(event) => setPasteText(event.target.value)}
                placeholder={'{\n  "testType": "READING",\n  "passages": [ … ],\n  "sections": [ … ]\n}'}
                spellCheck={false}
                className="mono"
              />
            )}
          </Field>
          <Field label="Title" hint="Optional. Shown in the import list.">
            {(id) => <TextInput id={id} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />}
          </Field>
          <p className="tiny muted">
            Detected content: {looksLikeJson ? 'JSON — validated against the structured content schema.' : 'plain text — kept as extracted text.'}{' '}
            {pasteText.length > 0 ? `${pasteText.length.toLocaleString()} characters.` : ''}
          </p>
          {provenance}
          <Button
            variant="primary"
            loading={busy}
            disabled={pasteText.trim().length < 40}
            onClick={async () => {
              setBusy(true);
              try {
                const result = await api.post<{ importId: string }>('/api/admin/imports/paste', {
                  text: pasteText,
                  title: form.title || undefined,
                  contentOrigin: form.contentOrigin,
                  sourceTitle: form.sourceTitle || undefined,
                  sourceUrl: form.sourceUrl || undefined,
                  attribution: form.attribution || undefined,
                  licenseNotes: form.licenseNotes || undefined,
                });
                await onCreated(result.importId);
              } catch (pasteError) {
                onError(describeError(pasteError));
              } finally {
                setBusy(false);
              }
            }}
          >
            Create import from pasted content
          </Button>
        </>
      ) : (
        <>
          <Field label="Source file" required hint="PDF, DOCX, TXT, Markdown or CSV up to 25 MB.">
            {(id) => (
              <input
                id={id}
                type="file"
                accept=".pdf,.docx,.txt,.md,.csv,.json,application/pdf,text/plain,text/markdown,text/csv,application/json,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            )}
          </Field>
          <Field label="Title" hint="Defaults to the file name if left empty.">
            {(id) => <TextInput id={id} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />}
          </Field>
          <p className="tiny muted">
            Text is extracted during the request and stored in the database as extracted text. The uploaded file itself
            is not retained in V1, so keep your own copy of the original.
          </p>
          {provenance}
          <Button
            variant="primary"
            loading={busy}
            disabled={!file}
            onClick={async () => {
              if (!file) return;
              setBusy(true);
              try {
                const body = new FormData();
                body.set('file', file);
                for (const [key, value] of Object.entries(form)) {
                  if (value) body.set(key, value);
                }
                const result = await api.upload<{ importId: string }>('/api/admin/imports', body);
                await onCreated(result.importId);
              } catch (uploadError) {
                onError(describeError(uploadError));
              } finally {
                setBusy(false);
              }
            }}
          >
            Upload for review
          </Button>
        </>
      )}
    </div>
  );
}

function ImportDetailView({
  importId,
  onChanged,
  onApplied,
}: {
  importId: string;
  onChanged: () => Promise<void>;
  onApplied: (testId: string) => Promise<void>;
}) {
  const toast = useToast();
  const { data, loading, error, reload } = useAsync<ImportDetail>(
    () => api.get(`/api/admin/imports/${importId}`),
    [importId],
  );
  const [payloadText, setPayloadText] = useState<string | null>(null);
  const [extracted, setExtracted] = useState<string | null>(null);
  const [applyTarget, setApplyTarget] = useState('');
  const [busy, setBusy] = useState(false);

  if (loading) return <Loading label="Loading import…" />;
  if (error) return <Notice tone="danger">{error}</Notice>;
  if (!data) return null;

  const record = data.import;
  const payload = record.structuredPayload;
  const payloadValue = payloadText ?? (payload ? JSON.stringify(payload, null, 2) : '');

  return (
    <div className="stack">
      <div className="grid grid--4">
        <Stat label="Status" value={record.status.toLowerCase()} />
        <Stat label="AI structuring" value={record.aiUsed ? 'used' : 'not used'} hint={record.aiModel ?? 'No model key configured'} />
        <Stat label="Extracted characters" value={record.extractedChars ?? 0} />
        <Stat
          label="Answer key confidence"
          value={record.answerKeyConfidence ?? '—'}
          hint={
            record.answerKeyConfidence === 'ABSENT'
              ? 'No key was found in the source: the key must be entered manually.'
              : undefined
          }
        />
      </div>

      <Card title="Source">
        <KeyValue
          items={[
            ['File', record.filename],
            ['MIME type', record.mime],
            ['Size', `${(record.sizeBytes / 1024).toFixed(0)} KB`],
            ['Uploaded by', record.createdBy ?? '—'],
            ['Uploaded at', formatDateTime(record.createdAt)],
            ['Content origin', record.contentOrigin.replace(/_/g, ' ').toLowerCase()],
            ['Target test', record.targetTestTitle ?? 'Not applied yet'],
          ]}
        />
        <div className="row" style={{ marginTop: 12 }}>
          <Button
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api.post(`/api/admin/imports/${importId}/process`, {});
                await reload();
                await onChanged();
                toast.push('Extraction finished. Review the structured draft before applying it.', 'success');
              } catch (processError) {
                toast.push(describeError(processError), 'error');
              } finally {
                setBusy(false);
              }
            }}
          >
            Run extraction + AI structuring
          </Button>
          <Button
            disabled={!record.hasExtractedText}
            onClick={async () => {
              try {
                const result = await api.get<{ text: string }>(`/api/admin/imports/${importId}/extracted`);
                setExtracted(result.text);
              } catch (extractError) {
                toast.push(describeError(extractError), 'error');
              }
            }}
          >
            View extracted text
          </Button>
          {record.targetTestId ? (
            <Link className="btn" to={`/admin/tests/${record.targetTestId}`}>
              Open generated test
            </Link>
          ) : null}
        </div>
        <p className="tiny muted" style={{ marginTop: 10 }}>
          The pipeline never publishes. It produces a DRAFT version that still has to pass deterministic validation and
          your review. If the source contains no reliable answer key the key is left empty and flagged for review rather
          than invented.
        </p>
      </Card>

      {extracted !== null ? (
        <Card title="Extracted text" hint="Kept in D1 so imports work without object storage.">
          <TextArea readOnly rows={12} value={extracted} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }} />
        </Card>
      ) : null}

      <Card title="Pipeline jobs" flush>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Stage</th>
                <th>Status</th>
                <th className="num">Attempts</th>
                <th>Started</th>
                <th>Finished</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {data.jobs.map((job) => (
                <tr key={job.id}>
                  <td className="mono">{job.stage}</td>
                  <td>
                    <Badge tone={job.status === 'FAILED' ? 'danger' : job.status === 'SKIPPED' ? 'warning' : job.status === 'SUCCEEDED' ? 'success' : 'neutral'}>
                      {job.status.toLowerCase()}
                    </Badge>
                  </td>
                  <td className="num">{job.attempts}</td>
                  <td className="nowrap">{formatDateTime(job.startedAt)}</td>
                  <td className="nowrap">{formatDateTime(job.finishedAt)}</td>
                  <td className="tiny">{job.error ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.jobs.length === 0 ? <EmptyState title="No jobs recorded yet" /> : null}
      </Card>

      {data.drafts.length > 0 ? (
        <Card title="Draft validation">
          {data.drafts.map((draft) => (
            <div key={draft.id}>
              <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                <Badge tone={draft.status === 'APPLIED' ? 'success' : draft.status === 'DISCARDED' ? 'neutral' : 'accent'}>
                  {draft.status.toLowerCase()}
                </Badge>
                <span className="tiny muted">created {formatDateTime(draft.createdAt)}</span>
              </div>
              <pre className="tiny" style={{ overflowX: 'auto' }}>
                {JSON.stringify(draft.validation, null, 2)}
              </pre>
            </div>
          ))}
        </Card>
      ) : null}

      <Card title="Structured payload" hint="Edit before applying. This is what becomes the test version content.">
        <TextArea
          rows={16}
          spellCheck={false}
          value={payloadValue}
          onChange={(event) => setPayloadText(event.target.value)}
          style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}
        />
        <div className="row" style={{ marginTop: 10 }}>
          <Button
            onClick={async () => {
              try {
                const parsed = JSON.parse(payloadValue) as unknown;
                await api.patch(`/api/admin/imports/${importId}`, { payload: parsed });
                await reload();
                toast.push('Draft payload saved.', 'success');
              } catch (saveError) {
                toast.push(describeError(saveError), 'error');
              }
            }}
          >
            Save draft payload
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setPayloadText(payload ? JSON.stringify(payload, null, 2) : '');
            }}
          >
            Revert edits
          </Button>
        </div>
      </Card>

      <Card title="Apply to a test version" hint="Creates or updates a DRAFT version — publishing stays a separate, manual step.">
        <Field label="Existing test ID (optional)" hint="Leave empty to create a new test. Applying never overwrites a published version.">
          {(id) => <TextInput id={id} value={applyTarget} onChange={(event) => setApplyTarget(event.target.value)} placeholder="tst_…" />}
        </Field>
        <div className="row">
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const result = await api.post<{
                  testId: string;
                  versionId: string;
                  totalQuestions: number;
                  publishable: boolean;
                  issues: Array<{ level: string; code: string; message: string }>;
                }>(`/api/admin/imports/${importId}/apply`, applyTarget ? { testId: applyTarget } : {});
                const warnings = result.issues.filter((issue) => issue.level !== 'ERROR');
                const errors = result.issues.filter((issue) => issue.level === 'ERROR');
                if (errors.length > 0) {
                  toast.push(`Draft created with ${errors.length} blocking issue(s) — open the draft and fix them before publishing.`, 'error');
                } else if (warnings.length > 0) {
                  toast.push(`Draft created with ${warnings.length} warning(s) to review.`, 'warning');
                }
                await onApplied(result.testId);
              } catch (applyError) {
                toast.push(describeError(applyError), 'error');
              } finally {
                setBusy(false);
              }
            }}
          >
            Apply draft
          </Button>
          <ConfirmButton
            title="Discard this import?"
            confirmLabel="Discard"
            onConfirm={async () => {
              await api.post(`/api/admin/imports/${importId}/discard`, {});
              await reload();
              await onChanged();
            }}
            body={<p>The import and its draft are marked discarded. Nothing that was already applied is deleted.</p>}
          >
            Discard
          </ConfirmButton>
        </div>
      </Card>
    </div>
  );
}
