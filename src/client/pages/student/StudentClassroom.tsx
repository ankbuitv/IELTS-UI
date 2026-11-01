import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAsync } from '../../hooks/useAsync';
import { api, describeError } from '../../lib/api';
import { ClassLogo } from '../../components/ClassLogo';
import { ClassroomCallButton } from '../../components/ClassroomCallButton';
import { StudentTermReports } from '../../components/StudentTermReports';
import { ClassResources } from '../../components/ClassResources';
import { ClassroomBoard } from '../../components/ClassroomBoard';
import { ClassroomChat } from '../../components/ClassroomChat';
import { Loading, Notice } from '../../components/ui';
import { AssignmentRow } from './Dashboard';
import type { AssignmentSummary } from './types';

type ClassItem = {id:string;name:string;description:string;status:string};
type Tab = 'chat' | 'files' | 'assignments' | 'board' | 'resources' | 'term-reports';
export function StudentClassroomPage() {
  const {classroomId=''}=useParams(); const [tab,setTab]=useState<Tab>('chat');
  const data=useAsync(async()=>{const [classes,assignments]=await Promise.all([api.get<{classrooms:ClassItem[]}>('/api/classrooms/mine'),api.get<{assignments:AssignmentSummary[]}>('/api/student/assignments')]);return {klass:classes.classrooms.find(c=>c.id===classroomId),assignments:assignments.assignments.filter(a=>a.classroomId===classroomId)};},[classroomId]);
  if(data.loading&&!data.data)return <Loading label="Đang mở lớp học…"/>;
  if(data.error)return <Notice tone="danger">{describeError(data.error)}</Notice>;
  const klass=data.data?.klass;
  if(!klass)return <Notice tone="danger">Bạn không thuộc lớp này hoặc lớp không còn khả dụng. <Link to="/classrooms">Về danh sách lớp</Link></Notice>;
  return <div className="student-classroom">
    <Link className="student-classroom__back" to="/classrooms">← Các lớp của tôi</Link>
    <header className="student-classroom__header"><ClassLogo type="teacher" id={klass.id} name={klass.name}/><div><span>LỚP HỌC</span><h1>{klass.name}</h1><p>{klass.description || 'Không gian học tập của lớp'}</p></div><ClassroomCallButton classroomId={klass.id}/></header>
    <nav className="student-classroom__tabs" aria-label="Nội dung lớp học">{([{id:'chat',label:'Trò chuyện'},{id:'board',label:'Bảng lớp'},{id:'resources',label:'Tài liệu giáo viên'},{id:'term-reports',label:'Báo cáo'},{id:'files',label:'Tệp lớp học'},{id:'assignments',label:'Bài tập'}] as const).map(item=><button key={item.id} type="button" aria-current={tab===item.id?'page':undefined} onClick={()=>setTab(item.id)}>{item.label}{item.id==='assignments'?` (${data.data?.assignments.length ?? 0})`:''}</button>)}</nav>
    {tab==='term-reports'?<StudentTermReports classroomId={klass.id}/>:tab==='resources'?<ClassResources classroomId={klass.id}/>:tab==='board'?<ClassroomBoard classroomId={klass.id}/>:tab==='assignments'?<section className="student-classroom__assignments"><h2>Bài tập của lớp</h2>{data.data?.assignments.length?data.data.assignments.map(a=><AssignmentRow key={a.assignmentId} assignment={a}/>):<p>Chưa có bài tập đang mở.</p>}</section>:<section className="student-classroom__chat"><header><h2>{tab==='chat'?'Trò chuyện trong lớp':'Tệp đã chia sẻ'}</h2><p>{tab==='chat'?'Trao đổi cùng giáo viên và các bạn.':'Tệp được chia sẻ trong cuộc trò chuyện của lớp.'}</p></header><ClassroomChat classroomId={klass.id} view={tab==='chat'?'messages':'files'}/></section>}
  </div>;
}
