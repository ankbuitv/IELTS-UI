import { useState } from 'react';
import { api, queryString } from '../../lib/api';
import { useAsync } from '../../hooks/useAsync';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Loading,
  Modal,
  Notice,
  Stat,
} from '../../components/ui';
import { ResultSummary, type AttemptResultPayload } from '../../components/ResultView';
import { formatBand, formatDateTime, formatScore, MODE_LABELS, TEST_TYPE_LABELS } from '../../lib/format';

interface AdminAttemptRow {
  id: string;
  status: string;
  mode: string;
  test_type: string;
  started_at: string;
  submitted_at: string | null;
  raw_score: number | null;
  total_questions: number | null;
  estimated_band: number | null;
  submitted_reason: string | null;
  test_title: string;
  email: string;
  display_name: string | null;
  version_number: number;
  integrity_count: number;
}

export function AdminAttemptsPage() {
  const [testType, setTestType] = useState('');
  const [status, setStatus] = useState('');
  const [userId, setUserId] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const query = queryString({
    testType: testType || undefined,
    status: status || undefined,
    userId: userId || undefined,
    limit: 100,
  });
  const { data, loading, error } = useAsync<{ attempts: AdminAttemptRow[] }>(
    () => api.get(`/api/admin/attempts${query}`),
    [query],
  );

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Attempts</h1>
          <p className="page-head__meta">
            Review marked attempts, integrity event logs and teacher-scored writing. Scores are computed on the server;
            this view never recalculates them.
          </p>
        </div>
      </div>

      <Card>
        <div className="filter-bar">
          <label className="field">
            <span className="field__label">Skill / test type</span>
            <select value={testType} onChange={(event) => setTestType(event.target.value)}>
              <option value="">All types</option>
              <option value="READING">Reading</option>
              <option value="LISTENING">Listening</option>
              <option value="WRITING">Writing</option>
              <option value="FULL_MOCK">Full mock</option>
            </select>
          </label>
          <label className="field">
            <span className="field__label">Status</span>
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">All statuses</option>
              <option value="IN_PROGRESS">In progress</option>
              <option value="SUBMITTED">Submitted</option>
              <option value="EXPIRED">Expired</option>
              <option value="ABANDONED">Abandoned</option>
            </select>
          </label>
          <label className="field" style={{ minWidth: 220 }}>
            <span className="field__label">Student user ID</span>
            <input value={userId} onChange={(event) => setUserId(event.target.value)} placeholder="usr_…" />
          </label>
        </div>
      </Card>

      {loading ? <Loading /> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}

      <Card flush>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Student</th>
                <th>Test</th>
                <th>Status</th>
                <th className="num">Raw</th>
                <th className="num">Est. band</th>
                <th className="num">Integrity</th>
                <th>Started</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data?.attempts.map((row) => (
                <tr key={row.id}>
                  <td>
                    {row.display_name ?? row.email}
                    <div className="tiny muted">{row.email}</div>
                  </td>
                  <td>
                    {row.test_title}
                    <div className="tiny muted">
                      {TEST_TYPE_LABELS[row.test_type] ?? row.test_type} · v{row.version_number} ·{' '}
                      {MODE_LABELS[row.mode] ?? row.mode}
                    </div>
                  </td>
                  <td>
                    <Badge
                      tone={
                        row.status === 'SUBMITTED'
                          ? 'success'
                          : row.status === 'IN_PROGRESS'
                            ? 'accent'
                            : row.status === 'EXPIRED'
                              ? 'warning'
                              : 'neutral'
                      }
                    >
                      {row.status.toLowerCase().replace('_', ' ')}
                    </Badge>
                  </td>
                  <td className="num">{row.raw_score !== null ? formatScore(row.raw_score, row.total_questions) : '—'}</td>
                  <td className="num">{formatBand(row.estimated_band)}</td>
                  <td className="num">{row.integrity_count}</td>
                  <td className="nowrap">{formatDateTime(row.started_at)}</td>
                  <td className="right">
                    <Button size="sm" onClick={() => setSelected(row.id)}>
                      Review
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data && data.attempts.length === 0 ? <EmptyState title="No attempts match these filters" /> : null}
      </Card>

      <Modal
        open={Boolean(selected)}
        wide
        title="Attempt detail"
        onClose={() => setSelected(null)}
        actions={<Button onClick={() => setSelected(null)}>Close</Button>}
      >
        {selected ? <AttemptDetail attemptId={selected} /> : null}
      </Modal>
    </div>
  );
}

function AttemptDetail({ attemptId }: { attemptId: string }) {
  const { data, loading, error, reload } = useAsync<AttemptResultPayload>(
    () => api.get(`/api/admin/attempts/${attemptId}`),
    [attemptId],
  );

  if (loading) return <Loading label="Loading attempt…" />;
  if (error) return <Notice tone="danger">{error}</Notice>;
  if (!data) return null;

  const writingEntries = data.sessions.flatMap((session) =>
    session.writing.map((entry) => ({ ...entry, skill: session.skill, sessionLabel: session.label })),
  );

  return (
    <div className="stack">
      {data.student ? (
        <Notice tone="info" title="Student">
          {data.student.displayName ?? data.student.email} ({data.student.id})
        </Notice>
      ) : null}
      <ResultSummary result={data} marking={{ apiBase: '/api/admin', onSaved: reload }} />
      {writingEntries.length === 0 ? null : (
        <p className="tiny muted">
          Writing on this attempt is marked in the section above, or from Administration → Writing.
        </p>
      )}
    </div>
  );
}

export function AdminAttemptsSummary() {
  return <Stat label="Attempts" value="—" />;
}
