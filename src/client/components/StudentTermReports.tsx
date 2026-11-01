import {api} from '../lib/api';import {useAsync} from '../hooks/useAsync';import {TermReportView,type Release} from './TermReportView';
export function StudentTermReports({classroomId}:{classroomId:string}) {
 const data=useAsync(()=>api.get<{reports:Release[]}>(`/api/classrooms/${encodeURIComponent(classroomId)}/term-reports`),[classroomId]);
 return <section className="term-report"><h2>Báo cáo học tập của bạn</h2><p>Chỉ những báo cáo đã được giáo viên duyệt và chia sẻ xuất hiện tại đây.</p>{data.error&&<p role="alert">{data.error}</p>}{data.loading&&!data.data&&<p>Đang tải…</p>}{data.data?.reports.map(report=><TermReportView key={report.id} report={report}/>)}{data.data&&!data.data.reports.length&&<p>Chưa có báo cáo được chia sẻ.</p>}</section>;
}
