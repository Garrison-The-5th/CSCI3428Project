/**
 * File: course-access.tsx
 * Description: Course Access — who can edit this lesson, and who has been given it.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-20
 */
/**
 * Course Access — who can edit this lesson or quiz, and who has been given it.
 *
 * Three columns, left to right, because there are three genuinely different
 * questions being asked and they used to be two:
 *
 *   Authors     — people who may edit this one course. They need an account:
 *                 editing happens behind a login.
 *   On platform — people it is enrolled to. They need an account too, and this
 *                 column will only offer addresses that have one, because
 *                 enrolling somebody who cannot sign in sends them to a door
 *                 they cannot open.
 *   Link only   — an address, and nothing else. One private URL that opens the
 *                 course with no sign-in. It deliberately does not search the
 *                 people already in the system: a link is for somebody who is
 *                 not one of them, and handing one to a colleague who has an
 *                 account gives them a second, weaker way in to work that
 *                 belongs on their Learning page. That is refused with the
 *                 reason rather than silently downgraded.
 *
 * Splitting them is what makes each rule statable. The single "search people, or
 * type a new email" box could not say any of this: it had one field doing three
 * jobs and the server quietly deciding which, so nothing on the page could warn
 * anybody about anything.
 *
 * A one-time link takes the middle column away entirely. Such a quiz is reached
 * only through its URL — the server forces the assignment to be a link whoever
 * it goes to — so an on-platform enrolment is a thing that cannot happen, and
 * greying it out with the reason beats letting somebody fill it in and be
 * overruled.
 *
 * The assigned list below is AssignmentRoster, shared with the admin dashboard:
 * what can be done to an assignment should not depend on which page you found it
 * on. Both kinds are listed together and badged, since only the link kind has a
 * URL to copy.
 */
import { MagnifyingGlassIcon, TrashIcon, UserPlusIcon } from '@heroicons/react/24/outline';
import { useCallback, useEffect, useState } from 'react';

import AssignmentRoster from '@/components/common/assignment-roster';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Assignment, assignmentApi } from '@/services/assignment-api';
import { Course, curriculumApi } from '@/services/curriculum-api';
import { logger } from '@/utils/logger';

interface Props {
  course: Course;
  /** Only a global author may change who can edit a lesson. */
  canManageAuthors: boolean;
  /** Names the thing on screen — a quiz set is not "a course" to its author. */
  mode?: 'lesson' | 'quiz';
  onNotify: (message: string, type?: 'success' | 'error') => void;
}

interface Person {
  id: number;
  email: string;
  name: string | null;
}

const inputClass = 'bg-white text-dark-gray';
const primaryBtn = 'bg-navy text-white hover:bg-navy-hover';

/**
 * The same rough shape check the server applies, run here so the link column can
 * refuse a non-address before it asks anybody about it. Deliberately loose: the
 * authority on whether mail arrives is the mail server, not a regular
 * expression, and a stricter one here would reject valid addresses.
 */
const looksLikeEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

/** The note that sits at the top of a column, stating its one rule. */
const ColumnNote = ({ children }: { children: React.ReactNode }) => (
  <p className="rounded-lg border border-navy/30 bg-navy/5 p-3 text-xs text-dark-gray">
    {children}
  </p>
);

const CourseAccess = ({ course, canManageAuthors, mode = 'lesson', onNotify }: Props) => {
  const [authors, setAuthors] = useState<Person[]>([]);
  const [authorQuery, setAuthorQuery] = useState('');
  const [authorResults, setAuthorResults] = useState<Person[]>([]);

  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [platformQuery, setPlatformQuery] = useState('');
  const [platformResults, setPlatformResults] = useState<Person[]>([]);
  const [linkEmail, setLinkEmail] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);
  const [rosterQuery, setRosterQuery] = useState('');

  /** What this course is called in prose, and what the pane is titled. */
  const noun = mode === 'quiz' ? 'quiz' : 'lesson';
  const accessTitle = mode === 'quiz' ? 'Quiz Access' : 'Course Access';

  /**
   * A one-time link in this course closes the on-platform column.
   *
   * Read off the content rather than off `mode`, because it is the quiz that
   * makes the rule true: `AssignmentService.assign` forces LINK whenever the
   * course holds one, so an on-platform enrolment here would be overruled
   * whichever page it was made from.
   */
  const oneTimeQuiz =
    course.sections
      .flatMap((section) => section.quizzes)
      .find((quiz) => quiz.type === 'ONE_TIME') ?? null;

  const load = useCallback(async () => {
    try {
      const [people, links] = await Promise.all([
        canManageAuthors ? curriculumApi.getContributors(course.id) : Promise.resolve([]),
        assignmentApi.list({ courseId: course.id }),
      ]);
      setAuthors(people);
      setAssignments(links);
    } catch (err) {
      logger.error('Error loading access:', err);
    }
  }, [course.id, canManageAuthors]);

  useEffect(() => {
    load();
  }, [load]);

  // Debounced type-ahead against the people already in the system.
  useEffect(() => {
    if (!authorQuery.trim()) return setAuthorResults([]);
    const timer = setTimeout(async () => {
      try {
        // Unfiltered, unlike the on-platform column beside it. Naming an author
        // is a different act from enrolling a learner: somebody may perfectly
        // well be added as an author before their first sign-in, and the note
        // above tells them what they will need. The picker states the rule
        // rather than enforcing it.
        setAuthorResults(await curriculumApi.searchUsers(authorQuery));
      } catch {
        setAuthorResults([]);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [authorQuery]);

  useEffect(() => {
    if (!platformQuery.trim()) return setPlatformResults([]);
    const timer = setTimeout(async () => {
      try {
        setPlatformResults(await curriculumApi.searchUsers(platformQuery, { accountsOnly: true }));
      } catch {
        setPlatformResults([]);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [platformQuery]);

  const saveAuthors = async (emails: string[]) => {
    try {
      await curriculumApi.setContributors(course.id, emails);
      await load();
      onNotify('Authors updated');
    } catch (err) {
      logger.error('Failed to update authors:', err);
      onNotify('Failed to update authors', 'error');
    }
  };

  const addAuthor = (email: string) => {
    if (authors.some((a) => a.email === email.toLowerCase())) {
      return onNotify('Already an author', 'error');
    }
    setAuthorQuery('');
    setAuthorResults([]);
    saveAuthors([...authors.map((a) => a.email), email]);
  };

  /**
   * Hands the course over.
   *
   * The type is stated now rather than inferred. It used to be left to the
   * server, which read it off whether the address had ever signed in — a fine
   * guess when there was one box, and the wrong answer now that the author has
   * said which of two columns they are standing in.
   */
  const assign = async (email: string, type: 'PLATFORM' | 'LINK') => {
    const clean = email.trim().toLowerCase();
    if (!clean) return onNotify('Enter an email address', 'error');

    try {
      const response = await assignmentApi.assign({
        courseId: course.id,
        email: clean,
        type,
      });
      setPlatformQuery('');
      setPlatformResults([]);
      setLinkEmail('');
      setLinkError(null);
      await load();
      onNotify(response.message, response.delivery.sent ? 'success' : 'error');
    } catch (err) {
      logger.error('Failed to assign:', err);
      onNotify(err instanceof Error && err.message ? err.message : 'Failed to assign', 'error');
    }
  };

  /**
   * Sending a private link, which is refused for anybody who can sign in.
   *
   * The check is against having signed in rather than against a User row
   * existing: a row is minted the moment somebody is assigned anything, so its
   * existence would refuse every address that had ever been sent a link before.
   */
  const sendLink = async () => {
    const clean = linkEmail.trim().toLowerCase();

    if (!looksLikeEmail(clean)) {
      return setLinkError('This column takes an email address and nothing else.');
    }

    try {
      if (await curriculumApi.hasAccount(clean)) {
        return setLinkError(
          `${clean} already has an account, so they should be given this on the platform — ` +
            'a private link would be a second way in to work that belongs on their Learning page.',
        );
      }
    } catch (err) {
      logger.error('Could not check for an account:', err);
      return setLinkError('Could not check that address just now. Try again in a moment.');
    }

    setLinkError(null);
    await assign(clean, 'LINK');
  };

  /** The assigned list, narrowed by the roster search. */
  const visibleAssignments = assignments.filter((assignment) => {
    const query = rosterQuery.trim().toLowerCase();
    if (!query) return true;
    return assignment.email.toLowerCase().includes(query);
  });

  const results = (people: Person[], onPick: (email: string) => void) =>
    people.length > 0 && (
      <ul className="flex flex-col gap-1 rounded-md border border-gray-300 bg-white p-1">
        {people.map((person) => (
          <li key={person.id}>
            <button
              onClick={() => onPick(person.email)}
              className="flex w-full flex-col rounded px-2 py-1 text-left text-sm text-dark-gray
                hover:bg-light-gray"
            >
              <span className="font-medium">{person.name ?? person.email}</span>
              {person.name && <span className="text-xs">{person.email}</span>}
            </button>
          </li>
        ))}
      </ul>
    );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold text-dark-gray">{accessTitle}</h2>
        <p className="text-sm text-dark-gray">
          Who may edit this {noun}, and who has been given it.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ---- 1. Authors ---- */}
        <Card className="h-fit bg-light-gray shadow-sm">
          <CardHeader className="p-4">
            <CardTitle className="text-lg text-dark-gray">Authors</CardTitle>
            <p className="text-sm text-dark-gray">
              People who can edit this {noun}. They see it under Course Editor, and lose access when
              removed from their last one.
            </p>
          </CardHeader>

          <CardContent className="flex flex-col gap-3">
            <ColumnNote>
              An author must have an account. Editing happens behind a sign-in, so anybody named
              here needs to be able to log in before they can open this {noun}.
            </ColumnNote>

            {canManageAuthors ? (
              <div className="flex flex-col gap-2">
                <div className="relative">
                  <MagnifyingGlassIcon
                    className="pointer-events-none absolute top-2.5 left-2 w-4 h-4 text-dark-gray"
                  />
                  <Input
                    value={authorQuery}
                    onChange={(e) => setAuthorQuery(e.target.value)}
                    placeholder="Search people by name or email"
                    className={`${inputClass} pl-8`}
                  />
                </div>
                {results(authorResults, addAuthor)}
              </div>
            ) : (
              <p className="text-sm text-dark-gray">Only an admin can change this list.</p>
            )}

            <hr className="h-px border-t-0 bg-gray-300" />

            {authors.length === 0 ? (
              <p className="text-sm text-dark-gray">No extra authors on this {noun}.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {authors.map((person) => (
                  <li
                    key={person.id}
                    className="flex items-center gap-3 rounded-lg border border-gray-300 bg-white
                      px-4 py-3"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-dark-gray">
                        {person.name ?? person.email}
                      </span>
                      {person.name && (
                        <span className="block truncate text-sm text-dark-gray">
                          {person.email}
                        </span>
                      )}
                    </span>
                    {canManageAuthors && (
                      <Button
                        onClick={() =>
                          saveAuthors(authors.filter((a) => a.id !== person.id).map((a) => a.email))
                        }
                        variant="ghost"
                        size="icon"
                        className="shrink-0 hover:text-danger-hover"
                        title="Remove author"
                      >
                        <TrashIcon className="w-5 h-5" />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* ---- 2. On the platform ---- */}
        <Card className="h-fit bg-light-gray shadow-sm">
          <CardHeader className="p-4">
            <CardTitle className="text-lg text-dark-gray">On platform</CardTitle>
            <p className="text-sm text-dark-gray">
              Enrolled on their account. They are emailed a sign-in link and find this {noun} on
              their Learning page.
            </p>
          </CardHeader>

          {/* A one-time link cannot be enrolled, so the column is put beyond use
              rather than left to be filled in and overruled by the server. The
              header above stays sharp: the author still has to be able to tell
              which of the three columns this is. */}
          <div className="relative">
            <div className={oneTimeQuiz ? 'pointer-events-none blur-sm select-none' : undefined}>
              <CardContent className="flex flex-col gap-3">
                <ColumnNote>
                  The person must already have an account. Only addresses that have signed in appear
                  here — enrolling anyone else would send them to a sign-in they cannot pass.
                </ColumnNote>

                <div className="flex flex-col gap-2">
                  <div className="relative">
                    <MagnifyingGlassIcon
                      className="pointer-events-none absolute top-2.5 left-2 w-4 h-4 text-dark-gray"
                    />
                    <Input
                      value={platformQuery}
                      onChange={(e) => setPlatformQuery(e.target.value)}
                      placeholder="Search people with an account"
                      aria-label="Search people with an account"
                      disabled={oneTimeQuiz !== null}
                      className={`${inputClass} pl-8`}
                    />
                  </div>
                  {results(platformResults, (email) => assign(email, 'PLATFORM'))}

                  {platformQuery.trim() && platformResults.length === 0 && (
                    <p className="text-xs text-dark-gray">
                      Nobody with an account matches that. If they have never signed in, send them a
                      link instead.
                    </p>
                  )}
                </div>

                <hr className="h-px border-t-0 bg-gray-300" />

                <p className="text-xs text-dark-gray">
                  Pick somebody from the search to enrol them. Their deadline comes from the days
                  remaining set on this {noun}, counted from today.
                </p>
              </CardContent>
            </div>

            {oneTimeQuiz && (
              <div className="absolute inset-0 flex items-center justify-center p-4">
                <p
                  className="rounded-lg border-2 border-navy/30 bg-white/95 p-4 text-center text-sm
                    font-medium text-dark-gray shadow-sm"
                >
                  &ldquo;{oneTimeQuiz.title}&rdquo; is a one-time link. It is reached only through
                  the URL you send, so it can only be handed over by email — use Link only.
                </p>
              </div>
            )}
          </div>
        </Card>

        {/* ---- 3. Link only ---- */}
        <Card className="h-fit bg-light-gray shadow-sm">
          <CardHeader className="p-4">
            <CardTitle className="text-lg text-dark-gray">Link only</CardTitle>
            <p className="text-sm text-dark-gray">
              One private URL that opens this {noun} without signing in. It stays off any account.
            </p>
          </CardHeader>

          <CardContent className="flex flex-col gap-3">
            <ColumnNote>
              This column takes an email address and nothing else — it does not search the people
              already here. An address that already has an account is refused: they should be given
              it on the platform instead.
            </ColumnNote>

            <div className="flex flex-col gap-2">
              <Input
                type="email"
                value={linkEmail}
                onChange={(e) => {
                  setLinkEmail(e.target.value);
                  // The message described the address they have just changed, so
                  // it stops being true the moment they type.
                  if (linkError) setLinkError(null);
                }}
                onKeyDown={(e) => e.key === 'Enter' && sendLink()}
                placeholder="person@example.com"
                aria-label="Email address to send a link to"
                aria-invalid={linkError !== null}
                className={`${inputClass} ${linkError ? 'border-danger' : ''}`}
              />

              {linkError && (
                <p
                  role="alert"
                  className="rounded-md border-2 border-danger bg-danger/10 p-2 text-xs font-medium
                    text-dark-gray"
                >
                  {linkError}
                </p>
              )}

              <Button onClick={sendLink} className={primaryBtn}>
                <UserPlusIcon className="w-5 h-5" /> Send link
              </Button>
            </div>

            <hr className="h-px border-t-0 bg-gray-300" />

            <p className="text-xs text-dark-gray">
              The link is the credential — anyone holding it counts as that person, so treat it like
              a password.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ---- Everyone this has been given to ---- */}
      <Card className="bg-light-gray shadow-sm">
        <CardHeader className="p-4">
          <CardTitle className="text-lg text-dark-gray">Assigned</CardTitle>
          <p className="text-sm text-dark-gray">
            Everyone this {noun} has been handed to, however they got it. Link assignments have a
            URL to copy; platform ones do not.
          </p>
        </CardHeader>

        <CardContent className="flex flex-col gap-3">
          <div className="relative">
            <MagnifyingGlassIcon
              className="pointer-events-none absolute top-2.5 left-2 w-4 h-4 text-dark-gray"
            />
            <Input
              value={rosterQuery}
              onChange={(e) => setRosterQuery(e.target.value)}
              placeholder={`Search who has been assigned this ${noun}`}
              aria-label="Search assigned people"
              className={`${inputClass} pl-8`}
            />
          </div>

          <AssignmentRoster
            assignments={visibleAssignments}
            label={course.title}
            progressOf="course"
            onNotify={onNotify}
            onRefresh={load}
          />
        </CardContent>
      </Card>
    </div>
  );
};

export default CourseAccess;
