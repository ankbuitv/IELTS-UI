import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ApiRequestError, api, describeError, queryString } from '../../lib/api';
import { useAsync } from '../../hooks/useAsync';
import { useInputLockdown } from '../../hooks/useInputLockdown';
import {
  Badge,
  Button,
  Card,
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
import { ClassroomChatButton } from '../../components/ClassroomChat';
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
import { UserAvatar } from '../../components/UserAvatar';

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
  type StartMode = 'PRACTICE' | 'STANDARD_EXAM';
  const [chooser, setChooser] = useState<{ test: CatalogTest; sectionIds?: string[] } | null>(null);
  const [codePrompt, setCodePrompt] = useState<CatalogTest | null>(null);
  const [codeTarget, setCodeTarget] = useState<{ test: CatalogTest; sectionIds?: string[]; mode: StartMode } | null>(null);
  const [accessCode, setAccessCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);

  const { data, loading, error, reload } = useAsync<{ tests: CatalogTest[] }>(() => api.get('/api/tests'), []);

  const start = async (test: CatalogTest, code?: string, sectionIds?: string[], mode: StartMode = 'PRACTICE') => {
    if (test.requiresAccessCode && !test.unlocked && !code) {
      setCodeTarget({ test, sectionIds, mode });
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
        mode,
        // A scoped practice set: only these sections are timed, shown and marked.
        ...(sectionIds && sectionIds.length > 0 ? { sectionIds } : {}),
        ...(code ? { accessCode: code } : {}),
      });
      navigate(`/exam/${result.attemptId}`);
    } catch (startError) {
      if (startError instanceof ApiRequestError && startError.code === 'ACCESS_CODE_REQUIRED') {
        setCodeTarget({ test, sectionIds, mode });
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
                  <Button
                    variant="primary"
                    size="sm"
                    loading={starting === test.id}
                    onClick={() => setChooser({ test })}
                  >
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
        open={chooser !== null}
        title={chooser ? `“${chooser.test.title}”` : 'Choose your mode'}
        onClose={() => setChooser(null)}
        wide
      >
        <p className="small muted" style={{ marginTop: 0 }}>
          Học qua luyện tập hay thi thử? Chọn chế độ của bạn:
        </p>
        <div className="mode-chooser">
          <button
            type="button"
            className="mode-card mode-card--practice"
            disabled={starting !== null}
            onClick={() => {
              const target = chooser;
              setChooser(null);
              if (target) void start(target.test, undefined, target.sectionIds, 'PRACTICE');
            }}
          >
            <span className="mode-card__icon">
              <Icon name="pen" size={22} />
            </span>
            <strong>Ôn luyện (Practice)</strong>
            <span className="mode-card__desc">
              Có tra từ, highlight, ghi chú trên bài đọc. Làm xong hiện đáp án & giải thích để học từ lỗi sai.
            </span>
          </button>
          <button
            type="button"
            className="mode-card mode-card--exam"
            disabled={starting !== null}
            onClick={() => {
              const target = chooser;
              setChooser(null);
              if (target) void start(target.test, undefined, target.sectionIds, 'STANDARD_EXAM');
            }}
          >
            <span className="mode-card__icon">
              <Icon name="shield" size={22} />
            </span>
            <strong>Thi thử (Exam)</strong>
            <span className="mode-card__desc">
              Như thi thật: không tra từ, không ghi chú, tính giờ nghiêm ngặt — để ước lượng band của bạn.
            </span>
          </button>
        </div>
      </Modal>

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
              onClick={() => codePrompt && void start(codePrompt, accessCode, codeTarget?.sectionIds, codeTarget?.mode ?? 'PRACTICE')}
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
                  void start(codePrompt, accessCode, codeTarget?.sectionIds, codeTarget?.mode ?? 'PRACTICE');
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
  useInputLockdown();
  const [restarting, setRestarting] = useState<string | null>(null);
  const { data, loading, error, reload } = useAsync<AttemptResultPayload>(
    () => api.get(`/api/attempts/${attemptId}/result`),
    [attemptId],
  );

  // Only the first load replaces the page: a refresh after the judges answer must not unmount the report.
  if (loading && !data) return <Loading label="Loading your result…" />;
  if (error && !data) return <Notice tone="danger">{error}</Notice>;
  if (!data) return null;

  // "Xem kết quả" opens the review in the exam interface itself — the report
  // below remains only for attempts whose review is not released yet.
  if (data.release?.reviewAvailable) {
    return <Navigate to={`/exam/${attemptId}/review`} replace />;
  }

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
          <Link className="btn btn--secondary btn--sm" to={`/exam/${attemptId}/review`}>
            <Icon name="eye" size={13} />
            Ôn lại như lúc thi
          </Link>
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
      <MockSpeakingCard result={data} />
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
              <div className="row gap-8" style={{ alignItems: 'center' }}>
                <Badge tone="neutral">
                  {classroom.activeAssignments} active assignment{classroom.activeAssignments === 1 ? '' : 's'}
                </Badge>
                <ClassroomChatButton classroomId={classroom.id} classroomName={classroom.name} />
              </div>
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

/** Upload or remove the profile picture shown across the app. */
function ConnectedAccountsCard() {
  const toast = useToast();
  const [search] = useSearchParams();
  const identitiesQ = useAsync<Array<{ provider: string; email: string | null }>>(
    async () =>
      (await api.get<{ identities: Array<{ provider: string; email: string | null }> }>('/api/auth/identities')).identities,
    [],
  );

  const linkedParam = search.get('linked');
  useEffect(() => {
    if (!linkedParam) return;
    toast.push(`${linkedParam === 'google' ? 'Google' : 'Microsoft'} connected to your account.`, 'success');
  }, [linkedParam, toast]);

  const linked = new Set((identitiesQ.data ?? []).map((identity) => identity.provider));
  const providers = [
    { id: 'google', label: 'Google' },
    { id: 'microsoft', label: 'Microsoft' },
  ];
  return (
    <Card
      title="Connected accounts"
      hint="Link Google or Microsoft to this account, then sign in with one click — no password needed."
    >
      <div className="stack" style={{ gap: 10 }}>
        {providers.map((provider) => (
          <div
            key={provider.id}
            className="row"
            style={{ justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}
          >
            <div>
              <strong>{provider.label}</strong>
              <div className="tiny muted">
                {linked.has(provider.id) ? 'Connected — you can sign in with it.' : 'Not connected yet.'}
              </div>
            </div>
            {linked.has(provider.id) ? (
              <span className="mchip mchip--sun">
                <Icon name="check" size={12} /> Connected
              </span>
            ) : (
              <a className="btn btn--sm btn--secondary" href={`/api/auth/sso/${provider.id}/start?link=1`}>
                <Icon name="target" size={13} />
                Connect {provider.label}
              </a>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

function AvatarCard() {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [pending, setPending] = useState<{ mime: string; dataBase64: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const pick = (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp|gif)$/i.test(file.type)) {
      toast.push('Choose a PNG, JPEG, WebP or GIF image.', 'error');
      return;
    }
    if (file.size > 2_000_000) {
      toast.push('Keep avatars under 2 MB.', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? '');
      setPreview(dataUrl);
      setPending({ mime: file.type, dataBase64: dataUrl });
    };
    reader.readAsDataURL(file);
  };

  const upload = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const result = await api.post<{ avatarUrl: string | null }>('/api/profile/avatar', pending);
      if (user) setUser({ ...user, avatarUrl: result.avatarUrl });
      setPending(null);
      toast.push('Avatar updated.', 'success');
    } catch (uploadError) {
      toast.push(describeError(uploadError), 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.delete('/api/profile/avatar');
      if (user) setUser({ ...user, avatarUrl: null });
      setPreview(null);
      setPending(null);
      toast.push('Avatar removed.', 'success');
    } catch (removeError) {
      toast.push(describeError(removeError), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Your avatar" hint="A face for the leaderboard, mentor rooms and your profile — PNG, JPEG, WebP or GIF up to 2 MB.">
      <div className="row" style={{ gap: 18, alignItems: 'center' }}>
        <UserAvatar
          src={preview ?? user?.avatarUrl ?? null}
          userId={user?.id}
          name={user?.displayName ?? 'Me'}
          size={84}
          key={preview ?? user?.avatarUrl ?? 'none'}
        />
        <div className="stack" style={{ gap: 8 }}>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            hidden
            onChange={(event) => pick(event.target.files?.[0])}
          />
          <div className="row">
            <Button variant="secondary" onClick={() => fileRef.current?.click()}>
              <Icon name="upload" size={14} />
              Choose image
            </Button>
            {pending ? (
              <Button variant="primary" loading={busy} onClick={upload}>
                <Icon name="check" size={14} />
                Save avatar
              </Button>
            ) : null}
            {user?.avatarUrl && !pending ? (
              <Button variant="danger" loading={busy} onClick={remove}>
                <Icon name="trash" size={14} />
                Remove
              </Button>
            ) : null}
          </div>
          {pending ? <span className="tiny muted">Preview shown — press “Save avatar” to apply it everywhere.</span> : null}
        </div>
      </div>
    </Card>
  );
}

export function ProfilePage() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [username, setUsername] = useState(user?.username ?? '');
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
        <>
        <AvatarCard />
        <ConnectedAccountsCard />
        <Card title="Profile details" hint={user?.email}>
          <Field label="Display name" required>
            {(id) => <TextInput id={id} value={displayName} onChange={(event) => setDisplayName(event.target.value)} />}
          </Field>
          <Field label="Username" hint="How you sign in and how the leaderboard greets you. 3–24 characters: letters, numbers, dot, dash or underscore.">
            {(id) => <TextInput id={id} value={username} onChange={(event) => setUsername(event.target.value)} />}
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
                  username: username.trim() || undefined,
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
        </>
      ) : (
        <>
        <TwoFactorCard />
        <SessionsCard />
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
        </>
      
      )}

      <Card title="Export your data" hint="One JSON file with your profile, attempts, vocabulary and progress.">
        <p className="small muted">
          Download everything the platform stores about you. Use it to keep your own records or move to another tool.
        </p>
        <Button
          variant="secondary"
          onClick={async () => {
            try {
              const data = await api.get<Record<string, unknown>>('/api/student/export');
              const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const anchor = document.createElement('a');
              anchor.href = url;
              anchor.download = `ielts-export-${new Date().toISOString().slice(0, 10)}.json`;
              anchor.click();
              URL.revokeObjectURL(url);
              toast.push('Export downloaded.', 'success');
            } catch (exportError) {
              toast.push(describeError(exportError), 'error');
            }
          }}
        >
          Download my data (JSON)
        </Button>
      </Card>

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


/**
 * Two-factor authentication card (profile → security). Enrolment shows the
 * TOTP secret and otpauth:// URL for manual entry into an authenticator app —
 * the platform never displays a QR image, so there is no library dependency.
 */
function TwoFactorCard() {
  const toast = useToast();
  const [status, setStatus] = useState<{ enabled: boolean; pending: boolean } | null>(null);
  const [enrolment, setEnrolment] = useState<{ secret: string; authUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await api.get<{ enabled: boolean; pending: boolean }>('/api/auth/2fa/status'));
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const startSetup = async () => {
    setBusy(true);
    try {
      setEnrolment(await api.post<{ secret: string; authUrl: string }>('/api/auth/2fa/setup', {}));
    } catch (setupError) {
      toast.push(describeError(setupError), 'error');
    } finally {
      setBusy(false);
    }
  };

  const enable = async () => {
    setBusy(true);
    try {
      const result = await api.post<{ enabled: true; backupCodes: string[] }>('/api/auth/2fa/enable', { code: code.trim() });
      setEnrolment(null);
      setCode('');
      setBackupCodes(result.backupCodes ?? []);
      await refreshStatus();
      toast.push('Two-factor authentication is on — save your backup codes.', 'success');
    } catch (enableError) {
      toast.push(describeError(enableError), 'error');
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    if (!window.confirm('Turn off two-factor authentication? Your password alone will protect the account.')) return;
    setBusy(true);
    try {
      await api.post('/api/auth/2fa/disable', { code: code.trim() });
      setCode('');
      await refreshStatus();
      toast.push('Two-factor authentication is off.', 'success');
    } catch (disableError) {
      toast.push(describeError(disableError), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="Two-factor authentication"
      hint={status?.enabled ? 'On · your authenticator code is required at sign in' : 'Off · sign in with password or a one-time code'}
    >
      {backupCodes.length > 0 ? (
        <>
          <Notice tone="success" title="Save these backup codes now">
            Each code signs you in once if you lose your authenticator. They are shown only this time.
          </Notice>
          <div className="backup-codes" role="list">
            {backupCodes.map((entry) => (
              <code key={entry} role="listitem">{entry}</code>
            ))}
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                void navigator.clipboard?.writeText(backupCodes.join('\n')).then(
                  () => toast.push('Backup codes copied.', 'success'),
                  () => toast.push('Could not copy — select the codes manually.', 'error'),
                );
              }}
            >
              Copy codes
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setBackupCodes([])}>
              I have saved them
            </Button>
          </div>
        </>
      ) : status?.enabled ? (
        <>
          <p className="small muted">
            Enter your current authenticator code to turn two-factor authentication off.
          </p>
          <Field label="Authenticator code" required>
            {(id) => (
              <TextInput id={id} inputMode="numeric" placeholder="123456" value={code} onChange={(event) => setCode(event.target.value)} />
            )}
          </Field>
          <Button variant="danger" loading={busy} onClick={disable}>
            Turn off two-factor
          </Button>
        </>
      ) : enrolment ? (
        <>
          <p className="small muted">
            Add this account to Google Authenticator, Microsoft Authenticator or any TOTP app, using the key below.
          </p>
          <Field label="Setup key" hint="Base32 key — enter it manually in your authenticator app.">
            {(id) => <TextInput id={id} readOnly value={enrolment.secret} />}
          </Field>
          <Field label="Or open this link on your phone">
            {(id) => <TextInput id={id} readOnly value={enrolment.authUrl} />}
          </Field>
          <Field label="Confirm the six-digit code" required>
            {(id) => (
              <TextInput id={id} inputMode="numeric" placeholder="123456" value={code} onChange={(event) => setCode(event.target.value)} />
            )}
          </Field>
          <div className="row gap-8">
            <Button variant="primary" loading={busy} onClick={enable}>
              Turn on two-factor
            </Button>
            <Button variant="ghost" onClick={() => { setEnrolment(null); setCode(''); }}>
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <div className="stack">
          <p className="small muted">
            With two-factor on, signing in needs your password and a rotating six-digit code from your authenticator app.
          </p>
          <div>
            <Button variant="primary" loading={busy} onClick={startSetup}>
              Set up two-factor
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}


/** Account management: the browser sessions signed into this account. */
function SessionsCard() {
  const toast = useToast();
  const [sessions, setSessions] = useState<
    Array<{ sessionId: string; createdAt: string; lastSeenAt: string; ip: string | null; userAgent: string | null; current: boolean }>
  >([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await api.get<{ sessions: typeof sessions }>('/api/auth/sessions');
      setSessions(result.sessions);
    } catch (cause) {
      toast.push(describeError(cause), 'error');
    } finally {
      setLoaded(true);
    }
  }, [toast]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const revoke = async (sessionId: string) => {
    setBusy(true);
    try {
      await api.post(`/api/auth/sessions/${sessionId}/revoke`, {});
      toast.push('Session signed out.', 'success');
      await load();
    } catch (cause) {
      toast.push(describeError(cause), 'error');
    } finally {
      setBusy(false);
    }
  };

  const revokeOthers = async () => {
    setBusy(true);
    try {
      const result = await api.post<{ revoked: number }>('/api/auth/sessions/revoke-others', {});
      toast.push(`${result.revoked} other session${result.revoked === 1 ? '' : 's'} signed out.`, 'success');
      await load();
    } catch (cause) {
      toast.push(describeError(cause), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Active sessions" hint="Every browser or phone currently signed in to your account.">
      {!loaded ? (
        <Loading label="Loading sessions…" />
      ) : sessions.length === 0 ? (
        <EmptyState title="No active sessions" icon="monitor">
          <p>Sessions appear here as soon as you sign in from a device.</p>
        </EmptyState>
      ) : (
        <div className="stack" style={{ gap: 10 }}>
          {sessions.map((session) => (
            <div key={session.sessionId} className="row" style={{ alignItems: 'center', gap: 10, justifyContent: 'space-between' }}>
              <div style={{ minWidth: 0 }}>
                <p className="small" style={{ margin: 0, fontWeight: 700 }}>
                  {session.current ? 'This device' : truncateAgent(session.userAgent)}
                </p>
                <p className="tiny muted" style={{ margin: 0 }}>
                  Last seen {relativeTime(session.lastSeenAt)} · signed in {relativeTime(session.createdAt)}
                  {session.ip ? ` · ${session.ip}` : ''}
                </p>
              </div>
              {session.current ? (
                <Badge tone="success">Current</Badge>
              ) : (
                <Button size="sm" variant="danger" loading={busy} onClick={() => void revoke(session.sessionId)}>
                  Sign out
                </Button>
              )}
            </div>
          ))}
          {sessions.length > 1 ? (
            <div>
              <Button size="sm" loading={busy} onClick={revokeOthers}>
                Sign out all other devices
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </Card>
  );
}

function truncateAgent(agent: string | null): string {
  if (!agent) return 'Unknown device';
  const short = agent.length > 72 ? `${agent.slice(0, 72)}…` : agent;
  return short;
}


/**
 * Full mocks count Speaking as a fourth skill: submitting opens one linked,
 * AI-judged speaking session. This card is the entry point and the band home.
 */
function MockSpeakingCard({ result }: { result: AttemptResultPayload }) {
  const speaking = result.speaking ?? null;
  const combined =
    speaking?.overallBand !== null && speaking?.overallBand !== undefined && result.estimatedBand !== null && result.estimatedBand !== undefined
      ? Math.round(((speaking.overallBand + result.estimatedBand) / 2) * 10) / 10
      : null;

  if (result.testType !== 'FULL_MOCK') return null;

  return (
    <Card
      title="Speaking — part of this mock"
      hint="AI-judged, like Writing. Reading and Listening use the scoring profile."
    >
      {!speaking ? (
        <p className="small muted" style={{ margin: 0 }}>
          The speaking task opens when the mock is submitted. Finish the written paper first.
        </p>
      ) : speaking.overallBand !== null ? (
        <div className="row" style={{ gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="dash-stat__value" style={{ color: 'var(--ink-900)' }}>
            Band {formatBand(speaking.overallBand)}
          </span>
          <span className="small muted">AI judgement · {speaking.topicTitle}</span>
          {combined !== null ? (
            <Badge tone="info" title="Average of the written band and the speaking band">
              Written + speaking average {formatBand(combined)}
            </Badge>
          ) : null}
          <Link className="btn btn--sm" to={`/speaking/${speaking.sessionId}`}>
            See the feedback
          </Link>
        </div>
      ) : (
        <div className="row" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="small">
            {speaking.status === 'IN_PROGRESS'
              ? 'Your speaking task is waiting — record your answers and the AI judges will mark them.'
              : 'Submitted — the AI judges are marking your speaking now.'}
          </span>
          <Link className="btn btn--sm btn--primary" to={`/speaking/${speaking.sessionId}`}>
            <Icon name="mic" size={13} />
            {speaking.status === 'IN_PROGRESS' ? 'Start speaking' : 'Open speaking'}
          </Link>
        </div>
      )}
    </Card>
  );
}
