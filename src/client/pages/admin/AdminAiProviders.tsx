import { useEffect, useState } from 'react';
import { ApiRequestError, api, describeError } from '../../lib/api';
import { useAsync } from '../../hooks/useAsync';
import { Badge, Button, Card, Field, Loading, Notice, Select, TextInput, useToast } from '../../components/ui';
import {
  AI_PROVIDER_KINDS,
  DEFAULT_PROVIDER_BASE_URLS,
  MODEL_PRESETS,
  PROVIDER_KIND_LABELS,
  SPEECH_TO_TEXT_MODELS,
  type AiProviderKind,
  type AiProviderPublic,
  type AiStatus,
} from '@shared/ai';

/**
 * AI providers: any number of OpenAI-compatible endpoints, one default.
 *
 * Keys are write-only — the API never returns one, so the field says
 * "leave blank to keep the stored key" rather than pretending to show it. This
 * is the screen where an administrator pastes an Ollama cloud key and picks
 * `gpt-oss:120b` or `gemma3:27b`, or points the platform at a self-hosted
 * Ollama daemon with no key at all.
 */

interface Draft extends AiProviderPublic {
  apiKey: string;
  sttModel: string;
  /** UI-only: true while the admin has typed a new key. */
  keyTouched: boolean;
}

export function AiProvidersPanel() {
  const toast = useToast();
  const { data, loading, error, reload } = useAsync<{ providers: AiProviderPublic[]; ai: AiStatus }>(
    () => api.get('/api/admin/ai/providers'),
    [],
  );
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    setDrafts(
      data.providers.map((provider) => ({
        ...provider,
        apiKey: '',
        sttModel: provider.sttModel ?? '',
        keyTouched: false,
      })),
    );
  }, [data]);

  if (loading) return <Loading label="Đang tải danh sách AI provider…" />;
  if (error) return <Notice tone="danger">{error}</Notice>;
  if (!drafts) return null;

  const update = (id: string, patch: Partial<Draft>) => {
    setDrafts((current) =>
      (current ?? []).map((draft) => (draft.id === id ? { ...draft, ...patch } : patch.isDefault ? { ...draft, isDefault: false } : draft)),
    );
  };

  const addPreset = (preset: { kind: AiProviderKind; model: string; label: string }) => {
    const id = `draft-${Math.random().toString(36).slice(2, 8)}`;
    setDrafts((current) => [
      ...(current ?? []),
      {
        id,
        label: preset.label,
        kind: preset.kind,
        baseUrl: DEFAULT_PROVIDER_BASE_URLS[preset.kind],
        model: preset.model,
        enabled: true,
        isDefault: (current ?? []).length === 0,
        sttModel: '',
        requiresKey: true,
        hasKey: false,
        keyHint: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        apiKey: '',
        keyTouched: false,
      },
    ]);
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.put('/api/admin/ai/providers', {
        providers: drafts.map((draft) => ({
          id: draft.id.startsWith('draft-') ? undefined : draft.id,
          label: draft.label,
          kind: draft.kind,
          baseUrl: draft.baseUrl,
          model: draft.model,
          // Only send the key when the admin typed one; otherwise the server keeps
          // the stored value. An empty typed value clears it.
          ...(draft.keyTouched ? { apiKey: draft.apiKey } : {}),
          requiresKey: draft.requiresKey,
          enabled: draft.enabled,
          isDefault: draft.isDefault,
          sttModel: draft.sttModel || null,
        })),
      });
      toast.push('Đã lưu danh sách AI provider.', 'success');
      await reload();
    } catch (saveError) {
      toast.push(describeError(saveError), 'error');
    } finally {
      setSaving(false);
    }
  };

  const test = async (draft: Draft) => {
    setTesting(draft.id);
    try {
      const result = await api.post<{ ok: boolean; message: string; latencyMs: number }>('/api/admin/ai/providers/test', {
        id: draft.id.startsWith('draft-') ? undefined : draft.id,
        label: draft.label,
        kind: draft.kind,
        baseUrl: draft.baseUrl,
        model: draft.model,
        requiresKey: draft.requiresKey,
        // Send the typed key when there is one; the server falls back to the stored key.
        ...(draft.keyTouched || draft.apiKey ? { apiKey: draft.apiKey } : {}),
      });
      toast.push(`${result.ok ? '✓' : '✕'} ${result.message} (${result.latencyMs} ms)`, result.ok ? 'success' : 'error');
    } catch (testError) {
      const message = testError instanceof ApiRequestError ? testError.message : describeError(testError);
      toast.push(message, 'error');
    } finally {
      setTesting(null);
    }
  };

  const status = data?.ai;

  return (
    <div className="stack">
      <Card title="Trạng thái AI" hint="Mọi tính năng AI (nhập đề, chấm Writing, chấm Speaking) dùng provider mặc định.">
        {status?.available ? (
          <div className="row" style={{ gap: 10 }}>
            <Badge tone="success">Đang hoạt động</Badge>
            <span className="small">
              {status.providerLabel} · <span className="mono">{status.model}</span>
              {status.fromEnvironment ? ' · key từ biến môi trường' : ''}
            </span>
          </div>
        ) : (
          <Notice tone="warning" title="Chưa có AI provider">
            {status?.reason ?? 'Thêm một provider bên dưới để bật chấm điểm bằng AI.'}
          </Notice>
        )}
      </Card>

      <Card title="Thêm provider" hint="Ollama cloud, OpenAI, hoặc gateway nội bộ tương thích OpenAI.">
        <div className="row">
          <Button size="sm" variant="secondary" onClick={() => addPreset({ kind: 'OLLAMA', model: 'gpt-oss:120b', label: 'Ollama cloud — gpt-oss:120b' })}>
            + Ollama · gpt-oss:120b
          </Button>
          <Button size="sm" variant="secondary" onClick={() => addPreset({ kind: 'OLLAMA', model: 'gemma3:27b', label: 'Ollama cloud — gemma3:27b' })}>
            + Ollama · gemma3:27b
          </Button>
          <Button size="sm" variant="secondary" onClick={() => addPreset({ kind: 'OLLAMA', model: 'gpt-oss:20b', label: 'Ollama cloud — gpt-oss:20b' })}>
            + Ollama · gpt-oss:20b
          </Button>
          <Button size="sm" variant="secondary" onClick={() => addPreset({ kind: 'OPENAI', model: 'gpt-4.1', label: 'OpenAI — gpt-4.1' })}>
            + OpenAI
          </Button>
          <Button size="sm" variant="ghost" onClick={() => addPreset({ kind: 'OPENAI_COMPATIBLE', model: '', label: 'Gateway nội bộ' })}>
            + Gateway khác
          </Button>
        </div>
      </Card>

      {drafts.length === 0 ? (
        <Card>
          <Notice tone="info" title="Chưa cấu hình provider nào">
            Nền tảng vẫn hoạt động: nhập đề thủ công, chấm Reading/Listening tự động và giáo viên chấm Writing đều
            không cần AI.
          </Notice>
        </Card>
      ) : null}

      {drafts.map((draft) => (
        <div key={draft.id} className={`provider-card ${draft.isDefault ? 'provider-card--default' : ''}`}>
          <div className="provider-card__head">
            <span className="provider-card__title">{draft.label || 'Provider'}</span>
            {draft.isDefault ? <Badge tone="accent">Mặc định</Badge> : null}
            <Badge tone={draft.enabled ? 'success' : 'neutral'}>{draft.enabled ? 'Bật' : 'Tắt'}</Badge>
            <span className="key-state" style={{ marginLeft: 'auto' }}>
              <span className={`key-state ${draft.hasKey || draft.apiKey ? 'key-state--set' : ''}`}>
                {draft.keyTouched ? '🔑 key mới sẽ được lưu' : draft.hasKey ? `🔑 key đã lưu ····${draft.keyHint ?? ''}` : '🔒 chưa có key'}
              </span>
            </span>
          </div>

          <div className="provider-card__grid">
            <Field label="Tên hiển thị">
              {(id) => (
                <TextInput id={id} value={draft.label} onChange={(event) => update(draft.id, { label: event.target.value })} />
              )}
            </Field>
            <Field label="Loại">
              {(id) => (
                <Select
                  id={id}
                  value={draft.kind}
                  onChange={(event) => {
                    const kind = event.target.value as AiProviderKind;
                    update(draft.id, {
                      kind,
                      baseUrl: DEFAULT_PROVIDER_BASE_URLS[kind],
                    });
                  }}
                >
                  {AI_PROVIDER_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {PROVIDER_KIND_LABELS[kind]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Base URL" hint="Ví dụ: https://ollama.com/v1 hoặc http://localhost:11434/v1">
              {(id) => (
                <TextInput id={id} value={draft.baseUrl} onChange={(event) => update(draft.id, { baseUrl: event.target.value })} />
              )}
            </Field>
            <Field label="Model" hint="Chọn preset hoặc gõ tên model bất kỳ.">
              {(id) => (
                <>
                  <TextInput
                    id={id}
                    value={draft.model}
                    onChange={(event) => update(draft.id, { model: event.target.value })}
                    list={`models-${draft.id}`}
                    placeholder="gpt-oss:120b"
                  />
                  <datalist id={`models-${draft.id}`}>
                    {MODEL_PRESETS.filter((preset) => !preset.kind || preset.kind === draft.kind).map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label}
                      </option>
                    ))}
                  </datalist>
                </>
              )}
            </Field>
            <Field label="API key" hint="Chỉ ghi khi cần đặt hoặc đổi key. Để trống = giữ nguyên key đã lưu.">
              {(id) => (
                <>
                  <TextInput
                    id={id}
                    type="password"
                    autoComplete="off"
                    value={draft.apiKey}
                    placeholder={draft.requiresKey ? (draft.hasKey ? '········ (đã lưu)' : 'dán key vào đây') : 'không cần key'}
                    disabled={!draft.requiresKey}
                    onChange={(event) => update(draft.id, { apiKey: event.target.value, keyTouched: true })}
                  />
                  <label className="display-menu__toggle">
                    <input
                      type="checkbox"
                      checked={!draft.requiresKey}
                      onChange={(event) => update(draft.id, { requiresKey: !event.target.checked })}
                    />
                    <span>Máy chủ nội bộ, không cần API key (ví dụ Ollama chạy local)</span>
                  </label>
                </>
              )}
            </Field>
            <Field label="Model chép lời (speech-to-text)" hint="Tuỳ chọn. Có thì Speaking mới chép lời được ở server.">
              {(id) => (
                <Select
                  id={id}
                  value={draft.sttModel}
                  onChange={(event) => update(draft.id, { sttModel: event.target.value })}
                >
                  <option value="">Không dùng</option>
                  {SPEECH_TO_TEXT_MODELS.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))}
                  {draft.sttModel && !SPEECH_TO_TEXT_MODELS.some((model) => model.id === draft.sttModel) ? (
                    <option value={draft.sttModel}>{draft.sttModel}</option>
                  ) : null}
                </Select>
              )}
            </Field>
          </div>

          <div className="provider-card__foot">
            <label className="display-menu__toggle">
              <input type="checkbox" checked={draft.enabled} onChange={(event) => update(draft.id, { enabled: event.target.checked })} />
              <span>Bật</span>
            </label>
            <label className="display-menu__toggle">
              <input
                type="checkbox"
                checked={draft.isDefault}
                onChange={(event) => update(draft.id, { isDefault: event.target.checked })}
              />
              <span>Mặc định</span>
            </label>
            <Button size="sm" variant="ghost" loading={testing === draft.id} onClick={() => void test(draft)}>
              Kiểm tra kết nối
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                if (!draft.id.startsWith('draft-')) {
                  // Deleting is a save without this provider; the confirm keeps it deliberate.
                  if (!window.confirm(`Xoá provider “${draft.label}”?`)) return;
                }
                const remaining = drafts.filter((item) => item.id !== draft.id);
                setDrafts(remaining.map((item, index) => ({ ...item, isDefault: item.isDefault || (index === 0 && !remaining.some((other) => other.isDefault)) })));
              }}
            >
              Xoá
            </Button>
            <span className="tiny muted" style={{ marginLeft: 'auto' }}>
              {draft.model ? `Model: ${draft.model}` : 'Chưa có model'}
            </span>
          </div>
        </div>
      ))}

      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <Button variant="primary" loading={saving} onClick={() => void save()} disabled={drafts.length === 0}>
          Lưu cấu hình AI
        </Button>
      </div>

      <Notice tone="info" title="Gợi ý dùng Ollama cloud">
        Base URL <span className="mono">https://ollama.com/v1</span>, key tạo tại ollama.com (Settings → Keys), model{' '}
        <span className="mono">gpt-oss:120b</span> cho chất lượng cao nhất hoặc <span className="mono">gemma3:27b</span>{' '}
        cho tốc độ. Có thể thêm nhiều key: mỗi provider là một dòng. Khi một provider bị giới hạn (429) hoặc từ chối key,
        hệ thống tự động thử provider đang bật tiếp theo — nên thêm ít nhất hai dòng nếu bạn có nhiều key.
      </Notice>
    </div>
  );
}
