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
 *
 * Because it survives a reload, the link is re-checked on every page load rather
 * than only when /a/<token> is opened. Two things depend on that. A link turned
 * off, expired or revoked part way through a visit used to keep working until the
 * tab was closed, since nothing asked again. And a one-time link counts the one
 * visit it still has after being handed in — which it cannot do if reloading a
 * deep page never tells the server anybody came back.
 */
import React, {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { assignmentApi } from '@/services/assignment-api';

const STORAGE_KEY = 'assignmentToken';

/** The entry page does its own checking and reports the reason it failed. */
const isEntryPath = () => window.location.pathname.startsWith('/a/');

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

  /**
   * Re-checks a token restored from storage, once per page load.
   *
   * Deliberately keyed to the token that was there at mount rather than to
   * `token`, and guarded by a ref: opening /a/<token> stores one a moment later,
   * and re-running then would spend the one visit a completed one-time link has
   * left before its holder had seen anything.
   *
   * A link that no longer works sends them to the entry page for it, which is
   * already the one place that turns a reason into a sentence — being told "this
   * link is no longer enabled" is the point of the exercise, and silently
   * dropping them at the sign-in page would not be.
   */
  const checked = useRef(false);
  useEffect(() => {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (checked.current || !stored || isEntryPath()) return;
    checked.current = true;

    let cancelled = false;
    (async () => {
      try {
        const user = await assignmentApi.getSession(stored);
        if (!cancelled) setEmail(user.email);
      } catch {
        if (cancelled) return;
        sessionStorage.removeItem(STORAGE_KEY);
        window.location.replace(`/a/${encodeURIComponent(stored)}`);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo(
    () => ({ token, isGuest: token !== null, email, setEmail, startSession, endSession }),
    [token, email, startSession, endSession],
  );

  return <GuestContext.Provider value={value}>{children}</GuestContext.Provider>;
};

/**
 * The assignment token this page was opened with, or null for a signed-in user.
 *
 * Read by `useLearnerApi` to decide which half of the API to call: with a token
 * every request goes to the public `/public/assignments/:token/...` routes, and
 * without one to the authenticated routes. Components stay identical either way,
 * which is what lets a guest and a learner share the whole player.
 */
export const useGuest = () => {
  const context = useContext(GuestContext);
  if (context === undefined) {
    throw new Error('useGuest must be used within a GuestProvider');
  }
  return context;
};
