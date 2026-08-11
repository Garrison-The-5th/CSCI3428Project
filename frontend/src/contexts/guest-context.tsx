/**
 * File: guest-context.tsx
 * Description: Guest sessions.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
/**
 * Guest sessions.
 *
 * Opening /a/<token> stores the token and turns the app into a read-only learner
 * experience for the email that token was issued to: same sidebar, dashboard,
 * Learning and Quizzes tabs, minus anything admin.
 *
 * The token lives in sessionStorage, not localStorage — it is a credential, and a
 * shared or public machine should not keep it after the tab closes.
 */
import React, { createContext, ReactNode, useCallback, useContext, useMemo, useState } from 'react';

const STORAGE_KEY = 'assignmentToken';

interface GuestContextType {
  token: string | null;
  isGuest: boolean;
  email: string | null;
  setEmail: (email: string | null) => void;
  startSession: (token: string) => void;
  endSession: () => void;
}

const GuestContext = createContext<GuestContextType | undefined>(undefined);

export const GuestProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem(STORAGE_KEY));
  const [email, setEmail] = useState<string | null>(null);

  const startSession = useCallback((next: string) => {
    sessionStorage.setItem(STORAGE_KEY, next);
    setToken(next);
  }, []);

  const endSession = useCallback(() => {
    sessionStorage.removeItem(STORAGE_KEY);
    setToken(null);
    setEmail(null);
  }, []);

  const value = useMemo(
    () => ({ token, isGuest: token !== null, email, setEmail, startSession, endSession }),
    [token, email, startSession, endSession],
  );

  return <GuestContext.Provider value={value}>{children}</GuestContext.Provider>;
};

export const useGuest = () => {
  const context = useContext(GuestContext);
  if (context === undefined) {
    throw new Error('useGuest must be used within a GuestProvider');
  }
  return context;
};
