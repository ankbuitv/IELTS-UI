import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { QUESTION_TYPES, QUESTION_TYPE_META } from '@shared/question-types';
import type { QuestionType } from '@shared/question-types';
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
  emptyGroup,
  emptyQuestion,
  emptySection,
  toEditable,
  type AdminVersionContentResponse,
  type EditableContent,
  type EditableGroup,
  type EditableQuestion,
  type EditableSection,
} from './content-types';

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
      const payload = tab === 'json' ? (JSON.parse(jsonText) as EditableContent) : draft;
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
            Paste or edit the structured payload directly. It must match the platform content schema; the server rejects
            anything else before writing.
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
              try {
                setDraft(JSON.parse(jsonText) as EditableContent);
                toast.push('JSON parsed into the editor.', 'success');
              } catch (jsonError) {
                toast.push(describeError(jsonError), 'error');
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
              <Field label="Scoring profile">
                {(id) => (
                  <TextInput
                    id={id}
                    value={draft.scoringProfileId ?? ''}
                    disabled={readOnly}
                    placeholder="No profile (bands unavailable)"
                    onChange={(event) => setDraft({ ...draft, scoringProfileId: event.target.value || null })}
                  />
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
          </Card>

          {draft.sections.map((section, sectionIndex) => (
            <Card
              key={`section-${sectionIndex}`}
              title={`${sectionIndex + 1}. ${section.title || '(untitled section)'}`}
              hint={`${section.skill} · ${section.groups.length} groups`}
              actions={
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={readOnly}
                  onClick={() =>
                    setDraft({ ...draft, sections: draft.sections.filter((_, index) => index !== sectionIndex) })
                  }
                >
                  Remove
                </Button>
              }
            >
              <div className="grid grid--3">
                <Field label="Skill">
                  {(id) => (
                    <Select
                      id={id}
                      value={section.skill}
                      disabled={readOnly}
                      onChange={(event) => updateSection(sectionIndex, { skill: event.target.value as EditableSection['skill'] })}
                    >
                      <option value="READING">Reading</option>
                      <option value="LISTENING">Listening</option>
                      <option value="WRITING">Writing</option>
                    </Select>
                  )}
                </Field>
                <Field label="Title">
                  {(id) => (
                    <TextInput id={id} value={section.title} disabled={readOnly} onChange={(event) => updateSection(sectionIndex, { title: event.target.value })} />
                  )}
                </Field>
                <Field label="Duration (seconds)">
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
              </div>
              <Field label="Section instructions">
                {(id) => (
                  <TextArea id={id} rows={2} value={section.instructions} disabled={readOnly} onChange={(event) => updateSection(sectionIndex, { instructions: event.target.value })} />
                )}
              </Field>

              {section.skill === 'LISTENING' ? (
                <div className="grid grid--2">
                  <Field label="Audio asset">
                    {(id) => (
                      <Select
                        id={id}
                        value={section.audioAssetId ?? ''}
                        disabled={readOnly}
                        onChange={(event) => updateSection(sectionIndex, { audioAssetId: event.target.value || null })}
                      >
                        <option value="">No audio attached</option>
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
                    onUploaded={async () => {
                      await reload();
                    }}
                  />
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
          ))}

          <div className="row">
            <Button disabled={readOnly} onClick={() => setDraft({ ...draft, sections: [...draft.sections, emptySection('READING')] })}>
              Add reading section
            </Button>
            <Button disabled={readOnly} onClick={() => setDraft({ ...draft, sections: [...draft.sections, emptySection('LISTENING')] })}>
              Add listening section
            </Button>
            <Button disabled={readOnly} onClick={() => setDraft({ ...draft, sections: [...draft.sections, emptySection('WRITING')] })}>
              Add writing section
            </Button>
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
  onUploaded: () => Promise<void> | void;
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
              await api.post('/api/admin/assets', { url: url.trim(), kind: 'AUDIO', testVersionId: versionId });
              setUrl('');
              toast.push('Audio linked to the draft.', 'success');
              await onUploaded();
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
  onQuestionChange,
}: {
  group: EditableGroup;
  readOnly?: boolean;
  onChange: (patch: Partial<EditableGroup>) => void;
  onRemove: () => void;
  onQuestionChange: (questionIndex: number, patch: Partial<EditableQuestion>) => void;
}) {
  const meta = QUESTION_TYPE_META[group.type];
  const usesOptions = Boolean(meta?.needsSharedOptions);
  const firstNumber = group.questions[0]?.number ?? 1;
  const nextNumber = group.questions.at(-1)?.number ?? firstNumber - 1;

  return (
    <div className="card card--nested">
      <div className="row row--between" style={{ marginBottom: 8 }}>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <Badge tone="accent">{meta?.label ?? group.type}</Badge>
          <span className="tiny muted">{group.questions.length} questions</span>
        </div>
        <Button size="sm" variant="ghost" disabled={readOnly} onClick={onRemove}>
          Remove group
        </Button>
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
