/**
 * File: app.tsx
 * Description: Application routing and the signed-in app shell.
 * Author: TTG Full-Stack Web Boilerplate
 * Modified by: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Date: 2026-10-30
 */
/* eslint-disable import/max-dependencies */
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { BrowserRouter as Router, Navigate, Route, Routes } from 'react-router-dom';

import Unauthorized from '@/components/common/unauthorized';
import Navbar from '@/components/navbar/navbar';
import { ProtectedRoute } from '@/components/protected-route';
import { TourProvider } from '@/components/tour/tour-context';
import { useAuth } from '@/contexts/auth-context';
import { useEditorAccess } from '@/contexts/editor-access-context';
import { useGuest } from '@/contexts/guest-context';
import HomePage from '@/pages/private/home/home';
import Learning from '@/pages/private/learning/learning';
import Profile from '@/pages/private/profile/profile';
import Quizzes from '@/pages/private/quizzes/quizzes';
import AssignmentEntry from '@/pages/public/assignment-entry';
import Login from '@/pages/public/login';
import { getNavbarData } from '@/utils/get-navbar-data';

/**
 * Route-level code splitting (§2.6.7, §1.1.1).
 *
 * The build was one bundle over 500 kB, so every learner downloaded the whole
 * authoring suite — the course editor, the quiz builder, the admin dashboard —
 * to read a section they will never edit. These are split out and fetched only
 * when their route is actually visited.
 *
 * The shell, the dashboard and the Learning grid stay eagerly imported: they
 * are the first paint for a signed-in learner, and lazily loading them would
 * trade a smaller bundle for a slower start on the page everyone opens.
 */
const AdminLearning = lazy(() => import('@/pages/private/admin/admin-learning'));
const AdminQuizzes = lazy(() => import('@/pages/private/admin/admin-quizzes'));
const CourseEditor = lazy(() => import('@/pages/private/admin/course-editor'));
const CourseEditorList = lazy(() => import('@/pages/private/admin/course-editor-list'));
const AdminPage = lazy(() => import('@/pages/private/admin-page/admin-page'));
const UsersList = lazy(() => import('@/pages/private/users/users-list'));
const TablePage = lazy(() => import('@/pages/private/table/table-page'));
const CoursePlayer = lazy(() => import('@/pages/private/learning/course-player'));
const CourseLanding = lazy(() => import('@/pages/private/learning/course-landing'));
const QuizPlayer = lazy(() => import('@/pages/private/quizzes/quiz-player'));
const QuizLanding = lazy(() => import('@/pages/private/quizzes/quiz-landing'));
const StandaloneQuiz = lazy(() => import('@/pages/private/quizzes/standalone-quiz'));
const ContactUs = lazy(() => import('@/pages/private/contact-us/contact-us'));
const About = lazy(() => import('@/pages/public/about'));
const PublicPage = lazy(() => import('@/pages/public/public-page/public-page'));

/**
 * Shown while a split route's chunk is fetched.
 *
 * Deliberately plain text rather than a spinner: on a warm cache the chunk
 * arrives in a few milliseconds, and a spinner that flashes and vanishes reads
 * as a glitch rather than as progress.
 */
const RouteFallback = () => (
  <div className="page-container flex flex-col">
    <p className="text-center text-dark-gray">Loading...</p>
  </div>
);

/**
 * The app shell: works out which tabs this person gets (guests see learner tabs only), and lays out
 * the sidebar, theme and routes.
 */
function App() {
  const { authenticated, loading, isAdmin, isAuthor } = useAuth();
  const { isGuest } = useGuest();
  const { isCourseContributor } = useEditorAccess();
  // Guests get the learner tabs only — no admin, no authoring.
  const showShell = authenticated || isGuest;
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') ?? 'light');
  /** Opens or closes the sidebar. */
  const toggleSidebar = () => setSidebarOpen((prev) => !prev);
  /** Sets the sidebar outright — the walkthrough opens it for the steps about the menu. */
  const setSidebar = useCallback((open: boolean) => setSidebarOpen(open), []);
  /** Switches between light and dark themes. */
  const toggleTheme = () => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  const { pages } = useMemo(
    () =>
      getNavbarData(
        isGuest ? false : isAdmin,
        isGuest ? false : isAuthor,
        isGuest ? false : isCourseContributor,
      ),
    [isAdmin, isAuthor, isGuest, isCourseContributor],
  );

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('theme', theme);
  }, [theme]);

  // Guests never wait on Keycloak — their session is the token in the URL.
  if (loading && !isGuest) {
    return (
      <div className="flex flex-row gap-2 justify-center items-center mt-12">
        <svg
          aria-hidden="true"
          className="w-8 h-8 text-white animate-spin fill-green"
          viewBox="0 0 100 101"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z"
            fill="currentColor"
          />
          <path
            d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z"
            fill="currentFill"
          />
        </svg>
      </div>
    );
  }

  return (
    <Router>
      {/*
        The first-login walkthrough. Inside the router because it moves people
        between pages and watches where they go — and App renders the router
        itself, so this is the outermost place that can. It wraps the shell
        rather than sitting up with the providers in index.tsx for the same
        reason, and is handed the sidebar's state because App owns it.
      */}
      <TourProvider enabled={showShell} sidebarOpen={sidebarOpen} setSidebarOpen={setSidebar}>
        {showShell && (
          <Navbar
            isDarkMode={theme === 'dark'}
            pages={pages}
            sidebarOpen={sidebarOpen}
            toggleSidebar={toggleSidebar}
            toggleTheme={toggleTheme}
          />
        )}
        {/* Main Content Area with proper spacing */}
        <div
          className={
            showShell
              ? `app-main app-main--authenticated ${sidebarOpen ? 'app-main--sidebar-open' : ''}`
              : 'w-full'
          }
        >
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              {/* Public Routes - No authentication required */}
              {/* Assignment links: the token in the URL is the credential, so this
              must stay outside ProtectedRoute. */}
              <Route path="/a/:token" element={<AssignmentEntry />} />
              <Route path="/login" element={<Login />} />
              <Route path="/public" element={<PublicPage />} />
              <Route path="/about" element={<About />} />
              <Route path="/unauthorized" element={<Unauthorized />} />

              {/* Protected Routes - Authentication required */}

              {/* admin side routes. The dashboard is open to authors as well:
                an author can do everything except manage users. */}
              <Route
                path="/admin"
                element={
                  <ProtectedRoute isAuthor={true}>
                    <AdminPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/users"
                element={
                  <ProtectedRoute isAdmin={true}>
                    <UsersList />
                  </ProtectedRoute>
                }
              />
              {/* Authoring routes - admins and contributors */}
              <Route
                path="/admin/learning"
                element={
                  <ProtectedRoute isAuthor={true}>
                    <AdminLearning />
                  </ProtectedRoute>
                }
              />
              {/* The editor is only reachable by picking a lesson card. Contributors
              get here through Course Editor, so it is gated on edit rights rather
              than the global author role. */}
              <Route
                path="/admin/learning/:courseId"
                element={
                  <ProtectedRoute canEdit={true}>
                    <CourseEditor />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/course-editor"
                element={
                  <ProtectedRoute canEdit={true}>
                    <CourseEditorList />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/quizzes"
                element={
                  <ProtectedRoute isAuthor={true}>
                    <AdminQuizzes />
                  </ProtectedRoute>
                }
              />
              {/* user side routes */}
              <Route
                path="/"
                element={
                  <ProtectedRoute>
                    <HomePage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/profile"
                element={
                  <ProtectedRoute>
                    <Profile />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/learning"
                element={
                  <ProtectedRoute>
                    <Learning />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/learning/:courseId"
                element={
                  <ProtectedRoute>
                    <CourseLanding />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/learning/:courseId/content"
                element={
                  <ProtectedRoute>
                    <CoursePlayer />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/quizzes"
                element={
                  <ProtectedRoute>
                    <Quizzes />
                  </ProtectedRoute>
                }
              />
              {/* A quiz that belongs to no course has no course page to sit under,
              so it gets its own. Declared before the course routes because
              "standalone" is a real path segment rather than a course id. */}
              <Route
                path="/quizzes/standalone/:quizId"
                element={
                  <ProtectedRoute>
                    <StandaloneQuiz />
                  </ProtectedRoute>
                }
              />
              {/* The start page, then the player. Which quiz is open is in the URL so
              a timed run survives a reload. */}
              <Route
                path="/quizzes/:courseId"
                element={
                  <ProtectedRoute>
                    <QuizLanding />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/quizzes/:courseId/take/:quizId"
                element={
                  <ProtectedRoute>
                    <QuizPlayer />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/table"
                element={
                  <ProtectedRoute>
                    <TablePage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/contact"
                element={
                  <ProtectedRoute>
                    <ContactUs />
                  </ProtectedRoute>
                }
              />

              {/* Add more protected routes here
          <Route 
            path="/dashboard" 
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            } 
          />
          */}

              {/* Catch all - redirect to home */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </div>
      </TourProvider>
    </Router>
  );
}
export default App;
