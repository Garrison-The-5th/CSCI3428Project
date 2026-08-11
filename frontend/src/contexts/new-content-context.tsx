/**
 * File: new-content-context.tsx
 * Description: Which courses have gained content since this learner finished them.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
/**
 * Which courses have gained content since this learner finished them.
 *
 * The dashboard already works this out per course; this holds the answer in one
 * place so the sidebar can put a dot on Learning, the Learning page can put one
 * on the course it belongs to, and neither has to fetch the dashboard for
 * itself. One request feeds the whole shell.
 *
 * Reading the dashboard is also what clears the notice: the server moves a
 * learner's completion date forward once they have worked through the new
 * material, so `refresh` after finishing something is what makes the dot go away.
 */
import React, {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { useAuth } from '@/contexts/auth-context';
import { useGuest } from '@/contexts/guest-context';
import { makeLearnerApi } from '@/services/learner-api';
import { logger } from '@/utils/logger';

interface NewContentContextType {
  /** Course ids with material added since the learner completed them. */
  newContentCourseIds: Set<string>;
  /** True when any course has something new — what the sidebar dot reads. */
  hasNewContent: boolean;
  refresh: () => Promise<void>;
}

const NewContentContext = createContext<NewContentContextType | undefined>(undefined);

export const NewContentProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { authenticated } = useAuth();
  const { token } = useGuest();
  const [newContentCourseIds, setNewContentCourseIds] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    // Nobody is signed in and no link is open — there is no dashboard to read.
    if (!authenticated && !token) {
      setNewContentCourseIds(new Set());
      return;
    }

    try {
      const dashboard = await makeLearnerApi(token).getDashboard();
      setNewContentCourseIds(
        new Set((dashboard.updatedCourses ?? []).map((course) => course.courseId)),
      );
    } catch (err) {
      // A badge is not worth an error state; the pages themselves report
      // properly when their own fetch fails.
      logger.error('Could not check for new course content:', err);
    }
  }, [authenticated, token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({
      newContentCourseIds,
      hasNewContent: newContentCourseIds.size > 0,
      refresh,
    }),
    [newContentCourseIds, refresh],
  );

  return <NewContentContext.Provider value={value}>{children}</NewContentContext.Provider>;
};

export const useNewContent = () => {
  const context = useContext(NewContentContext);
  if (context === undefined) {
    throw new Error('useNewContent must be used within a NewContentProvider');
  }
  return context;
};
