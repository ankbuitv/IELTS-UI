import {QuestionAnalysis} from './QuestionAnalysis';
import {PracticeBalance} from './PracticeBalance';
import {useState} from 'react';
import {api} from '../../lib/api';
import {useAsync} from '../../hooks/useAsync';
type Student={user_id:string;display_name:string|null;email:string};
type Point={skill:string;band:number;date:string;assignment_title:string};
type Progress={student:{id:string;email:string;display_name:string|null;target_band:number|null};points:Point[]};
export function ClassSkillProgress({classroomId}:{classroomId:string}) {
 const roster=useAsync(()=>api.get<{students:Student[]}>(`/api/teacher/classrooms/${encodeURIComponent(classroomId)}/gradebook`),[classroomId]);const [studentId,setStudentId]=useState('');
 return <section className="class-skill-progress"><h2>Tiến độ kỹ năng</h2><PracticeBalance classroomId={classroomId}/><QuestionAnalysis classroomId={classroomId}/><p>Chỉ tính bài được giao trong lớp này, không gồm luyện tập cá nhân hay lớp khác.</p>{roster.error&&<p role="alert">{roster.error}</p>}<label>Chọn học viên<select value={studentId} onChange={e=>setStudentId(e.target.value)}><option value="">Chọn học viên</option>{roster.data?.students.map(s=><option key={s.user_id} value={s.user_id}>{s.display_name||s.email}</option>)}</select></label>{studentId&&<ProgressChart key={studentId} classroomId={classroomId} studentId={studentId}/>}</section>;
}
function ProgressChart({classroomId,studentId}:{classroomId:string;studentId:string}) {
 const data=useAsync(()=>api.get<Progress>(`/api/teacher/classrooms/${encodeURIComponent(classroomId)}/student-progress/${encodeURIComponent(studentId)}`),[classroomId,studentId]);
 return <>{data.error&&<p role="alert">{data.error}</p>}{data.loading&&!data.data&&<p>Đang tải tiến độ…</p>}{data.data&&<><p>Mục tiêu cá nhân: <strong>{data.data.student.target_band==null?'Chưa đặt':`Band ${data.data.student.target_band.toFixed(1)}`}</strong>. Đây là mục tiêu, không phải điểm thi chính thức.</p><div className="class-skill-progress__grid">{(['LISTENING','READING','WRITING','SPEAKING'] as const).map(skill=>{const points=data.data!.points.filter(p=>p.skill===skill).slice(0,8).reverse();const latest=points.at(-1);const goal=data.data!.student.target_band;return <article key={skill}><h3>{skill}</h3>{latest?<><strong>Gần nhất: {latest.band.toFixed(1)}</strong>{goal!=null&&<small>{latest.band>=goal?'Đạt hoặc vượt mục tiêu':`Còn ${(goal-latest.band).toFixed(1)} band tới mục tiêu`}</small>}<div className="class-skill-progress__bars">{points.map((point,index)=><div key={`${point.date}:${index}`} title={`${point.assignment_title} · ${point.date} · band ${point.band}`}><span>{point.band.toFixed(1)}</span><i style={{height:`${Math.max(2,Math.min(100,point.band/9*100))}%`}}/><small>{new Date(point.date).toLocaleDateString('vi-VN',{day:'2-digit',month:'2-digit'})}</small></div>)}</div></>:<p>Chưa có điểm band trong lớp.</p>}</article>;})}</div><small>Tối đa 200 kết quả gần nhất, mỗi biểu đồ hiển thị 8 điểm. Điểm band chỉ là ước lượng luyện tập; chưa có điểm thì không suy đoán.</small></>}</>;
}
