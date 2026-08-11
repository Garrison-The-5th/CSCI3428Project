/**
 * File: protected-route.tsx
 * Description: Route gate for authenticated, admin, author and per-course access.
 * Author: TTG Full-Stack Web Boilerplate
 * Date: 2026-08-10
 */
import { Navigate } from 'react-router-dom';

import { useAuth } from '@/contexts/auth-context';
import { useEditorAccess } from '@/contexts/editor-access-context';
import { useGuest } from '@/contexts/guest-context';

interface ProtectedRouteProps {
  children: React.ReactNode;
  /** Restrict to admins (Users). */
  isAdmin?: boolean;
  /** Restrict to content authors — admins and the global contributor role. */
  isAuthor?: boolean;
  /** Restrict to anyone who can edit at least one course. */
  canEdit?: boolean;
}

/**
 * ProtectedRoute component wraps routes that require authentication.
 * If user is not authenticated, redirects to /login
 */
export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  isAdmin,
  isAuthor,
  canEdit,
}) => {
  const { authenticated, loading, isAdmin: userIsAdmin, isAuthor: userIsAuthor } = useAuth();
  const { isGuest } = useGuest();
  const { canEdit: userCanEdit } = useEditorAccess();

  // A guest on an assignment link gets the learner pages without a Keycloak
  // session, but never the admin or authoring ones.
  if (isGuest) {
    if (isAdmin || isAuthor || canEdit) return <Navigate to="/" replace />;
    return <>{children}</>;
  }

  // Show loading state while checking authentication
  if (loading) {
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

  // Redirect to login if not authenticated
  if (!authenticated) {
    return <Navigate to="/login" replace />;
  }

  // Only block access when the user lacks the role a restricted route requires
  if (isAdmin && !userIsAdmin) {
    return <Navigate to="/unauthorized" replace />;
  }

  if (isAuthor && !userIsAuthor) {
    return <Navigate to="/unauthorized" replace />;
  }

  // Losing your last course removes this access, because it is derived from the
  // course list rather than stored on the account.
  if (canEdit && !userCanEdit) {
    return <Navigate to="/unauthorized" replace />;
  }

  // Render protected content
  return <>{children}</>;
};
