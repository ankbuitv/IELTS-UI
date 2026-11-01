import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useAsync } from '../../hooks/useAsync';
import { api, describeError } from '../../lib/api';
import { Icon, type IconName } from '../../components/Icon';
import { BrandLogo } from '../../components/BrandLogo';
import { UserAvatar } from '../../components/UserAvatar';
import { useNotificationFeed } from '../../components/NotificationBell';
import {DesktopSearch} from './DesktopSearch';
import {TeacherToday} from './TeacherToday';
import { DesktopNotifications } from './DesktopNotifications';
import { DesktopApplication } from './DesktopApplications';
import { DesktopAppIcon } from './DesktopAppIcon';
import { SchoolOverviewWindow, SchoolBannerWindow } from './SchoolInsights';
import { safeInternalPath } from './desktop-routing';
import { resolveSchoolSelection } from './school-selection';
import { Loading, Notice } from '../../components/ui';
import { LessonPlansWindow } from './LessonPlansWindow';
import { SchoolCalendarWindow, SubjectGroupsWindow, LessonReviewsWindow, SchoolPermissionsWindow } from './SchoolOperations';

type School = { id: string; name: string; status: string; member_status: string; member_role?: string; address?: string };
type ClassItem = { id: string; name: string; studentCount?: number; status?: string };
type Member = { user_id: string; role: string; status: string; email: string; display_name: string | null };
type AppId = 'today' | 'resource-library' | 'question-bank' | 'school-overview' | 'school-banner' | 'teacher-progress' | 'page' | 'notifications' | 'profile' | 'mentor-console' | 'mentor-earnings' | 'admin-tests' | 'admin-imports' | 'admin-users' | 'admin-schools' | 'school-app-reviews' | 'admin-settings' | 'admin-attempts' | 'admin-learn' | 'admin-scoring' | 'practice' | 'history' | 'vocabulary' | 'dictionary' | 'speaking' | 'drills' | 'mentors' | 'study-room' | 'shortcut-folder' | 'school-permissions' | 'lesson-reviews' | 'subject-groups' | 'school-calendar' | 'lesson-plans' | 'classes' | 'class-detail' | 'class-manage' | 'school-manage' | 'school-invitations' | 'wallpaper' | 'schools' | 'members' | 'assignments' | 'messages' | 'files' | 'marking' | 'calendar' | 'sessions' | 'learn' | 'admin';
type DesktopApp = { id: AppId; title: string; icon: IconName; tone: string; group: string; path?: string };
type Wallpaper = 'sky' | 'forest' | 'sunset' | 'midnight' | 'ocean' | 'lavender' | 'custom';
type BackgroundSettings = { choice: Wallpaper; image: string | null; fit: 'cover' | 'contain' | 'center'; dim: number };
type DesktopMenu = { x: number; y: number; appId?: AppId };
type WindowState = { id: AppId; x: number; y: number; z: number; minimized: boolean; maximized: boolean; snap: 'left' | 'right' | null };
type ShortcutFolder = { id:string; name:string; apps:AppId[] };
type DesktopPreferences = { background: BackgroundSettings; iconsVisible: boolean; iconOrder: string[]; pinned: AppId[]; folders: ShortcutFolder[]; windows: WindowState[] };
const statusLabel = (s?: string) => ({ APPROVED: 'Đã duyệt', PENDING: 'Chờ duyệt', REJECTED: 'Từ chối', ACTIVE: 'Hoạt động', INVITED: 'Đã mời', DECLINED: 'Đã từ chối', REMOVED: 'Đã xóa', ARCHIVED: 'Lưu trữ', OWNER: 'Quản lý', TEACHER: 'Giáo viên' }[s ?? ''] ?? s ?? '—');

export function SchoolDesktop({initialPath}:{initialPath?:string} = {}) {
  const { user, logout } = useAuth();
  const navigate=useNavigate();
  const notification=useNotificationFeed();
  const [pagePath,setPagePath]=useState(initialPath ?? '/profile');
  const [pageRevision,setPageRevision]=useState(0);
  const [activeExams,setActiveExams]=useState<Record<string,boolean>>({});
  const [activeLessons,setActiveLessons]=useState<Record<string,boolean>>({});
  const reportLesson=useCallback((id:string,active:boolean)=>setActiveLessons(current=>{if(!!current[id]===active)return current;const next={...current};if(active)next[id]=true;else delete next[id];return next;}),[]);
  const [activeCalls,setActiveCalls]=useState<Record<string,boolean>>({});
  const reportCall=useCallback((id:string,active:boolean)=>setActiveCalls(current=>{if(!!current[id]===active)return current;const next={...current};if(active)next[id]=true;else delete next[id];return next;}),[]);
  const reportExam=useCallback((id:string,active:boolean)=>setActiveExams(current=>{if(!!current[id]===active)return current;const next={...current};if(active)next[id]=true;else delete next[id];return next;}),[]);
  const access = useAsync(() => api.get<{ isManager: boolean; canReviewSchools: boolean }>('/api/schools/access'), []);
  const schools = useAsync(() => api.get<{ schools: School[] }>('/api/schools'), []);
  const classes = useAsync(async () => {
    if (user?.role === 'MENTOR') {
      const result = await api.get<{ classes: Array<{ id: string; title: string; mentorId: string }> }>('/api/mentor/classes/list');
      return result.classes.filter(c => c.mentorId === user.id).map(c => ({ id: c.id, name: c.title } as ClassItem));
    }
    if (user?.role === 'TEACHER' || user?.role === 'ADMIN') return (await api.get<{ classrooms: ClassItem[] }>('/api/teacher/classrooms')).classrooms;
    return [];
  }, [user?.id, user?.role]);
  const [schoolId, setSchoolIdState] = useState(() => { try { return localStorage.getItem(`school-desktop-selected-school:${user?.id ?? 'guest'}`) ?? ''; } catch { return ''; } });
  const [schoolPickerOpen, setSchoolPickerOpen] = useState(false);
  const [classId, setClassId] = useState('');
  const [members, setMembers] = useState<{ schoolId: string; items: Member[]; error?: string } | null>(null);
  const [permissionVersion, setPermissionVersion] = useState(0);
  const [managementPermissions, setManagementPermissions] = useState<{schoolId:string;permissions:string[]}|null>(null);
  const [reviewPermission, setReviewPermission] = useState<{schoolId:string;canReview:boolean}|null>(null);
  const [logoVersion, setLogoVersion] = useState(0);
  const [contextMenu, setContextMenu] = useState<DesktopMenu | null>(null);
  const [iconsVisible, setIconsVisible] = useState(() => { try { return localStorage.getItem(`school-desktop-icons:${user?.id ?? 'guest'}`) !== 'hidden'; } catch { return true; } });
  const menuRef = useRef<HTMLDivElement>(null);
  const [logo, setLogo] = useState<{ id: string; mime: string; data_b64: string } | null>(null);
  const [windows, setWindows] = useState<WindowState[]>(() => initialPath ? [{id:initialPath.split('?')[0] === '/notifications' ? 'notifications' : 'page',x:115,y:38,z:2,minimized:false,maximized:false,snap:null}] : []);
  const [iconOrder, setIconOrder] = useState<string[]>(() => { try { const data:unknown = JSON.parse(localStorage.getItem(`school-desktop-order:${user?.id ?? 'guest'}`) ?? '[]'); return Array.isArray(data) ? data.filter((id): id is string => typeof id === 'string') : []; } catch { return []; } });
  const [pinned, setPinned] = useState<AppId[]>(() => { try { const data:unknown=JSON.parse(localStorage.getItem(`school-desktop-pinned:${user?.id ?? 'guest'}`)??'[]');return Array.isArray(data)?data.filter((id):id is AppId=>typeof id==='string').slice(0,6):[]; } catch {return [];} });
  const [folders, setFolders] = useState<ShortcutFolder[]>(() => { try {const data:unknown=JSON.parse(localStorage.getItem(`school-desktop-folders:${user?.id ?? 'guest'}`)??'[]');return Array.isArray(data)?data.filter((f):f is ShortcutFolder=>!!f && typeof f.id==='string' && typeof f.name==='string' && Array.isArray(f.apps)).slice(0,20):[];} catch {return [];} });
  const [currentFolder, setCurrentFolder] = useState<string|null>(null);
  const [folderEdit, setFolderEdit] = useState<'new'|string|null>(null);
  const [folderName, setFolderName] = useState('');
  const [folderApps, setFolderApps] = useState<AppId[]>([]);
  const [folderError, setFolderError] = useState('');
  const draggedIcon = useRef<AppId | null>(null);
  const [syncMessage, setSyncMessage] = useState('');
  const [syncBusy, setSyncBusy] = useState(false);
  const [start, setStart] = useState(false);
  const [focusMode,setFocusMode]=useState(false);
  const [submenu, setSubmenu] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteError, setInviteError] = useState('');
  const [inviteNotice, setInviteNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [clock, setClock] = useState(() => new Date());
  const wallpaperKey = `school-desktop-background:${user?.id ?? 'guest'}`;
  const [background, setBackground] = useState<BackgroundSettings>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(wallpaperKey) ?? '{}') as { choice?: string; image?: string; fit?: string; dim?: number };
      const choice = ['sky', 'forest', 'sunset', 'midnight', 'ocean', 'lavender', 'custom'].includes(stored.choice ?? '') ? stored.choice as Wallpaper : 'sky';
      const image = typeof stored.image === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(stored.image) ? stored.image : null;
      const fit = stored.fit === 'contain' || stored.fit === 'center' ? stored.fit : 'cover';
      const dim = typeof stored.dim === 'number' && Number.isFinite(stored.dim) ? Math.max(0, Math.min(70, stored.dim)) : 20;
      return { choice: choice === 'custom' && !image ? 'sky' : choice, image, fit, dim };
    } catch { return { choice: 'sky', image: null, fit: 'cover', dim: 20 }; }
  });
  const [wallpaperError, setWallpaperError] = useState('');
  const [wallpaperBusy, setWallpaperBusy] = useState(false);
  const desktopRef = useRef<HTMLDivElement>(null);
  const zCounter = useRef(initialPath ? 2 : 1);
  const drag = useRef<{ id: AppId; startX: number; startY: number; x: number; y: number } | null>(null);
  const {approved, selected: school, needsChoice} = resolveSchoolSelection(schools.data?.schools ?? [], schoolId);
  const soleSchoolId = approved.length === 1 ? approved[0]?.id : undefined;
  const schoolPickerRef = useRef<HTMLElement>(null);
  const needsSchoolChoice = !!schools.data && needsChoice;
  const changeSchool = (id: string) => {
    if (!approved.some(s => s.id === id)) return false;
    const schoolWindows = ['school-banner','school-permissions','subject-groups','lesson-reviews','school-calendar','lesson-plans','members'];
    if (school && school.id !== id && windows.some(w => schoolWindows.includes(w.id)) && !window.confirm('Chuyển trường sẽ tải lại các cửa sổ của trường và có thể mất nội dung chưa lưu. Tiếp tục?')) return false;
    setSchoolIdState(id);
    try { localStorage.setItem(`school-desktop-selected-school:${user?.id ?? 'guest'}`, id); } catch { /* The choice lasts for this visit. */ }
    setSchoolPickerOpen(false); setStart(false); setSubmenu(null);
    return true;
  };
  const setSchoolId = changeSchool;
  const selected = classes.data?.find(c => c.id === classId) ?? classes.data?.[0];
  const isMentor = user?.role === 'MENTOR';
  const owner = school?.member_role === 'OWNER';
  const granted = managementPermissions && school && managementPermissions.schoolId === school.id ? managementPermissions.permissions : [];
  const canManageGroups = !!owner || granted.includes('MANAGE_GROUPS');
  const canManageCalendar = !!owner || granted.includes('MANAGE_CALENDAR');
  const classList = isMentor ? '/classes' : '/teacher';
  const classPath = selected ? (isMentor ? `/classes/${selected.id}` : `/teacher/classrooms/${selected.id}`) : classList;
  const classTab = (tab: string) => selected && !isMentor ? `${classPath}?tab=${tab}` : classPath;
  const apps: DesktopApp[] = [
    ...(!isMentor ? [{id:'today' as const,title:'Hôm nay',icon:'clock' as const,tone:'cyan',group:'Giảng dạy'}] : []),
    ...(access.data?.canReviewSchools ? [{id:'school-overview' as const,title:'Tổng hợp trường',icon:'chart' as const,tone:'cyan',group:'Nhà trường'}] : []),
    ...(owner ? [{id:'school-banner' as const,title:'Banner học viên',icon:'presentation' as const,tone:'violet',group:'Nhà trường'}] : []),
    ...(!isMentor ? [{id:'resource-library' as const,title:'Thư viện tài liệu',icon:'file' as const,tone:'orange',group:'Giảng dạy',path:'/teacher/resources'}] : []),
    ...(!isMentor ? [{id:'question-bank' as const,title:'Ngân hàng câu hỏi',icon:'layers' as const,tone:'violet',group:'Giảng dạy',path:'/teacher/questions'}] : []),
    ...(!isMentor ? [{id:'teacher-progress' as const,title:'Tiến độ bài tập',icon:'chart' as const,tone:'blue',group:'Giảng dạy',path:'/teacher/progress'}] : []),
    ...((owner || (reviewPermission?.schoolId === school?.id && reviewPermission?.canReview)) ? [{ id: 'lesson-reviews' as const, title: 'Duyệt giáo án', icon: 'checkCircle' as const, tone: 'green', group: 'Nhà trường' }] : []),
    ...(owner ? [{ id: 'school-permissions' as const, title: 'Phân quyền trường', icon: 'shield' as const, tone: 'red', group: 'Nhà trường' }] : []),
    ...(canManageGroups ? [{ id: 'subject-groups' as const, title: 'Tổ bộ môn', icon: 'layers' as const, tone: 'orange', group: 'Nhà trường' }] : []),
    { id: 'notifications', title: 'Thông báo', icon: 'bell', tone: 'red', group: 'Tiện ích' },
    { id: 'profile', title: 'Hồ sơ cá nhân', icon: 'user', tone: 'blue', group: 'Tiện ích', path: '/profile' },
    ...(access.data?.canReviewSchools && user?.role !== 'ADMIN' ? [{id:'school-app-reviews' as const,title:'Duyệt đăng ký trường',icon:'checkCircle' as const,tone:'green',group:'Nhà trường',path:'/school-reviews'}] : []),
    { id: 'school-calendar', title: 'Lịch trường', icon: 'calendar', tone: 'green', group: 'Nhà trường' },
    { id: 'lesson-plans', title: 'Quản lý giáo án', icon: 'book', tone: 'green', group: 'Giảng dạy' },
    { id: 'classes', title: 'Quản lý lớp học', icon: 'users', tone: 'blue', group: 'Giảng dạy' },
    { id: 'schools', title: 'Trường học', icon: 'graduation', tone: 'cyan', group: 'Nhà trường' },
    ...(owner ? [{ id: 'members' as const, title: 'Nhân sự giáo viên', icon: 'user' as const, tone: 'orange', group: 'Nhà trường' }] : []),
    ...(!isMentor ? [{ id: 'assignments' as const, title: 'Quản lý bài tập', icon: 'list' as const, tone: 'violet', group: 'Giảng dạy', path: classTab('assignments') }] : []),
    ...(!isMentor ? [{ id: 'messages' as const, title: 'Tin nhắn lớp', icon: 'bubble' as const, tone: 'blue', group: 'Giảng dạy', path: classTab('conversation') }] : []),
    ...(!isMentor ? [{ id: 'files' as const, title: 'Tài liệu lớp', icon: 'file' as const, tone: 'orange', group: 'Giảng dạy', path: classTab('files') }, { id: 'marking' as const, title: 'Chấm bài Writing', icon: 'pen' as const, tone: 'red', group: 'Giảng dạy', path: user?.role === 'ADMIN' ? '/admin/writing' : '/teacher/marking' }] : []),
    { id: 'calendar', title: 'Lịch dạy', icon: 'calendar', tone: 'green', group: 'Tiện ích', path: '/calendar' },
    { id: 'wallpaper', title: 'Cài đặt hình nền', icon: 'settings', tone: 'violet', group: 'Tiện ích' },
    { id: 'sessions', title: 'Buổi học', icon: 'video', tone: 'cyan', group: 'Tiện ích', path: '/my-sessions' },
    { id: 'learn', title: 'Practice & Learn', icon: 'book', tone: 'green', group: 'Tiện ích', path: '/learn' },
    ...(isMentor || user?.role === 'ADMIN' ? [
      {id:'mentor-console' as const,title:'Quản lý cố vấn',icon:'presentation' as const,tone:'violet',group:'Cố vấn',path:'/mentor'},
      {id:'mentor-earnings' as const,title:'Thu nhập cố vấn',icon:'chart' as const,tone:'green',group:'Cố vấn',path:'/mentor/earnings'},
    ] : []),
    ...([
      {id:'practice' as const,title:'Luyện thi',icon:'book' as const,tone:'green',group:'Học tập',path:'/practice'},
      {id:'history' as const,title:'Kết quả',icon:'award' as const,tone:'orange',group:'Học tập',path:'/history'},
      {id:'vocabulary' as const,title:'Từ vựng',icon:'layers' as const,tone:'violet',group:'Học tập',path:'/vocabulary'},
      {id:'dictionary' as const,title:'Từ điển',icon:'search' as const,tone:'cyan',group:'Học tập',path:'/dictionary'},
      {id:'speaking' as const,title:'Luyện nói',icon:'mic' as const,tone:'blue',group:'Học tập',path:'/speaking'},
      {id:'drills' as const,title:'Ôn dạng bài',icon:'target' as const,tone:'green',group:'Học tập',path:'/drills'},
      {id:'mentors' as const,title:'Danh sách cố vấn',icon:'graduation' as const,tone:'blue',group:'Học tập',path:'/mentors'},
      {id:'study-room' as const,title:'Phòng học',icon:'clock' as const,tone:'orange',group:'Học tập',path:'/study-room'},
    ]),
    ...(user?.role === 'ADMIN' ? [
      {id:'admin' as const,title:'Quản trị hệ thống',icon:'shield' as const,tone:'red',group:'Hệ thống',path:'/admin'},
      {id:'admin-tests' as const,title:'Đề thi',icon:'file' as const,tone:'blue',group:'Hệ thống',path:'/admin/tests'},
      {id:'admin-imports' as const,title:'Nhập nội dung',icon:'upload' as const,tone:'cyan',group:'Hệ thống',path:'/admin/imports'},
      {id:'admin-users' as const,title:'Người dùng',icon:'users' as const,tone:'orange',group:'Hệ thống',path:'/admin/users'},
      {id:'admin-schools' as const,title:'Duyệt trường',icon:'graduation' as const,tone:'green',group:'Hệ thống',path:'/admin/schools'},
      {id:'admin-settings' as const,title:'Cài đặt hệ thống',icon:'settings' as const,tone:'violet',group:'Hệ thống',path:'/admin/settings'},
      {id:'admin-attempts' as const,title:'Lượt thi',icon:'list' as const,tone:'blue',group:'Hệ thống',path:'/admin/attempts'},
      {id:'admin-learn' as const,title:'Nội dung học',icon:'book' as const,tone:'green',group:'Hệ thống',path:'/admin/learn'},
      {id:'admin-scoring' as const,title:'Hồ sơ chấm điểm',icon:'checkCircle' as const,tone:'cyan',group:'Hệ thống',path:'/admin/scoring-profiles'},
    ] : []),
    {id:'page',title:'Trang ứng dụng',icon:'file',tone:'blue',group:'Tiện ích',path:pagePath},
    { id: 'class-detail', title: 'Chi tiết lớp học', icon: 'users', tone: 'blue', group: 'Giảng dạy', path: classPath },
    { id: 'class-manage', title: 'Quản lý và tạo lớp', icon: 'plus', tone: 'blue', group: 'Giảng dạy', path: classList },
    { id: 'shortcut-folder', title: 'Thư mục ứng dụng', icon: 'layers', tone: 'orange', group: 'Tiện ích' },
    { id: 'school-invitations', title: 'Trường và lời mời', icon: 'graduation', tone: 'cyan', group: 'Nhà trường', path: '/schools' },
    ...(owner ? [{ id: 'school-manage' as const, title: 'Quản lý trường', icon: 'settings' as const, tone: 'cyan', group: 'Nhà trường', path: '/schools' }] : []),
  ];
  useEffect(() => {
    if (!schools.data || !soleSchoolId || schoolId === soleSchoolId) return;
    setSchoolIdState(soleSchoolId);
    try { localStorage.setItem(`school-desktop-selected-school:${user?.id ?? 'guest'}`, soleSchoolId); } catch { /* Keep the choice in memory. */ }
  }, [schools.data, soleSchoolId, schoolId, user?.id]);
  useEffect(() => {
    if (!needsSchoolChoice && !schoolPickerOpen) return;
    schoolPickerRef.current?.querySelector<HTMLButtonElement>('.sd-school-picker__item')?.focus();
  }, [needsSchoolChoice, schoolPickerOpen]);
  const reloadSchools = schools.reload;
  useEffect(() => { const refresh=()=>{void reloadSchools();}; window.addEventListener('desktop-schools-changed',refresh); return()=>window.removeEventListener('desktop-schools-changed',refresh); },[reloadSchools]);
  const reloadClasses = classes.reload;
  useEffect(() => {
    const refresh=()=>{void reloadClasses();};
    window.addEventListener('desktop-classrooms-changed',refresh);
    return()=>window.removeEventListener('desktop-classrooms-changed',refresh);
  },[reloadClasses]);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!school?.id) { setLogo(null); return; }
    let active = true; const id = school.id;
    void api.get<{ logo: { mime: string; data_b64: string } | null }>(`/api/schools/${encodeURIComponent(id)}/logo`).then(r => { if (active) setLogo(r.logo ? { id, ...r.logo } : null); }).catch(() => { if (active) setLogo(null); });
    return () => { active = false; };
  }, [school?.id, logoVersion]);
  useEffect(() => {
    if (!school?.id) return; let active=true; const id=school.id;
    void api.get<{permissions:string[]}>(`/api/schools/${id}/my-permissions`).then(r=>{if(active)setManagementPermissions({schoolId:id,permissions:r.permissions});}).catch(()=>{if(active)setManagementPermissions({schoolId:id,permissions:[]});});
    return()=>{active=false;};
  },[school?.id,permissionVersion]);
  useEffect(() => {
    if (!school?.id) return; let active=true; const id=school.id;
    void api.get<{canReview:boolean}>(`/api/schools/${id}/lesson-review-access`).then(r=>{if(active)setReviewPermission({schoolId:id,canReview:r.canReview});}).catch(()=>{if(active)setReviewPermission({schoolId:id,canReview:false});});
    return()=>{active=false;};
  },[school?.id,permissionVersion]);
  useEffect(() => { const refresh=()=>setPermissionVersion(v=>v+1); window.addEventListener('focus',refresh); return()=>window.removeEventListener('focus',refresh); },[]);
  useEffect(() => {
    const onLogoUpdated = (event: MessageEvent) => {
      if (event.origin === window.location.origin && event.data?.type === 'school-logo-updated' && event.data.schoolId === school?.id) setLogoVersion(v => v + 1);
    };
    window.addEventListener('message', onLogoUpdated); return () => window.removeEventListener('message', onLogoUpdated);
  }, [school?.id]);
  useEffect(() => {
    if (!school?.id || !owner) { setMembers(null); return; }
    let active = true; const id = school.id;
    setMembers(null);
    void api.get<{ members: Member[] }>(`/api/schools/${encodeURIComponent(id)}/members`).then(r => { if (active) setMembers({ schoolId: id, items: r.members }); }).catch(e => { if (active) setMembers({ schoolId: id, items: [], error: describeError(e) }); });
    return () => { active = false; };
  }, [school?.id, owner]);
  useEffect(() => {
    const keydown = (e: KeyboardEvent) => { if (e.key === 'Escape') { setStart(false); setSubmenu(null); setInviteOpen(false); setContextMenu(null); setSchoolPickerOpen(false); } };
    window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown);
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const close = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node) && !(event.target as Element).closest?.('.sd-menu-button')) setContextMenu(null); };
    const resize = () => setContextMenu(null);
    document.addEventListener('pointerdown', close); window.addEventListener('resize', resize);
    return () => { document.removeEventListener('pointerdown', close); window.removeEventListener('resize', resize); };
  }, [contextMenu]);

  if (access.loading || (schools.loading && !schools.data)) return <Loading label="Đang mở không gian làm việc…" />;
  if (!user || (!['TEACHER', 'MENTOR', 'ADMIN'].includes(user.role) && !access.data?.isManager)) return <div className="sd-access-denied"><Notice tone="danger">Không gian này dành cho nhân sự giảng dạy và quản lý trường.</Notice><Link to="/dashboard">← Quay lại Ai eo</Link></div>;
  const open = (id: AppId) => {
    setStart(false); setSubmenu(null); setContextMenu(null);
    const z = ++zCounter.current;
    setWindows(current => current.some(w => w.id === id) ? current.map(w => w.id === id ? { ...w, minimized: false, z } : w) : [...current, { id, x: 115 + (current.length % 4) * 32, y: 38 + (current.length % 4) * 28, z, minimized: false, maximized: false, snap: null }]);
  };
  const confirmExamExit = (id:AppId) => (!activeExams[id] || window.confirm('Rời bài làm? Đồng hồ vẫn chạy. Hãy dùng nút thoát trong bài để lưu bài an toàn.')) && (!activeCalls[id] || window.confirm('Đóng cửa sổ sẽ rời cuộc gọi. Bạn có muốn tiếp tục?')) && (!activeLessons[id] || window.confirm('Rời bài học? Tiến độ chưa hoàn thành sẽ không được lưu.'));
  const closeWindow = (id:AppId) => { if(confirmExamExit(id)) setWindows(current=>current.filter(win=>win.id!==id)); };
  const openPage = (path:string) => { if(!safeInternalPath(path))return; if(path.split('?')[0]==='/notifications'){open('notifications');return;} if(path==='/dashboard' || path==='/school-desktop' || path==='/'){if(Object.keys(activeExams).length && !window.confirm('Rời bài làm? Đồng hồ vẫn chạy và bài chưa lưu có thể chưa đồng bộ.'))return;if(Object.keys(activeCalls).length && !window.confirm('Đóng các cửa sổ sẽ rời cuộc gọi. Bạn có muốn tiếp tục?'))return;if(Object.keys(activeLessons).length && !window.confirm('Đóng các cửa sổ sẽ rời bài học và mất tiến độ chưa hoàn thành.'))return;setWindows([]);return;} if(!confirmExamExit('page'))return;setPagePath(path);setPageRevision(v=>v+1);open('page'); };
  const update = (id: AppId, patch: Partial<WindowState>) => setWindows(current => current.map(w => w.id === id ? { ...w, ...patch } : w));
  const focus = (id: AppId) => update(id, { z: ++zCounter.current });
  const beginDrag = (event: ReactPointerEvent<HTMLElement>, w: WindowState) => {
    if (w.maximized || (event.target as HTMLElement).closest('button') || window.innerWidth <= 700) return;
    const bounds = desktopRef.current?.getBoundingClientRect(); const windowBounds = event.currentTarget.parentElement?.getBoundingClientRect();
    const x = w.snap && bounds && windowBounds ? windowBounds.left - bounds.left : w.x;
    const y = w.snap && bounds && windowBounds ? windowBounds.top - bounds.top : w.y;
    if (w.snap) update(w.id, { snap: null, x, y });
    drag.current = { id: w.id, startX: event.clientX, startY: event.clientY, x, y };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (!drag.current || !desktopRef.current) return;
    const { id, startX, startY, x, y } = drag.current; const bounds = desktopRef.current.getBoundingClientRect();
    update(id, { x: Math.max(0, Math.min(bounds.width - 160, x + event.clientX - startX)), y: Math.max(0, Math.min(bounds.height - 90, y + event.clientY - startY)) });
  };
  const endDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (!drag.current || !desktopRef.current) return;
    const bounds = desktopRef.current.getBoundingClientRect();
    if (event.clientX - bounds.left <= 20) update(drag.current.id, { snap: 'left', maximized: false });
    else if (bounds.right - event.clientX <= 20) update(drag.current.id, { snap: 'right', maximized: false });
    drag.current = null;
  };
  const invite = async () => {
    if (!school || !inviteEmail.trim()) return;
    setBusy(true); setInviteError(''); setInviteNotice('');
    try {
      await api.post(`/api/schools/${encodeURIComponent(school.id)}/invite`, { email: inviteEmail.trim() });
      const result = await api.get<{ members: Member[] }>(`/api/schools/${encodeURIComponent(school.id)}/members`);
      setMembers({ schoolId: school.id, items: result.members }); setInviteEmail(''); setInviteOpen(false);
      setInviteNotice('Đã gửi lời mời trong Ai eo. Giáo viên cần chấp nhận lời mời.');
    } catch (e) { setInviteError(describeError(e)); } finally { setBusy(false); }
  };
  const saveBackground = (next: BackgroundSettings) => {
    setBackground(next);
    try {
      localStorage.setItem(wallpaperKey, JSON.stringify(next));
      setWallpaperError('');
    } catch {
      setWallpaperError('Không thể lưu hình nền trên trình duyệt này. Hình nền chỉ áp dụng cho đến khi tải lại trang.');
    }
  };
  const uploadBackground = async (file: File) => {
    setWallpaperError('');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setWallpaperError('Chọn ảnh JPG, PNG hoặc WebP.'); return; }
    if (file.size > 10_000_000) { setWallpaperError('Ảnh phải nhỏ hơn 10 MB.'); return; }
    setWallpaperBusy(true);
    const url = URL.createObjectURL(file);
    try {
      const image = new Image(); image.src = url;
      await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('Không thể đọc ảnh này.')); });
      if (!image.naturalWidth || !image.naturalHeight) throw new Error('Ảnh không hợp lệ.');
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 1920 / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d'); if (!context) throw new Error('Trình duyệt không hỗ trợ xử lý ảnh.');
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      let data = canvas.toDataURL('image/jpeg', .82);
      if (data.length > 1_800_000) data = canvas.toDataURL('image/jpeg', .6);
      if (data.length > 1_800_000) throw new Error('Ảnh sau khi nén vẫn quá lớn. Hãy chọn ảnh khác.');
      saveBackground({ ...background, choice: 'custom', image: data });
    } catch (e) { setWallpaperError(e instanceof Error ? e.message : 'Không thể xử lý ảnh.'); }
    finally { URL.revokeObjectURL(url); setWallpaperBusy(false); }
  };
  const visibleIcons = apps.filter(app => !['class-detail', 'class-manage', 'school-manage', 'school-invitations', 'shortcut-folder', 'page'].includes(app.id));
  const orderedIcons = [...visibleIcons].sort((a,b) => {
    const ai=iconOrder.indexOf(a.id), bi=iconOrder.indexOf(b.id);
    return (ai === -1 ? 10_000 + visibleIcons.indexOf(a) : ai) - (bi === -1 ? 10_000 + visibleIcons.indexOf(b) : bi);
  });
  const changeIconOrder = (from: AppId, to: AppId) => {
    if (from === to) return;
    const ids=orderedIcons.map(app => app.id); const start=ids.indexOf(from), end=ids.indexOf(to);
    if (start < 0 || end < 0) return;
    ids.splice(start,1); ids.splice(end,0,from); setIconOrder(ids); setContextMenu(null);
    try { localStorage.setItem(`school-desktop-order:${user.id}`, JSON.stringify(ids)); } catch { /* Current session still changes. */ }
  };
  const syncLayout = async (mode: 'save' | 'load') => {
    if (mode === 'load' && Object.keys(activeExams).length && !window.confirm('Khôi phục cấu hình sẽ đóng bài làm. Đồng hồ vẫn chạy và bài chưa lưu có thể chưa đồng bộ.')) return;
    if (mode === 'load' && Object.keys(activeLessons).length && !window.confirm('Khôi phục cấu hình sẽ rời bài học và mất tiến độ chưa hoàn thành.')) return;
    if (mode === 'load' && Object.keys(activeCalls).length && !window.confirm('Khôi phục cấu hình sẽ rời cuộc gọi. Bạn có muốn tiếp tục?')) return;
    setSyncBusy(true); setSyncMessage('');
    try {
      if (mode === 'save') {
        await api.put('/api/profile/desktop-preferences', { background, iconsVisible, iconOrder, pinned, folders, windows: windows.filter(w=>w.id!=='page' && w.id!=='shortcut-folder') });
        setSyncMessage('Đã lưu cấu hình vào tài khoản.');
      } else {
        const result=await api.get<{preferences:DesktopPreferences|null}>('/api/profile/desktop-preferences');
        if (!result.preferences) { setSyncMessage('Tài khoản chưa có cấu hình đã lưu.'); return; }
        const p=result.preferences;
        // Only currently permitted apps can be restored; server permissions remain authoritative.
        const permitted=new Set(apps.map(app=>app.id));
        const restored=p.windows.filter(w=>permitted.has(w.id) && w.id !== 'shortcut-folder' && w.id !== 'page').map(w=>({ ...w, x: Math.max(0, Math.min(w.x, (desktopRef.current?.clientWidth ?? 800) - 160)), y: Math.max(0, Math.min(w.y, (desktopRef.current?.clientHeight ?? 600) - 90)) }));
        zCounter.current=Math.max(1,...restored.map(w=>w.z));
        setWindows(restored);setIconOrder(p.iconOrder);setIconsVisible(p.iconsVisible);setPinned(p.pinned ?? []);setFolders(p.folders ?? []);saveBackground(p.background);
        try { localStorage.setItem(`school-desktop-order:${user.id}`,JSON.stringify(p.iconOrder));localStorage.setItem(`school-desktop-icons:${user.id}`,p.iconsVisible?'visible':'hidden');localStorage.setItem(`school-desktop-pinned:${user.id}`,JSON.stringify(p.pinned ?? []));localStorage.setItem(`school-desktop-folders:${user.id}`,JSON.stringify(p.folders ?? [])); } catch { /* Continue in memory. */ }
        setSyncMessage('Đã khôi phục cấu hình từ tài khoản.');
      }
    } catch (e) { setSyncMessage(describeError(e)); } finally { setSyncBusy(false); }
  };
  const storePinned = (next:AppId[]) => { setPinned(next);try{localStorage.setItem(`school-desktop-pinned:${user.id}`,JSON.stringify(next));}catch{/* Session only. */} };
  const storeFolders = (next:ShortcutFolder[]) => { setFolders(next);try{localStorage.setItem(`school-desktop-folders:${user.id}`,JSON.stringify(next));}catch{/* Session only. */} };
  const startFolderEdit = (folder?:ShortcutFolder) => { setContextMenu(null);setFolderError('');setFolderEdit(folder?.id??'new');setFolderName(folder?.name??'');setFolderApps(folder?.apps??[]); };
  const saveFolder = () => {
    const name=folderName.trim();if(!name){setFolderError('Vui lòng nhập tên thư mục.');return;}if(folderEdit==='new' && folders.length>=20){setFolderError('Tối đa 20 thư mục.');return;}
    const id=folderEdit==='new' ? `folder-${crypto.randomUUID()}` : folderEdit;if(!id)return;
    const next=folderEdit==='new'?[...folders,{id,name,apps:folderApps}]:folders.map(f=>f.id===id?{...f,name,apps:folderApps}:f);
    storeFolders(next);setFolderEdit(null);setCurrentFolder(id);open('shortcut-folder');
  };
  const groups = [...new Set(apps.map(app => app.group))];
  const groupedFolders: ShortcutFolder[] = [...new Set(orderedIcons.map(app=>app.group))].map(group=>({id:`system:${group}`,name:group,apps:orderedIcons.filter(app=>app.group===group).map(app=>app.id)}));
  const currentFolderData = [...groupedFolders,...folders].find(folder=>folder.id===currentFolder);
  const isBuiltInFolder = !!currentFolder?.startsWith('system:');
  const showDesktopMenu = (x: number, y: number, appId?: AppId) => {
    const bounds = desktopRef.current?.getBoundingClientRect(); if (!bounds) return;
    // Keep the entire menu within the desktop, above its taskbar.
    setContextMenu({ x: Math.max(4, Math.min(x - bounds.left, bounds.width - 230)), y: Math.max(4, Math.min(y - bounds.top, bounds.height - (appId ? 400 : 280))), appId });
    setStart(false); setSubmenu(null);
  };
  const applyWorkspace = (kind:'teaching'|'marking'|'management') => {
    const ids:AppId[]=kind==='teaching'?['classes','calendar']:kind==='marking'?['marking','classes']:['classes','teacher-progress'];
    if(ids.some(id=>!apps.some(a=>a.id===id)))return;
    setStart(false);setSubmenu(null);
    setWindows(current=>{let next=[...current];ids.forEach((id,index)=>{const z=++zCounter.current;const found=next.find(w=>w.id===id);const patch:WindowState={id,x:0,y:0,z,minimized:false,maximized:false,snap:index===0?'left':'right'};next=found?next.map(w=>w.id===id?{...w,...patch}:w):[...next,patch];});return next;});
  };
  const desktopContext = (event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    // Native editing/context menus remain available inside applications and form controls.
    if (target.closest('.sd-window, .sd-taskbar, .sd-start, .sd-dialog-backdrop, .sd-context-menu, .sd-brand, input, textarea, select, a')) { setContextMenu(null); return; }
    event.preventDefault();
    const appId = target.closest<HTMLElement>('[data-desktop-app]')?.dataset.desktopApp as AppId | undefined;
    showDesktopMenu(event.clientX, event.clientY, appId);
  };
  const toggleIcons = () => {
    const next = !iconsVisible; setIconsVisible(next); setContextMenu(null);
    try { localStorage.setItem(`school-desktop-icons:${user.id}`, next ? 'visible' : 'hidden'); } catch { /* The change lasts for this visit. */ }
  };
  return <div className={`school-desktop school-desktop--${background.choice}`} style={background.choice === 'custom' && background.image ? { backgroundImage: `linear-gradient(rgba(10, 30, 46, ${background.dim / 100}), rgba(10, 30, 46, ${background.dim / 100})), url("${background.image}")`, backgroundSize: `100% 100%, ${background.fit === 'center' ? 'auto' : background.fit}`, backgroundPosition: 'center', backgroundRepeat: 'no-repeat', backgroundColor: '#173f57' } : undefined} ref={desktopRef} onContextMenu={desktopContext} onPointerDown={e => { if (e.target === e.currentTarget) { setStart(false); setSubmenu(null); } }}>
    <div className="sd-brand" aria-label={school ? `Ai eo và ${school.name}` : 'Ai eo'}>
      <BrandLogo theme="light" height={24} />
      {school && <><span className="sd-brand__cross" aria-hidden="true">×</span>{logo && logo.id === school.id ? <img className="sd-brand__school-logo" src={`data:${logo.mime};base64,${logo.data_b64}`} alt={`Logo ${school.name}`} /> : <span className="sd-brand__school-placeholder" aria-label="Trường chưa có logo"><Icon name="graduation" size={19}/></span>}</>}
    </div>
    <div className="sd-wallpaper-word" aria-hidden="true">Dạy học.<br/><strong>Thật đơn giản.</strong><span>Không gian làm việc của bạn</span></div>
    {iconsVisible && <div className="sd-icons" aria-label="Thư mục ứng dụng trên desktop">{groupedFolders.map((folder,index)=><button type="button" className="sd-icon" key={folder.id} onClick={()=>{setCurrentFolder(folder.id);open('shortcut-folder');}}><span className={`sd-icon__art sd-icon__art--${['blue','green','violet','cyan','orange','red'][index%6]}`}><Icon name={folder.name==='Giảng dạy'?'book':folder.name==='Nhà trường'?'graduation':folder.name==='Hệ thống'?'shield':folder.name==='Học tập'?'layers':folder.name==='Cố vấn'?'presentation':'settings'} size={27}/></span><span>{folder.name}</span></button>)}{folders.map(folder=><button type="button" className="sd-icon" key={folder.id} onClick={()=>{setCurrentFolder(folder.id);open('shortcut-folder');}}><span className="sd-icon__art sd-icon__art--orange"><Icon name="layers" size={27}/></span><span>{folder.name}</span></button>)}</div>}
    {windows.map(w => {
      const app = apps.find(a => a.id === w.id); if (!app) return null;
      return <section key={w.id} className={`sd-window${w.maximized ? ' sd-window--max' : ''}${w.minimized ? ' sd-window--min' : ''}${w.snap ? ` sd-window--snap-${w.snap}` : ''}`} style={{ left: w.x, top: w.y, zIndex: w.z }} onPointerDown={() => focus(w.id)} aria-label={`Cửa sổ ${app.title}`}>
        <header className="sd-window__title" onPointerDown={e => beginDrag(e, w)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={() => { drag.current = null; }} onDoubleClick={() => update(w.id, { maximized: !w.maximized, snap: null })}><span><DesktopAppIcon id={app.id} fallback={app.icon} size={15} /> {app.title}</span><div><button type="button" className="sd-snap-control" title="Chia cửa sổ bên trái" aria-label={`Chia trái ${app.title}`} onClick={() => update(w.id, { maximized: false, snap: 'left' })}>◧</button><button type="button" className="sd-snap-control" title="Chia cửa sổ bên phải" aria-label={`Chia phải ${app.title}`} onClick={() => update(w.id, { maximized: false, snap: 'right' })}>◨</button><button type="button" title="Thu nhỏ" aria-label={`Thu nhỏ ${app.title}`} onClick={() => update(w.id, { minimized: true })}>−</button><button type="button" title={w.maximized ? 'Khôi phục' : 'Phóng to'} aria-label={`${w.maximized ? 'Khôi phục' : 'Phóng to'} ${app.title}`} onClick={() => update(w.id, { maximized: !w.maximized, snap: null })}>□</button><button type="button" title="Đóng" aria-label={`Đóng ${app.title}`} onClick={() => closeWindow(w.id)}>×</button></div></header>
        {!app.path && <div className="sd-native-toolbar"><button type="button" onClick={()=>setWindows(current=>current.filter(win=>win.id!==w.id))}>← Quay lại desktop</button></div>}
        {app.id === 'today' && !isMentor ? <TeacherToday apiBase={user.role==='ADMIN'?'/api/admin':'/api/teacher'} onOpen={openPage}/> : null}
        {app.id === 'school-overview' ? <SchoolOverviewWindow/> : null}
        {app.id === 'school-banner' && owner ? <SchoolBannerWindow key={school?.id} school={school}/> : null}
        {app.id === 'notifications' ? <DesktopNotifications feedState={notification} onOpen={openPage} classes={classes.data??[]}/> : null}
        {app.id === 'shortcut-folder' ? <div className="sd-window__body">{!isBuiltInFolder && <div className="sd-appbar"><button onClick={()=>startFolderEdit(folders.find(f=>f.id===currentFolder))}><Icon name="edit" size={15}/> Sửa thư mục</button><button onClick={()=>{const folder=folders.find(f=>f.id===currentFolder);if(folder&&window.confirm(`Xóa thư mục “${folder.name}”? Các ứng dụng không bị xóa.`)){storeFolders(folders.filter(f=>f.id!==folder.id));setWindows(current=>current.filter(win=>win.id!=='shortcut-folder'));setCurrentFolder(null);}}}><Icon name="trash" size={15}/> Xóa thư mục</button></div>}<div className="sd-appheading"><div><b>{currentFolderData?.name ?? 'Thư mục ứng dụng'}</b><small>{isBuiltInFolder?'Ứng dụng được nhóm theo chức năng và quyền truy cập':'Phím tắt của bạn · chỉ hiện ứng dụng được phép sử dụng'}</small></div></div><div className="sd-folder-apps">{(currentFolderData?.apps ?? []).map(id=>visibleIcons.find(a=>a.id===id)).filter((item):item is DesktopApp=>!!item).map(item=><button key={item.id} draggable onDragStart={e=>{draggedIcon.current=item.id;e.dataTransfer.setData('text/plain',item.id);}} onDragOver={e=>{if(draggedIcon.current)e.preventDefault();}} onDrop={e=>{e.preventDefault();if(draggedIcon.current)changeIconOrder(draggedIcon.current,item.id);draggedIcon.current=null;}} onDragEnd={()=>{draggedIcon.current=null;}} onContextMenu={e=>{e.preventDefault();e.stopPropagation();showDesktopMenu(e.clientX,e.clientY,item.id);}} onClick={()=>open(item.id)}><span className={`sd-icon__art sd-icon__art--${item.tone}`}><DesktopAppIcon id={item.id} fallback={item.icon} size={22}/></span>{item.title}</button>)}</div><div className="sd-status">Nhấn chuột phải vào ứng dụng để ghim vào taskbar</div></div> : null}
        {app.id === 'school-permissions' && school && owner ? <SchoolPermissionsWindow key={school.id} school={school} members={members?.schoolId === school.id ? members.items : []}/> : null}
        {app.id === 'lesson-reviews' && school ? <LessonReviewsWindow key={school.id} school={school} userId={user.id} /> : null}
        {app.id === 'subject-groups' && school && canManageGroups ? <SubjectGroupsWindow key={school.id} school={school} /> : null}
        {app.id === 'school-calendar' ? <SchoolCalendarWindow key={school?.id ?? 'no-school'} school={school} owner={canManageCalendar} /> : null}
        {app.id === 'lesson-plans' ? <LessonPlansWindow key={school?.id ?? "no-school"} school={school} schools={approved} setSchoolId={setSchoolId} /> : null}
        {app.id === 'classes' ? <div className="sd-window__body"><div className="sd-appbar"><button onClick={() => open('class-manage')}><Icon name="plus" size={15} /> Mở quản lý lớp</button><button onClick={() => void classes.reload()}><Icon name="rotate" size={15} /> Làm mới</button></div><div className="sd-appheading"><div><b>Danh sách lớp học</b><small>Chọn một lớp để mở các công cụ giảng dạy.</small></div><span>{classes.data?.length ?? 0} lớp</span></div>{classes.error ? <p className="sd-message">{classes.error}</p> : classes.loading && !classes.data ? <p className="sd-message">Đang tải lớp học…</p> : <div className="sd-table-wrap"><table><thead><tr><th>STT</th><th>Tên lớp</th><th>Học viên</th><th>Trạng thái</th><th></th></tr></thead><tbody>{classes.data?.map((c, i) => <tr key={c.id} className={selected?.id === c.id ? 'selected' : ''} onClick={() => setClassId(c.id)}><td>{i + 1}</td><td><button className="sd-row-select" onClick={() => setClassId(c.id)}>{c.name}</button></td><td>{c.studentCount ?? '—'}</td><td>{statusLabel(c.status)}</td><td><button className="sd-row-select" onClick={() => { setClassId(c.id); open('class-detail'); }}>Mở lớp ↗</button></td></tr>)}</tbody></table>{!classes.data?.length && <p className="sd-message">Chưa có lớp học. Mở quản lý lớp để tạo lớp mới.</p>}</div>}<div className="sd-status">{selected ? `Lớp đang chọn: ${selected.name}` : 'Chưa chọn lớp'}<span>{classes.data?.length ?? 0} kết quả</span></div></div> : null}
        {app.id === 'schools' ? <div className="sd-window__body sd-school-list"><div className="sd-appbar">{access.data?.isManager && <button onClick={() => openPage('/schools#register')}><Icon name="plus" size={15} /> Đăng ký trường</button>}<button onClick={() => open(owner ? 'school-manage' : 'school-invitations')}><Icon name="external" size={15} /> Trường và lời mời</button><button onClick={() => void schools.reload()}><Icon name="rotate" size={15} /> Làm mới</button></div><div className="sd-school-list__heading"><div><small>KHÔNG GIAN CỦA BẠN</small><h2>Trường & trung tâm</h2><p>Chọn trường để thay đổi không gian làm việc.</p></div><span>{approved.length} trường đang hoạt động</span></div>{schools.error ? <p className="sd-message">{schools.error}</p> : <div className="sd-school-list__rows">{schools.data?.schools.map(s => {const available=approved.some(a=>a.id===s.id);return <div className={`sd-school-row${school?.id===s.id?' is-current':''}`} key={s.id}><div className="sd-school-row__symbol"><Icon name="graduation" size={23}/></div><div className="sd-school-row__info"><strong>{s.name}</strong><small>{s.address || 'Trường học'} · {statusLabel(s.member_role)}</small></div><span className="sd-school-row__status">{statusLabel(s.status)} · {statusLabel(s.member_status)}</span>{available ? <button disabled={school?.id===s.id} onClick={()=>setSchoolId(s.id)}>{school?.id===s.id?'Đang chọn':'Chọn trường'}</button> : <button onClick={()=>open('school-invitations')}>Xem chi tiết</button>}</div>})}{!schools.loading && !schools.data?.schools.length && <p className="sd-message">Bạn chưa có trường hoặc lời mời nào.</p>}</div>}<div className="sd-status">Chỉ trường đã duyệt và thành viên đang hoạt động mới có thể chọn<span>{schools.data?.schools.length ?? 0} kết quả</span></div></div> : null}
        {app.id === 'members' ? <div className="sd-window__body"><div className="sd-appbar"><button disabled={!owner} onClick={() => { setInviteError(''); setInviteOpen(true); }}><Icon name="plus" size={15} /> Mời giáo viên</button><button onClick={() => open('school-manage')}><Icon name="settings" size={15} /> Quản lý thành viên</button></div><div className="sd-appheading"><div><b>Nhân sự giáo viên</b><small>{school?.name || 'Chưa chọn trường'}</small></div>{approved.length > 1 && <select aria-label="Chọn trường nhân sự" value={school?.id ?? ''} onChange={e => setSchoolId(e.target.value)}>{approved.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}</div>{inviteNotice && <p className="sd-notice">{inviteNotice}</p>}{!school ? <p className="sd-message">Bạn chưa thuộc trường đã được duyệt. Xem trường và lời mời để bắt đầu.</p> : !owner ? <p className="sd-message">Danh sách nhân sự chỉ dành cho người quản lý trường.</p> : !members || members.schoolId !== school.id ? <p className="sd-message">Đang tải nhân sự…</p> : members.error ? <p className="sd-message">{members.error}</p> : <div className="sd-table-wrap"><table><thead><tr><th>STT</th><th>Họ tên</th><th>Email</th><th>Vai trò</th><th>Trạng thái</th></tr></thead><tbody>{members.items.map((m, i) => <tr key={m.user_id}><td>{i + 1}</td><td>{m.display_name || '—'}</td><td>{m.email}</td><td>{statusLabel(m.role)}</td><td>{statusLabel(m.status)}</td></tr>)}</tbody></table>{!members.items.length && <p className="sd-message">Chưa có nhân sự.</p>}</div>}<div className="sd-status">Thông tin theo trường được chọn<span>{owner && members?.schoolId === school?.id ? members.items.length : 0} kết quả</span></div></div> : null}
        {app.id === 'wallpaper' ? <div className="sd-window__body sd-wallpaper-settings"><div className="sd-appheading"><div><b>Hình nền desktop</b><small>Chọn giao diện hoặc tải ảnh của riêng bạn. Cài đặt được lưu trên trình duyệt này.</small></div></div><div className="sd-wallpaper-content"><div className="sd-wallpaper-presets">{([{ id: 'sky', label: 'Bầu trời' }, { id: 'forest', label: 'Xanh rừng' }, { id: 'sunset', label: 'Hoàng hôn' }, { id: 'midnight', label: 'Đêm xanh' }, { id: 'ocean', label: 'Đại dương' }, { id: 'lavender', label: 'Oải hương' }] as const).map(preset => <button type="button" key={preset.id} className={`sd-wallpaper-choice${background.choice === preset.id ? ' active' : ''}`} aria-pressed={background.choice === preset.id} onClick={() => saveBackground({ ...background, choice: preset.id })}><span className={`sd-wallpaper-swatch sd-wallpaper-swatch--${preset.id}`} /><b>{preset.label}</b>{background.choice === preset.id && <Icon name="checkCircle" size={16} />}</button>)}</div><div className="sd-wallpaper-upload"><div><b>Ảnh của bạn</b><small>JPG, PNG hoặc WebP, tối đa 10 MB. Ảnh được nén và lưu trên thiết bị; chỉ tải lên tài khoản khi bạn chọn đồng bộ.</small></div><label className="sd-upload-button">{wallpaperBusy ? 'Đang xử lý…' : 'Chọn ảnh'}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={wallpaperBusy} onChange={e => { const file = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (file) void uploadBackground(file); }} /></label>{background.image && <><button type="button" className="sd-upload-button" onClick={() => saveBackground({ ...background, choice: 'custom' })}>Dùng ảnh đã chọn</button><button type="button" className="sd-remove-background" onClick={() => saveBackground({ ...background, choice: background.choice === 'custom' ? 'sky' : background.choice, image: null })}>Xóa ảnh</button></>}</div>{background.image && <div className="sd-wallpaper-options"><div className="sd-wallpaper-preview" style={{ backgroundImage: `url("${background.image}")` }} role="img" aria-label="Ảnh nền đã chọn"/><div><label>Cách hiển thị<select value={background.fit} onChange={e => saveBackground({ ...background, fit: e.target.value as BackgroundSettings['fit'] })}><option value="cover">Phủ kín</option><option value="contain">Vừa khung</option><option value="center">Giữa màn hình</option></select></label><label>Độ tối lớp phủ <span className="sd-wallpaper-value">{background.dim}%</span><input type="range" min="0" max="70" step="5" value={background.dim} onChange={e => saveBackground({ ...background, dim: Number(e.target.value) })}/></label></div></div>}{wallpaperError && <p className="sd-error" role="alert">{wallpaperError}</p>}<div className="sd-sync-settings"><b>Đồng bộ giữa các thiết bị</b><p>Lưu cấu hình vào tài khoản, bao gồm ảnh nền riêng, thư mục phím tắt, ứng dụng ghim và vị trí cửa sổ. Nội dung đang nhập trong cửa sổ không được lưu.</p><div><button type="button" disabled={syncBusy} onClick={() => void syncLayout('save')}>Lưu cấu hình vào tài khoản</button><button type="button" disabled={syncBusy} onClick={() => void syncLayout('load')}>Khôi phục cấu hình đã lưu</button></div>{syncMessage && <p role="status">{syncMessage}</p>}</div></div><div className="sd-status">Thay đổi cục bộ được lưu trên trình duyệt; đồng bộ vào tài khoản là tùy chọn.</div></div> : null}
        {app.path ? <div className="sd-frame"><DesktopApplication key={`${app.id}:${app.path}:${app.id==='page'?pageRevision:0}`} path={app.path} onClose={()=>closeWindow(w.id)} windowId={w.id} reportExam={reportExam} reportLesson={reportLesson} reportCall={reportCall} callActive={!!activeCalls[w.id]}/></div> : null}
      </section>;
    })}
    {folderEdit && <div className="sd-dialog-backdrop"><form className="sd-plan-dialog" role="dialog" aria-modal="true" aria-labelledby="sd-folder-title" onSubmit={e=>{e.preventDefault();saveFolder();}}><header><b id="sd-folder-title">{folderEdit==='new'?'Tạo thư mục':'Sửa thư mục'}</b><button type="button" aria-label="Đóng" onClick={()=>setFolderEdit(null)}>×</button></header><div className="sd-plan-form"><label>Tên thư mục<input required maxLength={60} value={folderName} onChange={e=>setFolderName(e.target.value)}/></label><fieldset className="sd-member-picker"><legend>Chọn phím tắt</legend>{visibleIcons.map(item=><label key={item.id}><input type="checkbox" checked={folderApps.includes(item.id)} onChange={e=>setFolderApps(e.target.checked?[...folderApps,item.id]:folderApps.filter(id=>id!==item.id))}/>{item.title}</label>)}</fieldset>{folderError && <p className="sd-error" role="alert">{folderError}</p>}</div><footer><button type="button" onClick={()=>setFolderEdit(null)}>Hủy</button><button type="submit">Lưu thư mục</button></footer></form></div>}
    {inviteOpen && school && owner && <div className="sd-dialog-backdrop" role="presentation"><form className="sd-dialog" role="dialog" aria-modal="true" aria-labelledby="sd-invite-title" onSubmit={e => { e.preventDefault(); void invite(); }}><header id="sd-invite-title">Mời giáo viên <button type="button" aria-label="Đóng" onClick={() => setInviteOpen(false)}>×</button></header><div><p>Gửi lời mời tham gia <strong>{school.name}</strong> đến tài khoản đã có trên Ai eo.</p><label>Email giáo viên hoặc mentor<input type="email" required autoFocus value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} /></label>{inviteError && <p className="sd-error" role="alert">{inviteError}</p>}<div className="sd-dialog__actions"><button type="button" onClick={() => setInviteOpen(false)}>Hủy</button><button type="submit" disabled={busy}>{busy ? 'Đang gửi…' : 'Gửi lời mời'}</button></div></div></form></div>}
    {contextMenu && <div className="sd-context-menu" ref={menuRef} role="menu" aria-label="Menu desktop" style={{ left: contextMenu.x, top: contextMenu.y }} onKeyDown={e => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
      e.preventDefault(); const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')); const index = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; items[next]?.focus();
    }}>
      {contextMenu.appId && <><button role="menuitem" onClick={() => contextMenu.appId && open(contextMenu.appId)}><Icon name="external" size={16}/> Mở ứng dụng</button><button role="menuitem" onClick={()=>{if(!contextMenu.appId)return;const id=contextMenu.appId;if(!pinned.includes(id) && pinned.length>=6){setSyncMessage('Chỉ có thể ghim tối đa 6 ứng dụng.');open('wallpaper');return;}storePinned(pinned.includes(id)?pinned.filter(p=>p!==id):[...pinned,id]);setContextMenu(null);}}><Icon name="star" size={16}/>{pinned.includes(contextMenu.appId)?'Bỏ ghim khỏi taskbar':'Ghim vào taskbar'}</button><button role="menuitem" disabled={orderedIcons.findIndex(a=>a.id===contextMenu.appId)<=0} onClick={() => { const index=orderedIcons.findIndex(a=>a.id===contextMenu.appId); if(contextMenu.appId && index>0) changeIconOrder(contextMenu.appId,orderedIcons[index-1]!.id); }}>↑ Chuyển biểu tượng lên</button><button role="menuitem" disabled={orderedIcons.findIndex(a=>a.id===contextMenu.appId)>=orderedIcons.length-1} onClick={() => { const index=orderedIcons.findIndex(a=>a.id===contextMenu.appId); if(contextMenu.appId && index>=0 && index<orderedIcons.length-1) changeIconOrder(contextMenu.appId,orderedIcons[index+1]!.id); }}>↓ Chuyển biểu tượng xuống</button><div className="sd-context-separator"/></>}
      <button role="menuitem" onClick={() => startFolderEdit()}><Icon name="plus" size={16}/> Tạo thư mục</button>
      <button role="menuitem" onClick={() => open('wallpaper')}><Icon name="settings" size={16}/> Đổi hình nền</button>
      <button role="menuitem" onClick={toggleIcons}><Icon name={iconsVisible ? 'eye' : 'grid'} size={16}/> {iconsVisible ? 'Ẩn biểu tượng desktop' : 'Hiện biểu tượng desktop'}</button>
      <button role="menuitem" onClick={() => { void schools.reload(); void classes.reload(); setLogoVersion(v => v + 1); setPermissionVersion(v=>v+1); setContextMenu(null); }}><Icon name="rotate" size={16}/> Làm mới lớp và trường</button>
      <button role="menuitem" disabled={!windows.some(w => !w.minimized)} onClick={() => { setWindows(current => current.map(w => ({ ...w, minimized: true }))); setContextMenu(null); }}><Icon name="monitor" size={16}/> Thu nhỏ tất cả cửa sổ</button>
      <div className="sd-context-separator"/><button role="menuitem" onClick={() => open('schools')}><Icon name="graduation" size={16}/> Trường học</button>
    </div>}
    {(needsSchoolChoice || schoolPickerOpen) && <div className="sd-school-picker-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="sd-pick-school-title" className="sd-school-picker" ref={schoolPickerRef} onKeyDown={e=>{if(e.key!=='Tab')return;const buttons=Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));if(!buttons.length)return;const first=buttons[0],last=buttons[buttons.length-1];if(e.shiftKey && document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey && document.activeElement===last){e.preventDefault();first?.focus();}}}><header><span className="sd-school-picker__icon"><Icon name="graduation" size={24}/></span><div><small>KHÔNG GIAN LÀM VIỆC</small><h2 id="sd-pick-school-title">{needsSchoolChoice ? 'Chọn trường để bắt đầu' : 'Chuyển trường'}</h2><p>Trường được chọn sẽ được ghi nhớ trên trình duyệt này.</p></div>{!needsSchoolChoice && <button type="button" aria-label="Đóng chọn trường" className="sd-school-picker__close" onClick={()=>setSchoolPickerOpen(false)}>×</button>}</header><div className="sd-school-picker__list">{approved.map(item=><button key={item.id} type="button" className={`sd-school-picker__item${school?.id===item.id?' is-current':''}`} onClick={()=>changeSchool(item.id)}><span className="sd-school-picker__school-icon"><Icon name="graduation" size={20}/></span><span><strong>{item.name}</strong><small>{statusLabel(item.member_role)}{item.address ? ` · ${item.address}` : ''}</small></span>{school?.id===item.id ? <span className="sd-school-picker__current">Đang chọn</span> : <Icon name="chevronRight" size={17}/>}</button>)}</div><footer>{needsSchoolChoice ? 'Chỉ hiển thị trường đã duyệt mà bạn đang tham gia.' : 'Bạn có thể đổi lại bất kỳ lúc nào trong Start.'}</footer></section></div>}
    {start && <div className="sd-start"><div className="sd-start__user"><span><UserAvatar key={user.avatarUrl ?? 'none'} src={user.avatarUrl} userId={user.id} name={user.displayName || user.email} size={42}/></span><div><b>{user.displayName || user.email}</b><small>{user.role === 'ADMIN' ? 'Quản trị viên' : user.role === 'MENTOR' ? 'Cố vấn' : 'Giáo viên'}</small></div></div>{approved.length > 1 && <button type="button" className="sd-start__school" onClick={()=>{setStart(false);setSubmenu(null);setSchoolPickerOpen(true);}}><span><Icon name="graduation" size={17}/><span><small>TRƯỜNG ĐANG CHỌN</small><b>{school?.name ?? 'Chưa chọn trường'}</b></span></span><span>Chuyển trường <Icon name="chevronRight" size={14}/></span></button>}<DesktopSearch apps={visibleIcons} classes={classes.data??[]} teacher={!isMentor} onApp={id=>{const app=visibleIcons.find(a=>a.id===id);if(app)open(app.id);}} onPath={openPage}/>{!isMentor&&<div className="sd-workspaces"><small>BỐ CỤC NHANH</small><div><button onClick={()=>applyWorkspace('teaching')}>Dạy học</button><button onClick={()=>applyWorkspace('marking')}>Chấm bài</button><button onClick={()=>applyWorkspace('management')}>Quản lý</button></div></div>}<div className="sd-start__content"><div className="sd-start__groups"><small>ỨNG DỤNG</small>{groups.map(group => <button key={group} type="button" className={submenu === group ? 'active' : ''} onMouseEnter={() => setSubmenu(group)} onFocus={() => setSubmenu(group)} onClick={() => setSubmenu(group)}><Icon name={group === 'Giảng dạy' ? 'book' : group === 'Nhà trường' ? 'graduation' : group === 'Hệ thống' ? 'settings' : 'grid'} size={17}/><span>{group}</span><Icon name="chevronRight" size={14}/></button>)}<div className="sd-start__divider"/><button onClick={()=>{if(Object.keys(activeExams).length && !window.confirm('Đăng xuất sẽ đóng bài làm. Đồng hồ vẫn chạy và bài chưa lưu có thể chưa đồng bộ.'))return;if(Object.keys(activeCalls).length && !window.confirm('Đăng xuất sẽ rời cuộc gọi. Bạn có muốn tiếp tục?'))return;if(Object.keys(activeLessons).length && !window.confirm('Đăng xuất sẽ rời bài học và mất tiến độ chưa hoàn thành.'))return;void logout().catch(()=>{}).finally(()=>navigate('/login'));}}><Icon name="logout" size={17}/> Đăng xuất</button></div>{submenu && <div className="sd-submenu"><small>{submenu.toLocaleUpperCase()}</small>{visibleIcons.filter(a => a.group === submenu).map(app => <button key={app.id} onClick={() => open(app.id)}><DesktopAppIcon id={app.id} fallback={app.icon} size={17}/>{app.title}</button>)}</div>}</div><div className="sd-start__footer">Ai eo · School Desktop <button onClick={() => { setStart(false); setSubmenu(null); }}>Đóng</button></div></div>}
    <footer className="sd-taskbar"><button type="button" className={`sd-start-button${start ? ' active' : ''}`} aria-expanded={start} onClick={() => { setStart(!start); setSubmenu(null); }}><span className="sd-start-logo"><Icon name="grid" size={17}/></span> Start</button><div className="sd-taskbar__divider"/><div className="sd-pinned">{pinned.map(id=>visibleIcons.find(a=>a.id===id)).filter((item):item is DesktopApp=>!!item).map(item=><button key={item.id} title={`Mở ${item.title}`} aria-label={`Mở ${item.title} từ taskbar`} onClick={()=>open(item.id)}><DesktopAppIcon id={item.id} fallback={item.icon} size={16}/></button>)}</div><div className="sd-tasks">{windows.map(w => { const app = apps.find(a => a.id === w.id); if (!app) return null; return <button key={w.id} className={!w.minimized ? 'active' : ''} title={app.title} onClick={() => w.minimized || w.z < Math.max(...windows.filter(win => !win.minimized).map(win => win.z)) ? open(w.id) : update(w.id, { minimized: true })}><DesktopAppIcon id={app.id} fallback={app.icon} size={15}/><span>{app.title}</span></button>; })}</div><div className="sd-taskbar__right"><button className="sd-menu-button" aria-label="Tùy chọn desktop" aria-haspopup="menu" aria-expanded={!!contextMenu} onClick={e => { if (contextMenu) setContextMenu(null); else { const box = e.currentTarget.getBoundingClientRect(); showDesktopMenu(box.left, box.top - 230); } }}><Icon name="more" size={17}/></button><button className="sd-focus-toggle" aria-pressed={focusMode} title="Chế độ tập trung: ẩn huy hiệu, không xóa thông báo" onClick={()=>setFocusMode(v=>!v)}>{focusMode?'Đang tập trung':'Tập trung'}</button><button className="sd-notification-trigger" aria-label={`Thông báo${notification.feed?.unread ? `, ${notification.feed.unread} chưa đọc` : ''}`} onClick={()=>open('notifications')}><Icon name="bell" size={17}/>{!focusMode && !!notification.feed?.unread && <b>{notification.feed.unread > 9 ? '9+' : notification.feed.unread}</b>}</button><button className="sd-exit" title="Đăng xuất" aria-label="Đăng xuất" onClick={()=>{if(Object.keys(activeExams).length && !window.confirm('Đăng xuất sẽ đóng bài làm. Đồng hồ vẫn chạy và bài chưa lưu có thể chưa đồng bộ.'))return;if(Object.keys(activeCalls).length && !window.confirm('Đăng xuất sẽ rời cuộc gọi. Bạn có muốn tiếp tục?'))return;if(Object.keys(activeLessons).length && !window.confirm('Đăng xuất sẽ rời bài học và mất tiến độ chưa hoàn thành.'))return;void logout().catch(()=>{}).finally(()=>navigate('/login'));}}><Icon name="logout" size={16}/><span>Đăng xuất</span></button><span className="sd-online" title="Không gian làm việc">●</span><span>{clock.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}<small>{clock.toLocaleDateString('vi-VN')}</small></span></div></footer>
  </div>;
}
