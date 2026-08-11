/**
 * File: get-navbar-data.tsx
 * Description: Sidebar contents per audience.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import {
  AcademicCapIcon,
  ArrowRightStartOnRectangleIcon,
  ClipboardDocumentListIcon,
  EnvelopeIcon,
  HomeIcon,
  PencilSquareIcon,
  QuestionMarkCircleIcon,
  Squares2X2Icon,
  UserCircleIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline';

export interface NavbarPage {
  text: string;
  path: string;
  Icon?: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  isAccountMenu?: boolean;
  isLogout?: boolean;
}

export interface NavbarSetting {
  text: string;
  path?: string;
}

export interface NavbarDataType {
  pages: NavbarPage[];
  // settings?: NavbarSetting[]; // Uncomment if settings are needed
}

const home: NavbarPage = { path: '/', text: 'Home', Icon: HomeIcon };
const profile: NavbarPage = { path: '/profile', text: 'Profile', Icon: UserCircleIcon };
const learning: NavbarPage = { path: '/learning', text: 'Learning', Icon: AcademicCapIcon };
const quizzes: NavbarPage = { path: '/quizzes', text: 'Quizzes', Icon: QuestionMarkCircleIcon };
const contact: NavbarPage = { path: '/contact', text: 'Contact Us', Icon: EnvelopeIcon };

// Authoring tools — admins and contributors.
const createLesson: NavbarPage = {
  path: '/admin/learning',
  text: 'Create a Lesson',
  Icon: PencilSquareIcon,
};
const createQuiz: NavbarPage = {
  path: '/admin/quizzes',
  text: 'Create a Quiz',
  Icon: ClipboardDocumentListIcon,
};

// Admin-only tools.
const courseEditor: NavbarPage = {
  path: '/admin/course-editor',
  text: 'Course Editor',
  Icon: PencilSquareIcon,
};

const users: NavbarPage = { path: '/admin/users', text: 'Users', Icon: UserGroupIcon };
const adminDashboard: NavbarPage = {
  path: '/admin',
  text: 'Admin Dashboard',
  Icon: Squares2X2Icon,
};

const logoutItem: NavbarPage = {
  path: '',
  text: 'Logout',
  Icon: ArrowRightStartOnRectangleIcon,
  isLogout: true,
};

/**
 * Fixed order: Home, Profile, Learning, Quizzes, then the authoring tools, then
 * the admin tools, with Contact Us last. Items the user cannot reach are omitted
 * rather than reordered, so the sequence stays the same for everyone.
 */
export const getNavbarData = (
  isAdmin: boolean,
  isAuthor = isAdmin,
  /** Named on individual courses, but not a global author. */
  isCourseContributor = false,
): NavbarDataType => {
  return {
    pages: [
      home,
      profile,
      learning,
      quizzes,
      // Global authors create lessons; contributors only edit the ones they are on.
      ...(isAuthor ? [createLesson, createQuiz] : isCourseContributor ? [courseEditor] : []),
      ...(isAdmin ? [users, adminDashboard] : []),
      contact,
    ],
  };
};

export const getLogoutItem = (): NavbarPage => {
  return logoutItem;
};
