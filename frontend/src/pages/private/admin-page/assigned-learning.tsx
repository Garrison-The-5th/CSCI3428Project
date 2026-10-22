/**
 * File: assigned-learning.tsx
 * Description: Assigned learning — who has been given what, and how far they have got.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-09-22
 */
/**
 * Assigned learning — who has been given what, and how far they have got.
 *
 * Grid view : one card per course this person owns or is named on, with the
 *             headline numbers (assigned, finished, overdue). Courses nobody
 *             holds yet are listed too — a count of zero is the useful answer,
 *             not an empty one.
 * Course view: the same course's roster, one row per person, sortable by how far
 *             behind they are.
 *
 * Reporting only. Work is handed out from the course's own Access pane, in front
 * of the course being sent — see the note where the panel used to be.
 */
import { ArrowLeftIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import ProgressDonut from '@/components/ui/progress-donut';
import { AssignedCourse, Assignment, assignmentApi } from '@/services/assignment-api';
import { imageSrc } from '@/services/curriculum-api';
import { logger } from '@/utils/logger';

interface AssignedLearningProps {
  onNotify: (message: string, type?: 'success' | 'error') => void;
}

/** How a learner is doing, in the one word the roster leads with. */
type Status = 'finished' | 'overdue' | 'started' | 'not-started' | 'off';

/**
 * Where one assignment stands: turned off, finished, overdue, started or not started — checked in
 * that order.
 */
function statusOf(assignment: Assignment): Status {
  if (assignment.revokedAt) return 'off';

  const total = assignment.totalSections ?? 0;
  const done = assignment.completedSections ?? 0;
  if (total > 0 && done >= total) return 'finished';

  const overdue =
    assignment.dueDate !== null && new Date(assignment.dueDate).getTime() < Date.now();
  if (overdue) return 'overdue';

  return done > 0 ? 'started' : 'not-started';
}

const STATUS_LABEL: Record<Status, string> = {
  finished: 'Finished',
  overdue: 'Overdue',
  started: 'In progress',
  'not-started': 'Not started',
  off: 'Turned off',
};

const STATUS_CLASS: Record<Status, string> = {
  finished: 'bg-navy text-white',
  overdue: 'bg-danger text-white',
  started: 'bg-gray-500 text-white',
  'not-started': 'bg-gray-300 text-dark-gray',
  off: 'bg-gray-300 text-dark-gray',
};

/** Worst first, so the people who need chasing are at the top. */
const STATUS_ORDER: Status[] = ['overdue', 'not-started', 'started', 'finished', 'off'];

/** Who has been given which course, and how far each of them has got. */
const AssignedLearning = ({ onNotify }: AssignedLearningProps) => {
  const [courses, setCourses] = useState<AssignedCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [openCourseId, setOpenCourseId] = useState<string | null>(null);
  const [roster, setRoster] = useState<Assignment[]>([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [search, setSearch] = useState('');

  const fetchCourses = useCallback(async () => {
    try {
      setLoading(true);
      setCourses(await assignmentApi.listAssignedCourses());
    } catch (err) {
      logger.error('Error loading assigned learning:', err);
      onNotify('Failed to load assigned learning', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchRoster = useCallback(async (courseId: string) => {
    try {
      setRosterLoading(true);
      setRoster(await assignmentApi.list({ courseId }));
    } catch (err) {
      logger.error('Error loading the roster:', err);
      onNotify('Failed to load who has this course', 'error');
    } finally {
      setRosterLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCourses();
  }, [fetchCourses]);

  useEffect(() => {
    if (openCourseId) fetchRoster(openCourseId);
  }, [openCourseId, fetchRoster]);

  const openCourse = courses.find((course) => course.courseId === openCourseId) ?? null;

  const sortedRoster = useMemo(
    () =>
      [...roster].sort(
        (a, b) => STATUS_ORDER.indexOf(statusOf(a)) - STATUS_ORDER.indexOf(statusOf(b)),
      ),
    [roster],
  );

  const visibleCourses = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return courses;
    return courses.filter((course) => course.title.toLowerCase().includes(query));
  }, [courses, search]);

  /*
    Lessons above, quiz sets below.

    They arrive in one list because they are handed out and chased the same way,
    but they do not read the same way. A quiz set's sections are authoring
    furniture — one row per quiz — so "Sections: 4" beside a quiz set is a number
    about the plumbing, and mixed into a grid of lessons it invites the reader to
    compare it with a lesson's four chapters. Splitting is cheaper than teaching
    every figure on the card to mean two things.

    Anything with no kind at all is filed as a lesson: that is what every course
    was before quiz sets existed, and it is what an older payload means.
  */
  const lessonCards = visibleCourses.filter((course) => course.kind !== 'QUIZ_SET');
  const quizCards = visibleCourses.filter((course) => course.kind === 'QUIZ_SET');

  // ---- One course's roster ----
  if (openCourse) {
    const percent =
      openCourse.assignedCount === 0
        ? 0
        : Math.round((openCourse.completedCount / openCourse.assignedCount) * 100);

    return (
      <div className="flex flex-col gap-6">
        <Button
          onClick={() => setOpenCourseId(null)}
          variant="ghost"
          className="w-fit gap-2 px-0 text-dark-gray hover:text-green-hover"
        >
          <ArrowLeftIcon className="w-5 h-5" /> All assigned courses
        </Button>

        <Card className="bg-light-gray shadow-sm">
          <CardHeader className="p-4">
            <CardTitle className="text-lg text-dark-gray">{openCourse.title}</CardTitle>
            <p className="text-sm text-dark-gray">
              {openCourse.totalSections} section{openCourse.totalSections === 1 ? '' : 's'} ·{' '}
              {openCourse.assignedCount} assigned
            </p>
          </CardHeader>

          <CardContent className="flex flex-wrap items-center gap-8">
            <ProgressDonut
              percent={percent}
              size={100}
              caption={`${openCourse.completedCount} of ${openCourse.assignedCount} finished`}
            />

            {openCourse.overdueCount > 0 && (
              <p className="flex items-center gap-2 font-medium text-danger">
                <ExclamationTriangleIcon className="w-5 h-5" />
                {openCourse.overdueCount} overdue
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="bg-light-gray shadow-sm">
          <CardHeader className="p-4">
            <CardTitle className="text-lg text-dark-gray">Learners</CardTitle>
            <p className="text-sm text-dark-gray">
              Whoever needs chasing is at the top. Progress is per section.
            </p>
          </CardHeader>

          <CardContent>
            {rosterLoading ? (
              <p className="py-8 text-center text-dark-gray">Loading...</p>
            ) : sortedRoster.length === 0 ? (
              <p className="py-8 text-center text-dark-gray">Nobody holds this course any more.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {sortedRoster.map((entry) => {
                  const status = statusOf(entry);

                  return (
                    <li
                      key={entry.id}
                      className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-300
                        bg-white px-4 py-3"
                    >
                      <span className="min-w-48 flex-1">
                        <span className="block break-words font-semibold text-dark-gray">
                          {entry.name || entry.email}
                        </span>
                        {entry.name && (
                          <span className="block break-words text-sm text-dark-gray">
                            {entry.email}
                          </span>
                        )}
                        <span className="block text-xs text-dark-gray">
                          {entry.completedSections ?? 0}/{entry.totalSections ?? 0} sections
                          {entry.dueDate &&
                            ` · due ${new Date(entry.dueDate).toLocaleDateString()}`}
                          {entry.lastActivityAt
                            ? ` · last seen ${new Date(entry.lastActivityAt).toLocaleDateString()}`
                            : ' · never opened'}
                        </span>
                      </span>

                      {/* A bar rather than a ring: the roster is a list, and a
                          row of rings would out-shout the names beside them. */}
                      <span className="w-40 shrink-0">
                        <span className="block h-2 overflow-hidden rounded-full bg-gray-300">
                          <span
                            className="block h-full rounded-full bg-[#5b9748]"
                            style={{ width: `${entry.percentComplete ?? 0}%` }}
                          />
                        </span>
                        <span className="mt-1 block text-xs text-dark-gray">
                          {entry.percentComplete ?? 0}%
                        </span>
                      </span>

                      <Badge className={`shrink-0 px-2 ${STATUS_CLASS[status]}`}>
                        {STATUS_LABEL[status]}
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/*
          No AssignPanel here on purpose.

          Work is handed out from the course's own Access pane, where whoever is
          sending it has the course in front of them — what is in it, whether it
          is published, what deadline it carries. This page is the other half of
          that: it reports who holds what and how far they have got. Offering to
          assign from a summary screen meant a course could be sent by somebody
          reading a progress figure, which is the wrong moment and the wrong
          information to be deciding on.
        */}
      </div>
    );
  }

  /** One row of the two grids below. Identical for a lesson and a quiz set —
      what differs is the heading it is filed under. */
  const card = (course: AssignedCourse) => {
    const cover = imageSrc(course.imageData, course.imageType);
    const percent =
      course.assignedCount === 0
        ? 0
        : Math.round((course.completedCount / course.assignedCount) * 100);

    return (
      <Card
        key={course.courseId}
        onClick={() => setOpenCourseId(course.courseId)}
        className="flex cursor-pointer flex-col gap-0 overflow-hidden bg-light-gray p-0 shadow-sm
          transition-all duration-300 hover:-translate-y-1 hover:shadow-lg"
      >
        <div className="flex h-28 items-center justify-center overflow-hidden bg-navy/10">
          {cover ? (
            <img src={cover} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="text-sm text-dark-gray">No photo</span>
          )}
        </div>

        <CardHeader className="p-4">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="break-words text-lg text-dark-gray">{course.title}</CardTitle>
            {!course.published && <Badge className="bg-gray-400 px-2 text-white">Draft</Badge>}
            {course.overdueCount > 0 && (
              <Badge className="bg-danger px-2 text-white">{course.overdueCount} overdue</Badge>
            )}
          </div>

          <p className="mt-2 text-sm text-dark-gray">
            {course.assignedCount === 0
              ? 'Not handed to anyone yet'
              : `${course.completedCount} of ${course.assignedCount} finished`}
          </p>
          <span className="mt-1 block h-2 overflow-hidden rounded-full bg-gray-300">
            <span
              className="block h-full rounded-full bg-[#5b9748]"
              style={{ width: `${percent}%` }}
            />
          </span>
        </CardHeader>

        <CardContent
          className="flex items-center justify-between border-t border-gray-300 p-4 text-sm
            font-medium text-dark-gray"
        >
          <span>Assigned: {course.assignedCount}</span>
          {/* A quiz set stores one section per quiz, so the same figure is a
                count of quizzes there and of chapters on a lesson. Naming it
                for what it counts is the difference between the number meaning
                something and the reader having to know the schema. */}
          <span>
            {course.kind === 'QUIZ_SET' ? 'Quizzes' : 'Sections'}: {course.totalSections}
          </span>
        </CardContent>
      </Card>
    );
  };

  // ---- Card grid ----
  if (loading) {
    return <p className="py-8 text-center text-dark-gray">Loading assigned learning...</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search your courses..."
        className="max-w-md bg-white text-dark-gray"
      />

      {courses.length === 0 ? (
        <Card className="bg-light-gray">
          <CardContent className="py-16 text-center">
            <p>You have not created a course yet, and none has been shared with you.</p>
          </CardContent>
        </Card>
      ) : visibleCourses.length === 0 ? (
        <Card className="bg-light-gray">
          <CardContent className="py-16 text-center">
            <p>No course matches &ldquo;{search}&rdquo;.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-8">
          {/* Lessons first, quiz sets under them. Each section is drawn only
      when it has something in it, so an author who writes only lessons
      never sees an empty Quizzes heading. */}
          {lessonCards.length > 0 && (
            <section>
              <h2 className="mb-3 text-xl font-bold text-dark-gray">
                Courses{` (${lessonCards.length})`}
              </h2>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-6">
                {lessonCards.map(card)}
              </div>
            </section>
          )}

          {quizCards.length > 0 && (
            <section>
              <h2 className="mb-3 text-xl font-bold text-dark-gray">
                Quizzes{` (${quizCards.length})`}
              </h2>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-6">
                {quizCards.map(card)}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
};

export default AssignedLearning;
