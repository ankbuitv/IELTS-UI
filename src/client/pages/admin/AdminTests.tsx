import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, describeError } from '../../lib/api';
import { useAsync } from '../../hooks/useAsync';
import { Badge, Button, Card, EmptyState, Field, Loading, Modal, Notice, Select, TextArea, TextInput, useToast } from '../../components/ui';
import { formatDateTime, TEST_TYPE_LABELS } from '../../lib/format';

interface AdminTestRow {
  id: string;
  slug: string;
  title: string;
  type: string;
  status: string;
  summary: string;
  content_origin: string;
  updated_at: string;
  current_version_id: string | null;
  version_count: number;
  total_questions: number | null;
  attempt_count: number;
  component_count: number;
}

/** Status colours: draft neutral, review amber, published emerald, archived dimmed. */
const STATUS_TONES: Record<string, 'neutral' | 'accent' | 'success' | 'warning' | 'dim'> = {
  DRAFT: 'neutral',
  REVIEW: 'warning',
  PUBLISHED: 'success',
  ARCHIVED: 'dim',
};

export function AdminTestsPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);

  const { data, loading, error, reload } = useAsync<{ tests: AdminTestRow[] }>(
    () =>
      api.get(
        `/api/admin/tests?${new URLSearchParams({
          ...(status ? { status } : {}),
          ...(type ? { type } : {}),
          ...(search ? { search } : {}),
        }).toString()}`,
      ),
    [status, type, search],
  );

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Tests &amp; content</h1>
          <p className="page-head__meta">
            Publishing freezes an immutable version. Editing a published test requires creating a new version.
          </p>
        </div>
        <Button variant="primary" onClick={() => setCreating(true)}>
          New test
        </Button>
      </div>

      <Card>
        <div className="filter-bar">
          <label className="field">
            <span className="field__label">Status</span>
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">All</option>
              <option value="DRAFT">Draft</option>
              <option value="REVIEW">In review</option>
              <option value="PUBLISHED">Published</option>
              <option value="ARCHIVED">Archived</option>
            </select>
          </label>
          <label className="field">
            <span className="field__label">Type</span>
            <select value={type} onChange={(event) => setType(event.target.value)}>
              <option value="">All</option>
              <option value="READING">Reading</option>
              <option value="LISTENING">Listening</option>
              <option value="WRITING">Writing</option>
              <option value="FULL_MOCK">Full mock</option>
            </select>
          </label>
          <label className="field" style={{ minWidth: 240 }}>
            <span className="field__label">Search</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="title or slug" />
          </label>
        </div>
      </Card>

      {loading ? <Loading /> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}

      <Card flush>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Title</th>
                <th>Type</th>
                <th>Status</th>
                <th className="num">Questions</th>
                <th className="num">Versions</th>
                <th className="num">Attempts</th>
                <th>Updated</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data?.tests.map((test) => (
                <tr key={test.id}>
                  <td>
                    {test.title}
                    <div className="tiny muted">
                      {test.slug} · {test.content_origin.replace('_', ' ').toLowerCase()}
                    </div>
                  </td>
                  <td>{TEST_TYPE_LABELS[test.type] ?? test.type}</td>
                  <td>
                    <Badge tone={STATUS_TONES[test.status] ?? 'neutral'}>{test.status.toLowerCase()}</Badge>
                  </td>
                  <td className="num">{test.total_questions ?? '—'}</td>
                  <td className="num">{test.version_count}</td>
                  <td className="num">{test.attempt_count}</td>
                  <td className="nowrap">{formatDateTime(test.updated_at)}</td>
                  <td className="right">
                    <Link className="btn btn--sm" to={`/admin/tests/${test.id}`}>
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data && data.tests.length === 0 ? <EmptyState title="No tests match these filters" /> : null}
      </Card>

      <Modal
        open={creating}
        title="Create a test"
        onClose={() => setCreating(false)}
        actions={<Button onClick={() => setCreating(false)}>Cancel</Button>}
      >
        <CreateTestForm
          onCreated={async (testId) => {
            await reload();
            setCreating(false);
            toast.push('Draft test created.', 'success');
            navigate(`/admin/tests/${testId}`);
          }}
          onError={(message) => toast.push(message, 'error')}
        />
      </Modal>
    </div>
  );
}

function CreateTestForm({
  onCreated,
  onError,
}: {
  onCreated: (testId: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [form, setForm] = useState({
    title: '',
    type: 'READING',
    summary: '',
    contentOrigin: 'ORIGINAL',
    sourceTitle: '',
    attribution: '',
    licenseNotes: '',
  });

  return (
    <div>
      <Field label="Title" required>
        {(id) => <TextInput id={id} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />}
      </Field>
      <Field label="Type" required>
        {(id) => (
          <Select id={id} value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>
            <option value="READING">Reading</option>
            <option value="LISTENING">Listening</option>
            <option value="WRITING">Writing</option>
            <option value="FULL_MOCK">Full mock</option>
          </Select>
        )}
      </Field>
      <Field label="Summary" hint="Shown to candidates in the catalogue.">
        {(id) => <TextArea id={id} value={form.summary} onChange={(event) => setForm({ ...form, summary: event.target.value })} />}
      </Field>
      <Field label="Content origin" hint="Copyright provenance is tracked per test and shown to administrators.">
        {(id) => (
          <Select
            id={id}
            value={form.contentOrigin}
            onChange={(event) => setForm({ ...form, contentOrigin: event.target.value })}
          >
            <option value="ORIGINAL">Original — written for this platform</option>
            <option value="LICENSED">Licensed — you hold rights</option>
            <option value="AI_GENERATED">AI generated — you reviewed it</option>
            <option value="IMPORTED">Imported — rights cleared by your institution</option>
            <option value="OFFICIAL_PROVIDER">Official provider material (your own licence)</option>
          </Select>
        )}
      </Field>
      <Field label="Source title">
        {(id) => <TextInput id={id} value={form.sourceTitle} onChange={(event) => setForm({ ...form, sourceTitle: event.target.value })} />}
      </Field>
      <Field label="Attribution">
        {(id) => <TextInput id={id} value={form.attribution} onChange={(event) => setForm({ ...form, attribution: event.target.value })} />}
      </Field>
      <Field label="Licence notes">
        {(id) => <TextArea id={id} value={form.licenseNotes} onChange={(event) => setForm({ ...form, licenseNotes: event.target.value })} />}
      </Field>
      <Button
        variant="primary"
        onClick={async () => {
          try {
            const result = await api.post<{ testId: string }>('/api/admin/tests', form);
            await onCreated(result.testId);
          } catch (createError) {
            onError(describeError(createError));
          }
        }}
      >
        Create draft
      </Button>
    </div>
  );
}
