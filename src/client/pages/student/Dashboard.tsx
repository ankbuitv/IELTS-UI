import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, queryString } from '../../lib/api';
import { useAsync } from '../../hooks/useAsync';
import { useAuth } from '../../context/AuthContext';
import { Badge, Button, Card, EmptyState, Loading, Notice, ProgressBar, Stat } from '../../components/ui';
import { AccuracyList, BarChart, LineChart } from '../../components/charts';
import {
  BAND_DISCLAIMER,
  formatBand,
  formatDateTime,
  formatDuration,
  formatPercent,
  formatScore,
  relativeTime,
  SKILL_LABELS,
  statusTone,
  STATUS_LABELS,
  TEST_TYPE_LABELS,
} from '../../lib/format';
import type { SkillPerformance, StudentDashboard, TrendPoint, AssignmentSummary, AttemptSummary } from './types';

export function StudentDashboardPage() {
  const { user } = useAuth();
  const [filters, setFilters] = useState<{ from: string; to: string; skill: string; testType: string }>({
    from: '',
    to: '',
    skill: '',
    testType: '',
  });

  const query = queryString({
    from: filters.from ? new Date(filters.from).toISOString() : undefined,
    to: filters.to ? new Date(`${filters.to}T23:59:59`).toISOString() : undefined,
    skill: filters.skill || undefined,
    testType: filters.testType || undefined,
  });

  const { data, loading, error } = useAsync<StudentDashboard>(
    () => api.get<StudentDashboard>(`/api/student/dashboard${query}`),
    [query],
  );

  if (loading && !data) return <Loading label="Loading your dashboard…" />;
  if (error) return <Notice tone="danger">{error}</Notice>;
  if (!data) return null;

  const reading = data.skillPerformance.find((skill) => skill.skill === 'READING');
  const listening = data.skillPerformance.find((skill) => skill.skill === 'LISTENING');
  const writing = data.skillPerformance.find((skill) => skill.skill === 'WRITING');

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Welcome back, {user?.displayName.split(' ')[0]}</h1>
          <p className="page-head__meta">
            {data.assignments.length} active assignment{data.assignments.length === 1 ? '' : 's'} ·{' '}
            {data.totals.inProgress} attempt in progress · {data.totals.fullMocks} full mock
            {data.totals.fullMocks === 1 ? '' : 's'} completed
          </p>
        </div>
        <div className="row">
          <Link className="btn btn--primary" to="/practice">
            Start practice
          </Link>
          <Link className="btn" to="/history">
            Attempt history
          </Link>
        </div>
      </div>

      <Card title="Filters" hint="Filters apply to attempts, trends and task-type accuracy.">
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
              <option value="">All skills</option>
              <option value="READING">Reading</option>
              <option value="LISTENING">Listening</option>
              <option value="WRITING">Writing</option>
            </select>
          </label>
          <label className="field">
            <span className="field__label">Test type</span>
            <select value={filters.testType} onChange={(event) => setFilters({ ...filters, testType: event.target.value })}>
              <option value="">All types</option>
              <option value="READING">Reading</option>
              <option value="LISTENING">Listening</option>
              <option value="WRITING">Writing</option>
              <option value="FULL_MOCK">Full mock</option>
            </select>
          </label>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setFilters({ from: '', to: '', skill: '', testType: '' })}
          >
            Reset
          </Button>
        </div>
      </Card>

      <div className="grid grid--4">
        <Stat
          label="Attempts"
          value={data.totals.attempts}
          hint={`${data.totals.submitted} submitted`}
          icon="🗂"
          accent="blue"
        />
        <Stat
          label="Reading"
          value={formatScore(reading?.rawScore ?? null, reading?.totalQuestions ?? null)}
          hint={reading?.latestBand ? `Latest estimated band ${formatBand(reading.latestBand)}` : 'No marked reading yet'}
          icon="📖"
          accent="brand"
        />
        <Stat
          label="Listening"
          value={formatScore(listening?.rawScore ?? null, listening?.totalQuestions ?? null)}
          hint={listening?.latestBand ? `Latest estimated band ${formatBand(listening.latestBand)}` : 'No marked listening yet'}
          icon="🎧"
          accent="violet"
        />
        <Stat
          label="Writing"
          value={writing?.writingScores ? `${writing.writingScores} marked` : 'Not yet marked'}
          hint={writing?.averageWritingBand ? `Average ${formatBand(writing.averageWritingBand)}` : 'Teacher-marked only'}
          icon="✍️"
          accent="amber"
        />
      </div>

      <div className="grid grid--2">
        <Card title="Upcoming deadlines">
          {data.upcomingDeadlines.length === 0 ? (
            <EmptyState title="Nothing due">Assignments with a deadline will appear here.</EmptyState>
          ) : (
            <div className="stack" style={{ gap: 10 }}>
              {data.upcomingDeadlines.map((assignment) => (
                <AssignmentRow key={assignment.assignmentId} assignment={assignment} />
              ))}
            </div>
          )}
        </Card>

        <Card title="Active assignments">
          {data.assignments.length === 0 ? (
            <EmptyState title="No assignments yet">
              Join a classroom with a code or invitation link to receive assignments.
            </EmptyState>
          ) : (
            <div className="stack" style={{ gap: 10 }}>
              {data.assignments.slice(0, 6).map((assignment) => (
                <AssignmentRow key={assignment.assignmentId} assignment={assignment} compact />
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="grid grid--2">
        <Card title="Estimated band over time" hint="Reading and Listening only, from configured scoring profiles">
          <LineChart
            points={data.trends
              .slice(0, 12)
              .reverse()
              .map((trend) => ({
                label: new Date(trend.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
                value: trend.estimatedBand,
                sublabel: `${TEST_TYPE_LABELS[trend.testType]} · ${formatBand(trend.estimatedBand)}`,
              }))}
            yMax={9}
            formatValue={(value) => value.toFixed(1)}
            yLabel="Estimated band trend"
          />
          <p className="tiny muted">{BAND_DISCLAIMER}</p>
        </Card>

        <Card title="Raw score trend" hint="Percentage of marks per submitted attempt">
          <LineChart
            points={data.trends
              .slice(0, 12)
              .reverse()
              .map((trend) => ({
                label: new Date(trend.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
                value:
                  trend.rawScore !== null && trend.totalQuestions
                    ? Math.round((trend.rawScore / trend.totalQuestions) * 100)
                    : null,
                sublabel: `${trend.rawScore ?? 0}/${trend.totalQuestions ?? 0}`,
              }))}
            yMax={100}
            formatValue={(value) => `${Math.round(value)}%`}
            yLabel="Raw score trend"
          />
        </Card>
      </div>

      <div className="grid grid--2">
        <Card title="Skill breakdown">
          <div className="stack">
            {data.skillPerformance.map((skill) => (
              <div key={skill.skill}>
                <div className="row row--between">
                  <span>{SKILL_LABELS[skill.skill] ?? skill.skill}</span>
                  <span className="small muted">
                    {formatScore(skill.rawScore, skill.totalQuestions)} · {formatPercent(skill.accuracy)}
                  </span>
                </div>
                <ProgressBar
                  value={skill.accuracy ?? 0}
                  max={100}
                  tone={(skill.accuracy ?? 0) >= 70 ? 'success' : (skill.accuracy ?? 0) >= 45 ? 'warning' : 'danger'}
                />
              </div>
            ))}
          </div>
        </Card>

        <Card
          title="By passage / part"
          hint="Diagnostic only — these are not standalone IELTS band scores."
        >
          {(data.sectionPerformance ?? []).length === 0 ? (
            <p className="muted small">Submit a multi-part test to see per-passage and per-part performance.</p>
          ) : (
            <div className="stack">
              {(data.sectionPerformance ?? []).slice(0, 8).map((section) => (
                <div key={section.sectionId}>
                  <div className="row row--between">
                    <span>
                      {section.label} <span className="tiny muted">· {SKILL_LABELS[section.skill] ?? section.skill}</span>
                    </span>
                    <span className="small muted">
                      {section.correct}/{section.answered} correct · {formatPercent(section.accuracy)}
                    </span>
                  </div>
                  <ProgressBar
                    value={section.accuracy ?? 0}
                    max={100}
                    tone={(section.accuracy ?? 0) >= 70 ? 'success' : (section.accuracy ?? 0) >= 45 ? 'warning' : 'danger'}
                  />
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Task-type accuracy" hint="From server-marked answers">
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

      <Card title="Full mock history" flush>
        {data.mockHistory.length === 0 ? (
          <EmptyState title="No full mocks yet">
            Full mocks combine Listening, Reading and Writing with separate server-authoritative timers.
          </EmptyState>
        ) : (
          <AttemptTable attempts={data.mockHistory} />
        )}
      </Card>

      <Card title="Practice and test history" flush>
        {data.practiceHistory.length === 0 ? (
          <EmptyState title="No attempts recorded yet" />
        ) : (
          <AttemptTable attempts={data.practiceHistory.slice(0, 15)} />
        )}
      </Card>
    </div>
  );
}

export function AssignmentRow({ assignment, compact }: { assignment: AssignmentSummary; compact?: boolean }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const overdue = assignment.status === 'OVERDUE';

  const start = async () => {
    setBusy(true);
    try {
      const result = await api.post<{ attemptId: string }>('/api/attempts', { assignmentId: assignment.assignmentId });
      navigate(`/exam/${result.attemptId}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ padding: 14, background: 'var(--paper-muted)' }}>
      <div className="row row--between">
        <div>
          <strong>{assignment.title}</strong>
          <div className="tiny muted">
            {assignment.testTitle} · {TEST_TYPE_LABELS[assignment.testType] ?? assignment.testType} · v
            {assignment.versionNumber} · {assignment.classroomName}
          </div>
        </div>
        <Badge tone={statusTone(assignment.status)}>{STATUS_LABELS[assignment.status]}</Badge>
      </div>

      {!compact ? (
        <div className="row row--between" style={{ marginTop: 8 }}>
          <span className="small muted">
            Attempts {assignment.attemptsUsed}/{assignment.maxAttempts}
            {assignment.deadlineAt ? ` · due ${relativeTime(assignment.deadlineAt)}` : ''}
          </span>
          <span className="small muted">
            {assignment.bestRawScore !== null ? `Best ${assignment.bestRawScore}/${assignment.bestTotalQuestions}` : ''}
            {assignment.bestBand !== null ? ` · estimated ${formatBand(assignment.bestBand)}` : ''}
          </span>
        </div>
      ) : null}

      <div className="row" style={{ marginTop: 10 }}>
        {assignment.inProgressAttemptId ? (
          <Button size="sm" variant="primary" onClick={() => navigate(`/exam/${assignment.inProgressAttemptId}`)}>
            Continue attempt
          </Button>
        ) : overdue ? (
          <span className="small muted">The deadline has passed. Ask your teacher if you may still take it.</span>
        ) : (
          <Button
            size="sm"
            variant="primary"
            loading={busy}
            onClick={() => void start()}
            disabled={assignment.attemptsUsed >= assignment.maxAttempts}
          >
            {assignment.attemptsUsed > 0 ? 'Start another attempt' : 'Start test'}
          </Button>
        )}
        <span className="tiny muted">
          {assignment.mode === 'PRACTICE' ? 'Practice mode' : `${assignment.mode.replace('_', ' ').toLowerCase()}`} ·{' '}
          results {assignment.resultVisibility.toLowerCase().replace(/_/g, ' ')}
        </span>
      </div>
    </div>
  );
}

export function AttemptTable({ attempts }: { attempts: AttemptSummary[] }) {
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th>Test</th>
            <th>Type</th>
            <th className="num">Raw</th>
            <th className="num">Est. band</th>
            <th>Started</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {attempts.map((attempt) => (
            <tr key={attempt.attemptId}>
              <td>
                {attempt.testTitle}
                <div className="tiny muted">
                  v{attempt.versionNumber}
                  {attempt.assignmentTitle ? ` · ${attempt.assignmentTitle}` : ''}
                </div>
              </td>
              <td>{TEST_TYPE_LABELS[attempt.testType] ?? attempt.testType}</td>
              <td className="num">{attempt.rawScore !== null ? formatScore(attempt.rawScore, attempt.totalQuestions) : '—'}</td>
              <td className="num">{formatBand(attempt.estimatedBand)}</td>
              <td className="nowrap">{formatDateTime(attempt.startedAt)}</td>
              <td>
                <Badge tone={statusTone(attempt.status)}>{attempt.status.replace('_', ' ').toLowerCase()}</Badge>
              </td>
              <td className="right">
                {attempt.status === 'IN_PROGRESS' ? (
                  <Link className="btn btn--sm" to={`/exam/${attempt.attemptId}`}>
                    Resume
                  </Link>
                ) : (
                  <Link className="btn btn--sm" to={`/attempts/${attempt.attemptId}`}>
                    View result
                  </Link>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SkillPerformanceTable({ items }: { items: SkillPerformance[] }) {
  return (
    <table className="data">
      <thead>
        <tr>
          <th>Skill</th>
          <th className="num">Sessions</th>
          <th className="num">Raw</th>
          <th className="num">Accuracy</th>
          <th className="num">Average band</th>
          <th className="num">Latest band</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.skill}>
            <td>{SKILL_LABELS[item.skill] ?? item.skill}</td>
            <td className="num">{item.sessions}</td>
            <td className="num">{formatScore(item.rawScore, item.totalQuestions)}</td>
            <td className="num">{formatPercent(item.accuracy)}</td>
            <td className="num">{formatBand(item.averageBand)}</td>
            <td className="num">{formatBand(item.latestBand)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function TrendBars({ trends }: { trends: TrendPoint[] }) {
  return (
    <BarChart
      bars={trends
        .slice(0, 10)
        .reverse()
        .map((trend) => ({
          label: new Date(trend.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
          value: trend.rawScore ?? 0,
          sublabel: `${trend.rawScore ?? 0}/${trend.totalQuestions ?? 0}`,
        }))}
      emptyLabel="No submitted attempts yet"
    />
  );
}

export { formatDuration };
