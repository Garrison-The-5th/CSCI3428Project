/**
 * File: edit-locks-context.tsx
 * Description: Who else is editing this course, and what that locks.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-09-04
 */
/**
 * Who else has a piece of this course open right now.
 *
 * A context rather than props because the things that need the answer are four
 * levels down and unrelated to each other — a module heading in the structure
 * editor, a question row in the quiz editor — and threading two props through
 * every pane between here and there would put the plumbing in files that have
 * no other interest in it.
 *
 * The claim a component makes is its own: it says "I am editing this" on mount
 * and gives it back on unmount, and everything else in the app reads the result.
 * A claim is renewed on a heartbeat because a browser cannot be trusted to
 * announce that it has gone — a closed tab, a dead laptop, a lost connection all
 * look the same from here, and a lock nobody can release is worse than the race
 * it prevents.
 */
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

import { curriculumApi, EditLease, EditMarks, EditScope } from '@/services/curriculum-api';
import { logger } from '@/utils/logger';

/**
 * How often claims are renewed and the list refreshed.
 *
 * The server holds a claim for three beats, so one missed round trip does not
 * hand somebody's module away. Fast enough that walking into a module somebody
 * has just left is a wait of seconds, not a puzzle.
 */
const HEARTBEAT_MS = 15_000;

const NO_MARKS: EditMarks = {
  modules: {},
  sections: {},
  elements: {},
  quizzes: {},
  questions: {},
};

interface EditLocks {
  /** Module id to the first name of whoever holds it. Excludes your own claims. */
  lockedModules: Record<string, string>;
  /** Question id to the first name of whoever holds it. Excludes your own. */
  lockedQuestions: Record<string, string>;
  /** Claim something, or give it up by passing null. One claim per scope at a time. */
  claim: (scope: EditScope, targetId: string | null) => void;
  /**
   * What has changed since the last publish, and who changed it.
   *
   * Carried alongside the locks because it is the same question asked over a
   * longer window — who is working on this course — and because this is already
   * the thing polling for an answer. Cleared by a publish, which is what makes
   * the marks mean "not live yet" rather than "edited at some point".
   */
  marks: EditMarks;
}

const NOTHING_LOCKED: EditLocks = {
  lockedModules: {},
  lockedQuestions: {},
  claim: () => {},
  marks: NO_MARKS,
};

const EditLocksContext = createContext<EditLocks>(NOTHING_LOCKED);

/** What is locked for this viewer. Safe to call outside a provider — nothing is. */
export function useEditLocks(): EditLocks {
  return useContext(EditLocksContext);
}

interface ProviderProps {
  courseId: string;
  children: ReactNode;
}

/**
 * Tracks who else is editing this course and which modules and questions that locks, renewing this
 * person's own claims while they edit.
 */
export const EditLocksProvider = ({ courseId, children }: ProviderProps) => {
  const [leases, setLeases] = useState<EditLease[]>([]);
  const [marks, setMarks] = useState<EditMarks>(NO_MARKS);

  /**
   * What this tab currently claims, by scope.
   *
   * One target per scope on purpose: a person is in one module and writing one
   * question, and letting a tab accumulate claims would have somebody's closed
   * panes locking content they walked away from ten minutes ago.
   */
  const held = useRef<Partial<Record<EditScope, string>>>({});

  const refresh = useCallback(async () => {
    try {
      const [nextLeases, nextMarks] = await Promise.all([
        curriculumApi.getEditLeases(courseId),
        curriculumApi.getEditMarks(courseId),
      ]);
      setLeases(nextLeases);
      setMarks(nextMarks);
    } catch (err) {
      // A failed poll leaves the last answer standing rather than unlocking
      // everything: briefly stale is better than briefly wrong in the direction
      // that loses work.
      logger.error('Could not read who is editing:', err);
    }
  }, [courseId]);

  /** Renews everything this tab holds, then re-reads the whole picture. */
  const beat = useCallback(async () => {
    const mine = Object.entries(held.current) as Array<[EditScope, string]>;

    await Promise.all(
      mine.map(([scope, targetId]) =>
        curriculumApi.claimEditLease(courseId, scope, targetId).catch(() => undefined),
      ),
    );

    await refresh();
  }, [courseId, refresh]);

  useEffect(() => {
    void beat();
    const timer = window.setInterval(() => void beat(), HEARTBEAT_MS);
    return () => window.clearInterval(timer);
  }, [beat]);

  // Leaving the course gives up everything at once, so the next person does not
  // wait out the lease on a pane nobody has open.
  useEffect(() => {
    /** Gives up every claim this person holds in the course, e.g. on leaving the editor. */
    const releaseAll = () => {
      held.current = {};
      void curriculumApi.releaseEditLease(courseId).catch(() => undefined);
    };

    window.addEventListener('pagehide', releaseAll);
    return () => {
      window.removeEventListener('pagehide', releaseAll);
      releaseAll();
    };
  }, [courseId]);

  const claim = useCallback(
    (scope: EditScope, targetId: string | null) => {
      const previous = held.current[scope];
      if (previous === (targetId ?? undefined)) return;

      if (previous) {
        void curriculumApi
          .releaseEditLease(courseId, { scope, targetId: previous })
          .catch(() => undefined);
      }

      if (targetId) {
        held.current[scope] = targetId;
        void curriculumApi
          .claimEditLease(courseId, scope, targetId)
          .then(() => refresh())
          .catch(() => undefined);
      } else {
        delete held.current[scope];
        void refresh();
      }
    },
    [courseId, refresh],
  );

  // Only other people's claims lock anything. Your own are what let you edit.
  const byScope = (scope: EditScope) =>
    Object.fromEntries(
      leases
        .filter((lease) => lease.scope === scope && !lease.mine)
        .map((lease) => [lease.targetId, lease.holder]),
    );

  return (
    <EditLocksContext.Provider
      value={{
        lockedModules: byScope('MODULE'),
        lockedQuestions: byScope('QUESTION'),
        claim,
        marks,
      }}
    >
      {children}
    </EditLocksContext.Provider>
  );
};
