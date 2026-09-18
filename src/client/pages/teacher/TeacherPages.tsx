import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
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
  Select,
  Stat,
  Tabs,
  TextArea,
  TextInput,
  useToast,
} from '../../components/ui';
import { AccuracyList, BarChart, type ChartTone } from '../../components/charts';
import { ResultSummary, WritingMarkForm, type AttemptResultPayload } from '../../components/ResultView';
import {
  BAND_DISCLAIMER,
  formatBand,
  formatDateTime,
  formatPercent,
  formatScore,
  MODE_LABELS,
  SKILL_LABELS,
  statusTone,
  STATUS_LABELS,
  TEST_TYPE_LABELS,
} from '../../lib/format';

interface ClassroomView {
  id: string;
  name: string;
  description: string;
  joinCode: string;
  status: 'ACTIVE' | 'ARCHIVED';
  createdAt: string;
  studentCount: number;
  assignmentCount: number;
  isOwner: boolean;
}

/** Skill colours shared with the student dashboards and charts. */
const SKILL_CHART_TONES: Record<string, ChartTone> = {
  READING: 'brand',
  LISTENING: 'violet',
  WRITING: 'amber',
  FULL_MOCK: 'emerald',
};

export function TeacherHomePage() {
  const toast = useToast();
  const navigate = useNavigate();
  const { data, loading, error, reload } = useAsync<{ classrooms: ClassroomView[] }>(
    () => api.get('/api/teacher/classrooms'),
    [],
  );
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', description: '' });

  if (loading) return <Loading label="Loading your classrooms…" />;
  if (error) return <Notice tone="danger">{error}</Notice>;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Teaching</h1>
          <p className="page-head__meta">Classrooms, assignments, class analytics and integrity summaries.</p>
        </div>
        <div className="row">
          <Button onClick={() => navigate('/teacher/marking')}>Mark writing</Button>
          <Button variant="primary" onClick={() => setCreating(true)}>
            New classroom
          </Button>
        </div>
      </div>

      {data?.classrooms.length === 0 ? (
        <Card>
          <EmptyState title="No classrooms yet">
            Create a classroom, invite your students, then assign a published test.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid grid--3">
          {data?.classrooms.map((classroom) => (
            <div className="card card--link" key={classroom.id}>
              <div className="row row--between">
                <h3 style={{ margin: 0 }}>{classroom.name}</h3>
                {classroom.status === 'ARCHIVED' ? <Badge tone="dim">Archived</Badge> : <Badge tone="success">Active</Badge>}
              </div>
              <p className="small muted">{classroom.description || 'No description.'}</p>
              <KeyValue
                items={[
                  ['Students', String(classroom.studentCount)],
                  ['Assignments', String(classroom.assignmentCount)],
                  ['Class code', <span className="mono">{classroom.joinCode}</span>],
                  ['Your role', classroom.isOwner ? 'Owner' : 'Co-teacher'],
                ]}
              />
              <Button block variant="secondary" style={{ marginTop: 12 }} onClick={() => navigate(`/teacher/classrooms/${classroom.id}`)}>
                Open classroom
              </Button>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={creating}
        title="Create a classroom"
        onClose={() => setCreating(false)}
        actions={
          <>
            <Button onClick={() => setCreating(false)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={async () => {
                try {
                  const result = await api.post<{ classroom: ClassroomView }>('/api/teacher/classrooms', form);
                  await reload();
                  setCreating(false);
                  setForm({ name: '', description: '' });
                  toast.push(`Classroom created. Class code: ${result.classroom.joinCode}`, 'success');
                } catch (createError) {
                  toast.push(describeError(createError), 'error');
                }
              }}
            >
              Create
            </Button>
          </>
        }
      >
        <Field label="Classroom name" required>
          {(id) => <TextInput id={id} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />}
        </Field>
        <Field label="Description">
          {(id) => (
            <TextArea id={id} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
          )}
        </Field>
        <p className="tiny muted">
          Students join with the class code or a single-use invitation link that you generate. Invitation links can be
          bound to an email address and expire.
        </p>
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Classroom detail
// ---------------------------------------------------------------------------
interface ClassroomDetailResponse {
  classroom: { id: string; name: string; status: string; isOwner: boolean };
  members: Array<{
    userId: string;
    email: string;
    displayName: string;
    role: string;
    status: string;
    joinedAt: string;
    attemptCount: number;
    lastActiveAt: string | null;
  }>;
  invites: Array<{ id: string; email: string | null; status: string; expiresAt: string; createdAt: string }>;
  assignments: Array<{
    id: string;
    title: string;
    status: string;
    mode: string;
    resultVisibility: string;
    deadlineAt: string | null;
    maxAttempts: number;
    testTitle: string;
    testType: string;
    versionNumber: number;
    submissions: number;
  }>;
  analytics: {
    studentCount: number;
    assignmentCount: number;
    assignments: Array<{
      assignmentId: string;
      title: string;
      testTitle: string;
      testType: string;
      averageRawScore: number | null;
      averageTotalQuestions: number | null;
      averageBand: number | null;
      assignedCount: number;
      submittedCount: number;
      integrityFlaggedAttempts: number;
    }>;
    skillPerformance: Array<{ skill: string; rawScore: number; totalQuestions: number; accuracy: number | null; latestBand: number | null }>;
    taskTypes: Array<{ label: string; correct: number; answered: number; accuracy: number | null }>;
    bandDistribution: Array<{ band: number; count: number }>;
    integritySummary: Array<{ type: string; count: number }>;
  };
}

export function ClassroomPage() {
  const { classroomId = '' } = useParams();
  const toast = useToast();
  const [tab, setTab] = useState<'overview' | 'students' | 'assignments' | 'invites'>('overview');
  const { data, loading, error, reload } = useAsync<ClassroomDetailResponse>(
    () => api.get(`/api/teacher/classrooms/${classroomId}`),
    [classroomId],
  );

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteResult, setInviteResult] = useState<{ shareUrl: string; expiresAt: string } | null>(null);
  const [addEmail, setAddEmail] = useState('');
  const [assignOpen, setAssignOpen] = useState(false);

  if (loading) return <Loading label="Loading classroom…" />;
  if (error) return <Notice tone="danger">{error}</Notice>;
  if (!data) return null;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <Link to="/teacher" className="small">
            ← All classrooms
          </Link>
          <h1>{data.classroom.name}</h1>
          <p className="page-head__meta">
            {data.analytics.studentCount} students · {data.analytics.assignmentCount} assignments
          </p>
        </div>
        <div className="row">
          <Button onClick={() => setInviteOpen(true)}>Invite students</Button>
          <Button variant="primary" onClick={() => setAssignOpen(true)}>
            New assignment
          </Button>
        </div>
      </div>

      <Tabs
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'students', label: `Students (${data.members.filter((member) => member.role === 'STUDENT').length})` },
          { id: 'assignments', label: `Assignments (${data.assignments.length})` },
          { id: 'invites', label: `Invitations (${data.invites.length})` },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'overview' ? (
        <>
          <div className="grid grid--4">
            <Stat label="Students" value={data.analytics.studentCount} />
            <Stat label="Assignments" value={data.analytics.assignmentCount} />
            <Stat
              label="Submissions"
              value={data.analytics.assignments.reduce((total, assignment) => total + assignment.submittedCount, 0)}
            />
            <Stat
              label="Attempts with integrity events"
              value={data.analytics.assignments.reduce((total, assignment) => total + assignment.integrityFlaggedAttempts, 0)}
              hint="Observable events, not verdicts"
            />
          </div>

          <div className="grid grid--2">
            <Card title="Average raw score by assignment">
              <BarChart
                bars={data.analytics.assignments.map((assignment) => ({
                  label: assignment.title.slice(0, 8),
                  value: assignment.averageRawScore ?? 0,
                  sublabel: `${assignment.testTitle}: avg ${assignment.averageRawScore ?? 0}/${assignment.averageTotalQuestions ?? 0}`,
                }))}
                emptyLabel="No submissions yet"
              />
            </Card>
            <Card title="Estimated band distribution" hint="Across marked Reading/Listening sessions">
              <BarChart
                bars={data.analytics.bandDistribution.map((bucket) => ({
                  label: formatBand(bucket.band),
                  value: bucket.count,
                }))}
                emptyLabel="No estimated bands yet"
              />
              <p className="tiny muted">{BAND_DISCLAIMER}</p>
            </Card>
          </div>

          <div className="grid grid--2">
            <Card title="Skill performance">
              <AccuracyList
                items={data.analytics.skillPerformance.map((skill) => ({
                  label: `${SKILL_LABELS[skill.skill] ?? skill.skill} (${formatScore(skill.rawScore, skill.totalQuestions)})`,
                  correct: skill.rawScore,
                  total: skill.totalQuestions,
                  accuracy: skill.accuracy,
                  tone: SKILL_CHART_TONES[skill.skill] ?? 'brand',
                }))}
              />
            </Card>
            <Card title="Task-type accuracy">
              <AccuracyList
                items={data.analytics.taskTypes.map((task) => ({
                  label: task.label,
                  correct: task.correct,
                  total: task.answered,
                  accuracy: task.accuracy,
                }))}
              />
            </Card>
          </div>

          <Card title="Integrity event summary" hint="Counts of observable events across this classroom's attempts">
            {data.analytics.integritySummary.length === 0 ? (
              <EmptyState title="No integrity events recorded" />
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Event</th>
                      <th className="num">Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.analytics.integritySummary.map((event) => (
                      <tr key={event.type}>
                        <td className="mono">{event.type}</td>
                        <td className="num">{event.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="tiny muted" style={{ marginTop: 10 }}>
              These are observable browser events, not verdicts. A web page cannot block Alt+Tab, cannot see other
              applications or devices, and cannot prove that no other resource was used.
            </p>
          </Card>
        </>
      ) : null}

      {tab === 'students' ? (
        <Card flush>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Status</th>
                  <th className="num">Attempts</th>
                  <th>Last active</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.members.map((member) => (
                  <tr key={member.userId}>
                    <td>
                      {member.displayName}
                      <div className="tiny muted">{member.email}</div>
                    </td>
                    <td>
                      <Badge tone={member.role === 'CO_TEACHER' ? 'accent' : member.status === 'ACTIVE' ? 'success' : 'neutral'}>
                        {member.role === 'CO_TEACHER' ? 'Co-teacher' : member.status.toLowerCase()}
                      </Badge>
                    </td>
                    <td className="num">{member.attemptCount}</td>
                    <td>{member.lastActiveAt ? formatDateTime(member.lastActiveAt) : '—'}</td>
                    <td className="right">
                      {member.role === 'STUDENT' ? (
                        <div className="row" style={{ justifyContent: 'flex-end' }}>
                          <Link className="btn btn--sm" to={`/teacher/students/${member.userId}`}>
                            View progress
                          </Link>
                          <ConfirmButton
                            size="sm"
                            variant="ghost"
                            title="Remove student"
                            confirmLabel="Remove"
                            onConfirm={async () => {
                              await api.delete(`/api/teacher/classrooms/${classroomId}/members/${member.userId}`);
                              await reload();
                            }}
                            body={
                              <p>
                                Remove {member.displayName} from this classroom? Existing attempts stay in their history
                                and remain visible to you.
                              </p>
                            }
                          >
                            Remove
                          </ConfirmButton>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.members.length === 0 ? <EmptyState title="No members yet" /> : null}
        </Card>
      ) : null}

      {tab === 'assignments' ? (
        <Card flush>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Assignment</th>
                  <th>Test</th>
                  <th>Mode</th>
                  <th>Deadline</th>
                  <th className="num">Submissions</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.assignments.map((assignment) => (
                  <tr key={assignment.id}>
                    <td>
                      {assignment.title}
                      <div className="tiny muted">{assignment.status.toLowerCase()}</div>
                    </td>
                    <td>
                      {assignment.testTitle}
                      <div className="tiny muted">
                        {TEST_TYPE_LABELS[assignment.testType]} · v{assignment.versionNumber}
                      </div>
                    </td>
                    <td>{MODE_LABELS[assignment.mode] ?? assignment.mode}</td>
                    <td className="nowrap">{assignment.deadlineAt ? formatDateTime(assignment.deadlineAt) : 'No deadline'}</td>
                    <td className="num">{assignment.submissions}</td>
                    <td className="right">
                      <Link className="btn btn--sm" to={`/teacher/assignments/${assignment.id}`}>
                        Report
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.assignments.length === 0 ? (
            <EmptyState title="No assignments yet">Assign a published test to this classroom.</EmptyState>
          ) : null}
        </Card>
      ) : null}

      {tab === 'invites' ? (
        <Card>
          <div className="row" style={{ marginBottom: 12 }}>
            <TextInput
              placeholder="student@example.com"
              value={addEmail}
              onChange={(event) => setAddEmail(event.target.value)}
            />
            <Button
              onClick={async () => {
                try {
                  await api.post(`/api/teacher/classrooms/${classroomId}/members`, { email: addEmail });
                  setAddEmail('');
                  toast.push('Student enrolled.', 'success');
                  await reload();
                } catch (enrollError) {
                  const message = describeError(enrollError);
                  toast.push(
                    `${message} If they do not have an account, create an invitation link instead.`,
                    'warning',
                  );
                }
              }}
            >
              Enrol existing account
            </Button>
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Status</th>
                  <th>Expires</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.invites.map((invite) => (
                  <tr key={invite.id}>
                    <td>{invite.email ?? 'Open link (class code)'}</td>
                    <td>
                      <Badge
                        tone={
                          invite.status === 'PENDING' ? 'accent' : invite.status === 'ACCEPTED' ? 'success' : 'neutral'
                        }
                      >
                        {invite.status.toLowerCase()}
                      </Badge>
                    </td>
                    <td>{formatDateTime(invite.expiresAt)}</td>
                    <td className="right">
                      {invite.status === 'PENDING' ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            await api.delete(`/api/teacher/classrooms/${classroomId}/invites/${invite.id}`);
                            await reload();
                          }}
                        >
                          Revoke
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      <Modal
        open={inviteOpen}
        title="Invite students"
        onClose={() => {
          setInviteOpen(false);
          setInviteResult(null);
        }}
        actions={<Button onClick={() => setInviteOpen(false)}>Close</Button>}
      >
        <p className="small muted">
          Invitation links are single-use, expiring and stored only as a hash. Bind a link to an email address to make it
          usable by that student alone.
        </p>
        <Field label="Student email (optional)">
          {(id) => (
            <TextInput id={id} value={inviteEmail} placeholder="student@example.com" onChange={(event) => setInviteEmail(event.target.value)} />
          )}
        </Field>
        <Button
          variant="primary"
          onClick={async () => {
            try {
              const result = await api.post<{ invite: { expiresAt: string }; shareUrl: string }>(
                `/api/teacher/classrooms/${classroomId}/invites`,
                { email: inviteEmail || null },
              );
              setInviteResult({ shareUrl: result.shareUrl, expiresAt: result.invite.expiresAt });
              await reload();
            } catch (inviteError) {
              toast.push(describeError(inviteError), 'error');
            }
          }}
        >
          Create invitation link
        </Button>

        {inviteResult ? (
          <div style={{ marginTop: 14 }}>
            <Notice tone="success" title="Invitation ready">
              <div className="mono" style={{ wordBreak: 'break-all', marginTop: 6 }}>
                {inviteResult.shareUrl}
              </div>
              <div className="tiny" style={{ marginTop: 6 }}>
                Expires {formatDateTime(inviteResult.expiresAt)}
              </div>
            </Notice>
          </div>
        ) : null}
      </Modal>

      <CreateAssignmentModal
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        classroomId={classroomId}
        onCreated={async () => {
          await reload();
          setAssignOpen(false);
        }}
      />
    </div>
  );
}

function CreateAssignmentModal({
  open,
  onClose,
  classroomId,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  classroomId: string;
  onCreated: () => Promise<void>;
}) {
  const toast = useToast();
  const { data } = useAsync<{ tests: Array<{ id: string; title: string; type: string; versionId: string; versionNumber: number; totalQuestions: number }> }>(
    () => api.get('/api/tests'),
    [open],
    { immediate: open },
  );

  const [form, setForm] = useState({
    versionId: '',
    title: '',
    deadline: '',
    start: '',
    maxAttempts: 1,
    mode: 'STANDARD_EXAM',
    resultVisibility: 'AFTER_DEADLINE',
    timingPolicy: 'EXAM_DURATION',
    requireFullscreen: false,
    monitorVisibility: true,
    autoSubmitAtEvents: '',
    maxTabAwayEvents: '',
  });

  return (
    <Modal
      open={open}
      title="New assignment"
      wide
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!form.versionId}
            onClick={async () => {
              try {
                await api.post('/api/teacher/assignments', {
                  classroomId,
                  testVersionId: form.versionId,
                  title: form.title || undefined,
                  startAt: form.start ? new Date(form.start).toISOString() : null,
                  deadlineAt: form.deadline ? new Date(form.deadline).toISOString() : null,
                  maxAttempts: form.maxAttempts,
                  mode: form.mode,
                  timingPolicy: form.timingPolicy,
                  resultVisibility: form.resultVisibility,
                  integrityOverrides: {
                    requireFullscreen: form.requireFullscreen,
                    monitorVisibility: form.monitorVisibility,
                    ...(form.autoSubmitAtEvents ? { autoSubmitAtEvents: Number(form.autoSubmitAtEvents) } : {}),
                    ...(form.maxTabAwayEvents ? { maxTabAwayEvents: Number(form.maxTabAwayEvents) } : {}),
                  },
                  publish: true,
                });
                toast.push('Assignment created.', 'success');
                await onCreated();
              } catch (assignmentError) {
                toast.push(describeError(assignmentError), 'error');
              }
            }}
          >
            Create assignment
          </Button>
        </>
      }
    >
      <Field label="Published test" required hint="Only published, versioned tests can be assigned.">
        {(id) => (
          <Select id={id} value={form.versionId} onChange={(event) => setForm({ ...form, versionId: event.target.value })}>
            <option value="">Select a test…</option>
            {(data?.tests ?? []).map((test) => (
              <option key={test.versionId} value={test.versionId}>
                {test.title} ({TEST_TYPE_LABELS[test.type] ?? test.type}, v{test.versionNumber}, {test.totalQuestions} questions)
              </option>
            ))}
          </Select>
        )}
      </Field>

      <div className="grid grid--2">
        <Field label="Assignment title" hint="Defaults to the test title.">
          {(id) => <TextInput id={id} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />}
        </Field>
        <Field label="Maximum attempts">
          {(id) => (
            <TextInput
              id={id}
              type="number"
              min={1}
              max={20}
              value={form.maxAttempts}
              onChange={(event) => setForm({ ...form, maxAttempts: Number(event.target.value) })}
            />
          )}
        </Field>
        <Field label="Opens at" hint="Optional.">
          {(id) => (
            <TextInput id={id} type="datetime-local" value={form.start} onChange={(event) => setForm({ ...form, start: event.target.value })} />
          )}
        </Field>
        <Field label="Deadline" hint="Used for AFTER_DEADLINE result release and for blocking late starts.">
          {(id) => (
            <TextInput id={id} type="datetime-local" value={form.deadline} onChange={(event) => setForm({ ...form, deadline: event.target.value })} />
          )}
        </Field>
        <Field label="Exam mode">
          {(id) => (
            <Select id={id} value={form.mode} onChange={(event) => setForm({ ...form, mode: event.target.value })}>
              <option value="PRACTICE">Practice — minimal monitoring</option>
              <option value="STANDARD_EXAM">Standard exam — monitoring and logging</option>
              <option value="STRICT_EXAM">Strict exam — fullscreen, thresholds, auto-submit</option>
            </Select>
          )}
        </Field>
        <Field label="Result visibility">
          {(id) => (
            <Select id={id} value={form.resultVisibility} onChange={(event) => setForm({ ...form, resultVisibility: event.target.value })}>
              <option value="IMMEDIATE">Immediate</option>
              <option value="AFTER_DEADLINE">After deadline</option>
              <option value="SCORE_ONLY">Score only</option>
              <option value="NO_REVIEW">No review released</option>
            </Select>
          )}
        </Field>
        <Field label="Timing policy">
          {(id) => (
            <Select id={id} value={form.timingPolicy} onChange={(event) => setForm({ ...form, timingPolicy: event.target.value })}>
              <option value="EXAM_DURATION">Use the test's own duration</option>
              <option value="UNTIMED">Untimed practice</option>
            </Select>
          )}
        </Field>
        <Field label="Max tab-away events" hint="Leave empty for the mode default.">
          {(id) => (
            <TextInput
              id={id}
              type="number"
              min={0}
              value={form.maxTabAwayEvents}
              onChange={(event) => setForm({ ...form, maxTabAwayEvents: event.target.value })}
            />
          )}
        </Field>
        <Field label="Auto-submit after N counted events" hint="Leave empty to disable auto-submission.">
          {(id) => (
            <TextInput
              id={id}
              type="number"
              min={1}
              value={form.autoSubmitAtEvents}
              onChange={(event) => setForm({ ...form, autoSubmitAtEvents: event.target.value })}
            />
          )}
        </Field>
      </div>

      <div className="stack" style={{ gap: 8 }}>
        <Checkbox
          checked={form.monitorVisibility}
          onChange={(checked) => setForm({ ...form, monitorVisibility: checked })}
          label="Record tab-away and focus events (a web page cannot block Alt+Tab; it can only record the resulting visibility change)"
        />
        <Checkbox
          checked={form.requireFullscreen}
          onChange={(checked) => setForm({ ...form, requireFullscreen: checked })}
          label="Request fullscreen (browsers only allow this after a click and may refuse it)"
        />
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Assignment report
// ---------------------------------------------------------------------------
interface AssignmentDetail {
  id: string;
  classroomId: string;
  classroomName: string;
  title: string;
  instructions: string;
  testId: string;
  testTitle: string;
  testType: string;
  testVersionId: string;
  versionNumber: number;
  startAt: string | null;
  deadlineAt: string | null;
  maxAttempts: number;
  timingPolicy: string;
  mode: string;
  integrityPolicy: Record<string, unknown>;
  resultVisibility: string;
  status: string;
  report: Array<{
    userId: string;
    email: string;
    displayName: string;
    attemptsUsed: number;
    status: 'NOT_STARTED' | 'IN_PROGRESS' | 'SUBMITTED' | 'OVERDUE';
    bestRawScore: number | null;
    bestTotalQuestions: number | null;
    bestBand: number | null;
    latestAttemptId: string | null;
    latestSubmittedAt: string | null;
    integrityEventCount: number;
    writingSubmitted: number;
  }>;
}

export function AssignmentPage() {
  const { assignmentId = '' } = useParams();
  const { data, loading, error, reload } = useAsync<AssignmentDetail>(
    () => api.get(`/api/teacher/assignments/${assignmentId}`),
    [assignmentId],
  );
  const [editing, setEditing] = useState(false);
  const [deadline, setDeadline] = useState('');
  const [maxAttempts, setMaxAttempts] = useState(1);
  const toast = useToast();

  if (loading) return <Loading label="Loading assignment report…" />;
  if (error) return <Notice tone="danger">{error}</Notice>;
  if (!data) return null;

  const submitted = data.report.filter((row) => row.status === 'SUBMITTED').length;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <Link to={`/teacher/classrooms/${data.classroomId}`} className="small">
            ← {data.classroomName}
          </Link>
          <h1>{data.title}</h1>
          <p className="page-head__meta">
            {data.testTitle} · {TEST_TYPE_LABELS[data.testType]} · v{data.versionNumber} · {MODE_LABELS[data.mode]} · results{' '}
            {data.resultVisibility.toLowerCase().replace(/_/g, ' ')}
          </p>
        </div>
        <div className="row">
          <Button
            onClick={() => {
              setDeadline(data.deadlineAt ? toLocalInput(data.deadlineAt) : '');
              setMaxAttempts(data.maxAttempts);
              setEditing(true);
            }}
          >
            Edit settings
          </Button>
          <ConfirmButton
            title="Close this assignment"
            confirmLabel="Close assignment"
            variant="danger"
            onConfirm={async () => {
              await api.delete(`/api/teacher/assignments/${assignmentId}`);
              await reload();
            }}
            body={<p>Students will no longer be able to start new attempts. Existing attempts and results are preserved.</p>}
          >
            Close assignment
          </ConfirmButton>
        </div>
      </div>

      <div className="grid grid--4">
        <Stat label="Assigned" value={data.report.length} />
        <Stat label="Submitted" value={submitted} hint={`${data.report.length ? Math.round((submitted / data.report.length) * 100) : 0}% completion`} />
        <Stat label="Deadline" value={data.deadlineAt ? formatDateTime(data.deadlineAt) : 'None'} />
        <Stat label="Attempts allowed" value={data.maxAttempts} />
      </div>

      <Card title="Students" hint="Ordered by name. Integrity counts are observable events, not verdicts." flush>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Student</th>
                <th>Status</th>
                <th className="num">Attempts</th>
                <th className="num">Best raw</th>
                <th className="num">Best est. band</th>
                <th className="num">Integrity events</th>
                <th className="num">Writing</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.report.map((row) => (
                <tr key={row.userId}>
                  <td>
                    {row.displayName}
                    <div className="tiny muted">{row.email}</div>
                  </td>
                  <td>
                    <Badge tone={statusTone(row.status)}>{STATUS_LABELS[row.status]}</Badge>
                  </td>
                  <td className="num">
                    {row.attemptsUsed}/{data.maxAttempts}
                  </td>
                  <td className="num">{row.bestRawScore !== null ? formatScore(row.bestRawScore, row.bestTotalQuestions) : '—'}</td>
                  <td className="num">{formatBand(row.bestBand)}</td>
                  <td className="num">{row.integrityEventCount}</td>
                  <td className="num">{row.writingSubmitted}</td>
                  <td className="right">
                    <div className="row" style={{ justifyContent: 'flex-end' }}>
                      {row.writingSubmitted > 0 ? (
                        <Link className="btn btn--sm" to="/teacher/marking">
                          Mark writing
                        </Link>
                      ) : null}
                      <Link className="btn btn--sm" to={`/teacher/students/${row.userId}`}>
                        Progress
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.report.length === 0 ? <EmptyState title="No students enrolled" /> : null}
      </Card>

      <Modal
        open={editing}
        title="Assignment settings"
        onClose={() => setEditing(false)}
        actions={
          <>
            <Button onClick={() => setEditing(false)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={async () => {
                try {
                  await api.patch(`/api/teacher/assignments/${assignmentId}`, {
                    deadlineAt: deadline ? new Date(deadline).toISOString() : null,
                    maxAttempts,
                  });
                  await reload();
                  setEditing(false);
                  toast.push('Assignment updated.', 'success');
                } catch (updateError) {
                  toast.push(describeError(updateError), 'error');
                }
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <Field label="Deadline">
          {(id) => <TextInput id={id} type="datetime-local" value={deadline} onChange={(event) => setDeadline(event.target.value)} />}
        </Field>
        <Field label="Maximum attempts">
          {(id) => (
            <TextInput
              id={id}
              type="number"
              min={1}
              max={20}
              value={maxAttempts}
              onChange={(event) => setMaxAttempts(Number(event.target.value))}
            />
          )}
        </Field>
      </Modal>
    </div>
  );
}

function toLocalInput(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// ---------------------------------------------------------------------------
// Student detail (teacher view)
// ---------------------------------------------------------------------------
interface StudentDetail {
  student: { id: string; email: string; displayName: string; createdAt: string; lastLoginAt: string | null; targetBand: number | null };
  classrooms: Array<{ id: string; name: string }>;
  attempts: Array<{
    attemptId: string;
    testTitle: string;
    testType: string;
    versionNumber: number;
    status: string;
    startedAt: string;
    submittedAt: string | null;
    rawScore: number | null;
    totalQuestions: number | null;
    estimatedBand: number | null;
    mode: string;
    integrityCounted: number;
    integrityTotal: number;
  }>;
  skillPerformance: Array<{ skill: string; rawScore: number; totalQuestions: number; accuracy: number | null; latestBand: number | null }>;
  taskTypes: Array<{ label: string; correct: number; answered: number; accuracy: number | null }>;
  writing: Array<{
    submissionId: string;
    attemptId: string;
    testTitle: string;
    taskLabel: string;
    wordCount: number;
    submittedAt: string | null;
    responseText: string;
    prompt: string;
    scoreBand: number | null;
    feedback: string;
    scoringSource: string | null;
    criteria?: Record<string, number>;
  }>;
}

export function StudentDetailPage() {
  const { userId = '' } = useParams();
  const [selectedAttempt, setSelectedAttempt] = useState<string | null>(null);
  const [marking, setMarking] = useState<StudentDetail['writing'][number] | null>(null);
  const { data, loading, error, reload } = useAsync<StudentDetail>(() => api.get(`/api/teacher/students/${userId}`), [userId]);
  const attempt = useAsync<AttemptResultPayload>(
    () => api.get(`/api/teacher/attempts/${selectedAttempt}`),
    [selectedAttempt],
    { immediate: Boolean(selectedAttempt) },
  );

  if (loading) return <Loading label="Loading student record…" />;
  if (error) return <Notice tone="danger">{error}</Notice>;
  if (!data) return null;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>{data.student.displayName}</h1>
          <p className="page-head__meta">
            {data.student.email} · joined {formatDateTime(data.student.createdAt)} · last sign-in{' '}
            {data.student.lastLoginAt ? formatDateTime(data.student.lastLoginAt) : 'never'}
          </p>
        </div>
      </div>

      <div className="grid grid--3">
        {data.skillPerformance.map((skill) => (
          <Stat
            key={skill.skill}
            label={SKILL_LABELS[skill.skill] ?? skill.skill}
            value={formatScore(skill.rawScore, skill.totalQuestions)}
            hint={`${formatPercent(skill.accuracy)} accuracy${skill.latestBand ? ` · latest estimated band ${formatBand(skill.latestBand)}` : ''}`}
          />
        ))}
      </div>

      <Card title="Attempts" flush>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Test</th>
                <th>Mode</th>
                <th>Started</th>
                <th className="num">Raw</th>
                <th className="num">Est. band</th>
                <th className="num">Integrity</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.attempts.map((row) => (
                <tr key={row.attemptId}>
                  <td>
                    {row.testTitle}
                    <div className="tiny muted">
                      {TEST_TYPE_LABELS[row.testType]} · v{row.versionNumber}
                    </div>
                  </td>
                  <td>{MODE_LABELS[row.mode] ?? row.mode}</td>
                  <td className="nowrap">{formatDateTime(row.startedAt)}</td>
                  <td className="num">{row.rawScore !== null ? formatScore(row.rawScore, row.totalQuestions) : '—'}</td>
                  <td className="num">{formatBand(row.estimatedBand)}</td>
                  <td className="num">
                    {row.integrityCounted}
                    <span className="tiny muted">/{row.integrityTotal}</span>
                  </td>
                  <td>
                    <Badge tone={statusTone(row.status)}>{row.status.replace('_', ' ').toLowerCase()}</Badge>
                  </td>
                  <td className="right">
                    <Button size="sm" onClick={() => setSelectedAttempt(row.attemptId)}>
                      Review
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.attempts.length === 0 ? <EmptyState title="No attempts recorded" /> : null}
      </Card>

      <Card title="Task-type accuracy">
        <AccuracyList
          items={data.taskTypes.map((task) => ({
            label: task.label,
            correct: task.correct,
            total: task.answered,
            accuracy: task.accuracy,
          }))}
        />
      </Card>

      <Card title="Writing submissions" flush>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Test</th>
                <th>Task</th>
                <th className="num">Words</th>
                <th className="num">Band</th>
                <th>Source</th>
                <th>Submitted</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.writing.map((row) => (
                <tr key={row.submissionId}>
                  <td>{row.testTitle}</td>
                  <td>{row.taskLabel}</td>
                  <td className="num">{row.wordCount}</td>
                  <td className="num">{formatBand(row.scoreBand)}</td>
                  <td>{row.scoringSource ? row.scoringSource.toLowerCase() : 'Awaiting marking'}</td>
                  <td className="nowrap">{formatDateTime(row.submittedAt)}</td>
                  <td className="right">
                    <Button size="sm" variant="primary" onClick={() => setMarking(row)}>
                      {row.scoreBand != null ? 'Edit mark' : 'Mark'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.writing.length === 0 ? <EmptyState title="No writing submissions" /> : null}
      </Card>

      <Modal
        open={Boolean(selectedAttempt)}
        wide
        title="Attempt review"
        onClose={() => setSelectedAttempt(null)}
        actions={<Button onClick={() => setSelectedAttempt(null)}>Close</Button>}
      >
        {attempt.loading ? <Loading label="Loading attempt…" /> : null}
        {attempt.error ? <Notice tone="danger">{attempt.error}</Notice> : null}
        {attempt.data ? (
          <ResultSummary result={attempt.data} marking={{ apiBase: '/api/teacher', onSaved: attempt.reload }} />
        ) : null}
      </Modal>

      <Modal
        open={Boolean(marking)}
        wide
        title={marking ? `Mark ${marking.taskLabel}` : 'Mark writing'}
        onClose={() => setMarking(null)}
        actions={<Button onClick={() => setMarking(null)}>Close</Button>}
      >
        {marking ? (
          <WritingMarkForm
            apiBase="/api/teacher"
            submissionId={marking.submissionId}
            taskLabel={marking.taskLabel}
            wordCount={marking.wordCount}
            prompt={marking.prompt}
            responseText={marking.responseText}
            existing={
              marking.scoringSource
                ? {
                    band: marking.scoreBand,
                    feedback: marking.feedback,
                    source: marking.scoringSource,
                    scoredAt: marking.submittedAt ?? '',
                    criteria: marking.criteria ?? {},
                  }
                : null
            }
            onSaved={async () => {
              await reload();
              setMarking(null);
            }}
          />
        ) : null}
      </Modal>
    </div>
  );
}
