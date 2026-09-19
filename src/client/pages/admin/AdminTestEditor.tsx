import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { QUESTION_TYPES, QUESTION_TYPE_META } from '@shared/question-types';
import type { QuestionType } from '@shared/question-types';
import { parseIntoEditableContent } from '@shared/import-convert';
import {
  SECTION_TYPES,
  SECTION_TYPE_META,
  defaultSectionTypeForSkill,
  isSectionType,
  type SectionType,
  type TranscriptSegment,
} from '@shared/sections';
import { api, describeError } from '../../lib/api';
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
  Modal,
  Notice,
  ProgressBar,
  Select,
  Tabs,
  TextArea,
  TextInput,
  useToast,
} from '../../components/ui';
import { formatDateTime, TEST_TYPE_LABELS } from '../../lib/format';
import {
  countAnswersForGroup,
  duplicateSection,
  emptyGroup,
  emptyQuestion,
  emptySection,
  moveItem,
  toEditable,
  type AdminVersionContentResponse,
  type EditableContent,
  type EditableGroup,
  type EditableQuestion,
  type EditableSection,
} from './content-types';

const SECTION_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  SECTION_TYPES.map((type) => [type, SECTION_TYPE_META[type].label]),
);

/** Reads the draft's section policy with platform defaults filled in. */
function resolvePolicyForDraft(draft: EditableContent): SectionPolicyConfig {
  const raw = (draft.config as { sectionPolicy?: Partial<SectionPolicyConfig> } | null)?.sectionPolicy ?? {};
  return {
    navigation: raw.navigation ?? 'FREE_NAVIGATION',
    allowReturnToPreviousParts: raw.allowReturnToPreviousParts ?? true,
    autoAdvanceOnPartTimeout: raw.autoAdvanceOnPartTimeout ?? false,
    requireAudioForListening: raw.requireAudioForListening ?? true,
    requirePassageForReading: raw.requirePassageForReading ?? true,
  };
}

interface SectionPolicyConfig {
  navigation: 'FREE_NAVIGATION' | 'SEQUENTIAL_PARTS' | 'LOCKED_PARTS';
  allowReturnToPreviousParts: boolean;
  autoAdvanceOnPartTimeout: boolean;
  requireAudioForListening: boolean;
  requirePassageForReading: boolean;
}

/** Section navigation/timing policy editor (34/39) — stored in version config. */
function SectionPolicyEditor({
  policy,
  readOnly,
  onChange,
}: {
  policy: SectionPolicyConfig;
  readOnly?: boolean;
  onChange: (policy: SectionPolicyConfig) => void;
}) {
  return (
    <div style={{ marginTop: 14 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="field__label">Section / part policy</span>
        <span className="tiny muted">Applies within each skill; the server enforces the timers.</span>
      </div>
      <div className="grid grid--2" style={{ marginTop: 8 }}>
        <Field label="Navigation" hint="Sequential parts advance in order; free navigation allows moving between all parts.">
          {(id) => (
            <Select
              id={id}
              value={policy.navigation}
              disabled={readOnly}
              onChange={(event) => {
                const navigation = event.target.value as SectionPolicyConfig['navigation'];
                onChange({
                  ...policy,
                  navigation,
                  allowReturnToPreviousParts:
                    navigation === 'LOCKED_PARTS' ? false : policy.allowReturnToPreviousParts,
                });
              }}
            >
              <option value="FREE_NAVIGATION">Free navigation (any part, any time)</option>
              <option value="SEQUENTIAL_PARTS">Sequential parts (advance in order)</option>
              <option value="LOCKED_PARTS">Locked parts (no return to earlier parts)</option>
            </Select>
          )}
        </Field>
        <div className="stack" style={{ gap: 6 }}>
          <Checkbox
            checked={policy.allowReturnToPreviousParts}
            disabled={readOnly || policy.navigation === 'LOCKED_PARTS'}
            label="May return to previous parts"
            onChange={(checked) => onChange({ ...policy, allowReturnToPreviousParts: checked })}
          />
          <Checkbox
            checked={policy.autoAdvanceOnPartTimeout}
            disabled={readOnly}
            label="Advance automatically when a part timer expires"
            onChange={(checked) => onChange({ ...policy, autoAdvanceOnPartTimeout: checked })}
          />
          <Checkbox
            checked={policy.requireAudioForListening}
            disabled={readOnly}
            label="Listening parts require audio before publish"
            onChange={(checked) => onChange({ ...policy, requireAudioForListening: checked })}
          />
          <Checkbox
            checked={policy.requirePassageForReading}
            disabled={readOnly}
            label="Reading sections require a passage before publish"
            onChange={(checked) => onChange({ ...policy, requirePassageForReading: checked })}
          />
        </div>
      </div>
    </div>
  );
}

function resolveSectionType(section: Pick<EditableSection, 'type' | 'skill'>): SectionType {
  if (typeof section.type === 'string' && isSectionType(section.type)) return section.type;
  return defaultSectionTypeForSkill(section.skill);
}

/**
 * Transcript editor: one segment per line as `mm:ss | Speaker | text`
 * (`mm:ss` and speaker optional). Segment ids are generated (`seg-N`) so
 * answer evidence can reference them (`segment:seg-3`).
 */
function TranscriptEditor({
  transcript,
  readOnly,
  onChange,
}: {
  transcript: { segments: TranscriptSegment[] } | null;
  readOnly?: boolean;
  onChange: (transcript: { segments: TranscriptSegment[] } | null) => void;
}) {
  const toLine = (segment: TranscriptSegment): string => {
    const time =
      segment.startSeconds !== null && segment.startSeconds !== undefined
        ? `${String(Math.floor(segment.startSeconds / 60)).padStart(2, '0')}:${String(segment.startSeconds % 60).padStart(2, '0')}`
        : '';
    return [time, segment.speaker ?? '', segment.text].map((part) => part.trim()).join(' | ');
  };
  const parseLine = (line: string, index: number): TranscriptSegment => {
    const parts = line.split('|').map((part) => part.trim());
    let startSeconds: number | null = null;
    let cursor = 0;
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(parts[0] ?? '')) {
      const [minutes, seconds] = (parts[0] ?? '0:0').split(':');
      startSeconds = Number(minutes) * 60 + Number(seconds);
      cursor = 1;
    }
    let speaker: string | null = null;
    if (parts.length > cursor + 1) {
      speaker = parts[cursor] || null;
      cursor += 1;
    }
    return {
      id: `seg-${index + 1}`,
      startSeconds,
      speaker,
      text: parts.slice(cursor).join(' | '),
    };
  };

  const lines = (transcript?.segments ?? []).map(toLine);
  return (
    <div className="stack">
      <Field
        label="Transcript (review material)"
        hint="One segment per line: `mm:ss | Speaker | text` — the timestamp and speaker are optional. Referenced from marking evidence as segment:seg-2."
      >
        {(id) => (
          <TextArea
            id={id}
            rows={5}
            spellCheck={false}
            disabled={readOnly}
            value={lines.join('\n')}
            placeholder={'00:05 | W: | Good morning, how can I help?\n00:12 | M: | I’d like to open an account…'}
            onChange={(event) => {
              const text = event.target.value;
              if (!text.trim()) {
                onChange(null);
                return;
              }
              onChange({
                segments: text
                  .split('\n')
                  .map((line) => line.trim())
                  .filter(Boolean)
                  .map(parseLine),
              });
            }}
          />
        )}
      </Field>
    </div>
  );
}

interface ValidationIssue {
  level: 'ERROR' | 'WARNING' | 'INFO';
  code: string;
  message: string;
  questionNumber?: number | null;
}

interface ValidationResult {
  publishable?: boolean;
  issues?: ValidationIssue[];
  errors?: number;
  warnings?: number;
  totalQuestions?: number;
  checkedAt?: string;
}

interface TestDetailResponse {
  test: {
    id: string;
    slug: string;
    title: string;
    type: string;
    status: string;
    summary: string;
    content_origin: string;
    source_title: string | null;
    source_url: string | null;
    attribution: string | null;
    license_notes: string | null;
    current_version_id: string | null;
    updated_at: string;
    requires_access_code: number;
    access_code_set_at: string | null;
  };
  versions: Array<{
    id: string;
    version_number: number;
    status: string;
    change_note: string;
    total_questions: number;
    duration_seconds: number | null;
    is_complete_test: number;
    published_at: string | null;
    created_at: string;
    updated_at: string;
    validation_json: string | null;
    published_by_email: string | null;
    attempt_count: number;
  }>;
}

export function AdminTestEditorPage() {
  const { testId = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [editingVersionId, setEditingVersionId] = useState<string | null>(null);
  const [previewVersionId, setPreviewVersionId] = useState<string | null>(null);
  const [editingMeta, setEditingMeta] = useState(false);

  const { data, loading, error, reload } = useAsync<TestDetailResponse>(
    () => api.get(`/api/admin/tests/${testId}`),
    [testId],
  );

  if (loading) return <Loading label="Loading test…" />;
  if (error) return <Notice tone="danger">{error}</Notice>;
  if (!data) return null;

  const { test, versions } = data;
  const currentVersion = versions.find((version) => version.id === test.current_version_id) ?? null;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <Link to="/admin/tests" className="small">
            ← All tests
          </Link>
          <h1>{test.title}</h1>
          <p className="page-head__meta">
            {test.slug} · {TEST_TYPE_LABELS[test.type] ?? test.type} · content origin{' '}
            {test.content_origin.replace(/_/g, ' ').toLowerCase()}
          </p>
        </div>
        <div className="row">
          <Badge tone={test.status === 'PUBLISHED' ? 'success' : test.status === 'REVIEW' ? 'warning' : test.status === 'ARCHIVED' ? 'dim' : 'neutral'}>
            {test.status.toLowerCase()}
          </Badge>
          <Button onClick={() => setEditingMeta(true)}>Edit metadata</Button>
          <ConfirmButton
            variant="danger"
            title={`Delete “${test.title}”?`}
            confirmLabel="Delete test"
            onConfirm={async () => {
              try {
                await api.delete(`/api/admin/tests/${testId}`);
                toast.push('Test deleted.', 'success');
                navigate('/admin/tests');
              } catch (deleteError) {
                toast.push(describeError(deleteError), 'error');
                throw deleteError;
              }
            }}
            body={
              <p>
                This permanently removes the test, every version, and every attempt on it. This cannot be undone.
              </p>
            }
          >
            Delete test
          </ConfirmButton>
          <ConfirmButton
            title="Create a new version"
            confirmLabel="Create version"
            variant="primary"
            onConfirm={async () => {
              const result = await api.post<{ versionId: string; versionNumber: number }>(
                `/api/admin/tests/${testId}/versions`,
                { changeNote: `Draft created from v${currentVersion?.version_number ?? 0}` },
              );
              await reload();
              setEditingVersionId(result.versionId);
              toast.push(`Version v${result.versionNumber} created as a draft.`, 'success');
            }}
            body={
              <p>
                The new version starts as a DRAFT and copies the content of the latest version. Published versions are
                immutable, so this is the only way to change a live test.
              </p>
            }
          >
            New version
          </ConfirmButton>
        </div>
      </div>

      <div className="grid grid--2">
        <Card title="Test summary">
          <p className="small">{test.summary || 'No summary yet.'}</p>
          <KeyValue
            items={[
              ['Questions in current version', currentVersion ? String(currentVersion.total_questions) : '—'],
              ['Duration', currentVersion?.duration_seconds ? `${Math.round(currentVersion.duration_seconds / 60)} minutes` : '—'],
              ['Complete test flag', currentVersion?.is_complete_test ? 'Yes' : 'No'],
              ['Versions', String(versions.length)],
            ]}
          />
        </Card>
        <Card title="Content provenance" hint="You remain responsible for the rights to this material.">
          <KeyValue
            items={[
              ['Origin', test.content_origin.replace(/_/g, ' ').toLowerCase()],
              ['Source title', test.source_title ?? '—'],
              ['Source URL', test.source_url ?? '—'],
              ['Attribution', test.attribution ?? '—'],
            ]}
          />
          {test.license_notes ? <p className="tiny muted">{test.license_notes}</p> : null}
        </Card>
      </div>

      <AccessCodeCard test={test} onChanged={reload} />

      <Card title="Versions" hint="Only DRAFT and REVIEW versions can be edited." flush>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Version</th>
                <th>Status</th>
                <th className="num">Questions</th>
                <th className="num">Attempts</th>
                <th>Validation</th>
                <th>Published</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {versions.map((version) => {
                const validation = parseValidation(version.validation_json);
                return (
                  <tr key={version.id}>
                    <td>
                      v{version.version_number}
                      <div className="tiny muted">{version.change_note}</div>
                    </td>
                    <td>
                      <Badge
                        tone={
                          version.status === 'PUBLISHED'
                            ? 'success'
                            : version.status === 'ARCHIVED'
                              ? 'warning'
                              : version.status === 'REVIEW'
                                ? 'accent'
                                : 'neutral'
                        }
                      >
                        {version.status.toLowerCase()}
                      </Badge>
                    </td>
                    <td className="num">{version.total_questions}</td>
                    <td className="num">{version.attempt_count}</td>
                    <td>
                      {validation ? (
                        <span className="tiny">
                          {validation.publishable ? 'Publishable' : 'Has errors'} · {validation.errors ?? 0} errors ·{' '}
                          {validation.warnings ?? 0} warnings
                        </span>
                      ) : (
                        <span className="tiny muted">Not checked</span>
                      )}
                    </td>
                    <td className="nowrap">
                      {version.published_at ? formatDateTime(version.published_at) : '—'}
                      {version.published_by_email ? <div className="tiny muted">{version.published_by_email}</div> : null}
                    </td>
                    <td className="right">
                      <div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        <Button size="sm" onClick={() => setPreviewVersionId(version.id)}>
                          Preview
                        </Button>
                        <Button
                          size="sm"
                          onClick={async () => {
                            try {
                              const result = await api.post<ValidationResult>(
                                `/api/admin/versions/${version.id}/validate`,
                              );
                              await reload();
                              toast.push(
                                result.publishable
                                  ? `v${version.version_number} is publishable (${result.warnings ?? 0} warnings).`
                                  : `v${version.version_number} has ${result.errors ?? 0} blocking errors.`,
                                result.publishable ? 'success' : 'warning',
                              );
                            } catch (validateError) {
                              toast.push(describeError(validateError), 'error');
                            }
                          }}
                        >
                          Validate
                        </Button>
                        {version.status === 'DRAFT' || version.status === 'REVIEW' ? (
                          <Button size="sm" variant="primary" onClick={() => setEditingVersionId(version.id)}>
                            Edit content
                          </Button>
                        ) : null}
                        {version.status !== 'PUBLISHED' && version.status !== 'ARCHIVED' ? (
                          <ConfirmButton
                            size="sm"
                            variant="primary"
                            title={`Publish v${version.version_number}?`}
                            confirmLabel="Publish"
                            onConfirm={async () => {
                              try {
                                const result = await api.post<{ warnings: number }>(
                                  `/api/admin/versions/${version.id}/publish`,
                                  {},
                                );
                                await reload();
                                toast.push(`v${version.version_number} published (${result.warnings} warnings).`, 'success');
                              } catch (publishError) {
                                toast.push(describeError(publishError), 'error');
                              }
                            }}
                            body={
                              <p>
                                Publishing freezes this exact content, archives the previously published version and makes
                                the test available to assign. Answer keys are never sent to candidates.
                              </p>
                            }
                          >
                            Publish
                          </ConfirmButton>
                        ) : null}
                        {version.status === 'PUBLISHED' ? (
                          <ConfirmButton
                            size="sm"
                            variant="danger"
                            title="Unpublish this version?"
                            confirmLabel="Unpublish"
                            onConfirm={async () => {
                              await api.post(`/api/admin/versions/${version.id}/unpublish`, {});
                              await reload();
                            }}
                            body={<p>The version is archived. Attempts already taken keep their original content.</p>}
                          >
                            Unpublish
                          </ConfirmButton>
                        ) : null}
                        <ConfirmButton
                          size="sm"
                          title={`Clone v${version.version_number}?`}
                          confirmLabel="Clone"
                          onConfirm={async () => {
                            const result = await api.post<{ versionId: string; versionNumber: number }>(
                              `/api/admin/versions/${version.id}/clone`,
                              {},
                            );
                            await reload();
                            setEditingVersionId(result.versionId);
                            toast.push(`v${result.versionNumber} created as a copy.`, 'success');
                          }}
                          body={<p>Creates a new editable draft containing a copy of this version's content.</p>}
                        >
                          Clone
                        </ConfirmButton>
                        <ConfirmButton
                          size="sm"
                          variant="danger"
                          title={`Delete v${version.version_number}?`}
                          confirmLabel="Delete version"
                          onConfirm={async () => {
                            try {
                              const result = await api.delete<{ testDeleted?: boolean }>(
                                `/api/admin/versions/${version.id}`,
                              );
                              toast.push(
                                result.testDeleted
                                  ? 'Last version removed — the test was deleted.'
                                  : `v${version.version_number} deleted.`,
                                'success',
                              );
                              if (result.testDeleted) {
                                navigate('/admin/tests');
                                return;
                              }
                              await reload();
                            } catch (deleteError) {
                              toast.push(describeError(deleteError), 'error');
                              throw deleteError;
                            }
                          }}
                          body={
                            <p>
                              This permanently removes this version and any attempts taken on it. If it is the last
                              version, the whole test is deleted.
                            </p>
                          }
                        >
                          Delete
                        </ConfirmButton>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {versions.length === 0 ? <EmptyState title="No versions" /> : null}
      </Card>

      <Modal
        open={editingMeta}
        title="Test metadata"
        onClose={() => setEditingMeta(false)}
        actions={<Button onClick={() => setEditingMeta(false)}>Close</Button>}
      >
        <TestMetaForm
          test={data.test}
          onSaved={async () => {
            await reload();
            setEditingMeta(false);
            toast.push('Test metadata updated.', 'success');
          }}
          onError={(message) => toast.push(message, 'error')}
        />
      </Modal>

      <Modal
        open={Boolean(previewVersionId)}
        wide
        title="Candidate preview (no answer keys)"
        onClose={() => setPreviewVersionId(null)}
        actions={<Button onClick={() => setPreviewVersionId(null)}>Close</Button>}
      >
        {previewVersionId ? <VersionPreview versionId={previewVersionId} /> : null}
      </Modal>

      {editingVersionId ? (
        <VersionContentEditor
          versionId={editingVersionId}
          testType={test.type}
          onClose={() => setEditingVersionId(null)}
          onSaved={reload}
        />
      ) : null}
    </div>
  );
}

function parseValidation(raw: string | null): ValidationResult | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ValidationResult;
  } catch {
    return null;
  }
}

function TestMetaForm({
  test,
  onSaved,
  onError,
}: {
  test: TestDetailResponse['test'];
  onSaved: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [form, setForm] = useState({
    title: test.title,
    summary: test.summary,
    contentOrigin: test.content_origin,
    sourceTitle: test.source_title ?? '',
    sourceUrl: test.source_url ?? '',
    attribution: test.attribution ?? '',
    licenseNotes: test.license_notes ?? '',
  });

  return (
    <div>
      <Field label="Title" required>
        {(id) => <TextInput id={id} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />}
      </Field>
      <Field label="Summary">
        {(id) => <TextArea id={id} value={form.summary} onChange={(event) => setForm({ ...form, summary: event.target.value })} />}
      </Field>
      <Field label="Content origin">
        {(id) => (
          <Select id={id} value={form.contentOrigin} onChange={(event) => setForm({ ...form, contentOrigin: event.target.value })}>
            <option value="ORIGINAL">Original</option>
            <option value="LICENSED">Licensed</option>
            <option value="AI_GENERATED">AI generated (reviewed)</option>
            <option value="IMPORTED">Imported</option>
            <option value="OFFICIAL_PROVIDER">Official provider material</option>
          </Select>
        )}
      </Field>
      <Field label="Source title">{(id) => <TextInput id={id} value={form.sourceTitle} onChange={(event) => setForm({ ...form, sourceTitle: event.target.value })} />}</Field>
      <Field label="Source URL">{(id) => <TextInput id={id} value={form.sourceUrl} onChange={(event) => setForm({ ...form, sourceUrl: event.target.value })} />}</Field>
      <Field label="Attribution">{(id) => <TextInput id={id} value={form.attribution} onChange={(event) => setForm({ ...form, attribution: event.target.value })} />}</Field>
      <Field label="Licence notes">
        {(id) => <TextArea id={id} value={form.licenseNotes} onChange={(event) => setForm({ ...form, licenseNotes: event.target.value })} />}
      </Field>
      <Button
        variant="primary"
        onClick={async () => {
          try {
            await api.patch(`/api/admin/tests/${test.id}`, {
              title: form.title,
              summary: form.summary,
              contentOrigin: form.contentOrigin,
              sourceTitle: form.sourceTitle || null,
              sourceUrl: form.sourceUrl || null,
              attribution: form.attribution || null,
              licenseNotes: form.licenseNotes || null,
            });
            await onSaved();
          } catch (metaError) {
            onError(describeError(metaError));
          }
        }}
      >
        Save metadata
      </Button>
    </div>
  );
}

/** Client-side random code, same alphabet as server classroom codes. */
function generateAccessCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

function AccessCodeCard({
  test,
  onChanged,
}: {
  test: TestDetailResponse['test'];
  onChanged: () => Promise<void>;
}) {
  const toast = useToast();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [justSet, setJustSet] = useState<string | null>(null);
  const locked = test.requires_access_code === 1;

  const save = async () => {
    setBusy(true);
    try {
      await api.post(`/api/admin/tests/${test.id}/access-code`, { code });
      setJustSet(code.trim().toUpperCase());
      setCode('');
      await onChanged();
      toast.push('Access code saved. Share it with your students.', 'success');
    } catch (saveError) {
      toast.push(describeError(saveError), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="Student access code"
      hint="Optional. When set, students must enter this code once before they can practise this test."
    >
      <div className="row" style={{ marginBottom: 12 }}>
        {locked ? (
          <Badge tone="warning">🔒 Code required{test.access_code_set_at ? ` · set ${formatDateTime(test.access_code_set_at)}` : ''}</Badge>
        ) : (
          <Badge tone="neutral">Open to all students</Badge>
        )}
      </div>
      {justSet ? (
        <Notice tone="success" title="Current code — copy it now">
          <span className="mono" style={{ fontSize: '1.1rem', letterSpacing: '0.08em' }}>
            {justSet}
          </span>
          <div className="tiny" style={{ marginTop: 6 }}>
            Only the hash is stored, so this code cannot be viewed again later — setting a new code replaces it.
          </div>
        </Notice>
      ) : null}
      <div style={{ height: 12 }} />
      <Field label={locked ? 'Replace code' : 'New code'} hint="4–32 characters, case-insensitive. Saving revokes all previous unlocks.">
        {(id) => (
          <div className="row">
            <TextInput
              id={id}
              value={code}
              autoComplete="off"
              placeholder="e.g. READING-01"
              onChange={(event) => setCode(event.target.value)}
              disabled={busy}
            />
            <Button disabled={busy} onClick={() => setCode(generateAccessCode())}>
              Generate
            </Button>
            <Button variant="primary" disabled={busy || code.trim().length < 4} onClick={() => void save()}>
              {busy ? 'Saving…' : locked ? 'Replace code' : 'Set code'}
            </Button>
            {locked ? (
              <ConfirmButton
                title="Remove access code"
                confirmLabel="Remove code"
                body={<p>Students will be able to practise this test without a code. Previous unlocks are discarded.</p>}
                onConfirm={async () => {
                  try {
                    await api.delete(`/api/admin/tests/${test.id}/access-code`);
                    setJustSet(null);
                    await onChanged();
                    toast.push('Access code removed.', 'success');
                  } catch (clearError) {
                    toast.push(describeError(clearError), 'error');
                  }
                }}
              >
                Remove
              </ConfirmButton>
            ) : null}
          </div>
        )}
      </Field>
    </Card>
  );
}

interface CandidatePreview {
  preview: boolean;
  test: {
    title: string;
    type: string;
    sections: Array<{
      skill: string;
      title: string;
      instructions: string;
      durationSeconds: number | null;
      passage: { title: string; paragraphs: Array<{ label: string; text: string }> } | null;
      groups: Array<{
        type: string;
        instructions: string;
        sharedOptions: Array<{ id: string; text: string }>;
        questions: Array<{ number: number; prompt: string; options: Array<{ id: string; text: string }> }>;
      }>;
    }>;
  };
}

function VersionPreview({ versionId }: { versionId: string }) {
  const { data, loading, error } = useAsync<CandidatePreview>(
    () => api.get(`/api/admin/versions/${versionId}/preview`),
    [versionId],
  );
  if (loading) return <Loading label="Building candidate payload…" />;
  if (error) return <Notice tone="danger">{error}</Notice>;
  if (!data) return null;

  return (
    <div className="stack">
      <Notice tone="info" title="This is exactly what a candidate can see">
        The payload contains no answer keys, evidence or explanations.
      </Notice>
      {data.test.sections.map((section, sectionIndex) => (
        <Card key={`${section.title}-${sectionIndex}`} title={section.title || `Section ${sectionIndex + 1}`} hint={section.instructions}>
          {section.passage ? (
            <details>
              <summary>{section.passage.title} ({section.passage.paragraphs.length} paragraphs)</summary>
              {section.passage.paragraphs.map((paragraph) => (
                <p key={paragraph.label}>
                  <strong>{paragraph.label}</strong> {paragraph.text}
                </p>
              ))}
            </details>
          ) : null}
          {section.groups.map((group, groupIndex) => (
            <div key={`${group.type}-${groupIndex}`} style={{ marginTop: 12 }}>
              <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                <Badge tone="accent">{QUESTION_TYPE_META[group.type as QuestionType]?.label ?? group.type}</Badge>
                <span className="tiny muted">{group.questions.length} questions</span>
              </div>
              <ol className="stack" style={{ marginTop: 8, paddingLeft: 18 }}>
                {group.questions.map((question) => (
                  <li key={question.number}>
                    <span className="tiny muted">#{question.number}</span> {question.prompt}
                    {question.options.length > 0 ? (
                      <div className="tiny muted">{question.options.map((option) => `${option.id}. ${option.text}`).join('  ·  ')}</div>
                    ) : null}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Content editor
// ---------------------------------------------------------------------------
function VersionContentEditor({
  versionId,
  testType,
  onClose,
  onSaved,
}: {
  versionId: string;
  testType: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { data, loading, error, reload } = useAsync<AdminVersionContentResponse>(
    () => api.get(`/api/admin/versions/${versionId}`),
    [versionId],
  );

  if (loading) return <Loading label="Loading version content…" />;
  if (error) return <Notice tone="danger">{error}</Notice>;
  if (!data) return null;

  // Keying by version id means a freshly loaded tree becomes the editor's
  // initial state exactly once, with no state syncing in an effect.
  return (
    <VersionEditorBody
      key={data.version.id}
      data={data}
      versionId={versionId}
      testType={testType}
      reload={reload}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}

function VersionEditorBody({
  data,
  versionId,
  testType,
  reload,
  onClose,
  onSaved,
}: {
  data: AdminVersionContentResponse;
  versionId: string;
  testType: string;
  reload: () => Promise<void>;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState<EditableContent>(() => toEditable(data));
  const [tab, setTab] = useState<'outline' | 'json'>('outline');
  const [jsonText, setJsonText] = useState(() => JSON.stringify(toEditable(data), null, 2));
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [saving, setSaving] = useState(false);
  const scoringProfiles = useAsync<{
    profiles: Array<{ id: string; name: string; skill: string; status: string; version: number }>;
  }>(() => api.get('/api/admin/scoring-profiles'), []);
  const mockVersionList = useAsync<{
    tests: Array<{ id: string; title: string; type: string; current_version_id: string | null }>;
  }>(() => api.get('/api/admin/tests'), [], { immediate: testType === 'FULL_MOCK' });

  const mockOptions = (mockVersionList.data?.tests ?? [])
    .filter((test) => test.current_version_id && test.id !== data.test.id)
    .map((test) => ({ id: test.current_version_id as string, title: test.title, type: test.type }));

  const readOnly = !data.editable;
  const questionTotal = draft.sections.reduce(
    (total, section) => total + section.groups.reduce((sum, group) => sum + countAnswersForGroup(group), 0),
    0,
  );

  const updateSection = (index: number, patch: Partial<EditableSection>) =>
    setDraft({ ...draft, sections: draft.sections.map((section, i) => (i === index ? { ...section, ...patch } : section)) });

  const updateGroup = (sectionIndex: number, groupIndex: number, patch: Partial<EditableGroup>) =>
    updateSection(sectionIndex, {
      groups: draft.sections[sectionIndex]!.groups.map((group, i) => (i === groupIndex ? { ...group, ...patch } : group)),
    });

  const updateQuestion = (
    sectionIndex: number,
    groupIndex: number,
    questionIndex: number,
    patch: Partial<EditableQuestion>,
  ) =>
    updateGroup(sectionIndex, groupIndex, {
      questions: draft.sections[sectionIndex]!.groups[groupIndex]!.questions.map((question, i) =>
        i === questionIndex ? { ...question, ...patch } : question,
      ),
    });

  const save = async () => {
    setSaving(true);
    try {
      const pasted = tab === 'json' ? JSON.parse(jsonText) : draft;
      // The JSON tab accepts the documented import formats as well as the
      // platform content schema; anything in an import format is converted
      // first, so the server never receives a tree it would have to reject.
      const { content: payload, issues, converted } = parseIntoEditableContent(pasted);
      const fatal = issues.find((issue) => issue.level === 'ERROR');
      if (payload.sections.length === 0) {
        toast.push(fatal?.message ?? 'The payload contains no sections to save.', 'error');
        return;
      }
      if (converted) {
        setDraft(payload);
        setJsonText(JSON.stringify(payload, null, 2));
        toast.push('Import format converted to the platform content schema.', 'success');
      }
      const result = await api.put<{ totalQuestions: number; validation: ValidationResult }>(
        `/api/admin/versions/${versionId}/content`,
        payload,
      );
      setValidation(result.validation);
      setDraft(payload);
      setJsonText(JSON.stringify(payload, null, 2));
      await reload();
      await onSaved();
      toast.push(`Saved ${result.totalQuestions} questions.`, 'success');
    } catch (saveError) {
      toast.push(describeError(saveError), 'error');
    } finally {
      setSaving(false);
    }
  };

  const audioAssets = data.assets.filter((asset) => asset.kind === 'AUDIO');

  return (
    <Modal open title={`Edit v${data.version.versionNumber} content`} wide onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" loading={saving} disabled={readOnly} onClick={save}>
            Save content
          </Button>
        </>
      }
    >
      {readOnly ? (
        <Notice tone="warning" title={`v${data.version.versionNumber} is ${data.version.status.toLowerCase()}`}>
          Published and archived versions are immutable because attempts reference them. Create a new version to make
          changes.
        </Notice>
      ) : null}

      <div className="row row--between" style={{ margin: '10px 0' }}>
        <div className="row" style={{ gap: 10, alignItems: 'center' }}>
          <Badge tone={questionTotal > 0 ? 'accent' : 'danger'}>{questionTotal} questions in tree</Badge>
          <span className="tiny muted">Attempts on this version: {data.attemptCount}</span>
        </div>
        <Tabs
          tabs={[
            { id: 'outline', label: 'Outline' },
            { id: 'json', label: 'JSON' },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>

      {validation ? (
        <Notice tone={validation.publishable ? 'success' : 'danger'} title={validation.publishable ? 'Validation passed' : 'Validation problems'}>
          <ul style={{ margin: '6px 0 0 18px' }}>
            {(validation.issues ?? []).slice(0, 12).map((issue, index) => (
              <li key={`${issue.code}-${index}`}>
                [{issue.level}] {issue.questionNumber ? `Q${issue.questionNumber}: ` : ''}
                {issue.message}
              </li>
            ))}
          </ul>
          {(validation.issues ?? []).length === 0 ? <span>No issues found.</span> : null}
        </Notice>
      ) : null}

      {tab === 'json' ? (
        <div className="stack">
          <p className="small muted">
            Paste or edit the structured payload directly. The platform content schema and the documented import formats
            (the ones Admin → Imports accepts, e.g. <code>docs/samples/full-test.json</code>) both work: import formats
            are converted when you press <strong>Parse into outline</strong> or <strong>Save content</strong>.
          </p>
          <TextArea
            value={jsonText}
            rows={24}
            spellCheck={false}
            onChange={(event) => setJsonText(event.target.value)}
            style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}
          />
          <Button
            onClick={() => {
              let parsed: unknown;
              try {
                parsed = JSON.parse(jsonText);
              } catch (jsonError) {
                toast.push(describeError(jsonError), 'error');
                return;
              }
              const { content, issues, converted } = parseIntoEditableContent(parsed);
              const errors = issues.filter((issue) => issue.level === 'ERROR');
              if (content.sections.length === 0) {
                toast.push(errors[0]?.message ?? 'This payload contains no sections.', 'error');
                return;
              }
              setDraft(content);
              setJsonText(JSON.stringify(content, null, 2));
              if (errors.length > 0) {
                toast.push(
                  `Parsed into the editor with ${errors.length} validation problem${errors.length === 1 ? '' : 's'} — review before saving.`,
                  'warning',
                );
              } else {
                toast.push(converted ? 'Import format parsed into the editor.' : 'JSON parsed into the editor.', 'success');
              }
            }}
          >
            Parse into outline
          </Button>
        </div>
      ) : (
        <div className="stack">
          <Card title="Version settings">
            <div className="grid grid--3">
              <Field label="Total duration (seconds)">
                {(id) => (
                  <TextInput
                    id={id}
                    type="number"
                    min={60}
                    value={draft.durationSeconds ?? ''}
                    disabled={readOnly}
                    onChange={(event) =>
                      setDraft({ ...draft, durationSeconds: event.target.value ? Number(event.target.value) : null })
                    }
                  />
                )}
              </Field>
              <Field
                label="Scoring profile"
                hint="Default Reading and Listening tables are created automatically. Writing is marked by a teacher."
              >
                {(id) => (
                  <Select
                    id={id}
                    value={draft.scoringProfileId ?? ''}
                    disabled={readOnly}
                    onChange={(event) => setDraft({ ...draft, scoringProfileId: event.target.value || null })}
                  >
                    <option value="">None — raw score only</option>
                    {(scoringProfiles.data?.profiles ?? [])
                      .filter((profile) => profile.status === 'ACTIVE')
                      .map((profile) => (
                        <option key={profile.id} value={profile.id}>
                          {profile.name} · {profile.skill.toLowerCase()} v{profile.version}
                        </option>
                      ))}
                  </Select>
                )}
              </Field>
              <div className="field">
                <span className="field__label">Flags</span>
                <Checkbox
                  checked={Boolean(draft.isCompleteTest)}
                  disabled={readOnly}
                  onChange={(checked) => setDraft({ ...draft, isCompleteTest: checked })}
                  label="Full-length complete test (eligible for band estimation)"
                />
              </div>
            </div>
            <SectionPolicyEditor
              policy={resolvePolicyForDraft(draft)}
              readOnly={readOnly}
              onChange={(policy) =>
                setDraft({ ...draft, config: { ...(draft.config ?? {}), sectionPolicy: policy } })
              }
            />
          </Card>

          {draft.sections.map((section, sectionIndex) => {
            const sectionTypeName = SECTION_TYPE_LABELS[resolveSectionType(section)] ?? section.skill;
            const sectionQuestionCount = section.groups.reduce((sum, group) => sum + countAnswersForGroup(group), 0);
            return (
            <Card
              key={`section-${sectionIndex}`}
              title={`${sectionIndex + 1}. ${section.label || section.title || '(untitled section)'}`}
              hint={`${sectionTypeName} · ${section.skill} · ${section.groups.length} group${section.groups.length === 1 ? '' : 's'} · ${sectionQuestionCount} questions`}
              actions={
                <div className="row" style={{ gap: 6 }}>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={readOnly || sectionIndex === 0}
                    aria-label="Move section up"
                    title="Move up"
                    onClick={() =>
                      setDraft({ ...draft, sections: moveItem(draft.sections, sectionIndex, -1) })
                    }
                  >
                    ↑
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={readOnly || sectionIndex === draft.sections.length - 1}
                    aria-label="Move section down"
                    title="Move down"
                    onClick={() =>
                      setDraft({ ...draft, sections: moveItem(draft.sections, sectionIndex, 1) })
                    }
                  >
                    ↓
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={readOnly}
                    title="Duplicate this section with all its groups and questions"
                    onClick={() => {
                      const next = [...draft.sections];
                      next.splice(sectionIndex + 1, 0, duplicateSection(section));
                      setDraft({ ...draft, sections: next });
                    }}
                  >
                    Duplicate
                  </Button>
                  <ConfirmButton
                    size="sm"
                    variant="ghost"
                    title={`Delete “${section.label || section.title || `section ${sectionIndex + 1}`}”?`}
                    confirmLabel="Delete section"
                    body={
                      <p className="small">
                        This removes the section and all of its question groups, questions and answer keys from the
                        draft. The change is only stored once you press <strong>Save content</strong>.
                      </p>
                    }
                    onConfirm={() =>
                      setDraft({ ...draft, sections: draft.sections.filter((_, index) => index !== sectionIndex) })
                    }
                  >
                    Delete
                  </ConfirmButton>
                </div>
              }
            >
              <div className="grid grid--3">
                <Field label="Skill" hint={`Structural type: ${sectionTypeName}`}>
                  {(id) => (
                    <Select
                      id={id}
                      value={section.skill}
                      disabled={readOnly}
                      onChange={(event) => {
                        const skill = event.target.value as EditableSection['skill'];
                        updateSection(sectionIndex, { skill, type: defaultSectionTypeForSkill(skill) });
                      }}
                    >
                      <option value="READING">Reading</option>
                      <option value="LISTENING">Listening</option>
                      <option value="WRITING">Writing</option>
                    </Select>
                  )}
                </Field>
                <Field label="Label" hint="Shown in exam navigation, e.g. “Passage 2” or “Part 3”.">
                  {(id) => (
                    <TextInput
                      id={id}
                      value={section.label ?? ''}
                      placeholder={`${SECTION_TYPE_LABELS[resolveSectionType(section)]} ${sectionIndex + 1}`}
                      disabled={readOnly}
                      onChange={(event) => updateSection(sectionIndex, { label: event.target.value || null })}
                    />
                  )}
                </Field>
                <Field label="Title">
                  {(id) => (
                    <TextInput id={id} value={section.title} disabled={readOnly} onChange={(event) => updateSection(sectionIndex, { title: event.target.value })} />
                  )}
                </Field>
                <Field label="Duration (seconds)" hint="Optional per-part timer; enforcement depends on the section policy.">
                  {(id) => (
                    <TextInput
                      id={id}
                      type="number"
                      value={section.durationSeconds ?? ''}
                      disabled={readOnly}
                      onChange={(event) => updateSection(sectionIndex, { durationSeconds: event.target.value ? Number(event.target.value) : null })}
                    />
                  )}
                </Field>
                <div style={{ gridColumn: 'span 2' }}>
                  <Field label="Description" hint="One line shown to candidates under the section label.">
                    {(id) => (
                      <TextInput
                        id={id}
                        value={section.description ?? ''}
                        disabled={readOnly}
                        onChange={(event) => updateSection(sectionIndex, { description: event.target.value || null })}
                      />
                    )}
                  </Field>
                </div>
              </div>
              <Field label="Section instructions">
                {(id) => (
                  <TextArea id={id} rows={2} value={section.instructions} disabled={readOnly} onChange={(event) => updateSection(sectionIndex, { instructions: event.target.value })} />
                )}
              </Field>

              {section.skill === 'LISTENING' || section.audioAssetId || section.audioUrl ? (
                <div className="stack">
                  <Field
                    label="Audio URL"
                    hint="Paste an HTTPS link. Saving the content attaches it to this section automatically."
                  >
                    {(id) => (
                      <TextInput
                        id={id}
                        type="url"
                        value={section.audioUrl ?? ''}
                        disabled={readOnly}
                        placeholder="https://cdn.example.com/listening/section-1.mp3"
                        onChange={(event) =>
                          updateSection(sectionIndex, {
                            audioUrl: event.target.value || null,
                            audioAssetId: event.target.value ? event.target.value : section.audioAssetId,
                          })
                        }
                      />
                    )}
                  </Field>
                  <div className="grid grid--2">
                    <Field label="Audio asset">
                      {(id) => (
                        <Select
                          id={id}
                          value={section.audioAssetId && !section.audioAssetId.startsWith('http') ? section.audioAssetId : ''}
                          disabled={readOnly}
                          onChange={(event) =>
                            updateSection(sectionIndex, { audioAssetId: event.target.value || null, audioUrl: null })
                          }
                        >
                          <option value="">No audio attached</option>
                          {section.audioAssetId &&
                          !section.audioAssetId.startsWith('http') &&
                          !audioAssets.some((asset) => asset.id === section.audioAssetId) ? (
                            <option value={section.audioAssetId}>Newly linked audio</option>
                          ) : null}
                          {audioAssets.map((asset) => (
                            <option key={asset.id} value={asset.id}>
                              {asset.filename} {asset.duration_seconds ? `(${Math.round(asset.duration_seconds)}s)` : ''}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                    <AudioUpload
                      versionId={versionId}
                      disabled={readOnly}
                      onUploaded={(assetId) => {
                        if (assetId) updateSection(sectionIndex, { audioAssetId: assetId, audioUrl: null });
                      }}
                    />
                  </div>
                </div>
              ) : null}

              {section.skill === 'LISTENING' ? (
                <div className="grid grid--4">
                  <Field label="Max plays">
                    {(id) => (
                      <TextInput
                        id={id}
                        type="number"
                        min={1}
                        max={10}
                        value={section.playback?.maxPlays ?? ''}
                        disabled={readOnly}
                        onChange={(event) =>
                          updateSection(sectionIndex, {
                            playback: { ...section.playback, maxPlays: event.target.value ? Number(event.target.value) : undefined },
                          })
                        }
                      />
                    )}
                  </Field>
                  <Field label="Prep seconds">
                    {(id) => (
                      <TextInput
                        id={id}
                        type="number"
                        min={0}
                        value={section.playback?.prepSeconds ?? ''}
                        disabled={readOnly}
                        onChange={(event) =>
                          updateSection(sectionIndex, {
                            playback: { ...section.playback, prepSeconds: event.target.value ? Number(event.target.value) : undefined },
                          })
                        }
                      />
                    )}
                  </Field>
                  <div className="field">
                    <span className="field__label">Pause allowed</span>
                    <Checkbox
                      checked={Boolean(section.playback?.allowPause)}
                      disabled={readOnly}
                      onChange={(checked) => updateSection(sectionIndex, { playback: { ...section.playback, allowPause: checked } })}
                      label="Candidates may pause"
                    />
                  </div>
                  <div className="field">
                    <span className="field__label">Seeking</span>
                    <Checkbox
                      checked={Boolean(section.playback?.allowSeekAfterPlay)}
                      disabled={readOnly}
                      onChange={(checked) => updateSection(sectionIndex, { playback: { ...section.playback, allowSeekAfterPlay: checked } })}
                      label="May seek after first play"
                    />
                  </div>
                </div>
              ) : null}

              {section.skill === 'READING' ? (
                <div className="stack">
                  <div className="grid grid--2">
                    <Field label="Passage title">
                      {(id) => (
                        <TextInput
                          id={id}
                          value={section.passage?.title ?? ''}
                          disabled={readOnly}
                          onChange={(event) =>
                            updateSection(sectionIndex, {
                              passage: {
                                title: event.target.value,
                                subtitle: section.passage?.subtitle ?? null,
                                paragraphs: section.passage?.paragraphs ?? [],
                              },
                            })
                          }
                        />
                      )}
                    </Field>
                    <Field label="Passage subtitle">
                      {(id) => (
                        <TextInput
                          id={id}
                          value={section.passage?.subtitle ?? ''}
                          disabled={readOnly}
                          onChange={(event) =>
                            updateSection(sectionIndex, {
                              passage: {
                                title: section.passage?.title ?? '',
                                subtitle: event.target.value || null,
                                paragraphs: section.passage?.paragraphs ?? [],
                              },
                            })
                          }
                        />
                      )}
                    </Field>
                  </div>
                  {(section.passage?.paragraphs ?? []).map((paragraph, paragraphIndex) => (
                    <div key={`p-${sectionIndex}-${paragraphIndex}`} className="row" style={{ alignItems: 'flex-start', gap: 8 }}>
                      <TextInput
                        style={{ width: 64 }}
                        value={paragraph.label}
                        disabled={readOnly}
                        aria-label="Paragraph label"
                        onChange={(event) =>
                          updateSection(sectionIndex, {
                            passage: {
                              title: section.passage?.title ?? '',
                              subtitle: section.passage?.subtitle ?? null,
                              paragraphs: (section.passage?.paragraphs ?? []).map((item, index) =>
                                index === paragraphIndex ? { ...item, label: event.target.value } : item,
                              ),
                            },
                          })
                        }
                      />
                      <TextArea
                        rows={3}
                        value={paragraph.text}
                        disabled={readOnly}
                        aria-label="Paragraph text"
                        onChange={(event) =>
                          updateSection(sectionIndex, {
                            passage: {
                              title: section.passage?.title ?? '',
                              subtitle: section.passage?.subtitle ?? null,
                              paragraphs: (section.passage?.paragraphs ?? []).map((item, index) =>
                                index === paragraphIndex ? { ...item, text: event.target.value } : item,
                              ),
                            },
                          })
                        }
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={readOnly}
                        onClick={() =>
                          updateSection(sectionIndex, {
                            passage: {
                              title: section.passage?.title ?? '',
                              subtitle: section.passage?.subtitle ?? null,
                              paragraphs: (section.passage?.paragraphs ?? []).filter((_, index) => index !== paragraphIndex),
                            },
                          })
                        }
                      >
                        ×
                      </Button>
                    </div>
                  ))}
                  <Button
                    size="sm"
                    disabled={readOnly}
                    onClick={() =>
                      updateSection(sectionIndex, {
                        passage: {
                          title: section.passage?.title ?? '',
                          subtitle: section.passage?.subtitle ?? null,
                          paragraphs: [
                            ...(section.passage?.paragraphs ?? []),
                            { label: String.fromCharCode(65 + (section.passage?.paragraphs.length ?? 0)), text: '' },
                          ],
                        },
                      })
                    }
                  >
                    Add paragraph
                  </Button>
                </div>
              ) : null}

              {section.skill === 'LISTENING' || section.transcript ? (
                <TranscriptEditor
                  transcript={section.transcript ?? null}
                  readOnly={readOnly}
                  onChange={(transcript) => updateSection(sectionIndex, { transcript })}
                />
              ) : null}

              {section.skill !== 'WRITING' ? (
                <Field
                  label="Section image URL (optional)"
                  hint="Diagram or chart shown with this section. Saving the content attaches the HTTPS link automatically."
                >
                  {(id) => (
                    <TextInput
                      id={id}
                      type="url"
                      value={section.imageUrl ?? (section.imageAssetId ? `asset:${section.imageAssetId}` : '')}
                      disabled={readOnly}
                      placeholder="https://cdn.example.com/diagram.png"
                      onChange={(event) =>
                        updateSection(sectionIndex, {
                          imageUrl: event.target.value || null,
                          imageAssetId: event.target.value ? section.imageAssetId : null,
                        })
                      }
                    />
                  )}
                </Field>
              ) : null}

              <div className="stack" style={{ marginTop: 14 }}>
                {section.groups.map((group, groupIndex) => (
                  <GroupEditor
                    key={`group-${sectionIndex}-${groupIndex}`}
                    group={group}
                    readOnly={readOnly}
                    onChange={(patch) => updateGroup(sectionIndex, groupIndex, patch)}
                    onRemove={() =>
                      updateSection(sectionIndex, {
                        groups: section.groups.filter((_, index) => index !== groupIndex),
                      })
                    }
                    onMove={(direction) =>
                      updateSection(sectionIndex, { groups: moveItem(section.groups, groupIndex, direction) })
                    }
                    onDuplicate={() => {
                      const next = [...section.groups];
                      next.splice(groupIndex + 1, 0, {
                        ...group,
                        config: { ...group.config },
                        sharedOptions: group.sharedOptions.map((option) => ({ ...option })),
                        questions: group.questions.map((question) => ({
                          ...question,
                          options: question.options.map((option) => ({ ...option })),
                          config: { ...question.config },
                          answerKey: question.answerKey
                            ? question.answerKey.kind === 'CHOICE'
                              ? { ...question.answerKey, values: [...question.answerKey.values] }
                              : question.answerKey.kind === 'TEXT'
                                ? { ...question.answerKey, accept: [...question.answerKey.accept] }
                                : { ...question.answerKey }
                            : null,
                        })),
                      });
                      updateSection(sectionIndex, { groups: next });
                    }}
                    onQuestionChange={(questionIndex, patch) => updateQuestion(sectionIndex, groupIndex, questionIndex, patch)}
                  />
                ))}
                <Button
                  size="sm"
                  disabled={readOnly}
                  onClick={() => updateSection(sectionIndex, { groups: [...section.groups, emptyGroup()] })}
                >
                  Add question group
                </Button>
              </div>
            </Card>
            );
          })}

          <div className="row" style={{ flexWrap: 'wrap' }}>
            {(['READING', 'LISTENING', 'WRITING'] as const).map((skill) => {
              const ordinal = draft.sections.filter((entry) => entry.skill === skill).length + 1;
              const noun = skill === 'READING' ? 'reading passage' : skill === 'LISTENING' ? 'listening part' : 'writing task';
              return (
                <Button
                  key={skill}
                  disabled={readOnly}
                  onClick={() => setDraft({ ...draft, sections: [...draft.sections, emptySection(skill, ordinal)] })}
                >
                  + Add {noun} {ordinal}
                </Button>
              );
            })}
          </div>

          {testType === 'FULL_MOCK' ? (
            <Card title="Mock components" hint="Ordered skill sequence: duration, break and the version that supplies each skill.">
              {(draft.mockComponents ?? []).map((component, index) => (
                <div key={`mock-${index}`} className="grid grid--4" style={{ alignItems: 'end', marginBottom: 10 }}>
                  <Field label="Skill">
                    {(id) => (
                      <Select
                        id={id}
                        value={component.skill}
                        disabled={readOnly}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            mockComponents: (draft.mockComponents ?? []).map((item, i) =>
                              i === index ? { ...item, skill: event.target.value as EditableSection['skill'] } : item,
                            ),
                          })
                        }
                      >
                        <option value="LISTENING">Listening</option>
                        <option value="READING">Reading</option>
                        <option value="WRITING">Writing</option>
                      </Select>
                    )}
                  </Field>
                  <Field label="Source version" hint="Published sibling versions appear here.">
                    {(id) => (
                      <Select
                        id={id}
                        value={component.testVersionId}
                        disabled={readOnly}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            mockComponents: (draft.mockComponents ?? []).map((item, i) =>
                              i === index ? { ...item, testVersionId: event.target.value } : item,
                            ),
                          })
                        }
                      >
                        <option value={component.testVersionId}>{component.testVersionId.slice(0, 14)}… (current)</option>
                        {mockOptions
                          .filter((option) => option.type === 'READING' || option.type === 'LISTENING' || option.type === 'WRITING')
                          .map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.title} — {TEST_TYPE_LABELS[option.type] ?? option.type}
                            </option>
                          ))}
                      </Select>
                    )}
                  </Field>
                  <Field label="Duration (seconds)">
                    {(id) => (
                      <TextInput
                        id={id}
                        type="number"
                        value={component.durationSeconds}
                        disabled={readOnly}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            mockComponents: (draft.mockComponents ?? []).map((item, i) =>
                              i === index ? { ...item, durationSeconds: Number(event.target.value) } : item,
                            ),
                          })
                        }
                      />
                    )}
                  </Field>
                  <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
                    <Field label="Break after (s)">
                      {(id) => (
                        <TextInput
                          id={id}
                          type="number"
                          value={component.breakAfterSeconds}
                          disabled={readOnly}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              mockComponents: (draft.mockComponents ?? []).map((item, i) =>
                                i === index ? { ...item, breakAfterSeconds: Number(event.target.value) } : item,
                              ),
                            })
                          }
                        />
                      )}
                    </Field>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={readOnly}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          mockComponents: (draft.mockComponents ?? []).filter((_, i) => i !== index),
                        })
                      }
                    >
                      ×
                    </Button>
                  </div>
                </div>
              ))}
              <Button
                size="sm"
                disabled={readOnly}
                onClick={() =>
                  setDraft({
                    ...draft,
                    mockComponents: [
                      ...(draft.mockComponents ?? []),
                      { skill: 'LISTENING', testVersionId: '', label: 'Listening', durationSeconds: 1800, breakAfterSeconds: 0 },
                    ],
                  })
                }
              >
                Add component
              </Button>
            </Card>
          ) : null}

          <Card title="Save">
            <p className="small muted">
              Saving replaces the entire content tree of this version (sections, groups, questions and answer keys) and
              re-runs deterministic validation. Drafts and reviews only — published content is immutable.
            </p>
            <ProgressBar value={questionTotal} max={Math.max(questionTotal, 40)} />
            <div className="row" style={{ marginTop: 12 }}>
              <Button variant="primary" loading={saving} onClick={save}>
                Save content
              </Button>
              <Button onClick={onClose}>Cancel</Button>
            </div>
          </Card>
        </div>
      )}
    </Modal>
  );
}

function AudioUpload({
  versionId,
  disabled,
  onUploaded,
}: {
  versionId: string;
  disabled?: boolean;
  onUploaded: (assetId?: string) => Promise<void> | void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState('');
  const valid = /^https:\/\/\S+$/i.test(url.trim());

  return (
    <div className="field">
      <span className="field__label">Audio URL (https://… — mp3, m4a, wav, ogg)</span>
      <div className="row">
        <TextInput
          type="url"
          inputMode="url"
          value={url}
          disabled={disabled || busy}
          placeholder="https://cdn.example.com/listening/section-1.mp3"
          onChange={(event) => setUrl(event.target.value)}
          style={{ flex: '1 1 260px' }}
        />
        <Button
          size="sm"
          loading={busy}
          disabled={disabled || !valid}
          onClick={async () => {
            setBusy(true);
            try {
              const linked = await api.post<{ assetId: string }>('/api/admin/assets', {
                url: url.trim(),
                kind: 'AUDIO',
                testVersionId: versionId,
              });
              setUrl('');
              toast.push('Audio linked. It is selected for this section — save content to keep it.', 'success');
              await onUploaded(linked.assetId);
            } catch (linkError) {
              toast.push(describeError(linkError), 'error');
            } finally {
              setBusy(false);
            }
          }}
        >
          Link audio
        </Button>
      </div>
      <span className="field__hint">
        Media is linked, not uploaded: the file stays on the host you name and must be reachable over HTTPS.
      </span>
    </div>
  );
}

function GroupEditor({
  group,
  readOnly,
  onChange,
  onRemove,
  onMove,
  onDuplicate,
  onQuestionChange,
}: {
  group: EditableGroup;
  readOnly?: boolean;
  onChange: (patch: Partial<EditableGroup>) => void;
  onRemove: () => void;
  onMove?: (direction: -1 | 1) => void;
  onDuplicate?: () => void;
  onQuestionChange: (questionIndex: number, patch: Partial<EditableQuestion>) => void;
}) {
  const meta = QUESTION_TYPE_META[group.type];
  const usesOptions = Boolean(meta?.needsSharedOptions);
  const firstNumber = group.questions[0]?.number ?? 1;
  const nextNumber = group.questions.at(-1)?.number ?? firstNumber - 1;
  const rangeText =
    group.rangeFrom != null && group.rangeTo != null
      ? `Questions ${group.rangeFrom}–${group.rangeTo}`
      : group.questions.length > 0
        ? `Questions ${Math.min(...group.questions.map((question) => question.number))}–${Math.max(...group.questions.map((question) => question.number))}`
        : 'No question range';

  return (
    <div className="card card--nested">
      <div className="row row--between" style={{ marginBottom: 8 }}>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <Badge tone="accent">{meta?.label ?? group.type}</Badge>
          <span className="tiny muted">{group.questions.length} questions</span>
          <span className="tiny muted">{rangeText}</span>
        </div>
        <div className="row" style={{ gap: 6 }}>
          {onMove ? (
            <>
              <Button size="sm" variant="ghost" disabled={readOnly} title="Move group up" aria-label="Move group up" onClick={() => onMove(-1)}>
                ↑
              </Button>
              <Button size="sm" variant="ghost" disabled={readOnly} title="Move group down" aria-label="Move group down" onClick={() => onMove(1)}>
                ↓
              </Button>
            </>
          ) : null}
          {onDuplicate ? (
            <Button size="sm" variant="ghost" disabled={readOnly} title="Duplicate group" onClick={onDuplicate}>
              Duplicate
            </Button>
          ) : null}
          <ConfirmButton
            size="sm"
            variant="ghost"
            title="Remove this question group?"
            confirmLabel="Remove group"
            body={<p className="small">The group and its questions are removed from the draft; save content to store the change.</p>}
            onConfirm={onRemove}
          >
            Remove
          </ConfirmButton>
        </div>
      </div>

      <div className="grid grid--3">
        <Field label="Question type">
          {(id) => (
            <Select id={id} value={group.type} disabled={readOnly} onChange={(event) => onChange({ type: event.target.value as QuestionType })}>
              {QUESTION_TYPES.map((type) => (
                <option key={type} value={type}>
                  {QUESTION_TYPE_META[type].label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="First number">
          {(id) => (
            <TextInput
              id={id}
              type="number"
              value={group.rangeFrom ?? ''}
              disabled={readOnly}
              onChange={(event) => onChange({ rangeFrom: event.target.value ? Number(event.target.value) : null })}
            />
          )}
        </Field>
        <Field label="Last number">
          {(id) => (
            <TextInput
              id={id}
              type="number"
              value={group.rangeTo ?? ''}
              disabled={readOnly}
              onChange={(event) => onChange({ rangeTo: event.target.value ? Number(event.target.value) : null })}
            />
          )}
        </Field>
      </div>

      <Field label="Group instructions">
        {(id) => <TextArea id={id} rows={2} value={group.instructions} disabled={readOnly} onChange={(event) => onChange({ instructions: event.target.value })} />}
      </Field>

      {usesOptions ? (
        <Field label="Shared options" hint="One option per line as `ID | text` (e.g. `A | the first option`).">
          {(id) => (
            <TextArea
              id={id}
              rows={4}
              value={group.sharedOptions.map((option) => `${option.id} | ${option.text}`).join('\n')}
              disabled={readOnly}
              onChange={(event) => onChange({ sharedOptions: parseOptionLines(event.target.value) })}
            />
          )}
        </Field>
      ) : null}

      <div className="grid grid--2">
        <Field label="Select count (checkbox groups)">
          {(id) => (
            <TextInput
              id={id}
              type="number"
              min={1}
              max={10}
              value={group.config.selectCount ?? ''}
              disabled={readOnly}
              onChange={(event) =>
                onChange({ config: { ...group.config, selectCount: event.target.value ? Number(event.target.value) : undefined } })
              }
            />
          )}
        </Field>
        <Field label="Group note">
          {(id) => (
            <TextInput
              id={id}
              value={group.config.note ?? ''}
              disabled={readOnly}
              onChange={(event) => onChange({ config: { ...group.config, note: event.target.value || undefined } })}
            />
          )}
        </Field>
        {group.type === 'WRITING_TASK_1' || group.type === 'WRITING_TASK_2' ? (
          <Field label="Minimum words" hint="Shown with the task; validation warns when the prompt is missing.">
            {(id) => (
              <TextInput
                id={id}
                type="number"
                min={1}
                max={2000}
                value={group.config.minimumWords ?? ''}
                disabled={readOnly}
                onChange={(event) =>
                  onChange({ config: { ...group.config, minimumWords: event.target.value ? Number(event.target.value) : undefined } })
                }
              />
            )}
          </Field>
        ) : null}
      </div>

      <div className="stack" style={{ marginTop: 10 }}>
        {group.questions.map((question, questionIndex) => (
          <QuestionEditor
            key={`q-${question.number}-${questionIndex}`}
            question={question}
            readOnly={readOnly}
            usesOptions={usesOptions}
            onChange={(patch) => onQuestionChange(questionIndex, patch)}
            onRemove={() => onChange({ questions: group.questions.filter((_, index) => index !== questionIndex) })}
          />
        ))}
        <div className="row">
          <Button
            size="sm"
            disabled={readOnly}
            onClick={() => onChange({ questions: [...group.questions, emptyQuestion(nextNumber + 1)] })}
          >
            Add question
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={readOnly || group.questions.length === 0}
            onClick={() =>
              onChange({
                questions: group.questions.map((question, index) =>
                  index === 0 ? question : { ...question, number: question.number },
                ),
              })
            }
            title="Renumbering is manual: edit each question number."
          >
            Numbers are manual
          </Button>
        </div>
      </div>
    </div>
  );
}

function parseOptionLines(text: string): Array<{ id: string; text: string }> {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const [id, ...rest] = line.split('|');
      if (rest.length === 0) return { id: String.fromCharCode(65 + index), text: line };
      return { id: (id ?? '').trim(), text: rest.join('|').trim() };
    })
    .filter((option) => option.id.length > 0)
    .slice(0, 40);
}

function QuestionEditor({
  question,
  readOnly,
  usesOptions,
  onChange,
  onRemove,
}: {
  question: EditableQuestion;
  readOnly?: boolean;
  usesOptions: boolean;
  onChange: (patch: Partial<EditableQuestion>) => void;
  onRemove: () => void;
}) {
  const key = question.answerKey;
  const keyKind = key ? key.kind : 'NONE';

  return (
    <div className="card card--nested">
      <div className="grid grid--3">
        <Field label="Number">
          {(id) => (
            <TextInput
              id={id}
              type="number"
              min={1}
              value={question.number}
              disabled={readOnly}
              onChange={(event) => onChange({ number: Number(event.target.value) })}
            />
          )}
        </Field>
        <Field label="Prompt" hint="Use [[3]] markers for inline blank numbering.">
          {(id) => (
            <TextInput id={id} value={question.prompt} disabled={readOnly} onChange={(event) => onChange({ prompt: event.target.value })} />
          )}
        </Field>
        <Field label="Answer key">
          {(id) => (
            <Select
              id={id}
              value={keyKind}
              disabled={readOnly}
              onChange={(event) => {
                const value = event.target.value;
                if (value === 'NONE') onChange({ answerKey: null });
                else if (value === 'CHOICE') onChange({ answerKey: { kind: 'CHOICE', values: [] } });
                else if (value === 'TEXT') onChange({ answerKey: { kind: 'TEXT', accept: [] } });
                else onChange({ answerKey: { kind: 'MANUAL' } });
              }}
            >
              <option value="NONE">No key yet (requires review)</option>
              <option value="CHOICE">Choice — one or more option IDs</option>
              <option value="TEXT">Text — accepted variants</option>
              <option value="MANUAL">Manual marking</option>
            </Select>
          )}
        </Field>
      </div>

      {key?.kind === 'CHOICE' ? (
        <Field label="Correct option IDs" hint="Comma separated, e.g. `A, C`.">
          {(id) => (
            <TextInput
              id={id}
              value={key.values.join(', ')}
              disabled={readOnly}
              onChange={(event) =>
                onChange({
                  answerKey: {
                    kind: 'CHOICE',
                    values: event.target.value
                      .split(',')
                      .map((value) => value.trim())
                      .filter(Boolean),
                    partialCredit: key.partialCredit,
                  },
                })
              }
            />
          )}
        </Field>
      ) : null}

      {key?.kind === 'TEXT' ? (
        <Field label="Accepted answers" hint="One accepted spelling or variant per line. Matching is case-insensitive.">
          {(id) => (
            <TextArea
              id={id}
              rows={3}
              value={key.accept.join('\n')}
              disabled={readOnly}
              onChange={(event) =>
                onChange({
                  answerKey: {
                    kind: 'TEXT',
                    accept: event.target.value.split('\n').map((line) => line.trim()).filter(Boolean),
                    numeric: key.numeric,
                    ignoreLeadingArticle: key.ignoreLeadingArticle,
                  },
                })
              }
            />
          )}
        </Field>
      ) : null}

      {usesOptions && question.options.length === 0 ? (
        <Field label="Question-specific options" hint="Only needed when this question does not use the group options. `ID | text` per line.">
          {(id) => (
            <TextArea
              id={id}
              rows={3}
              value=""
              disabled={readOnly}
              placeholder="A | first option"
              onChange={(event) => onChange({ options: parseOptionLines(event.target.value) })}
            />
          )}
        </Field>
      ) : null}

      <div className="grid grid--3">
        <Field label="Word limit (min)">
          {(id) => (
            <TextInput
              id={id}
              type="number"
              min={0}
              value={question.config.wordLimit?.min ?? ''}
              disabled={readOnly}
              onChange={(event) =>
                onChange({
                  config: {
                    ...question.config,
                    wordLimit: { ...question.config.wordLimit, min: event.target.value ? Number(event.target.value) : undefined },
                  },
                })
              }
            />
          )}
        </Field>
        <Field label="Word limit (max)">
          {(id) => (
            <TextInput
              id={id}
              type="number"
              min={1}
              value={question.config.wordLimit?.max ?? ''}
              disabled={readOnly}
              onChange={(event) =>
                onChange({
                  config: {
                    ...question.config,
                    wordLimit: { ...question.config.wordLimit, max: event.target.value ? Number(event.target.value) : undefined },
                  },
                })
              }
            />
          )}
        </Field>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <Button size="sm" variant="ghost" disabled={readOnly} onClick={onRemove}>
            Remove question
          </Button>
        </div>
      </div>

      <div className="grid grid--2">
        <Field label="Evidence (server-side only)">
          {(id) => (
            <TextArea id={id} rows={2} value={question.evidence ?? ''} disabled={readOnly} onChange={(event) => onChange({ evidence: event.target.value || null })} />
          )}
        </Field>
        <Field label="Explanation (shown in review)">
          {(id) => (
            <TextArea id={id} rows={2} value={question.explanation ?? ''} disabled={readOnly} onChange={(event) => onChange({ explanation: event.target.value || null })} />
          )}
        </Field>
      </div>
    </div>
  );
}
