import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ApiRequestError, api, describeError, queryString } from '../../lib/api';
import { useAsync } from '../../hooks/useAsync';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Chips,
  EmptyState,
  Field,
  Loading,
  Modal,
  Notice,
  Select,
  SkillGlyph,
  skillClass,
  Tabs,
  TextInput,
  useToast,
} from '../../components/ui';
import { Icon, type IconName } from '../../components/Icon';
import { ResultSummary, type AttemptResultPayload } from '../../components/ResultView';
import { AccuracyList } from '../../components/charts';
import { SkillPerformanceTable, TrendBars } from './Dashboard';
import { AttemptList, newestFirst } from '../../components/AttemptList';
import type { AttemptSummary, CatalogTest, StudentDashboard } from './types';
import {
  BAND_DISCLAIMER,
  daysSince,
  formatBand,
  formatDateTime,
  formatPercent,
  formatScore,
  relativeTime,
  SKILL_LABELS,
  TEST_TYPE_LABELS,
} from '../../lib/format';
import { useAuth } from '../../context/AuthContext';

// ---------------------------------------------------------------------------
// Practice catalogue
// ---------------------------------------------------------------------------
type SortKey = 'newest' | 'oldest' | 'title' | 'short';

const SORT_LABELS: Record<SortKey, string> = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  title: 'A → Z',
  short: 'Shortest first',
};

/** When a test went live; falls back to its last edit for rows from before `publishedAt` existed. */
function publishedMs(test: CatalogTest): number {
  const value = Date.parse(test.publishedAt ?? test.updatedAt);
  return Number.isNaN(value) ? 0 : value;
}

export function sortTests(tests: CatalogTest[], sort: SortKey): CatalogTest[] {
  const byTitle = (a: CatalogTest, b: CatalogTest) => a.title.localeCompare(b.title);
  const copy = [...tests];
  switch (sort) {
    case 'oldest':
      return copy.sort((a, b) => publishedMs(a) - publishedMs(b) || byTitle(a, b));
    case 'title':
      return copy.sort(byTitle);
    case 'short':
      return copy.sort(
        (a, b) => (a.durationSeconds ?? Number.MAX_SAFE_INTEGER) - (b.durationSeconds ?? Number.MAX_SAFE_INTEGER) || byTitle(a, b),
      );
    default:
      return copy.sort((a, b) => publishedMs(b) - publishedMs(a) || byTitle(a, b));
  }
}

/** What kind of band a test produces, so the catalogue never promises one it cannot give. */
function bandLabel(test: CatalogTest): string {
  if (test.type === 'WRITING') return 'Marked by AI judges';
  if (test.type === 'READING' || test.type === 'LISTENING') {
    if (test.isCompleteTest) return 'Estimated band';
    return test.totalQuestions >= 8 ? 'Projected band' : 'Raw score only';
  }
  if (test.type === 'FULL_MOCK') return 'Band per skill';
  return '';
}

function bandHint(test: CatalogTest): string {
  if (test.type === 'WRITING') return 'Judge01 and Judge02 mark each task as soon as you submit.';
  if (test.isCompleteTest) return 'A complete paper converts straight to an estimated band.';
  if (test.type === 'READING' || test.type === 'LISTENING') {
    return test.totalQuestions >= 8
      ? 'Your score on this short set is scaled to a full paper to give a projected band.'
      : 'Too few questions to place a band on; you get the raw score.';
  }
  return '';
}

const SKILL_TILES: Array<{ type: string; skill: 'mock' | 'listening' | 'reading' | 'writing'; icon: IconName; label: string }> = [
  { type: '', skill: 'mock', icon: 'layers', label: 'All tests' },
  { type: 'LISTENING', skill: 'listening', icon: 'headphones', label: 'Listening' },
  { type: 'READING', skill: 'reading', icon: 'book', label: 'Reading' },
  { type: 'WRITING', skill: 'writing', icon: 'pen', label: 'Writing' },
  { type: 'FULL_MOCK', skill: 'mock', icon: 'award', label: 'Full mocks' },
];

export function PracticePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const [testType, setTestType] = useState(() => {
    const skill = params.get('skill');
    return skill && ['READING', 'LISTENING', 'WRITING', 'FULL_MOCK'].includes(skill) ? skill : '';
  });
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('newest');
  const [starting, setStarting] = useState<string | null>(null);
  const [strict, setStrict] = useState(false);
  const [codePrompt, setCodePrompt] = useState<CatalogTest | null>(null);
  const [accessCode, setAccessCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);

  const { data, loading, error, reload } = useAsync<{ tests: CatalogTest[] }>(() => api.get('/api/tests'), []);

  const start = async (test: CatalogTest, code?: string, sectionIds?: string[]) => {
    if (test.requiresAccessCode && !test.unlocked && !code) {
      setCodePrompt(test);
      setAccessCode('');
      setCodeError(null);
      return;
    }
    setStarting(sectionIds ? `${test.id}:${sectionIds.join(',')}` : test.id);
    setCodeError(null);
    try {
      const result = await api.post<{ attemptId: string }>('/api/attempts', {
        testId: test.id,
        mode: strict ? 'STANDARD_EXAM' : 'PRACTICE',
        // A scoped practice set: only these sections are timed, shown and marked.
        ...(sectionIds && sectionIds.length > 0 ? { sectionIds } : {}),
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

  const all = useMemo(() => data?.tests ?? [], [data]);
  const counts = useMemo(() => {
    const result: Record<string, number> = { '': all.length };
    for (const test of all) result[test.type] = (result[test.type] ?? 0) + 1;
    return result;
  }, [all]);
  const tests = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const matching = all.filter(
      (test) =>
        (!testType || test.type === testType) &&
        (!needle || `${test.title} ${test.summary}`.toLowerCase().includes(needle)),
    );
    return sortTests(matching, sort);
  }, [all, testType, search, sort]);

  if (loading) return <Loading label="Loading the published catalogue…" />;
  if (error) return <Notice tone="danger">{error}</Notice>;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Practice tests</h1>
          <p className="page-head__meta">Published and frozen by an administrator, newest first. A version never changes underneath you.</p>
        </div>
      </div>

      <div className="skill-tiles" role="group" aria-label="Filter by paper">
        {SKILL_TILES.filter((tile) => tile.type !== 'FULL_MOCK' || (counts.FULL_MOCK ?? 0) > 0).map((tile) => {
          const count = counts[tile.type] ?? 0;
          const active = testType === tile.type;
          return (
            <button
              key={tile.type || 'all'}
              type="button"
              className={`skill-tile skill-${tile.skill}${active ? ' is-on' : ''}`}
              aria-pressed={active}
              disabled={count === 0 && !active}
              onClick={() => setTestType(active ? '' : tile.type)}
            >
              <span className="skill-tile__icon">
                <Icon name={tile.icon} size={20} strokeWidth={2} />
              </span>
              <span className="skill-tile__text">
                <b>{tile.label}</b>
                <small>{count === 0 ? 'None published yet' : `${count} test${count === 1 ? '' : 's'}`}</small>
              </span>
            </button>
          );
        })}
        <Link className="skill-tile skill-speaking" to="/speaking">
          <span className="skill-tile__icon">
            <Icon name="mic" size={20} strokeWidth={2} />
          </span>
          <span className="skill-tile__text">
            <b>Speaking</b>
            <small>Record and get feedback</small>
          </span>
          <Icon name="arrowRight" size={16} strokeWidth={2.2} className="skill-tile__go" />
        </Link>
      </div>

      <div className="toolbar toolbar--end">
        <div className="toolbar__end">
          <label className="search">
            <Icon name="search" size={15} />
            <input
              type="search"
              value={search}
              placeholder="Search tests"
              aria-label="Search tests"
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <select value={sort} aria-label="Sort tests" onChange={(event) => setSort(event.target.value as SortKey)}>
            {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
              <option key={key} value={key}>
                {SORT_LABELS[key]}
              </option>
            ))}
          </select>
          <span title="Exam mode also blocks copy and paste and records fullscreen exits for your teacher. The tab lock (three strikes, then the attempt is submitted) applies in every mode.">
            <Checkbox checked={strict} onChange={setStrict} label="Exam mode" />
          </span>
        </div>
      </div>

      {tests.length === 0 ? (
        <Card>
          <EmptyState title={all.length === 0 ? 'No published tests yet' : 'No tests match'} icon="search">
            {all.length === 0
              ? 'Ask your teacher or administrator to publish a test, or join a classroom to receive an assignment.'
              : 'Try another type or clear the search box.'}
          </EmptyState>
        </Card>
      ) : (
        <div className="test-grid">
          {tests.map((test) => {
            const age = daysSince(test.publishedAt ?? test.updatedAt);
            const isNew = age !== null && age <= 14;
            const locked = test.requiresAccessCode && !test.unlocked;
            const sections = test.sections ?? [];
            return (
              <article className={`test-card ${skillClass(test.type)}`} key={test.id}>
                <header className="test-card__head">
                  <SkillGlyph type={test.type} size={17} />
                  <div className="test-card__titles">
                    <h3>{test.title}</h3>
                    <div className="test-card__chips">
                      <span className="skill-chip">{TEST_TYPE_LABELS[test.type] ?? test.type}</span>
                      {isNew ? <Badge tone="success" plain>New</Badge> : null}
                      {locked ? (
                        <Badge tone="warning" plain>
                          <Icon name="lock" size={11} /> Code
                        </Badge>
                      ) : test.requiresAccessCode ? (
                        <Badge tone="success" plain>Unlocked</Badge>
                      ) : null}
                    </div>
                  </div>
                </header>

                {test.summary ? <p className="test-card__summary">{test.summary}</p> : null}

                <div className="test-card__meta">
                  <span>
                    <Icon name="list" size={13} />
                    {test.type === 'FULL_MOCK' ? `${test.mockComponentCount} parts` : `${test.totalQuestions} questions`}
                  </span>
                  <span>
                    <Icon name="clock" size={13} />
                    {test.durationSeconds ? `${Math.round(test.durationSeconds / 60)} min` : 'Untimed'}
                  </span>
                  <span title={formatDateTime(test.publishedAt ?? test.updatedAt)}>
                    <Icon name="calendar" size={13} />
                    {relativeTime(test.publishedAt ?? test.updatedAt)}
                  </span>
                </div>

                <div className="test-card__actions">
                  <Button variant="primary" size="sm" loading={starting === test.id} onClick={() => void start(test)}>
                    {locked ? 'Unlock & start' : 'Start'}
                  </Button>
                  <span className="tiny muted" title={bandHint(test)}>
                    {bandLabel(test)}
                  </span>
                </div>

                {/* Short practice sets: one section, or the first N. Every set is
                    marked on its own questions (and projected to a full-test band). */}
                {sections.length > 1 ? (
                  <details className="test-card__parts">
                    <summary>Practise by part</summary>
                    <div className="set-picker">
                      {sections.map((section, index) => (
                        <button
                          key={section.id}
                          type="button"
                          className="set-chip"
                          disabled={starting !== null}
                          onClick={() => void start(test, undefined, [section.id])}
                          title={`${section.totalQuestions} câu${section.durationSeconds ? ` · ${Math.round(section.durationSeconds / 60)} phút` : ''}`}
                        >
                          {section.label || `Phần ${index + 1}`}
                          <span className="set-chip__count">{section.totalQuestions} câu</span>
                        </button>
                      ))}
                      {[2, 3, 4]
                        .filter((count) => count < sections.length)
                        .map((count) => (
                          <button
                            key={count}
                            type="button"
                            className="set-chip set-chip--all"
                            disabled={starting !== null}
                            onClick={() =>
                              void start(
                                test,
                                undefined,
                                sections.slice(0, count).map((section) => section.id),
                              )
                            }
                          >
                            {count} phần đầu
                          </button>
                        ))}
                    </div>
                  </details>
                ) : null}
              </article>
            );
          })}
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
  const [range, setRange] = useState({ from: '', to: '' });
  const [type, setType] = useState('');
  const [search, setSearch] = useState('');
  const [oldestFirst, setOldestFirst] = useState(false);
  const query = queryString({
    from: range.from ? new Date(range.from).toISOString() : undefined,
    to: range.to ? new Date(`${range.to}T23:59:59`).toISOString() : undefined,
    limit: 200,
  });

  const { data, loading, error } = useAsync<{ attempts: AttemptSummary[] }>(
    () => api.get(`/api/student/attempts${query}`),
    [query],
  );

  const attempts = useMemo(() => data?.attempts ?? [], [data]);
  const counts = useMemo(() => {
    const result: Record<string, number> = { '': attempts.length };
    for (const attempt of attempts) result[attempt.testType] = (result[attempt.testType] ?? 0) + 1;
    return result;
  }, [attempts]);
  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const matching = attempts.filter(
      (attempt) => (!type || attempt.testType === type) && (!needle || attempt.testTitle.toLowerCase().includes(needle)),
    );
    const ordered = newestFirst(matching);
    return oldestFirst ? ordered.reverse() : ordered;
  }, [attempts, type, search, oldestFirst]);

  if (loading && !data) return <Loading label="Loading attempt history…" />;
  if (error) return <Notice tone="danger">{error}</Notice>;

  const typeOptions = [
    { id: '', label: 'All', count: counts[''] ?? 0 },
    ...(['READING', 'LISTENING', 'WRITING', 'FULL_MOCK'] as const)
      .filter((value) => (counts[value] ?? 0) > 0)
      .map((value) => ({ id: value as string, label: TEST_TYPE_LABELS[value] ?? value, count: counts[value] ?? 0 })),
  ];

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>My attempts</h1>
          <p className="page-head__meta">Most recent first. Raw scores are facts; bands are practice estimates.</p>
        </div>
      </div>

      <div className="toolbar">
        <Chips label="Test type" value={type} onChange={setType} options={typeOptions} />
        <div className="toolbar__end">
          <label className="search">
            <Icon name="search" size={15} />
            <input
              type="search"
              value={search}
              placeholder="Search attempts"
              aria-label="Search attempts"
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <select
            value={oldestFirst ? 'oldest' : 'newest'}
            aria-label="Sort attempts"
            onChange={(event) => setOldestFirst(event.target.value === 'oldest')}
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
          <details className="range">
            <summary className="btn btn--sm">
              <Icon name="calendar" size={13} />
              {range.from || range.to ? 'Dates · on' : 'Dates'}
            </summary>
            <div className="range__panel card">
              <label className="field">
                <span className="field__label">From</span>
                <input type="date" value={range.from} onChange={(event) => setRange({ ...range, from: event.target.value })} />
              </label>
              <label className="field">
                <span className="field__label">To</span>
                <input type="date" value={range.to} onChange={(event) => setRange({ ...range, to: event.target.value })} />
              </label>
              <Button size="sm" variant="ghost" onClick={() => setRange({ from: '', to: '' })}>
                Clear
              </Button>
            </div>
          </details>
        </div>
      </div>

      <Card flush>
        {shown.length > 0 ? (
          <AttemptList attempts={shown} />
        ) : (
          <EmptyState title={attempts.length === 0 ? 'No attempts yet' : 'No attempts match these filters'} icon="clock">
            {attempts.length === 0 ? (
              <Link className="btn btn--primary btn--sm" to="/practice" style={{ marginTop: 10 }}>
                Start a practice test
              </Link>
            ) : null}
          </EmptyState>
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
  const navigate = useNavigate();
  const toast = useToast();
  // Right-click and the developer tools are refused by the shell that renders
  // this page (AppShell), so the result screen does not mount its own copy.
  const [restarting, setRestarting] = useState<string | null>(null);
  const { data, loading, error, reload } = useAsync<AttemptResultPayload>(
    () => api.get(`/api/attempts/${attemptId}/result`),
    [attemptId],
  );

  // Only the first load replaces the page: a refresh after the judges answer must not unmount the report.
  if (loading && !data) return <Loading label="Loading your result…" />;
  if (error && !data) return <Notice tone="danger">{error}</Notice>;
  if (!data) return null;

  const wrongSectionIds = [
    ...new Set(
      data.sessions
        .flatMap((session) => (session.review ?? []).filter((item) => item.isCorrect === false).map((item) => item.sectionId))
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const startAttempt = async (scope: 'full' | 'weak') => {
    setRestarting(scope);
    try {
      const result = await api.post<{ attemptId: string }>('/api/attempts', {
        testId: data.testId,
        mode: 'PRACTICE',
        ...(scope === 'weak' && wrongSectionIds.length > 0 ? { sectionIds: wrongSectionIds } : {}),
      });
      navigate(`/exam/${result.attemptId}`);
    } catch (cause) {
      toast.push(describeError(cause), 'error');
    } finally {
      setRestarting(null);
    }
  };

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <Link className="btn btn--ghost btn--sm" to="/history">
          <Icon name="chevronRight" size={13} className="icon--flip" />
          All results
        </Link>
        <div className="row">
          {wrongSectionIds.length > 0 ? (
            <Button size="sm" loading={restarting === 'weak'} onClick={() => void startAttempt('weak')}>
              <Icon name="rotate" size={13} />
              Practice my wrong questions
            </Button>
          ) : null}
          <Button size="sm" variant="primary" loading={restarting === 'full'} onClick={() => void startAttempt('full')}>
            <Icon name="play" size={13} />
            Do this test again
          </Button>
        </div>
      </div>
      <ResultSummary result={data} onRefresh={reload} />
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
          <EmptyState title="You are not enrolled yet" icon="users">Use an invitation link or class code to join.</EmptyState>
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
