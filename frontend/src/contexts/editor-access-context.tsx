/**
 * File: editor-access-context.tsx
 * Description: Who can edit course content.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
/**
 * Who can edit course content.
 *
 * Two ways in: a global author (admin or the Keycloak `contributor` role), or
 * being named on individual courses. The second group gets a Course Editor page
 * listing only their courses — and loses it the moment they are removed from the
 * last one, because access is derived from the list rather than a stored flag.
 */
import React, {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';

import { useAuth } from '@/contexts/auth-context';
import { useGuest } from '@/contexts/guest-context';
import HttpHelper from '@/utils/http-helper';

interface EditorAccess {
  /** Courses they may edit — all of them for a global author. */
  editableCourseIds: string[];
  /** Admin or the global contributor role. */
  isGlobalAuthor: boolean;
  /** Named on at least one course, but not a global author. */
  isCourseContributor: boolean;
  /** Can reach a course editor at all. */
  canEdit: boolean;
  refresh: () => Promise<void>;
}

const EditorAccessContext = createContext<EditorAccess | undefined>(undefined);

export const EditorAccessProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { authenticated } = useAuth();
  const { isGuest } = useGuest();
  const [editableCourseIds, setEditableCourseIds] = useState<string[]>([]);
  const [isGlobalAuthor, setIsGlobalAuthor] = useState(false);

  const refresh = useCallback(async () => {
    // Guests never author, and an anonymous visitor has nothing to ask about.
    if (!authenticated || isGuest) {
      setEditableCourseIds([]);
      setIsGlobalAuthor(false);
      return;
    }

    try {
      const response = await HttpHelper.get('curriculum/courses/editable');
      setEditableCourseIds((response.courses ?? []).map((c: { id: string }) => c.id));
      setIsGlobalAuthor(response.isGlobalAuthor === true);
    } catch {
      // A plain learner gets nothing back; that is not an error worth surfacing.
      setEditableCourseIds([]);
      setIsGlobalAuthor(false);
    }
  }, [authenticated, isGuest]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const isCourseContributor = !isGlobalAuthor && editableCourseIds.length > 0;

  return (
    <EditorAccessContext.Provider
      value={{
        editableCourseIds,
        isGlobalAuthor,
        isCourseContributor,
        canEdit: isGlobalAuthor || editableCourseIds.length > 0,
        refresh,
      }}
    >
      {children}
    </EditorAccessContext.Provider>
  );
};

/**
 * Whether this person may edit anything, and so whether the authoring tabs show.
 *
 * Course-level contributor rights cannot be read off the Keycloak token — they
 * live in the database, on the course — so this asks the server. It is what
 * makes the rule "lose your last contributor role, lose the Course Editor,
 * Users and Admin Dashboard tabs" hold without a sign-out and back in.
 */
export const useEditorAccess = () => {
  const context = useContext(EditorAccessContext);
  if (context === undefined) {
    throw new Error('useEditorAccess must be used within an EditorAccessProvider');
  }
  return context;
};
