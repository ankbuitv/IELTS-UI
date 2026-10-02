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
            Essays are marked automatically by the AI judges. Award a practice band and feedback here and your band replaces their estimate.
          </p>
        </div>
        <Button onClick={() => setUnmarkedOnly((value) => !value)}>
          {unmarkedOnly ? 'Show teacher-marked as well' : 'No teacher band only'}
        </Button>
      </div>

      <div className="grid grid--3">
        <Stat label="In this list" value={data?.submissions.length ?? 0} />
        <Stat label="No teacher band" value={data?.unmarkedCount ?? 0} hint="Marked by the AI judges only so far" />
        <Stat label="Filter" value={unmarkedOnly ? 'No teacher band' : 'All submitted'} />
      </div>

      {loading ? <Loading label="Loading writing submissions…" /> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}

      <Card
        title="Submissions"
        hint="Practice writing only. The AI judges mark every essay automatically; a teacher’s band replaces their estimate. None of it is an official IELTS result."
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
                      <Badge tone="neutral">AI only</Badge>
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
                        {row.scoreBand != null ? 'Edit band' : 'Add band'}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data && data.submissions.length === 0 ? (
          <EmptyState title={unmarkedOnly ? 'No essays are waiting for a teacher band' : 'No writing submissions yet'}>
            When a student submits Task 1 or Task 2, the essay appears here. The AI judges mark it automatically; you can add a teacher’s band.
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
