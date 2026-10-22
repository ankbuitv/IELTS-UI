import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, queryString } from '../../lib/api';
import { useAsync } from '../../hooks/useAsync';
import { useAuth } from '../../context/AuthContext';
import { Badge, Button, Card, Chips, EmptyState, Loading, Notice, ProgressBar, SkillGlyph } from '../../components/ui';
import { AccuracyList, BarChart, LineChart } from '../../components/charts';
import { AttemptList, newestFirst } from '../../components/AttemptList';
import { Icon } from '../../components/Icon';
import { learnApi } from '../../lib/learn-api';
import { BandEstimatesPanel } from '../../components/BandEstimates';
import { LearnStrip } from '../../components/learn/LearnStrip';
import {
  BAND_DISCLAIMER,
  formatBand,
  formatDuration,
  formatPercent,
  formatScore,
  initials,
  relativeTime,
  SKILL_LABELS,
  statusTone,
  STATUS_LABELS,
  TEST_TYPE_LABELS,
} from '../../lib/format';
import type { SkillPerformance, StudentDashboard, TrendPoint, AssignmentSummary } from './types';

export function StudentDashboardPage() {
  const { user } = useAuth();
  const [trendMode, setTrendMode] = useState<'band' | 'score'>('band');
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

  if (loading && !data) return <Loading label="Đang tải bảng điều khiển…" />;
  if (error) return <Notice tone="danger">{error}</Notice>;
  if (!data) return null;

  const recent = newestFirst(data.recentAttempts.length > 0 ? data.recentAttempts : data.practiceHistory);
  const running = recent.find((attempt) => attempt.status === 'IN_PROGRESS') ?? null;
  const dueSoon = data.upcomingDeadlines.slice(0, 3);
  const activeAssignments = data.assignments.filter((assignment) => assignment.status !== 'SUBMITTED').slice(0, 3);
  const upNext = dueSoon.length > 0 ? dueSoon : activeAssignments;
  const firstName = user?.username ?? user?.displayName.split(' ')[0] ?? '';

  const trendPoints = data.trends
    .slice(0, 12)
    .reverse()
    .map((trend) => ({
      label: new Date(trend.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      value:
        trendMode === 'band'
          ? trend.estimatedBand
          : trend.rawScore !== null && trend.totalQuestions
            ? Math.round((trend.rawScore / trend.totalQuestions) * 100)
            : null,
      sublabel:
        trendMode === 'band'
          ? `${TEST_TYPE_LABELS[trend.testType]} · ${formatBand(trend.estimatedBand)}`
          : `${trend.rawScore ?? 0}/${trend.totalQuestions ?? 0}`,
    }));
  const hasTrend = trendPoints.some((point) => point.value !== null);

  return (
    <div className="stack dash">
      <section className="dash-hero">
        <span className="dash-hero__bars" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <div className="dash-hero__text">
          <p className="dash-hero__kicker">{greeting()}</p>
          <h1>Xin chào{firstName ? ` ${firstName}` : ''}!</h1>
          <p>
            {data.totals.submitted === 0
              ? 'Làm bài thi thử đầu tiên để bắt đầu theo dõi tiến bộ của bạn.'
              : `Đã hoàn thành ${data.totals.submitted} bài${
                  data.totals.inProgress > 0 ? ` · ${data.totals.inProgress} bài đang làm` : ''
                }${data.totals.fullMocks > 0 ? ` · ${data.totals.fullMocks} đề mock` : ''}`}
          </p>
        </div>
        <div className="dash-hero__stats" role="list" aria-label="Thống kê của bạn">
          <div className="dash-stat" role="listitem">
            <span className="dash-stat__value">{data.totals.submitted}</span>
            <span className="dash-stat__label">Bài đã làm</span>
          </div>
          <div className="dash-stat" role="listitem">
            <span className="dash-stat__value">{data.totals.averageBand !== null ? formatBand(data.totals.averageBand) : '—'}</span>
            <span className="dash-stat__label">Band trung bình</span>
          </div>
          <div className="dash-stat" role="listitem">
            <span className="dash-stat__value">{formatDuration(data.totals.totalTimeSeconds)}</span>
            <span className="dash-stat__label">Đã luyện</span>
          </div>
          <div className="dash-stat" role="listitem">
            <span className="dash-stat__value">{data.totals.streakDays}</span>
            <span className="dash-stat__label">Chuỗi ngày</span>
          </div>
          <div className="dash-stat" role="listitem">
            <span className="dash-stat__value">{data.totals.xpTotal.toLocaleString('vi-VN')}</span>
            <span className="dash-stat__label">XP</span>
          </div>
          <div className="dash-stat" role="listitem">
            <span className="dash-stat__value">{data.totals.fullMocks}</span>
            <span className="dash-stat__label">Đề mock</span>
          </div>
        </div>
        <div className="dash-hero__actions">
          {running ? (
            <Link className="btn btn--primary" to={`/exam/${running.attemptId}`}>
              <Icon name="play" size={14} />
              Tiếp tục “{truncateTitle(running.testTitle)}”
            </Link>
          ) : (
            <Link className="btn btn--primary" to="/practice">
              <Icon name="play" size={14} />
              Bắt đầu thi
            </Link>
          )}
          <Link className="btn" to="/learn">
            <Icon name="target" size={14} />
            Tiếp tục học
          </Link>
        </div>
      </section>

      <div className="dash-roster">
        <div className="dash-roster__main">
          <BandEstimatesPanel estimates={data.estimates} />

          {upNext.length > 0 ? (
            <Card className="dash-deadline" title={dueSoon.length > 0 ? 'Sắp hết hạn' : 'Bài tập của bạn'} hint="Từ lớp học của bạn">
              <div className="stack" style={{ gap: 8 }}>
                {upNext.map((assignment) => (
                  <AssignmentRow key={assignment.assignmentId} assignment={assignment} compact />
                ))}
              </div>
            </Card>
          ) : null}

          <LearnStrip />
        </div>

        <aside className="dash-roster__side">
          <WeeklyLeaderboard />
        </aside>
      </div>

      <div className="dash-grid">
        <Card
          title="Recent attempts"
          actions={
            <Link className="small" to="/history">
              View all
            </Link>
          }
          flush
        >
          {recent.length === 0 ? (
            <EmptyState title="No attempts yet" icon="book">
              <p>Your finished tests and their bands will be listed here, newest first.</p>
              <Link className="btn btn--primary" to="/practice">
                Start your first test
              </Link>
            </EmptyState>
          ) : (
            <AttemptList attempts={recent} limit={6} />
          )}
        </Card>

        <Card
          title="Progress"
          hint={trendMode === 'band' ? 'Estimated band per attempt' : 'Share of marks per attempt'}
          actions={
            <Chips
              label="Chart"
              value={trendMode}
              onChange={setTrendMode}
              options={[
                { id: 'band', label: 'Band' },
                { id: 'score', label: 'Score %' },
              ]}
            />
          }
        >
          {hasTrend ? (
            <LineChart
              points={trendPoints}
              yMax={trendMode === 'band' ? 9 : 100}
              formatValue={(value) => (trendMode === 'band' ? value.toFixed(1) : `${Math.round(value)}%`)}
              yLabel={trendMode === 'band' ? 'Estimated band trend' : 'Raw score trend'}
            />
          ) : (
            <EmptyState title="Nothing to chart yet" icon="trendingUp">
              <p>Finish a Reading or Listening test and your trend appears here.</p>
            </EmptyState>
          )}
          {trendMode === 'band' ? <p className="tiny muted">{BAND_DISCLAIMER}</p> : null}
        </Card>
      </div>

      <details className="disclosure">
        <summary>
          <Icon name="chart" size={15} />
          <span>More analytics</span>
          <span className="disclosure__hint">Skills, parts, task types, full mocks and filters</span>
          <Icon name="chevronDown" size={15} className="disclosure__chev" />
        </summary>
        <div className="disclosure__body stack">
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
            <Button size="sm" variant="ghost" onClick={() => setFilters({ from: '', to: '', skill: '', testType: '' })}>
              Reset
            </Button>
          </div>

          <div className="grid grid--2">
            <Card title="Skill breakdown">
              <div className="stack" style={{ gap: 10 }}>
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

            <Card title="By passage / part" hint="Diagnostic only — not standalone band scores.">
              {(data.sectionPerformance ?? []).length === 0 ? (
                <p className="muted small">Submit a multi-part test to see per-passage and per-part performance.</p>
              ) : (
                <div className="stack" style={{ gap: 10 }}>
                  {(data.sectionPerformance ?? []).slice(0, 8).map((section) => (
                    <div key={section.sectionId}>
                      <div className="row row--between">
                        <span>
                          {section.label} <span className="tiny muted">· {SKILL_LABELS[section.skill] ?? section.skill}</span>
                        </span>
                        <span className="small muted">
                          {section.correct}/{section.answered} · {formatPercent(section.accuracy)}
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

            <Card title="Full mock history" flush>
              {data.mockHistory.length === 0 ? (
                <EmptyState title="No full mocks yet" icon="clock">
                  <p>Full mocks combine Listening, Reading and Writing with separate server-authoritative timers.</p>
                </EmptyState>
              ) : (
                <AttemptList attempts={data.mockHistory} limit={6} />
              )}
            </Card>
          </div>
        </div>
      </details>
    </div>
  );
}

/**
 * The week's XP board: four rows with rank ribbons and name plates, straight
 * from the Learn leaderboard — never fabricated. Like the Learn strip it is a
 * convenience: on failure it simply does not render.
 */
function WeeklyLeaderboard() {
  const { data, loading } = useAsync(() => learnApi.leaderboard('learn', 'week'), []);

  if (!data) {
    return loading ? (
      <Card className="lb-card" title="Bảng xếp hạng tuần">
        <div className="stack" style={{ gap: 8 }}>
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="skeleton lb-row--skeleton" style={{ height: 46 }} />
          ))}
        </div>
      </Card>
    ) : null;
  }

  const rows = data.rows.slice(0, 4);
  return (
    <Card
      className="lb-card"
      title="Bảng xếp hạng tuần"
      hint={data.total > 0 ? `${data.total} bạn có hoạt động tuần này` : 'XP trên con đường học'}
    >
      {rows.length === 0 ? (
        <p className="muted small" style={{ margin: 0 }}>
          Tuần này chưa có ai lên bảng — học một bài là lên hạng ngay.
        </p>
      ) : (
        <ol className="lb-list">
          {rows.map((row) => (
            <li key={row.userId} className={`lb-row${row.isMe ? ' is-me' : ''}`}>
              <span className={`rank-ribbon rank-ribbon--${row.rank > 4 ? 'n' : String(row.rank)}`} aria-label={`Hạng ${row.rank}`}>
                {row.rank}
              </span>
              <span className="name-plate">
                <span className="name-plate__avatar" aria-hidden="true">
                  {initials(row.name)}
                </span>
                <span className="name-plate__name">
                  <span className="name-plate__text">{row.name}</span>
                  {row.role === 'ADMIN' ? <Badge tone="accent" plain>Quản trị</Badge> : null}
                </span>
                {row.online ? <i className="name-plate__dot" title="Đang học" /> : null}
              </span>
              <span className="lb-row__value">{row.valueLabel}</span>
            </li>
          ))}
        </ol>
      )}
      <Link className="lb-more" to="/learn/leaderboard">
        Xem tất cả <Icon name="arrowRight" size={13} />
      </Link>
    </Card>
  );
}

/** A short greeting line above the name, from the learner's own clock. */
function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return 'Khuya rồi';
  if (hour < 12) return 'Chào buổi sáng';
  if (hour < 18) return 'Chào buổi chiều';
  return 'Chào buổi tối';
}

/** Keeps a button label on one line. */
function truncateTitle(title: string, max = 28): string {
  return title.length > max ? `${title.slice(0, max - 1).trimEnd()}…` : title;
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

  const used = `${assignment.attemptsUsed}/${assignment.maxAttempts} attempts`;
  return (
    <div className={`assign-row${overdue ? ' assign-row--overdue' : ''}`}>
      <SkillGlyph type={assignment.testType} />
      <div className="assign-row__main">
        <div className="assign-row__title">
          <strong>{assignment.title}</strong>
          <Badge tone={statusTone(assignment.status)} plain>
            {STATUS_LABELS[assignment.status]}
          </Badge>
        </div>
        <div className="assign-row__meta">
          {assignment.testTitle} · {assignment.classroomName}
          {assignment.deadlineAt ? ` · ${relativeTime(assignment.deadlineAt)}` : ''}
          {!compact ? ` · ${used}` : ''}
          {!compact && assignment.bestRawScore !== null
            ? ` · best ${assignment.bestRawScore}/${assignment.bestTotalQuestions}${assignment.bestBand !== null ? ` (band ${formatBand(assignment.bestBand)})` : ''}`
            : ''}
        </div>
      </div>
      <div className="assign-row__action">
        {assignment.inProgressAttemptId ? (
          <Button size="sm" variant="primary" onClick={() => navigate(`/exam/${assignment.inProgressAttemptId}`)}>
            Tiếp tục
          </Button>
        ) : overdue ? (
          <span className="tiny muted" title="Hỏi giáo viên xem bạn có được làm lại không.">
            Đã đóng
          </span>
        ) : (
          <Button
            size="sm"
            variant="primary"
            loading={busy}
            onClick={() => void start()}
            disabled={assignment.attemptsUsed >= assignment.maxAttempts}
          >
            {assignment.attemptsUsed > 0 ? 'Làm lại' : 'Bắt đầu'}
          </Button>
        )}
      </div>
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
