import {SpeakingQueue} from './SpeakingQueue';
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
  needsRevisionReview:boolean;
  classroomId:string|null;classroomName:string|null;markingDeadlineAt:string|null;
  criteria: Record<string, number>;
}

export function WritingQueuePage({ apiBase }: { apiBase: '/api/admin' | '/api/teacher' }) {
  const [unmarkedOnly, setUnmarkedOnly] = useState(true);
  const [selected, setSelected] = useState<WritingQueueItem | null>(null);
  const [classroom,setClassroom]=useState('all');
  const [deadline,setDeadline]=useState('all');
  const [sort,setSort]=useState('recent');
  const query=new URLSearchParams();if(unmarkedOnly)query.set('unmarked','1');if(classroom!=='all')query.set('classroom',classroom);if(deadline!=='all')query.set('deadline',deadline);if(sort==='deadline')query.set('order','deadline');const queryString=query.toString();
  const classroomList=useAsync(()=>api.get<{classrooms:Array<{id:string;name:string}>}>('/api/teacher/classrooms'),[]);
  const { data, loading, error, reload } = useAsync<{ submissions: WritingQueueItem[]; unmarkedCount: number }>(
    () => api.get(`${apiBase}/writing-queue?${queryString}`),
    [apiBase, queryString],
  );

  const classes=[...new Map([...(classroomList.data?.classrooms??[]).map(c=>[c.id,c.name] as [string,string]),...(data?.submissions??[]).filter(row=>row.classroomId).map(row=>[row.classroomId!,row.classroomName??'Lớp'] as [string,string])]).entries()];
  const filtered=data?.submissions??[];

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
          {unmarkedOnly ? 'Hiện tất cả bài nộp' : 'Cần giáo viên xem only'}
        </Button>
      </div>

      <div className="grid grid--3">
        <Stat label="In this list" value={data?.submissions.length ?? 0} />
        <Stat label="Cần giáo viên xem" value={data?.unmarkedCount ?? 0} hint="Marked by the AI judges only so far" />
        <Stat label="Filter" value={unmarkedOnly ? 'Cần giáo viên xem' : 'All submitted'} />
      </div>

      {loading ? <Loading label="Loading writing submissions…" /> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}

      <div className="marking-filters" aria-label="Bộ lọc chấm bài"><label>Lớp<select value={classroom} onChange={e=>setClassroom(e.target.value)}><option value="all">Tất cả lớp</option>{classes.map(([id,name])=><option value={id} key={id}>{name}</option>)}</select></label><label>Hạn chấm<select value={deadline} onChange={e=>setDeadline(e.target.value)}><option value="all">Tất cả</option><option value="has">Có hạn</option><option value="none">Chưa có hạn</option></select></label><label>Sắp xếp<select value={sort} onChange={e=>setSort(e.target.value)}><option value="recent">Mặc định</option><option value="deadline">Hạn gần nhất</option></select></label><small>Lọc trên máy chủ; hiển thị tối đa 100 bài phù hợp. Chọn Writing hoặc Speaking ở phía trên.</small></div>
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
                <th>Task / Lớp</th><th>Hạn chấm</th>
                <th className="num">Words</th>
                <th className="num">Band</th>
                <th>Submitted</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.submissionId}>
                  <td>
                    {row.studentName}
                    <div className="tiny muted">{row.studentEmail}</div>
                  </td>
                  <td>
                    {row.testTitle}
                    <div className="tiny muted">{TEST_TYPE_LABELS[row.testType] ?? row.testType}</div>
                  </td>
                  <td>{row.taskLabel}<div className="tiny muted">{row.classroomName??'Không thuộc lớp'}</div>{row.needsRevisionReview&&<div><Badge tone="warning">Bản sửa chờ nhận xét</Badge></div>}</td>
                  <td>{row.markingDeadlineAt?formatDateTime(row.markingDeadlineAt):'—'}</td>
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
        {data && filtered.length === 0 ? (
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

function MarkingWorkspace({apiBase}:{apiBase:'/api/teacher'|'/api/admin'}){const [skill,setSkill]=useState<'WRITING'|'SPEAKING'>('WRITING');return <div className="stack"><div className="row"><Button variant={skill==='WRITING'?'primary':'secondary'} onClick={()=>setSkill('WRITING')}>Writing</Button><Button variant={skill==='SPEAKING'?'primary':'secondary'} onClick={()=>setSkill('SPEAKING')}>Speaking</Button></div>{skill==='WRITING'?<WritingQueuePage apiBase={apiBase}/>:<SpeakingQueue/>}</div>;}
export function TeacherWritingQueuePage() { return <MarkingWorkspace apiBase="/api/teacher" />; }
export function AdminWritingQueuePage() { return <MarkingWorkspace apiBase="/api/admin" />; }
