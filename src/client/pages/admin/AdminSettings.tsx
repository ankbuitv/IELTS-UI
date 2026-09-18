import { useState } from 'react';
import { api, describeError, queryString } from '../../lib/api';
import { useAsync } from '../../hooks/useAsync';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  ConfirmButton,
  EmptyState,
  Field,
  KeyValue,
  Loading,
  Notice,
  Stat,
  Tabs,
  TextArea,
  TextInput,
  useToast,
} from '../../components/ui';
import { formatDateTime } from '../../lib/format';

interface AssetRow {
  id: string;
  kind: string;
  filename: string;
  mime: string;
  size_bytes: number;
  duration_seconds: number | null;
  alt_text: string | null;
  visibility: string;
  test_version_id: string | null;
  created_at: string;
  uploaded_by_email: string | null;
  test_title: string | null;
}

export function AdminSettingsPage() {
  const [tab, setTab] = useState<'settings' | 'assets' | 'audit'>('settings');

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Settings &amp; operations</h1>
          <p className="page-head__meta">
            Platform switches are enforced on the server; files live in object storage and every admin action is audited.
          </p>
        </div>
      </div>

      <Tabs
        tabs={[
          { id: 'settings', label: 'Platform settings' },
          { id: 'assets', label: 'Assets' },
          { id: 'audit', label: 'Audit log' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'settings' ? <SettingsPanel /> : null}
      {tab === 'assets' ? <AssetsPanel /> : null}
      {tab === 'audit' ? <AuditPanel /> : null}
    </div>
  );
}

function SettingsPanel() {
  const toast = useToast();
  const { data, loading, error, reload } = useAsync<{
    settings: Record<string, unknown>;
    ai: { available: boolean; model?: string; reason?: string };
  }>(() => api.get('/api/admin/settings'), []);

  const [form, setForm] = useState<{
    bandEstimationEnabled: boolean;
    aiImportEnabled: boolean;
    registrationEnabled: boolean;
    integrityNotice: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading) return <Loading label="Loading settings…" />;
  if (error) return <Notice tone="danger">{error}</Notice>;
  if (!data) return null;

  const current = form ?? {
    bandEstimationEnabled: data.settings['band_estimation_enabled'] !== false,
    aiImportEnabled: data.settings['ai_import_enabled'] !== false,
    registrationEnabled: data.settings['registration_enabled'] !== false,
    integrityNotice: typeof data.settings['integrity_notice'] === 'string' ? (data.settings['integrity_notice'] as string) : '',
  };

  return (
    <div className="stack">
      <Card title="AI provider">
        <KeyValue
          items={[
            ['Status', data.ai.available ? 'Configured' : 'Not configured'],
            ['Model', data.ai.model ?? '—'],
            ['Note', data.ai.reason ?? 'Structuring runs server-side only; the key is never sent to the browser.'],
          ]}
        />
      </Card>

      <Card title="Behaviour switches" hint="Changes apply to new requests immediately and are written to the audit log.">
        <div className="stack" style={{ gap: 12 }}>
          <Checkbox
            checked={current.bandEstimationEnabled}
            onChange={(checked) => setForm({ ...current, bandEstimationEnabled: checked })}
            label="Enable estimated bands (Reading and Listening only, via active scoring profiles)"
          />
          <Checkbox
            checked={current.aiImportEnabled}
            onChange={(checked) => setForm({ ...current, aiImportEnabled: checked })}
            label="Allow AI structuring of imported documents (requires an API key; extraction and manual structuring always work)"
          />
          <Checkbox
            checked={current.registrationEnabled}
            onChange={(checked) => setForm({ ...current, registrationEnabled: checked })}
            label="Allow self-service student registration (the one-time bootstrap administrator is exempt)"
          />
        </div>

        <Field
          label="Integrity notice shown to candidates"
          hint="Displayed next to the monitoring indicator. Keep it factual: browser events are recorded, not proven misconduct."
        >
          {(id) => (
            <TextArea
              id={id}
              rows={4}
              value={current.integrityNotice}
              onChange={(event) => setForm({ ...current, integrityNotice: event.target.value })}
            />
          )}
        </Field>

        <div className="row">
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api.patch('/api/admin/settings', {
                  settings: {
                    band_estimation_enabled: current.bandEstimationEnabled,
                    ai_import_enabled: current.aiImportEnabled,
                    registration_enabled: current.registrationEnabled,
                    integrity_notice: current.integrityNotice,
                  },
                });
                await reload();
                toast.push('Settings saved.', 'success');
              } catch (saveError) {
                toast.push(describeError(saveError), 'error');
              } finally {
                setBusy(false);
              }
            }}
          >
            Save settings
          </Button>
          <Button onClick={() => setForm(null)}>Reset form</Button>
        </div>
      </Card>

      <Card title="Manual steps outside the application" hint="These cannot be configured from the admin UI.">
        <ul className="small" style={{ margin: '0 0 0 18px' }}>
          <li>
            Secrets (<span className="mono">SESSION_SECRET</span>, optional <span className="mono">OPENAI_API_KEY</span>)
            are set with <span className="mono">wrangler secret put</span>, never in the repository.
          </li>
          <li>
            Custom domains and DNS records are configured in the Cloudflare dashboard or with{' '}
            <span className="mono">wrangler</span>. The application does not claim a domain is verified just because it
            is configured here.
          </li>
          <li>Content rights and licensing remain the administrator's responsibility.</li>
        </ul>
      </Card>
    </div>
  );
}

function AssetsPanel() {
  const toast = useToast();
  const [kind, setKind] = useState('');
  const [versionId, setVersionId] = useState('');
  const [altText, setAltText] = useState('');
  const [duration, setDuration] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const query = queryString({ kind: kind || undefined });
  const { data, loading, error, reload } = useAsync<{ assets: AssetRow[] }>(
    () => api.get(`/api/admin/assets${query}`),
    [query],
  );

  return (
    <div className="stack">
      <Card title="Upload an asset" hint="Audio for Listening sections, images for diagrams, PDFs for reference.">
        <div className="grid grid--2">
          <Field label="File" required>
            {(id) => (
              <input
                id={id}
                type="file"
                accept="audio/*,image/*,.pdf,.docx,.txt,.md,.csv"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            )}
          </Field>
          <Field label="Attach to a test version ID" hint="Optional. Assets can be attached later in the content editor.">
            {(id) => <TextInput id={id} value={versionId} onChange={(event) => setVersionId(event.target.value)} placeholder="ver_…" />}
          </Field>
          <Field label="Alt text / description" hint="Required for images to keep the exam usable with a screen reader.">
            {(id) => <TextInput id={id} value={altText} onChange={(event) => setAltText(event.target.value)} />}
          </Field>
          <Field label="Audio duration in seconds" hint="Used by the playback policy UI.">
            {(id) => <TextInput id={id} type="number" value={duration} onChange={(event) => setDuration(event.target.value)} />}
          </Field>
        </div>
        <p className="tiny muted">
          Allowed: PDF, DOCX, TXT, Markdown, CSV and images, up to the configured upload limit (25 MB by default). MIME
          type and size are validated on the server.
        </p>
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
              if (versionId) body.set('testVersionId', versionId);
              if (altText) body.set('altText', altText);
              if (duration) body.set('durationSeconds', duration);
              await api.upload('/api/admin/assets', body);
              setFile(null);
              setAltText('');
              setDuration('');
              await reload();
              toast.push('Asset uploaded.', 'success');
            } catch (uploadError) {
              toast.push(describeError(uploadError), 'error');
            } finally {
              setBusy(false);
            }
          }}
        >
          Upload asset
        </Button>
      </Card>

      <Card>
        <div className="filter-bar">
          <label className="field">
            <span className="field__label">Kind</span>
            <select value={kind} onChange={(event) => setKind(event.target.value)}>
              <option value="">All kinds</option>
              <option value="AUDIO">Audio</option>
              <option value="IMAGE">Image</option>
              <option value="PDF">PDF</option>
              <option value="DOC">Document</option>
              <option value="OTHER">Other</option>
            </select>
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
                <th>File</th>
                <th>Kind</th>
                <th className="num">Size</th>
                <th>Attached to</th>
                <th>Uploaded</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data?.assets.map((asset) => (
                <tr key={asset.id}>
                  <td>
                    {asset.filename}
                    <div className="tiny muted mono">{asset.id}</div>
                  </td>
                  <td>
                    <Badge tone={asset.kind === 'AUDIO' ? 'accent' : 'neutral'}>{asset.kind.toLowerCase()}</Badge>
                  </td>
                  <td className="num">{(asset.size_bytes / 1024).toFixed(0)} KB</td>
                  <td className="tiny">{asset.test_title ?? asset.test_version_id ?? 'Not attached'}</td>
                  <td className="nowrap">{formatDateTime(asset.created_at)}</td>
                  <td className="right">
                    <div className="row" style={{ justifyContent: 'flex-end' }}>
                      <a className="btn btn--sm" href={`/api/files/${asset.id}`} target="_blank" rel="noreferrer">
                        Open
                      </a>
                      <ConfirmButton
                        size="sm"
                        variant="ghost"
                        title="Delete this asset?"
                        confirmLabel="Delete"
                        onConfirm={async () => {
                          await api.delete(`/api/admin/assets/${asset.id}`);
                          await reload();
                        }}
                        body={<p>The file is removed from object storage. Assets still attached to a section cannot be deleted.</p>}
                      >
                        Delete
                      </ConfirmButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data && data.assets.length === 0 ? <EmptyState title="No assets uploaded" /> : null}
      </Card>
    </div>
  );
}

function AuditPanel() {
  const [action, setAction] = useState('');
  const [limit, setLimit] = useState(100);
  const query = queryString({ action: action || undefined, limit });
  const { data, loading, error } = useAsync<{
    logs: Array<{
      id: string;
      action: string;
      entity_type: string;
      entity_id: string;
      metadata: unknown;
      ip: string | null;
      created_at: string;
      actor_email: string | null;
    }>;
  }>(() => api.get(`/api/admin/audit-logs${query}`), [query]);

  return (
    <div className="stack">
      <Card>
        <div className="filter-bar">
          <label className="field">
            <span className="field__label">Action</span>
            <input value={action} onChange={(event) => setAction(event.target.value)} placeholder="e.g. USER_CREATE" />
          </label>
          <label className="field">
            <span className="field__label">Limit</span>
            <select value={limit} onChange={(event) => setLimit(Number(event.target.value))}>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
            </select>
          </label>
        </div>
      </Card>

      {loading ? <Loading /> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}

      <Card title="Administrative actions" hint="Secrets and passwords are never written to the audit log." flush>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>When</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Entity</th>
                <th>Metadata</th>
              </tr>
            </thead>
            <tbody>
              {data?.logs.map((log) => (
                <tr key={log.id}>
                  <td className="nowrap">{formatDateTime(log.created_at)}</td>
                  <td className="tiny">{log.actor_email ?? 'system'}</td>
                  <td>
                    <span className="mono tiny">{log.action}</span>
                  </td>
                  <td className="tiny">
                    {log.entity_type}
                    <div className="mono tiny muted">{log.entity_id}</div>
                  </td>
                  <td className="tiny" style={{ maxWidth: 340, wordBreak: 'break-word' }}>
                    {log.metadata && Object.keys(log.metadata as object).length > 0
                      ? JSON.stringify(log.metadata)
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data && data.logs.length === 0 ? <EmptyState title="No audit entries" /> : null}
      </Card>

      <Card title="Storage note">
        <Stat label="Audit retention" value="Unbounded" hint="Prune with a scheduled query if your policy requires retention limits." />
      </Card>
    </div>
  );
}
