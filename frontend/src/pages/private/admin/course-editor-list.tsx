/**
 * File: course-editor-list.tsx
 * Description: The Course Editor page for contributors.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
/**
 * CourseEditorList - the Course Editor page for contributors.
 *
 * Shows only the courses this person was named on. They cannot create a course,
 * so there is no new-lesson box; picking a card opens the same editor a global
 * author uses.
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Course, imageSrc } from '@/services/curriculum-api';
import HttpHelper from '@/utils/http-helper';
import { logger } from '@/utils/logger';

/**
 * The Course Editor page for contributors: the courses they have been named on, each opening the
 * editor.
 */
const CourseEditorList = () => {
  const navigate = useNavigate();
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const response = await HttpHelper.get('curriculum/courses/editable');
      setCourses(response.courses ?? []);
    } catch (err) {
      logger.error('Error loading courses:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="page-container flex flex-col">
        <div className="text-center">Loading your courses...</div>
      </div>
    );
  }

  return (
    <div className="page-container flex flex-col">
      <header className="responsive-page-header">
        <h1 className="page-title font-bold text-dark-gray mb-2">Course Editor</h1>
        <p className="page-subtitle text-dark-gray font-medium">
          Courses you have been given access to edit.
        </p>
      </header>

      <hr className="mt-4 mb-8 h-0.5 border-t-0 bg-navy" />

      {courses.length === 0 ? (
        <Card className="bg-light-gray">
          <CardContent className="py-16 text-center">
            <p>You are not set up to edit any courses yet.</p>
            <p className="mt-2 text-sm text-dark-gray">
              An admin can add you as a contributor from a course&rsquo;s editor.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-6">
          {courses.map((course) => {
            const cover = imageSrc(course.imageData, course.imageType);
            const quizCount = course.sections.reduce((s, m) => s + m.quizzes.length, 0);

            return (
              <Card
                key={course.id}
                onClick={() => navigate(`/admin/learning/${course.id}`)}
                className="flex aspect-[4/5] cursor-pointer flex-col gap-0 overflow-hidden
                  bg-light-gray p-0 shadow-sm transition-all duration-300 hover:-translate-y-1
                  hover:shadow-lg"
              >
                <div className="flex min-h-0 flex-1 flex-col">
                  <div className="flex h-1/2 items-center justify-center overflow-hidden bg-navy/10">
                    {cover ? (
                      <img src={cover} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-sm text-dark-gray">No photo</span>
                    )}
                  </div>
                  <CardHeader className="p-4">
                    <CardTitle className="break-words text-lg text-dark-gray">
                      {course.title}
                    </CardTitle>
                    {!course.published && (
                      <Badge className="mt-2 w-fit bg-gray-400 px-2 text-white">Draft</Badge>
                    )}
                  </CardHeader>
                </div>

                <CardContent
                  className="flex items-center justify-between border-t border-gray-300 p-4 text-sm
                    font-medium text-dark-gray"
                >
                  <span>Sections: {course.sections.length}</span>
                  <span>Quizzes: {quizCount}</span>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default CourseEditorList;
