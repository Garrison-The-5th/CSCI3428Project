/**
 * File: course-access.tsx
 * Description: Course Access — who can edit this lesson, and who has been given it.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
/**
 * Course Access — who can edit this lesson, and who has been given it.
 *
 * Authors  : people who may edit this one lesson, picked from the people already
 *            in the system.
 * Students : people the lesson has been assigned to. Either pick an existing user
 *            or type an email — the account does not have to exist first.
 *
 * Assigning always emails the person, from the address of whoever is signed in;
 * the radio decides what that email says. "On the platform" enrols them and tells
 * them to sign in. "By link only" sends one private URL that opens the lesson
 * without a login. Both kinds are listed together below, badged, since only the
 * link kind has a URL to copy.
 *
 * The list itself is AssignmentRoster, shared with the admin dashboard — what an
 * assignment can be made to do should not depend on which page you found it on.
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
  onNotify: (message: string, type?: 'success' | 'error') => void;
}

interface Person {
  id: number;
  email: string;
  name: string | null;
}

const inputClass = 'bg-white text-dark-gray';
const primaryBtn = 'bg-navy text-white hover:bg-navy-hover';

const CourseAccess = ({ course, canManageAuthors, onNotify }: Props) => {
  const [authors, setAuthors] = useState<Person[]>([]);
  const [authorQuery, setAuthorQuery] = useState('');
  const [authorResults, setAuthorResults] = useState<Person[]>([]);

  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [studentQuery, setStudentQuery] = useState('');
  const [rosterQuery, setRosterQuery] = useState('');
  const [studentResults, setStudentResults] = useState<Person[]>([]);
  const [dueDate, setDueDate] = useState('');

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
        setAuthorResults(await curriculumApi.searchUsers(authorQuery));
      } catch {
        setAuthorResults([]);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [authorQuery]);

  useEffect(() => {
    if (!studentQuery.trim()) return setStudentResults([]);
    const timer = setTimeout(async () => {
      try {
        setStudentResults(await curriculumApi.searchUsers(studentQuery));
      } catch {
        setStudentResults([]);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [studentQuery]);

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

  const assign = async (email: string) => {
    const clean = email.trim().toLowerCase();
    if (!clean) return onNotify('Enter an email address', 'error');

    try {
      // No `type`: the server picks it from whether the address has an account.
      const response = await assignmentApi.assign({
        courseId: course.id,
        email: clean,
        dueDate: dueDate || null,
      });
      setStudentQuery('');
      setStudentResults([]);
      await load();
      onNotify(response.message, response.delivery.sent ? 'success' : 'error');
    } catch (err) {
      logger.error('Failed to assign:', err);
      onNotify(err instanceof Error && err.message ? err.message : 'Failed to assign', 'error');
    }
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
    <div className="grid gap-6 lg:grid-cols-2">
      {/* ---- Authors ---- */}
      <Card className="h-fit bg-light-gray shadow-sm">
        <CardHeader className="p-4">
          <CardTitle className="text-lg text-dark-gray">Authors</CardTitle>
          <p className="text-sm text-dark-gray">
            People who can edit this lesson. They see it under Course Editor, and lose access when
            removed from their last lesson.
          </p>
        </CardHeader>

        <CardContent className="flex flex-col gap-3">
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
            <p className="text-sm text-dark-gray">No extra authors on this lesson.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {authors.map((person) => (
                <li
                  key={person.id}
                  className="flex items-center gap-3 rounded-lg border border-gray-300 bg-white px-4
                    py-3"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-dark-gray">
                      {person.name ?? person.email}
                    </span>
                    {person.name && (
                      <span className="block truncate text-sm text-dark-gray">{person.email}</span>
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

      {/* ---- Students ---- */}
      <Card className="h-fit bg-light-gray shadow-sm">
        <CardHeader className="p-4">
          <CardTitle className="text-lg text-dark-gray">Students</CardTitle>
          <p className="text-sm text-dark-gray">
            People this lesson has been assigned to. Everyone you add is emailed — what the email
            contains depends on which of the two below you pick.
          </p>
        </CardHeader>

        <CardContent className="flex flex-col gap-3">
          {/* No choice to make any more: the server sends a sign-in link to
              someone with an account and a private link to an address without
              one, which is all the radio ever really encoded. */}
          <p className="rounded-lg border border-navy/30 bg-navy/5 p-3 text-xs text-dark-gray">
            People who already have an account are emailed a sign-in link and find the lesson on
            their Learning page. An address with no account is sent a private link that opens it
            without signing in — treat that link like a password, since anyone holding it counts as
            that person.
          </p>

          <div className="flex flex-col gap-2">
            <div className="relative">
              <MagnifyingGlassIcon
                className="pointer-events-none absolute top-2.5 left-2 w-4 h-4 text-dark-gray"
              />
              <Input
                value={studentQuery}
                onChange={(e) => setStudentQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && assign(studentQuery)}
                placeholder="Search people, or type a new email"
                className={`${inputClass} pl-8`}
              />
            </div>
            {results(studentResults, assign)}

            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-sm font-medium text-dark-gray">
                Due date
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="h-9 rounded-md border border-gray-300 bg-white px-2 text-sm
                    text-dark-gray"
                />
              </label>
              <Button onClick={() => assign(studentQuery)} className={primaryBtn}>
                <UserPlusIcon className="w-5 h-5" /> Assign
              </Button>
            </div>
          </div>

          <hr className="h-px border-t-0 bg-gray-300" />

          <div className="relative">
            <MagnifyingGlassIcon
              className="pointer-events-none absolute top-2.5 left-2 w-4 h-4 text-dark-gray"
            />
            <Input
              value={rosterQuery}
              onChange={(e) => setRosterQuery(e.target.value)}
              placeholder="Search who has been assigned this lesson"
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
