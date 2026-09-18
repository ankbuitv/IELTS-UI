import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiRequestError, api, describeError, queryString } from '../../lib/api';
import { useAsync } from '../../hooks/useAsync';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Field,
  KeyValue,
  Loading,
  Modal,
  Notice,
  Select,
  Tabs,
  TextInput,
  useToast,
} from '../../components/ui';
import { ResultSummary, type AttemptResultPayload } from '../../components/ResultView';
import { AccuracyList } from '../../components/charts';
import { AttemptTable, SkillPerformanceTable, TrendBars } from './Dashboard';
import type { AttemptSummary, CatalogTest, StudentDashboard } from './types';
import {
  BAND_DISCLAIMER,
  formatBand,
  formatDateTime,
  formatDuration,
  formatPercent,
  formatScore,
  MODE_LABELS,
  SKILL_LABELS,
  TEST_TYPE_LABELS,
} from '../../lib/format';
import { useAuth } from '../../context/AuthContext';

// ---------------------------------------------------------------------------
// Practice catalogue
// ---------------------------------------------------------------------------
export function PracticePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [testType, setTestType] = useState('');
  const [starting, setStarting] = useState<string | null>(null);
  const [strict, setStrict] = useState(false);
  const [codePrompt, setCodePrompt] = useState<CatalogTest | null>(null);
  const [accessCode, setAccessCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);

  const { data, loading, error, reload } = useAsync<{ tests: CatalogTest[] }>(() => api.get('/api/tests'), []);

  const start = async (test: CatalogTest, code?: string) => {
    if (test.requiresAccessCode && !test.unlocked && !code) {
      setCodePrompt(test);
      setAccessCode('');
      setCodeError(null);
      return;
    }
    setStarting(test.id);
    setCodeError(null);
    try {
      const result = await api.post<{ attemptId: string }>('/api/attempts', {
        testId: test.id,
        mode: strict ? 'STANDARD_EXAM' : 'PRACTICE',
        ...(code ? { accessCode: code } : {}),
      });
      navigate(`/exam/${result.attemptId}`);
    } catch (startError) {
      if (startError instanceof ApiRequestError && startError.code === 'ACCESS_CODE_REQUIRED') {
        setCodePrompt(test);
        setAccessCode('');
        setCodeError(null);
        return;
      }
      if (codePrompt && startError instanceof ApiRequestError && startError.status === 403) {
        setCodeError(describeError(startError));
        return;
      }
      toast.push(describeError(startError), 'error');
    } finally {
      setStarting(null);
    }
  };

  if (loading) return <Loading label="Loading the published catalogue…" />;
  if (error) return <Notice tone="danger">{error}</Notice>;

  const tests = (data?.tests ?? []).filter((test) => !testType || test.type === testType);

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Published practice tests</h1>
          <p className="page-head__meta">
            Only tests that an administrator has published and frozen appear here. Versions never change underneath you.
          </p>
        </div>
        <div className="filter-bar">
          <label className="field">
            <span className="field__label">Type</span>
            <select value={testType} onChange={(event) => setTestType(event.target.value)}>
              <option value="">All</option>
              <option value="READING">Reading</option>
              <option value="LISTENING">Listening</option>
              <option value="WRITING">Writing</option>
              <option value="FULL_MOCK">Full mock</option>
            </select>
          </label>
        </div>
      </div>

      <Notice tone="info" title="Practice mode">
        <span>
          Practice attempts do not enforce fullscreen or copy rules. Self-start a standard-exam mode attempt with the
          checkbox below if you want the monitored environment.
        </span>
        <div style={{ marginTop: 8 }}>
          <Checkbox checked={strict} onChange={setStrict} label="Start in standard exam mode (monitoring on, no fullscreen requirement)" />
        </div>
      </Notice>

      {tests.length === 0 ? (
        <Card>
          <EmptyState title="No published tests yet">
            Ask your teacher or administrator to publish a test, or join a classroom to receive an assignment.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid grid--3">
          {tests.map((test) => (
            <div className="card" key={test.id}>
              <div className="row row--between">
                <Badge tone="accent">{TEST_TYPE_LABELS[test.type] ?? test.type}</Badge>
                <span className="tiny muted">v{test.versionNumber}</span>
              </div>
              {test.requiresAccessCode ? (
                <div style={{ marginTop: 8 }}>
                  {test.unlocked ? (
                    <Badge tone="success">🔓 Unlocked</Badge>
                  ) : (
                    <Badge tone="warning">🔒 Requires access code</Badge>
                  )}
                </div>
              ) : null}
              <h3 style={{ marginTop: 10 }}>{test.title}</h3>
              <p className="small muted">{test.summary || 'Practice material.'}</p>
              <KeyValue
                items={[
                  ['Questions', test.type === 'FULL_MOCK' ? `${test.mockComponentCount} components` : String(test.totalQuestions)],
                  ['Duration', formatDuration(test.durationSeconds)],
                  [
                    'Estimated band',
                    test.isCompleteTest && (test.type === 'READING' || test.type === 'LISTENING')
                      ? 'Available for complete tests'
                      : 'Not offered for this test',
                  ],
                  ['Origin', test.contentOrigin.replace('_', ' ').toLowerCase()],
                ]}
              />
              <Button
                variant="primary"
                block
                style={{ marginTop: 12 }}
                loading={starting === test.id}
                onClick={() => void start(test)}
              >
                {test.requiresAccessCode && !test.unlocked ? 'Unlock & start' : 'Start attempt'}
              </Button>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={codePrompt !== null}
        title={codePrompt ? `Unlock “${codePrompt.title}”` : 'Unlock test'}
        onClose={() => {
          setCodePrompt(null);
          setCodeError(null);
          void reload();
        }}
        actions={
          <>
            <Button
              onClick={() => {
                setCodePrompt(null);
                setCodeError(null);
                void reload();
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={starting !== null}
              disabled={!accessCode.trim()}
              onClick={() => codePrompt && void start(codePrompt, accessCode)}
            >
              Unlock & start
            </Button>
          </>
        }
      >
        <p className="small muted">
          This test is protected by an access code. Ask your teacher for the code — you only need to enter it once.
        </p>
        {codeError ? <Notice tone="danger">{codeError}</Notice> : null}
        <Field label="Access code" required>
          {(id) => (
            <TextInput
              id={id}
              value={accessCode}
              autoComplete="off"
              placeholder="e.g. READING-01"
              onChange={(event) => setAccessCode(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && codePrompt && accessCode.trim() && !starting) {
                  void start(codePrompt, accessCode);
                }
              }}
            />
          )}
        </Field>
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Attempt history
// ---------------------------------------------------------------------------
export function AttemptHistoryPage() {
  const [filters, setFilters] = useState({ from: '', to: '', skill: '', testType: '' });
  const query = queryString({
    from: filters.from ? new Date(filters.from).toISOString() : undefined,
    to: filters.to ? new Date(`${filters.to}T23:59:59`).toISOString() : undefined,
    skill: filters.skill || undefined,
    testType: filters.testType || undefined,
    limit: 200,
  });

  const { data, loading, error } = useAsync<{ attempts: AttemptSummary[] }>(
    () => api.get(`/api/student/attempts${query}`),
    [query],
  );

  if (loading) return <Loading label="Loading attempt history…" />;
  if (error) return <Notice tone="danger">{error}</Notice>;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Attempt history</h1>
          <p className="page-head__meta">Raw scores are facts; estimated bands are practice indications from a configured conversion table.</p>
        </div>
      </div>

      <Card>
        <div className="filter-bar">
          <label className="field">
            <span className="field__label">From</span>
            <input type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} />
          </label>
          <label className="field">
            <span className="field__label">To</span>
            <input type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} />
          </label>
          <label className="field">
            <span className="field__label">Skill</span>
            <select value={filters.skill} onChange={(event) => setFilters({ ...filters, skill: event.target.value })}>
              <option value="">All</option>
              <option value="READING">Reading</option>
              <option value="LISTENING">Listening</option>
              <option value="WRITING">Writing</option>
            </select>
          </label>
          <label className="field">
            <span className="field__label">Type</span>
            <select value={filters.testType} onChange={(event) => setFilters({ ...filters, testType: event.target.value })}>
              <option value="">All</option>
              <option value="READING">Reading</option>
              <option value="LISTENING">Listening</option>
              <option value="WRITING">Writing</option>
              <option value="FULL_MOCK">Full mock</option>
            </select>
          </label>
        </div>
      </Card>

      <Card flush>
        {data && data.attempts.length > 0 ? (
          <AttemptTable attempts={data.attempts} />
        ) : (
          <EmptyState title="No attempts match these filters" />
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single attempt result
// ---------------------------------------------------------------------------
export function AttemptResultPage() {
  const { attemptId = '' } = useParams();
  const { data, loading, error } = useAsync<AttemptResultPayload>(
    () => api.get(`/api/attempts/${attemptId}/result`),
    [attemptId],
  );

  if (loading) return <Loading label="Loading your result…" />;
  if (error) return <Notice tone="danger">{error}</Notice>;
  if (!data) return null;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>{data.testTitle}</h1>
          <p className="page-head__meta">
            {TEST_TYPE_LABELS[data.testType] ?? data.testType} · version {data.versionNumber} ·{' '}
            {MODE_LABELS[data.mode] ?? data.mode} · {formatDateTime(data.submittedAt)}
          </p>
        </div>
        <Link className="btn" to="/history">
          Back to history
        </Link>
      </div>
      <ResultSummary result={data} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Analytics detail page
// ---------------------------------------------------------------------------
export function StudentAnalyticsPage() {
  const { data, loading, error } = useAsync<StudentDashboard>(() => api.get('/api/student/dashboard'), []);

  if (loading) return <Loading label="Loading analytics…" />;
  if (error) return <Notice tone="danger">{error}</Notice>;
  if (!data) return null;

  return (
    <div className="stack">
      <h1>Your analytics</h1>
      <div className="grid grid--2">
        <Card title="Raw score trend" hint="Each bar is a submitted attempt">
          <TrendBars trends={data.trends} />
        </Card>
        <Card title="Task-type accuracy">
          <AccuracyList
            items={data.taskTypes.map((taskType) => ({
              label: taskType.label,
              correct: taskType.correct,
              total: taskType.answered,
              accuracy: taskType.accuracy,
            }))}
          />
        </Card>
      </div>
      <Card title="Skill performance" flush>
        <SkillPerformanceTable items={data.skillPerformance} />
      </Card>
      <p className="tiny muted">{BAND_DISCLAIMER}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Student classrooms + profile
// ---------------------------------------------------------------------------
export function StudentClassroomsPage() {
  const { data, loading, error } = useAsync<{
    classrooms: Array<{ id: string; name: string; description: string; role: string; activeAssignments: number }>;
  }>(() => api.get('/api/classrooms/mine'), []);

  if (loading) return <Loading />;
  if (error) return <Notice tone="danger">{error}</Notice>;

  return (
    <div className="stack">
      <h1>Your classrooms</h1>
      <Card>
        <JoinByCode />
      </Card>
      {data && data.classrooms.length === 0 ? (
        <Card>
          <EmptyState title="You are not enrolled yet">Use an invitation link or class code to join.</EmptyState>
        </Card>
      ) : (
        <div className="grid grid--3">
          {data?.classrooms.map((classroom) => (
            <div className="card" key={classroom.id}>
              <h3>{classroom.name}</h3>
              <p className="small muted">{classroom.description || 'No description.'}</p>
              <Badge tone="neutral">
                {classroom.activeAssignments} active assignment{classroom.activeAssignments === 1 ? '' : 's'}
              </Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function JoinByCode() {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const navigate = useNavigate();

  return (
    <form
      className="row"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        try {
          const result = await api.post<{ classroomName: string }>('/api/classrooms/join', { code });
          toast.push(`Joined ${result.classroomName}.`, 'success');
          navigate(0);
        } catch (joinError) {
          toast.push(describeError(joinError), 'error');
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="field" style={{ marginBottom: 0 }}>
        <label className="field__label" htmlFor="join-code">
          Join a classroom with a class code
        </label>
        <TextInput
          id="join-code"
          value={code}
          placeholder="e.g. 7KQ2MB"
          onChange={(event) => setCode(event.target.value.toUpperCase())}
        />
      </div>
      <Button type="submit" variant="primary" loading={busy} style={{ marginTop: 20 }}>
        Join
      </Button>
    </form>
  );
}

export function ProfilePage() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [targetBand, setTargetBand] = useState('');
  const [passwords, setPasswords] = useState({ current: '', next: '' });
  const [busy, setBusy] = useState(false);
  const [tabs, setTabs] = useState<'profile' | 'security'>('profile');

  return (
    <div className="stack">
      <h1>Your profile</h1>
      <Tabs
        tabs={[
          { id: 'profile', label: 'Profile' },
          { id: 'security', label: 'Security' },
        ]}
        value={tabs}
        onChange={setTabs}
      />

      {tabs === 'profile' ? (
        <Card title="Profile details" hint={user?.email}>
          <Field label="Display name" required>
            {(id) => <TextInput id={id} value={displayName} onChange={(event) => setDisplayName(event.target.value)} />}
          </Field>
          <Field label="Target band" hint="Optional. Shown only to you and your teachers as a goal, never as a score.">
            {(id) => (
              <Select id={id} value={targetBand} onChange={(event) => setTargetBand(event.target.value)}>
                <option value="">Not set</option>
                {[5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9].map((band) => (
                  <option key={band} value={band}>
                    {band.toFixed(1)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api.patch('/api/auth/profile', {
                  displayName,
                  targetBand: targetBand ? Number(targetBand) : null,
                });
                await refresh();
                toast.push('Profile updated.', 'success');
              } catch (profileError) {
                toast.push(describeError(profileError), 'error');
              } finally {
                setBusy(false);
              }
            }}
          >
            Save profile
          </Button>
        </Card>
      ) : (
        <Card title="Change password" hint="Changing your password signs out all other sessions.">
          <Field label="Current password" required>
            {(id) => (
              <TextInput
                id={id}
                type="password"
                autoComplete="current-password"
                value={passwords.current}
                onChange={(event) => setPasswords({ ...passwords, current: event.target.value })}
              />
            )}
          </Field>
          <Field label="New password" required hint="At least 10 characters with upper case, lower case and a number.">
            {(id) => (
              <TextInput
                id={id}
                type="password"
                autoComplete="new-password"
                value={passwords.next}
                onChange={(event) => setPasswords({ ...passwords, next: event.target.value })}
              />
            )}
          </Field>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api.post('/api/auth/password', { currentPassword: passwords.current, newPassword: passwords.next });
                toast.push('Password changed. Please sign in again.', 'success');
                await refresh();
              } catch (passwordError) {
                toast.push(describeError(passwordError), 'error');
              } finally {
                setBusy(false);
              }
            }}
          >
            Change password
          </Button>
        </Card>
      )}

      <Card title="Data and privacy">
        <p className="small muted">
          Your answers, results and integrity events are visible to you and to the teachers of classrooms you have joined.
          Administrators can see attempts for platform administration. Passwords are stored as salted PBKDF2 hashes and can
          never be read by staff.
        </p>
      </Card>
    </div>
  );
}

export { formatBand, formatScore, formatPercent, SKILL_LABELS };
