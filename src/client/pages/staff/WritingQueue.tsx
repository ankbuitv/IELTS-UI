import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAsync } from '../../hooks/useAsync';
import { Badge, Button, Card, EmptyState, Loading, Modal, Notice, Stat } from '../../components/ui';
import { WritingMarkForm } from '../../components/ResultView';
import { formatBand, formatDateTime, TEST_TYPE_LABELS } from '../../lib/format';

interface WritingQueueItem {
  submissionId: string;
  attemptId: string;
  studentId: string;
  studentEmail: string;
  studentName: string;
  testTitle: string;
  testType: string;
  taskLabel: string;
  wordCount: number;
  prompt: string;
  responseText: string;
  submittedAt: string | null;
  attemptStatus: string;
  scoreBand: number | null;
  feedback: string;
  scoringSource: string | null;
  criteria: Record<string, number>;
}

export function WritingQueuePage({ apiBase }: { apiBase: '/api/admin' | '/api/teacher' }) {
  const [unmarkedOnly, setUnmarkedOnly] = useState(true);
  const [selected, setSelected] = useState<WritingQueueItem | null>(null);
  const query = unmarkedOnly ? '?unmarked=1' : '';
  const { data, loading, error, reload } = useAsync<{ submissions: WritingQueueItem[]; unmarkedCount: number }>(
    () => api.get(`${apiBase}/writing-queue${query}`),
    [apiBase, query],
  );

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Writing to mark</h1>
          <p className="page-head__meta">
            Essays are never scored automatically. A teacher or administrator awards a practice band and feedback.
          </p>
        </div>
        <Button onClick={() => setUnmarkedOnly((value) => !value)}>
          {unmarkedOnly ? 'Show marked as well' : 'Awaiting marking only'}
        </Button>
      </div>

      <div className="grid grid--3">
        <Stat label="In this list" value={data?.submissions.length ?? 0} />
        <Stat label="Awaiting a band" value={data?.unmarkedCount ?? 0} hint="Submitted writing with no human score yet" />
        <Stat label="Filter" value={unmarkedOnly ? 'Unmarked' : 'All submitted'} />
      </div>

      {loading ? <Loading label="Loading writing submissions…" /> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}

      <Card
        title="Submissions"
        hint="Practice writing only — bands here are human judgments, not official IELTS results."
        flush
      >
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Student</th>
                <th>Test</th>
                <th>Task</th>
                <th className="num">Words</th>
                <th className="num">Band</th>
                <th>Submitted</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data?.submissions.map((row) => (
                <tr key={row.submissionId}>
                  <td>
                    {row.studentName}
                    <div className="tiny muted">{row.studentEmail}</div>
                  </td>
                  <td>
                    {row.testTitle}
                    <div className="tiny muted">{TEST_TYPE_LABELS[row.testType] ?? row.testType}</div>
                  </td>
                  <td>{row.taskLabel}</td>
                  <td className="num">{row.wordCount}</td>
                  <td className="num">
                    {row.scoreBand != null ? (
                      <Badge tone="success">{formatBand(row.scoreBand)}</Badge>
                    ) : (
                      <Badge tone="warning">Awaiting marking</Badge>
                    )}
                  </td>
                  <td className="nowrap">{formatDateTime(row.submittedAt)}</td>
                  <td className="right">
                    <div className="row" style={{ justifyContent: 'flex-end' }}>
                      {apiBase === '/api/teacher' ? (
                        <Link className="btn btn--sm" to={`/teacher/students/${row.studentId}`}>
                          Student
                        </Link>
                      ) : null}
                      <Button size="sm" variant="primary" onClick={() => setSelected(row)}>
                        {row.scoreBand != null ? 'Edit mark' : 'Mark'}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data && data.submissions.length === 0 ? (
          <EmptyState title={unmarkedOnly ? 'Nothing waiting to be marked' : 'No writing submissions yet'}>
            When a student submits Task 1 or Task 2, the essay appears here for a teacher or administrator.
          </EmptyState>
        ) : null}
      </Card>

      <Modal
        open={Boolean(selected)}
        wide
        title={selected ? `Mark ${selected.taskLabel} · ${selected.studentName}` : 'Mark writing'}
        onClose={() => setSelected(null)}
        actions={<Button onClick={() => setSelected(null)}>Close</Button>}
      >
        {selected ? (
          <WritingMarkForm
            apiBase={apiBase}
            submissionId={selected.submissionId}
            taskLabel={selected.taskLabel}
            wordCount={selected.wordCount}
            prompt={selected.prompt}
            responseText={selected.responseText}
            existing={
              selected.scoringSource
                ? {
                    band: selected.scoreBand,
                    feedback: selected.feedback,
                    source: selected.scoringSource,
                    scoredAt: selected.submittedAt ?? '',
                    criteria: selected.criteria,
                  }
                : null
            }
            onSaved={async () => {
              await reload();
              setSelected(null);
            }}
          />
        ) : null}
      </Modal>
    </div>
  );
}

export function TeacherWritingQueuePage() {
  return <WritingQueuePage apiBase="/api/teacher" />;
}

export function AdminWritingQueuePage() {
  return <WritingQueuePage apiBase="/api/admin" />;
}
