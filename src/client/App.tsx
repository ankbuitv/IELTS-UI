import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { AppShell } from './components/AppShell';
import { Loading, Notice } from './components/ui';
import { useAuth } from './context/AuthContext';
import { JoinPage, LandingPage, LoginPage, NotFoundPage, RegisterPage } from './pages/auth/PublicPages';
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
import { TakeExamPage } from './pages/exam/TakeExam';
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

function RequireAuth({ children, roles }: { children: ReactNode; roles?: Array<'STUDENT' | 'TEACHER' | 'ADMIN'> }) {
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
        path="/exam/:attemptId"
        element={
          <RequireAuth>
            <TakeExamPage />
          </RequireAuth>
        }
      />

      <Route element={<AppShell />}>
        <Route index element={<LandingPage />} />
        <Route path="login" element={<LoginPage />} />
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
          path="vocabulary"
          element={
            <RequireAuth>
              <VocabularyPage />
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
          <Route path="settings" element={<AdminSettingsPage />} />
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
