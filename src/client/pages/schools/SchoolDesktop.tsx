import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useAsync } from '../../hooks/useAsync';
import { api } from '../../lib/api';
import { Icon, type IconName } from '../../components/Icon';
import { Loading, Notice } from '../../components/ui';

type School = {id:string;name:string;status:string;member_status:string};
type ClassItem = {id:string;name:string};
type Shortcut = {title:string;detail:string;icon:IconName;to:string;tone:string};
export function SchoolDesktop() {
  const {user}=useAuth();
  const access=useAsync(()=>api.get<{isManager:boolean}>('/api/schools/access'),[]);
  const schools=useAsync(()=>api.get<{schools:School[]}>('/api/schools'),[]);
  const [schoolLogo,setSchoolLogo]=useState<{id:string;mime:string;data_b64:string}|null>(null);
  const [schoolId,setSchoolId]=useState(''); const [classId,setClassId]=useState(''); const [query,setQuery]=useState(''); const [menu,setMenu]=useState(false);
  const [wallpaper,setWallpaper]=useState(()=>localStorage.getItem('school-desktop-wallpaper') || 'mist');
  const [recent,setRecent]=useState<string[]>(()=>{try{return JSON.parse(localStorage.getItem('school-desktop-recent') || '[]') as string[];}catch{return [];}});
  const staff=user?.role==='TEACHER'||user?.role==='MENTOR'||user?.role==='ADMIN';
  const classes=useAsync(async()=>{
    if(user?.role==='MENTOR') {const result=await api.get<{classes:Array<{id:string;title:string;mentorId:string}>}>('/api/mentor/classes/list');return result.classes.filter(c=>c.mentorId===user.id).map(c=>({id:c.id,name:c.title}));}
    if(user?.role==='TEACHER'||user?.role==='ADMIN') {const result=await api.get<{classrooms:ClassItem[]}>('/api/teacher/classrooms');return result.classrooms;}
    return [];
  },[user?.id,user?.role]);
  const approved=(schools.data?.schools??[]).filter(s=>s.status==='APPROVED'&&s.member_status==='ACTIVE');
  const school=approved.find(s=>s.id===schoolId) ?? approved[0];
  useEffect(()=>{if(!school?.id)return;let active=true;const id=school.id;void api.get<{logo:{mime:string;data_b64:string}|null}>(`/api/schools/${encodeURIComponent(id)}/logo`).then(result=>{if(active)setSchoolLogo(result.logo?{id,...result.logo}:null);}).catch(()=>{if(active)setSchoolLogo(null);});return()=>{active=false;};},[school?.id]);
  useEffect(()=>{localStorage.setItem('school-desktop-wallpaper',wallpaper);},[wallpaper]);
  if(access.loading)return <Loading label="Đang mở không gian làm việc…"/>;
  if(!staff && !access.data?.isManager)return <Notice tone="danger">Không gian này dành cho nhân sự giảng dạy và quản lý trường.</Notice>;
  const isMentor=user?.role==='MENTOR';
  const selected=classes.data?.find(c=>c.id===classId)??classes.data?.[0];
  const home=isMentor?'/mentor':'/teacher';
  const classList=isMentor?'/classes':'/teacher';
  const classPath=selected?(isMentor?`/classes/${selected.id}`:`/teacher/classrooms/${selected.id}`):classList;
  const classTab=(tab:string)=>selected && !isMentor?`${classPath}?tab=${tab}`:classPath;
  const shortcuts:Shortcut[]=[
    {title:'Lớp học',detail:'Lớp và học viên',icon:'users',to:classList,tone:'blue'},
    ...(!isMentor?[{title:'Bài tập',detail:'Giao và theo dõi bài',icon:'list' as const,to:classTab('assignments'),tone:'amber'}]:[]),
    ...(!isMentor?[{title:'Chấm Writing',detail:'Hàng chờ chấm bài',icon:'pen' as const,to:'/teacher/marking',tone:'red'}]:[]),
    {title:'Điểm danh',detail:'Mở phòng và báo cáo',icon:'checkCircle',to:classPath,tone:'green'},
    {title:'Tin nhắn',detail:'Hội thoại lớp học',icon:'bubble',to:classTab('conversation'),tone:'blue'},
    ...(!isMentor?[{title:'Tài liệu',detail:'Tệp của lớp',icon:'file' as const,to:classTab('files'),tone:'teal'}]:[]),
    {title:'Đánh giá buổi học',detail:isMentor?'Xem báo cáo trong phòng':'Xem trong lớp',icon:'star',to:isMentor?classPath:classTab('ratings'),tone:'amber'},
    {title:'Lịch dạy',detail:'Lịch và buổi học',icon:'calendar',to:'/calendar',tone:'green'},
    {title:'Trường học',detail:'Thông tin và thành viên',icon:'graduation',to:'/schools',tone:'teal'},
    {title:'Buổi học',detail:'Lịch sử và phòng call',icon:'video',to:'/my-sessions',tone:'blue'},
    ...(user?.role==='ADMIN'?[{title:'Quản trị hệ thống',detail:'Tài khoản và xét duyệt',icon:'shield' as const,to:'/admin',tone:'red'}]:[]),
  ];
  const filtered=shortcuts.filter(x=>`${x.title} ${x.detail}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const remember=(title:string)=>{const next=[title,...recent.filter(x=>x!==title)].slice(0,4);setRecent(next);localStorage.setItem('school-desktop-recent',JSON.stringify(next));};
  return <div className={`school-desktop school-desktop--${wallpaper}`}>
    <header className="sd-top"><div><span className="sd-wordmark">AI EO <i/> WORKSPACE</span><div className="sd-welcome"><div><p>KHÔNG GIAN LÀM VIỆC</p><h1>Xin chào, {user?.displayName}</h1><span>Mọi công cụ giảng dạy, gọn trong một nơi.</span></div></div></div><div className="sd-school">{schoolLogo && schoolLogo.id===school?.id?<img src={`data:${schoolLogo.mime};base64,${schoolLogo.data_b64}`} alt={`Logo ${school?.name}`}/>:<span className="sd-school__mark"><Icon name="graduation" size={23}/></span>}<div><small>ĐƠN VỊ CÔNG TÁC</small>{approved.length>1?<select value={school?.id??''} onChange={e=>setSchoolId(e.target.value)} aria-label="Chọn trường">{approved.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select>:<strong>{school?.name || 'Cá nhân'}</strong>}</div></div></header>
    <nav className="sd-modes" aria-label="Không gian làm việc"><Link to="/dashboard">Practice & Learn <span>Học tập cá nhân</span></Link><Link to={home}>Teaching <span>Giảng dạy</span></Link><span className="active">School Desktop <small>Không gian làm việc</small></span></nav>
    <div className="sd-toolbar"><div><h2>Công cụ làm việc</h2><p>Chọn lớp để mở nhanh bài tập, tin nhắn và tài liệu.</p></div><div className="sd-tools"><label className="sd-class-select"><span>Lớp hiện tại</span><select value={selected?.id??''} onChange={e=>setClassId(e.target.value)} aria-label="Chọn lớp hiện tại">{selected?classes.data?.map(c=><option key={c.id} value={c.id}>{c.name}</option>):<option value="">Chưa có lớp</option>}</select></label><label className="sd-search"><Icon name="search" size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Tìm công cụ" aria-label="Tìm công cụ"/></label></div></div>
    <div className="sd-icons">{filtered.map(item=><Link key={item.title} className="sd-icon" to={item.to} onClick={()=>remember(item.title)}><span className={`sd-icon__art sd-icon__art--${item.tone}`}><Icon name={item.icon} size={25}/></span><strong>{item.title}</strong><small>{item.detail}</small></Link>)}{!filtered.length?<p>Không tìm thấy công cụ phù hợp.</p>:null}</div>
    <div className="sd-spacer"/>
    <footer className="sd-dock"><div className="sd-dock__start"><button type="button" onClick={()=>setMenu(!menu)} aria-expanded={menu}><Icon name="grid" size={19}/> <span>Menu</span></button>{menu?<div className="sd-menu"><strong>Đi đến</strong><Link to="/dashboard">Practice & Learn</Link><Link to={home}>Teaching</Link><Link to="/schools">Trường học</Link></div>:null}</div><label className="sd-dock__search"><Icon name="search" size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Tìm công cụ" aria-label="Tìm trong desktop"/></label><div className="sd-recent"><span>Gần đây</span>{recent.map(name=>{const item=shortcuts.find(x=>x.title===name);return item?<Link key={name} to={item.to} title={name} aria-label={name} onClick={()=>remember(name)}><Icon name={item.icon} size={18}/></Link>:null;})}</div><div className="sd-dock__end"><label>Giao diện <select aria-label="Chọn hình nền" value={wallpaper} onChange={e=>setWallpaper(e.target.value)}><option value="mist">Sương</option><option value="paper">Giấy</option><option value="sage">Xanh lá</option></select></label><Link to="/notifications" aria-label="Thông báo" title="Thông báo"><Icon name="bell" size={20}/></Link></div></footer>
  </div>;
}
