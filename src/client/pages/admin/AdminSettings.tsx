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
import { AiProvidersPanel } from './AdminAiProviders';
import { Icon } from '../../components/Icon';

interface AssetRow {
  id: string;
  kind: string;
  storage_kind: string;
  external_url: string | null;
  filename: string;
  mime: string;
  size_bytes: number;
  duration_seconds: number | null;
  alt_text: string | null;
  visibility: string;
  test_version_id: string | null;
  created_at: string;
  updated_at: string | null;
  uploaded_by_email: string | null;
  test_title: string | null;
}

export function AdminSettingsPage() {
  const [tab, setTab] = useState<'settings' | 'ai' | 'assets' | 'notifications' | 'audit'>('settings');

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Settings &amp; operations</h1>
          <p className="page-head__meta">
            Platform switches are enforced on the server; media is linked by URL and every admin action is audited.
          </p>
        </div>
      </div>

      <Tabs
        tabs={[
          { id: 'settings', label: 'Platform settings' },
          { id: 'ai', label: 'AI providers' },
          { id: 'assets', label: 'Media' },
          { id: 'notifications', label: 'Announcements' },
          { id: 'audit', label: 'Audit log' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'settings' ? <SettingsPanel /> : null}
      {tab === 'ai' ? <AiProvidersPanel /> : null}
      {tab === 'assets' ? <AssetsPanel /> : null}
      {tab === 'notifications' ? <AnnouncementsPanel /> : null}
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
      <Card title="AI provider" hint="Nhiều provider, nhiều API key, có tự chuyển khi bị giới hạn — xem tab “AI providers”.">
        <KeyValue
          items={[
            ['Status', data.ai.available ? 'Configured' : 'Not configured'],
            ['Model', data.ai.model ?? '—'],
            ['Note', data.ai.reason ?? 'Keys live on the server only and are never sent to the browser.'],
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
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [assetKind, setAssetKind] = useState('');
  const [versionId, setVersionId] = useState('');
  const [altText, setAltText] = useState('');
  const [duration, setDuration] = useState('');
  const [busy, setBusy] = useState(false);

  const query = queryString({ kind: kind || undefined });
  const { data, loading, error, reload } = useAsync<{ assets: AssetRow[] }>(
    () => api.get(`/api/admin/assets${query}`),
    [query],
  );

  const register = async () => {
    setBusy(true);
    try {
      await api.post('/api/admin/assets', {
        url: url.trim(),
        filename: label.trim() || undefined,
        kind: assetKind || undefined,
        testVersionId: versionId.trim() || undefined,
        altText: altText.trim() || undefined,
        durationSeconds: duration ? Number(duration) : undefined,
      });
      setUrl('');
      setLabel('');
      setAltText('');
      setDuration('');
      await reload();
      toast.push('Media URL registered.', 'success');
    } catch (registerError) {
      toast.push(describeError(registerError), 'error');
    } finally {
      setBusy(false);
    }
  };

  const urlLooksValid = /^https:\/\/\S+$/i.test(url.trim());
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [lastUploaded, setLastUploaded] = useState<{ id: string; filename: string; url: string; sizeBytes: number } | null>(null);

  /**
   * Upload instead of linking: the file is read in the browser, sent as base64,
   * chunked into D1 by the Worker and streamed back from /api/files/:id with
   * Range support. This is what removes the "paste an audio URL" step.
   */
  const uploadFile = async (file: File) => {
    if (file.size > 25 * 1024 * 1024) {
      toast.push('File lớn hơn 25 MB. Hãy nén audio trước khi tải lên.', 'error');
      return;
    }
    setUploading(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Không đọc được file.'));
        reader.readAsDataURL(file);
      });
      const result = await api.post<{ asset: { id: string; filename: string; url: string; sizeBytes: number } }>(
        '/api/admin/assets/upload',
        {
          filename: file.name,
          mime: file.type || 'application/octet-stream',
          dataBase64: base64,
          kind: file.type.startsWith('audio/') ? 'AUDIO' : file.type.startsWith('image/') ? 'IMAGE' : undefined,
          altText: altText.trim() || undefined,
          testVersionId: versionId.trim() || undefined,
        },
      );
      setLastUploaded(result.asset);
      await reload();
      toast.push('Đã tải media lên. Không cần link ngoài nữa.', 'success');
    } catch (uploadError) {
      toast.push(describeError(uploadError), 'error');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="stack">
      <Card
        title="Tải file lên (khuyến nghị)"
        hint="Audio bài nghe, hình minh hoạ. File được lưu trong hệ thống và phát qua /api/files/:id — không cần link."
      >
        <div
          className={`dropzone ${dragOver ? 'dropzone--over' : ''}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragOver(false);
            const file = event.dataTransfer.files?.[0];
            if (file) void uploadFile(file);
          }}
        >
          <Icon name="upload" size={22} />
          <span>Kéo thả file vào đây, hoặc</span>
          <label className="btn btn--sm btn--secondary" style={{ cursor: 'pointer' }}>
            {uploading ? 'Đang tải lên…' : 'Chọn file từ máy'}
            <input
              type="file"
              accept="audio/*,image/*"
              hidden
              disabled={uploading}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadFile(file);
                event.target.value = '';
              }}
            />
          </label>
          <span className="tiny muted">Audio (mp3, m4a, webm, ogg…) hoặc ảnh (png, jpg, webp…). Tối đa 25 MB.</span>
        </div>
        {lastUploaded ? (
          <div className="row" style={{ marginTop: 10, gap: 8 }}>
            <Badge tone="success">Đã tải</Badge>
            <span className="small">{lastUploaded.filename}</span>
            <code className="mono small">/api/files/{lastUploaded.id}</code>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                void navigator.clipboard?.writeText(`${window.location.origin}${lastUploaded.url}`);
                toast.push('Đã copy URL. Dán vào ô audio của bài test, hoặc dùng asset id trong editor.', 'info');
              }}
            >
              Copy URL
            </Button>
          </div>
        ) : null}
      </Card>

      <Card
        title="Hoặc dùng link ngoài"
        hint="Chỉ dùng khi file đã nằm ở nơi khác và bạn có quyền sử dụng."
      >
        <div className="grid grid--2">
          <Field label="HTTPS media URL" required hint="Audio for Listening, images and charts for Reading/Writing.">
            {(id) => (
              <TextInput
                id={id}
                type="url"
                inputMode="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://cdn.example.com/listening/section-1.mp3"
              />
            )}
          </Field>
          <Field label="Display name" hint="Optional. Defaults to the file name in the URL.">
            {(id) => <TextInput id={id} value={label} onChange={(event) => setLabel(event.target.value)} />}
          </Field>
          <Field label="Media kind" hint="Optional. Detected from the URL when left empty.">
            {(id) => (
              <select id={id} value={assetKind} onChange={(event) => setAssetKind(event.target.value)}>
                <option value="">Detect automatically</option>
                <option value="AUDIO">Audio</option>
                <option value="IMAGE">Image</option>
                <option value="PDF">PDF</option>
                <option value="DOC">Document</option>
                <option value="OTHER">Other</option>
              </select>
            )}
          </Field>
          <Field label="Attach to a test version ID" hint="Optional. Assets can also be attached from the content editor.">
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
          Only plain <span className="mono">https://</span> URLs are accepted. The server stores the link, records who
          registered it, and streams nothing itself — the candidate browser fetches the media from the host you name.
        </p>
        <div className="row">
          <Button variant="primary" loading={busy} disabled={!urlLooksValid} onClick={register}>
            Register URL
          </Button>
          {url && !urlLooksValid ? <span className="tiny muted">Enter a full https:// URL.</span> : null}
        </div>
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
                <th>Media</th>
                <th>Kind</th>
                <th>Source</th>
                <th>Attached to</th>
                <th>Registered</th>
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
                  <td className="tiny">
                    {asset.external_url ? (
                      <span className="mono" title={asset.external_url}>
                        {hostOf(asset.external_url)}
                      </span>
                    ) : (
                      asset.storage_kind.toLowerCase().replace('_', ' ')
                    )}
                  </td>
                  <td className="tiny">{asset.test_title ?? asset.test_version_id ?? 'Not attached'}</td>
                  <td className="nowrap">{formatDateTime(asset.created_at)}</td>
                  <td className="right">
                    <div className="row" style={{ justifyContent: 'flex-end' }}>
                      {asset.external_url ? (
                        <a className="btn btn--sm" href={asset.external_url} target="_blank" rel="noreferrer">
                          Open source
                        </a>
                      ) : null}
                      <ConfirmButton
                        size="sm"
                        variant="ghost"
                        title="Remove this media record?"
                        confirmLabel="Remove"
                        onConfirm={async () => {
                          await api.delete(`/api/admin/assets/${asset.id}`);
                          await reload();
                        }}
                        body={
                          <p>
                            The record is deleted from the database. A linked file on another host is not touched. Media
                            still attached to a section cannot be deleted.
                          </p>
                        }
                      >
                        Remove
                      </ConfirmButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data && data.assets.length === 0 ? <EmptyState title="No media registered yet" /> : null}
      </Card>
    </div>
  );
}

/** Host shown in the asset table so admins can see where media comes from. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
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


// ------------------------------------------------------------- announcements

interface EmailRow {
  id: string;
  to_email: string;
  subject: string;
  status: 'QUEUED' | 'SENT' | 'FAILED' | 'SKIPPED';
  provider: string | null;
  error: string | null;
  created_at: string;
  sent_at: string | null;
}

const EMAIL_TONE: Record<EmailRow['status'], 'neutral' | 'success' | 'warning' | 'danger'> = {
  SENT: 'success',
  QUEUED: 'warning',
  FAILED: 'danger',
  SKIPPED: 'neutral',
};

function AnnouncementsPanel() {
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [href, setHref] = useState('');
  const [role, setRole] = useState<'ALL' | 'STUDENT' | 'TEACHER' | 'MENTOR' | 'ADMIN'>('ALL');
  const [email, setEmail] = useState(false);
  const [busy, setBusy] = useState(false);
  const { data: emails, reload } = useAsync<{ providerConfigured: boolean; items: EmailRow[] }>(
    () => api.get('/api/admin/emails'),
    [],
  );

  const send = async () => {
    setBusy(true);
    try {
      const result = await api.post<{ recipients: number }>('/api/admin/notifications/broadcast', {
        title: title.trim(),
        body: body.trim(),
        ...(href.trim() ? { href: href.trim() } : {}),
        ...(role === 'ALL' ? {} : { role }),
        email,
      });
      toast.push(`Sent to ${result.recipients} ${result.recipients === 1 ? 'person' : 'people'}.`, 'success');
      setTitle('');
      setBody('');
      setHref('');
      await reload();
    } catch (error) {
      toast.push(describeError(error), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card
        title="Send an announcement"
        hint="Lands in the bell of every signed-in account. Optionally email it as well — email needs RESEND_API_KEY and EMAIL_FROM."
      >
        <Field label="Title" required>
          {(id) => (
            <TextInput
              id={id}
              value={title}
              maxLength={120}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Mock test this Saturday"
            />
          )}
        </Field>
        <Field label="Message" hint="One short paragraph reads best in the bell.">
          {(id) => (
            <TextArea id={id} value={body} maxLength={600} rows={3} onChange={(event) => setBody(event.target.value)} />
          )}
        </Field>
        <div className="grid grid--2">
          <Field label="Open when clicked" hint="An in-app path, e.g. /practice or /my-sessions.">
            {(id) => (
              <TextInput id={id} value={href} onChange={(event) => setHref(event.target.value)} placeholder="/practice" />
            )}
          </Field>
          <Field label="Audience">
            {(id) => (
              <select id={id} value={role} onChange={(event) => setRole(event.target.value as typeof role)}>
                <option value="ALL">Everyone active</option>
                <option value="STUDENT">Students</option>
                <option value="TEACHER">Teachers</option>
                <option value="MENTOR">Mentors</option>
                <option value="ADMIN">Admins</option>
              </select>
            )}
          </Field>
        </div>
        <Checkbox checked={email} onChange={setEmail} label="Also send it by email" />
        <div className="row" style={{ marginTop: 10 }}>
          <Button variant="primary" loading={busy} disabled={title.trim().length < 3} onClick={send}>
            Send announcement
          </Button>
        </div>
      </Card>

      <Card
        title="Email delivery"
        hint="Every transactional email is recorded before it is sent, so queued messages can be checked even without a provider."
        actions={<Badge tone={emails?.providerConfigured ? 'success' : 'warning'}>{emails?.providerConfigured ? 'Provider connected' : 'Queued only'}</Badge>}
      >
        {emails && !emails.providerConfigured ? (
          <Notice tone="info" title="No email provider configured">
            Messages are stored with status QUEUED and the sign-in links can be read from the outbox. Set
            <span className="mono"> RESEND_API_KEY </span> and <span className="mono">EMAIL_FROM</span> as Worker secrets to
            deliver them.
          </Notice>
        ) : null}
        <div className="stack" style={{ gap: 0 }}>
          {(emails?.items ?? []).slice(0, 12).map((item) => (
            <div key={item.id} className="row" style={{ justifyContent: 'space-between', gap: 12, padding: '9px 0', borderBottom: '1px solid var(--ink-100)' }}>
              <div style={{ minWidth: 0 }}>
                <strong className="small" style={{ display: 'block' }}>{item.subject}</strong>
                <span className="tiny muted">{item.to_email} · {formatDateTime(item.created_at)}</span>
                {item.error ? <span className="tiny" style={{ color: 'var(--danger, #b4324b)', display: 'block' }}>{item.error}</span> : null}
              </div>
              <Badge tone={EMAIL_TONE[item.status]}>{item.status.toLowerCase()}</Badge>
            </div>
          ))}
          {emails && emails.items.length === 0 ? <p className="muted small">No email has been sent yet.</p> : null}
        </div>
      </Card>
    </>
  );
}
