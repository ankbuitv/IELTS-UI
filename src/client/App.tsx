import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { AppShell } from './components/AppShell';
import { Loading, Notice } from './components/ui';
import { useAuth } from './context/AuthContext';
import { JoinPage, LandingPage, LoginPage, NotFoundPage, RegisterPage } from './pages/auth/PublicPages';
import { MagicLinkPage, ResetPasswordPage } from './pages/auth/EmailLinks';
import {
  AttemptHistoryPage,
  AttemptResultPage,
  PracticePage,
  ProfilePage,
  StudentAnalyticsPage,
  StudentClassroomsPage,
} from './pages/student/StudentPages';
import { StudentDashboardPage } from './pages/student/Dashboard';
import { VocabularyPage } from './pages/student/VocabularyPage';
import { TutorPage } from './pages/student/TutorPage';
import { LearnPage } from './pages/student/LearnPage';
import { PlanPage } from './pages/student/PlanPage';
import { ShopPage } from './pages/student/ShopPage';
import { LeaderboardPage } from './pages/student/LeaderboardPage';
import { EverydayLessonsPage } from './pages/student/EverydayLessonsPage';
import { FriendPage, PublicPlayerProfilePage } from './pages/student/SocialPages';
import { LessonPage, ReviewPage } from './pages/student/LessonPages';
import { DictionaryPage } from './pages/student/DictionaryPage';
import { SpeakingPage } from './pages/student/SpeakingPage';
import { TakeExamPage } from './pages/exam/TakeExam';
import { AttemptReviewPage } from './pages/exam/ReviewExam';
import { TeacherHomePage, ClassroomPage, AssignmentPage, StudentDetailPage } from './pages/teacher/TeacherPages';
import { AdminWritingQueuePage, TeacherWritingQueuePage } from './pages/staff/WritingQueue';
import { AdminLayout } from './pages/admin/AdminLayout';
import { AdminDashboardPage } from './pages/admin/AdminDashboard';
import { AdminTestsPage } from './pages/admin/AdminTests';
import { AdminTestEditorPage } from './pages/admin/AdminTestEditor';
import { AdminImportsPage } from './pages/admin/AdminImports';
import { AdminScoringProfilesPage } from './pages/admin/AdminScoringProfiles';
import { AdminUsersPage } from './pages/admin/AdminUsers';
import { AdminAttemptsPage } from './pages/admin/AdminAttempts';
import { AdminSettingsPage } from './pages/admin/AdminSettings';
import { AdminLearnPage } from './pages/admin/AdminLearn';
import { MentorDirectoryPage } from './pages/mentor/MentorDirectoryPage';
import { MentorProfilePage } from './pages/mentor/MentorProfilePage';
import { MySessionsPage } from './pages/mentor/MySessionsPage';
import { MentorConsolePage } from './pages/mentor/MentorConsolePage';
import { ClassesPage } from './pages/mentor/ClassesPage';
import { TrainingPage } from './pages/staff/TrainingPage';
import { CalendarPage } from './pages/student/CalendarPage';
import { ClassDetailPage } from './pages/mentor/ClassDetailPage';
import { CallRoomPage } from './pages/mentor/CallRoomPage';
import { EarningsPage } from './pages/mentor/EarningsPage';
import { NotificationsPage } from './components/NotificationBell';
import { CertificatePage } from './pages/student/CertificatePage';

function RequireAuth({ children, roles }: { children: ReactNode; roles?: Array<'STUDENT' | 'TEACHER' | 'ADMIN' | 'MENTOR'> }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <Loading label="Checking your session…" />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  if (roles && !roles.includes(user.role)) {
    return (
      <Notice tone="danger" title="Not authorized">
        Your role ({user.role.toLowerCase()}) does not have access to this page.
      </Notice>
    );
  }
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      {/* Full-screen exam experience: deliberately outside the app chrome. */}
      <Route
        path="/exam/:attemptId/review"
        element={
          <RequireAuth>
            <AttemptReviewPage />
          </RequireAuth>
        }
      />
      <Route
        path="/exam/:attemptId"
        element={
          <RequireAuth>
            <TakeExamPage />
          </RequireAuth>
        }
      />

      {/* Lessons are played full screen too, like Duolingo: no navigation to wander off to. */}
      <Route
        path="/learn/lesson/:lessonId"
        element={
          <RequireAuth>
            <LessonPage />
          </RequireAuth>
        }
      />
      <Route
        path="/learn/review"
        element={
          <RequireAuth>
            <ReviewPage />
          </RequireAuth>
        }
      />

      {/* The call room is a full-screen experience, like the exam and the lesson player. */}
      <Route
        path="/sessions/:sessionId/room"
        element={
          <RequireAuth>
            <CallRoomPage />
          </RequireAuth>
        }
      />

      <Route element={<AppShell />}>
        <Route index element={<LandingPage />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="auth/magic" element={<MagicLinkPage />} />
        <Route path="reset-password" element={<ResetPasswordPage />} />
        <Route path="register" element={<RegisterPage />} />
        <Route path="join" element={<JoinPage />} />

        <Route
          path="dashboard"
          element={
            <RequireAuth>
              <StudentDashboardPage />
            </RequireAuth>
          }
        />
        <Route
          path="practice"
          element={
            <RequireAuth>
              <PracticePage />
            </RequireAuth>
          }
        />
        <Route
          path="certificate/:attemptId"
          element={
            <RequireAuth>
              <CertificatePage />
            </RequireAuth>
          }
        />
        <Route
          path="notifications"
          element={
            <RequireAuth>
              <NotificationsPage />
            </RequireAuth>
          }
        />
        <Route
          path="history"
          element={
            <RequireAuth>
              <AttemptHistoryPage />
            </RequireAuth>
          }
        />
        <Route
          path="attempts/:attemptId"
          element={
            <RequireAuth>
              <AttemptResultPage />
            </RequireAuth>
          }
        />
        <Route
          path="analytics"
          element={
            <RequireAuth>
              <StudentAnalyticsPage />
            </RequireAuth>
          }
        />
        <Route
          path="classrooms"
          element={
            <RequireAuth>
              <StudentClassroomsPage />
            </RequireAuth>
          }
        />
        <Route
          path="speaking"
          element={
            <RequireAuth>
              <SpeakingPage />
            </RequireAuth>
          }
        />
        <Route
          path="speaking/:sessionId"
          element={
            <RequireAuth>
              <SpeakingPage />
            </RequireAuth>
          }
        />
        <Route
          path="learn"
          element={
            <RequireAuth>
              <LearnPage />
            </RequireAuth>
          }
        />
        <Route
          path="learn/plan"
          element={
            <RequireAuth>
              <PlanPage />
            </RequireAuth>
          }
        />
        <Route
          path="learn/shop"
          element={
            <RequireAuth>
              <ShopPage />
            </RequireAuth>
          }
        />
        <Route
          path="learn/leaderboard"
          element={
            <RequireAuth>
              <LeaderboardPage />
            </RequireAuth>
          }
        />
        <Route
          path="learn/everyday"
          element={
            <RequireAuth roles={['STUDENT', 'ADMIN']}>
              <EverydayLessonsPage />
            </RequireAuth>
          }
        />
        <Route
          path="learn/friends"
          element={
            <RequireAuth roles={['STUDENT', 'ADMIN']}>
              <FriendPage />
            </RequireAuth>
          }
        />
        <Route
          path="learn/profile"
          element={
            <RequireAuth roles={['STUDENT', 'ADMIN']}>
              <PublicPlayerProfilePage />
            </RequireAuth>
          }
        />
        <Route
          path="learn/profile/:userId"
          element={
            <RequireAuth roles={['STUDENT', 'ADMIN']}>
              <PublicPlayerProfilePage />
            </RequireAuth>
          }
        />
        <Route
          path="vocabulary"
          element={
            <RequireAuth>
              <VocabularyPage />
            </RequireAuth>
          }
        />
        <Route
          path="dictionary"
          element={
            <RequireAuth>
              <DictionaryPage />
            </RequireAuth>
          }
        />
        <Route
          path="tutor"
          element={
            <RequireAuth>
              <TutorPage />
            </RequireAuth>
          }
        />
        <Route
          path="calendar"
          element={
            <RequireAuth>
              <CalendarPage />
            </RequireAuth>
          }
        />
        <Route
          path="training"
          element={
            <RequireAuth roles={['MENTOR', 'TEACHER', 'ADMIN']}>
              <TrainingPage />
            </RequireAuth>
          }
        />
        <Route
          path="profile"
          element={
            <RequireAuth>
              <ProfilePage />
            </RequireAuth>
          }
        />

        {/* Mentor platform: directory, booking, live classes and the mentor console. */}
        <Route
          path="mentors"
          element={
            <RequireAuth>
              <MentorDirectoryPage />
            </RequireAuth>
          }
        />
        <Route
          path="mentors/:mentorId"
          element={
            <RequireAuth>
              <MentorProfilePage />
            </RequireAuth>
          }
        />
        <Route
          path="my-sessions"
          element={
            <RequireAuth>
              <MySessionsPage />
            </RequireAuth>
          }
        />
        <Route
          path="classes/:classId"
          element={
            <RequireAuth>
              <ClassDetailPage />
            </RequireAuth>
          }
        />
        <Route
          path="classes"
          element={
            <RequireAuth>
              <ClassesPage />
            </RequireAuth>
          }
        />
        <Route
          path="mentor"
          element={
            <RequireAuth roles={['MENTOR', 'ADMIN']}>
              <MentorConsolePage />
            </RequireAuth>
          }
        />
        <Route
          path="mentor/earnings"
          element={
            <RequireAuth roles={['MENTOR', 'ADMIN']}>
              <EarningsPage />
            </RequireAuth>
          }
        />

        {/* Teacher */}
        <Route
          path="teacher"
          element={
            <RequireAuth roles={['TEACHER', 'ADMIN']}>
              <TeacherHomePage />
            </RequireAuth>
          }
        />
        <Route
          path="teacher/marking"
          element={
            <RequireAuth roles={['TEACHER', 'ADMIN']}>
              <TeacherWritingQueuePage />
            </RequireAuth>
          }
        />
        <Route
          path="teacher/classrooms/:classroomId"
          element={
            <RequireAuth roles={['TEACHER', 'ADMIN']}>
              <ClassroomPage />
            </RequireAuth>
          }
        />
        <Route
          path="teacher/assignments/:assignmentId"
          element={
            <RequireAuth roles={['TEACHER', 'ADMIN']}>
              <AssignmentPage />
            </RequireAuth>
          }
        />
        <Route
          path="teacher/students/:userId"
          element={
            <RequireAuth roles={['TEACHER', 'ADMIN']}>
              <StudentDetailPage />
            </RequireAuth>
          }
        />

        {/* Admin */}
        <Route
          path="admin"
          element={
            <RequireAuth roles={['ADMIN']}>
              <AdminLayout />
            </RequireAuth>
          }
        >
          <Route index element={<AdminDashboardPage />} />
          <Route path="tests" element={<AdminTestsPage />} />
          <Route path="tests/:testId" element={<AdminTestEditorPage />} />
          <Route path="imports" element={<AdminImportsPage />} />
          <Route path="scoring-profiles" element={<AdminScoringProfilesPage />} />
          <Route path="users" element={<AdminUsersPage />} />
          <Route path="attempts" element={<AdminAttemptsPage />} />
          <Route path="writing" element={<AdminWritingQueuePage />} />
          <Route path="learn" element={<AdminLearnPage />} />
          <Route path="settings" element={<AdminSettingsPage />} />
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
