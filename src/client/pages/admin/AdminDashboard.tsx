import { api } from '../../lib/api';
import { useAsync } from '../../hooks/useAsync';
import { Badge, Card, Loading, Notice, Stat } from '../../components/ui';
import { BarChart } from '../../components/charts';
import { formatDateTime } from '../../lib/format';

interface AdminAnalytics {
  users: { total: number; students: number; teachers: number; admins: number; activeLast30Days: number };
  tests: { total: number; draft: number; review: number; published: number; archived: number };
  attempts: { total: number; submitted: number; inProgress: number; last7Days: number; last30Days: number };
  completion: { assignmentAttempts: number; submittedAssignmentAttempts: number; completionRate: number | null };
  imports: { total: number; pending: number; failed: number };
  recentActivity: Array<{ date: string; attempts: number }>;
}

export function AdminDashboardPage() {
  const { data, loading, error } = useAsync<{
    analytics: AdminAnalytics;
    ai: { available: boolean; model?: string; reason?: string };
    runtime: { environment: string; baseUrl: string };
  }>(() => api.get('/api/admin/dashboard'), []);

  if (loading) return <Loading label="Loading platform analytics…" />;
  if (error) return <Notice tone="danger">{error}</Notice>;
  if (!data) return null;

  const { analytics, ai, runtime } = data;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Platform dashboard</h1>
          <p className="page-head__meta">
            Environment {runtime.environment} · {runtime.baseUrl}
          </p>
        </div>
        <Badge tone={ai.available ? 'success' : 'neutral'}>
          AI import {ai.available ? `available (${ai.model})` : 'unavailable'}
        </Badge>
      </div>

      {!ai.available ? <Notice tone="info" title="AI import is not configured">{ai.reason}</Notice> : null}

      <div className="grid grid--4">
        <Stat
          label="Users"
          value={analytics.users.total}
          hint={`${analytics.users.students} students · ${analytics.users.teachers} teachers`}
          icon="👥"
          accent="blue"
        />
        <Stat
          label="Published tests"
          value={analytics.tests.published}
          hint={`${analytics.tests.draft} draft · ${analytics.tests.review} in review`}
          icon="📄"
          accent="brand"
        />
        <Stat
          label="Attempts (30d)"
          value={analytics.attempts.last30Days}
          hint={`${analytics.attempts.submitted} submitted in total`}
          icon="🧭"
          accent="violet"
        />
        <Stat
          label="Assignment completion"
          value={analytics.completion.completionRate !== null ? `${analytics.completion.completionRate}%` : '—'}
          hint={`${analytics.completion.submittedAssignmentAttempts}/${analytics.completion.assignmentAttempts} assignment attempts submitted`}
          icon="✅"
          accent="emerald"
        />
      </div>

      <div className="grid grid--2">
        <Card title="Attempts started per day" hint="Last 30 days">
          <BarChart
            bars={analytics.recentActivity.map((row) => ({
              label: row.date.slice(5),
              value: row.attempts,
              sublabel: row.date,
            }))}
            emptyLabel="No attempts in the last 30 days"
          />
        </Card>

        <Card title="Content and imports">
          <div className="table-wrap">
            <table className="data">
              <tbody>
                <tr>
                  <td>Draft tests</td>
                  <td className="num">{analytics.tests.draft}</td>
                </tr>
                <tr>
                  <td>Tests in review</td>
                  <td className="num">{analytics.tests.review}</td>
                </tr>
                <tr>
                  <td>Published tests</td>
                  <td className="num">{analytics.tests.published}</td>
                </tr>
                <tr>
                  <td>Archived tests</td>
                  <td className="num">{analytics.tests.archived}</td>
                </tr>
                <tr>
                  <td>Imports awaiting review</td>
                  <td className="num">{analytics.imports.pending}</td>
                </tr>
                <tr>
                  <td>Failed imports</td>
                  <td className="num">{analytics.imports.failed}</td>
                </tr>
                <tr>
                  <td>Attempts in progress</td>
                  <td className="num">{analytics.attempts.inProgress}</td>
                </tr>
                <tr>
                  <td>Users active in 30 days</td>
                  <td className="num">{analytics.users.activeLast30Days}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="tiny muted" style={{ marginTop: 10 }}>
            Generated {formatDateTime(new Date().toISOString())} from aggregated SQL counts (no per-question loops).
          </p>
        </Card>
      </div>
    </div>
  );
}
