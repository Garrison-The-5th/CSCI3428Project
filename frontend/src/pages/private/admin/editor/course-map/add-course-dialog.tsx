/**
 * File: add-course-dialog.tsx
 * Description: Search for another course to bring into staging.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-09-22
 */
/**
 * Pulling another course's training onto this map.
 *
 * Only courses this person made or was named on are listed, which is the same
 * rule that decides what appears on their Create a Lesson page — bringing a
 * course into staging puts its sections in front of somebody about to place
 * them, and that is a form of reading it. Courses already in staging are left
 * out rather than shown greyed, because the only useful answer to "can I add
 * this" here is the list of things that can be.
 */
import { MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { courseMapApi, type ImportableCourse } from '@/services/course-map-api';
import { logger } from '@/utils/logger';

interface AddCourseDialogProps {
  open: boolean;
  courseId: string;
  onClose: () => void;
  onAdd: (sourceCourseId: string) => Promise<void>;
}

/** Searches for another course to bring into this map's staging. */
const AddCourseDialog = ({ open, courseId, onClose, onAdd }: AddCourseDialogProps) => {
  const [courses, setCourses] = useState<ImportableCourse[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  /** The row being added, so only its own button reports the wait. */
  const [adding, setAdding] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setLoading(true);
    setQuery('');

    courseMapApi
      .availableCourses(courseId)
      .then((result) => !cancelled && setCourses(result.courses ?? []))
      .catch((err) => logger.error('Error loading courses to stage:', err))
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [open, courseId]);

  if (!open) return null;

  const needle = query.trim().toLowerCase();
  const shown = needle
    ? courses.filter((course) => course.title.toLowerCase().includes(needle))
    : courses;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Add a course to staging"
      onClick={onClose}
    >
      <Card
        className="w-full max-w-xl bg-white"
        onClick={(event: React.MouseEvent) => event.stopPropagation()}
      >
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-lg font-semibold text-dark-gray">Add a course to staging</h2>
            <Button onClick={onClose} variant="ghost" size="icon" title="Close">
              <XMarkIcon className="w-5 h-5" />
            </Button>
          </div>

          <div className="relative mt-3">
            <MagnifyingGlassIcon
              className="absolute top-1/2 left-3 w-5 h-5 -translate-y-1/2 text-dark-gray"
            />
            <Input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search your courses"
              className="bg-light-gray pl-10"
            />
          </div>

          <ul className="mt-3 flex max-h-80 flex-col gap-2 overflow-y-auto">
            {loading && <li className="py-6 text-center text-sm text-dark-gray">Loading…</li>}

            {!loading && shown.length === 0 && (
              <li className="py-6 text-center text-sm text-dark-gray">
                {courses.length === 0
                  ? 'Every course you can edit is already in staging.'
                  : 'No course matches that.'}
              </li>
            )}

            {shown.map((course) => (
              <li
                key={course.id}
                className="flex items-center gap-3 rounded-lg border border-navy/20 bg-light-gray
                  px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-dark-gray">{course.title}</p>
                  {/* Counted in the unit the course is actually made of: a quiz
                      set stores one section per quiz, so calling its four exams
                      "4 sections" describes the schema rather than the thing
                      about to be dragged onto the map. */}
                  <p className="truncate text-xs text-dark-gray">
                    {course.sectionCount}{' '}
                    {course.kind === 'QUIZ_SET'
                      ? `quiz${course.sectionCount === 1 ? '' : 'zes'}`
                      : `section${course.sectionCount === 1 ? '' : 's'}`}
                    {course.shortDescription ? ` · ${course.shortDescription}` : ''}
                  </p>
                </div>
                <Button
                  onClick={async () => {
                    setAdding(course.id);
                    await onAdd(course.id);
                    setAdding(null);
                  }}
                  disabled={adding !== null}
                  className="shrink-0 bg-navy text-white hover:bg-navy-hover"
                >
                  {adding === course.id ? 'Adding…' : 'Add to staging'}
                </Button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
};

export default AddCourseDialog;
