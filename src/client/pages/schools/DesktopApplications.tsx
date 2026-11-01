import { useEffect, useRef, useState, type ReactNode, type ContextType } from 'react';
import { MemoryRouter, Navigate, Route, Routes, UNSAFE_LocationContext, UNSAFE_RouteContext, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Notice } from '../../components/ui';
import { JoinPage } from '../auth/PublicPages';
import { DesktopTeacherClasses } from './DesktopTeacherClasses';
import { SchoolsPage, AdminSchoolsPage } from './SchoolsPage';
import { ClassroomPage, AssignmentPage, StudentDetailPage } from '../teacher/TeacherPages';
import { AdminWritingQueuePage, TeacherWritingQueuePage } from '../staff/WritingQueue';
import { AdminLayout } from '../admin/AdminLayout';
import { AdminDashboardPage } from '../admin/AdminDashboard';
import { AdminTestsPage } from '../admin/AdminTests';
import { AdminTestEditorPage } from '../admin/AdminTestEditor';
import { AdminImportsPage } from '../admin/AdminImports';
import { AdminScoringProfilesPage } from '../admin/AdminScoringProfiles';
import { AdminUsersPage } from '../admin/AdminUsers';
import { AdminAttemptsPage } from '../admin/AdminAttempts';
import { AdminSettingsPage } from '../admin/AdminSettings';
import { AdminLearnPage } from '../admin/AdminLearn';
import { ClassesPage } from '../mentor/ClassesPage';
import { ClassDetailPage } from '../mentor/ClassDetailPage';
import { MySessionsPage } from '../mentor/MySessionsPage';
import { MentorConsolePage } from '../mentor/MentorConsolePage';
import { EarningsPage } from '../mentor/EarningsPage';
import { MentorDirectoryPage } from '../mentor/MentorDirectoryPage';
import { MentorProfilePage } from '../mentor/MentorProfilePage';
import { CalendarPage } from '../student/CalendarPage';
import { ProfilePage, PracticePage, AttemptHistoryPage, AttemptResultPage, StudentAnalyticsPage, StudentClassroomsPage } from '../student/StudentPages';
import { StudentClassroomPage } from '../student/StudentClassroom';
import { LearnPage } from '../student/LearnPage';
import { PlanPage } from '../student/PlanPage';
import { ShopPage } from '../student/ShopPage';
import { LeaderboardPage } from '../student/LeaderboardPage';
import { EverydayLessonsPage } from '../student/EverydayLessonsPage';
import { FriendPage, PublicPlayerProfilePage } from '../student/SocialPages';
import { VocabularyPage } from '../student/VocabularyPage';
import { DictionaryPage } from '../student/DictionaryPage';
import { SpeakingPage } from '../student/SpeakingPage';
import { DrillsPage } from '../student/DrillsPage';
import { StudyRoomPage } from '../student/StudyRoomPage';
import { CertificatePage } from '../student/CertificatePage';
import { TakeExamPage } from '../exam/TakeExam';
import { AttemptReviewPage } from '../exam/ReviewExam';
import { ExamEmbeddedContext } from '../../components/exam/ExamEmbeddedContext';

function RolePage({roles,children}:{roles:string[];children:ReactNode}) {
  const {user}=useAuth();
  return user && roles.includes(user.role) ? <>{children}</> : <Notice tone="danger">Bạn không có quyền sử dụng chức năng này.</Notice>;
}
function FullScreenRoute({onOpen}:{onOpen:(path:string)=>void}) {
  const location=useLocation();
  useEffect(()=>{onOpen(location.pathname+location.search+location.hash);},[location,onOpen]);
  return <p className="sd-message">Đang mở trải nghiệm toàn màn hình. Nếu bạn hủy, hãy dùng nút Quay lại.</p>;
}
function ReturnToDesktop({onClose}:{onClose:()=>void}) {
  useEffect(()=>{onClose();},[onClose]);
  return null;
}
function WritingQueueForRole() { const {user}=useAuth(); return user?.role==='ADMIN' ? <AdminWritingQueuePage/> : <TeacherWritingQueuePage/>; }
function WindowNavigation({onClose,windowId,reportExam}:{onClose:()=>void;windowId:string;reportExam:(id:string,active:boolean)=>void}) {
  const navigate=useNavigate();const location=useLocation();const action=useNavigationType();
  const last=useRef(location.key);const depth=useRef(0);const [canGoBack,setCanGoBack]=useState(false);
  useEffect(()=>{reportExam(windowId,/^\/exam\/[^/]+$/.test(location.pathname));return()=>reportExam(windowId,false);},[location.pathname,windowId,reportExam]);
  useEffect(()=>{
    if(last.current===location.key)return;
    last.current=location.key;
    if(action==='PUSH')depth.current+=1;else if(action==='POP')depth.current=Math.max(0,depth.current-1);
    setCanGoBack(depth.current>0);
  },[location.key,action]);
  return <div className="sd-native-toolbar"><button type="button" onClick={()=>{if(canGoBack && /^\/exam\/[^/]+$/.test(location.pathname) && !window.confirm('Rời bài làm? Đồng hồ vẫn chạy. Hãy dùng nút thoát trong bài để lưu bài an toàn.'))return;if(canGoBack)navigate(-1);else onClose();}}>← Quay lại</button><span>{location.pathname}</span></div>;
}

/** Each application gets its own in-memory navigation history, without an iframe or a second site shell. */
export function DesktopApplication({path,onClose,onOpenFullScreen,windowId,reportExam}:{path:string;onClose:()=>void;onOpenFullScreen:(path:string)=>void;windowId:string;reportExam:(id:string,active:boolean)=>void}) {
  return <UNSAFE_LocationContext.Provider value={null as unknown as ContextType<typeof UNSAFE_LocationContext>}><UNSAFE_RouteContext.Provider value={{outlet:null,matches:[],isDataRoute:false}}><MemoryRouter initialEntries={[path]}><WindowNavigation onClose={onClose} windowId={windowId} reportExam={reportExam}/><DesktopRoutes onClose={onClose} onOpenFullScreen={onOpenFullScreen}/></MemoryRouter></UNSAFE_RouteContext.Provider></UNSAFE_LocationContext.Provider>;
}
function DesktopRoutes({onClose,onOpenFullScreen}:{onClose:()=>void;onOpenFullScreen:(path:string)=>void}) {
  const location=useLocation();const exam=/^\/exam\/[^/]+(?:\/review)?$/.test(location.pathname);const examRoot=useRef<HTMLDivElement>(null);
  return <div ref={examRoot} className={`sd-native-content${exam?' sd-native-content--exam':''}`}><Routes>
    <Route path="/" element={<ReturnToDesktop onClose={onClose}/>}/><Route path="/dashboard" element={<ReturnToDesktop onClose={onClose}/>}/><Route path="/school-desktop" element={<ReturnToDesktop onClose={onClose}/>}/>
    <Route path="/join" element={<JoinPage/>}/><Route path="/schools" element={<SchoolsPage/>}/>
    <Route path="/teacher" element={<RolePage roles={['TEACHER','ADMIN']}><DesktopTeacherClasses/></RolePage>}/>
    <Route path="/teacher/classrooms/:classroomId" element={<RolePage roles={['TEACHER','ADMIN']}><ClassroomPage/></RolePage>}/>
    <Route path="/teacher/marking" element={<RolePage roles={['TEACHER','ADMIN']}><WritingQueueForRole/></RolePage>}/>
    <Route path="/teacher/assignments/:assignmentId" element={<RolePage roles={['TEACHER','ADMIN']}><AssignmentPage/></RolePage>}/>
    <Route path="/teacher/students/:userId" element={<RolePage roles={['TEACHER','ADMIN']}><StudentDetailPage/></RolePage>}/>
    <Route path="/admin" element={<RolePage roles={['ADMIN']}><AdminLayout/></RolePage>}>
      <Route index element={<AdminDashboardPage/>}/><Route path="tests" element={<AdminTestsPage/>}/><Route path="tests/:testId" element={<AdminTestEditorPage/>}/><Route path="imports" element={<AdminImportsPage/>}/><Route path="scoring-profiles" element={<AdminScoringProfilesPage/>}/><Route path="users" element={<AdminUsersPage/>}/><Route path="attempts" element={<AdminAttemptsPage/>}/><Route path="writing" element={<AdminWritingQueuePage/>}/><Route path="learn" element={<AdminLearnPage/>}/><Route path="billing" element={<Navigate to="/admin" replace/>}/><Route path="settings" element={<AdminSettingsPage/>}/><Route path="schools" element={<AdminSchoolsPage/>}/>
    </Route>
    <Route path="/classes" element={<ClassesPage/>}/><Route path="/classes/:classId" element={<ClassDetailPage/>}/>
    <Route path="/mentor" element={<RolePage roles={['MENTOR','ADMIN']}><MentorConsolePage/></RolePage>}/><Route path="/mentor/earnings" element={<RolePage roles={['MENTOR','ADMIN']}><EarningsPage/></RolePage>}/>
    <Route path="/mentors" element={<MentorDirectoryPage/>}/><Route path="/mentors/:mentorId" element={<MentorProfilePage/>}/><Route path="/my-sessions" element={<MySessionsPage/>}/>
    <Route path="/calendar" element={<CalendarPage/>}/><Route path="/profile" element={<ProfilePage/>}/><Route path="/practice" element={<PracticePage/>}/><Route path="/history" element={<AttemptHistoryPage/>}/><Route path="/attempts/:attemptId" element={<AttemptResultPage/>}/><Route path="/analytics" element={<StudentAnalyticsPage/>}/><Route path="/classrooms" element={<StudentClassroomsPage/>}/><Route path="/classrooms/:classroomId" element={<StudentClassroomPage/>}/><Route path="/certificate/:attemptId" element={<CertificatePage/>}/>
    <Route path="/learn" element={<LearnPage/>}/><Route path="/learn/plan" element={<PlanPage/>}/><Route path="/learn/shop" element={<ShopPage/>}/><Route path="/learn/leaderboard" element={<LeaderboardPage/>}/><Route path="/learn/everyday" element={<EverydayLessonsPage/>}/><Route path="/learn/friends" element={<FriendPage/>}/><Route path="/learn/profile" element={<PublicPlayerProfilePage/>}/><Route path="/learn/profile/:userId" element={<PublicPlayerProfilePage/>}/>
    <Route path="/vocabulary" element={<VocabularyPage/>}/><Route path="/dictionary" element={<DictionaryPage/>}/><Route path="/speaking" element={<SpeakingPage/>}/><Route path="/speaking/:sessionId" element={<SpeakingPage/>}/><Route path="/drills" element={<DrillsPage/>}/><Route path="/study-room" element={<StudyRoomPage/>}/>
    <Route path="/sessions/:sessionId/room" element={<FullScreenRoute onOpen={onOpenFullScreen}/>}/><Route path="/exam/:attemptId" element={<ExamEmbeddedContext.Provider value={examRoot}><TakeExamPage/></ExamEmbeddedContext.Provider>}/><Route path="/exam/:attemptId/review" element={<ExamEmbeddedContext.Provider value={examRoot}><AttemptReviewPage/></ExamEmbeddedContext.Provider>}/><Route path="/learn/lesson/:lessonId" element={<FullScreenRoute onOpen={onOpenFullScreen}/>}/><Route path="/learn/review" element={<FullScreenRoute onOpen={onOpenFullScreen}/>}/>
    <Route path="*" element={<Notice>Không tìm thấy trang trong ứng dụng này. Hãy quay lại desktop.</Notice>}/>
  </Routes></div>;
}
