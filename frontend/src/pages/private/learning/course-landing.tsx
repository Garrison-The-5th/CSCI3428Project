/**
 * File: course-landing.tsx
 * Description: The overview a learner sees after picking a course card.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
/**
 * CourseLanding - the overview a learner sees after picking a course card.
 *
 * Left column : header (title, short description, tags, authors, dates,
 *               languages), "What you'll learn", collapsible module preview,
 *               prerequisites, full description, instructors.
 * Right column: cover photo, a button into the player, and the course totals.
 */
import {
  ArrowLeftIcon,
  CheckIcon,
  ChevronDownIcon,
  ClockIcon,
  DocumentTextIcon,
  PlayCircleIcon,
  QuestionMarkCircleIcon,
} from '@heroicons/react/24/outline';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { plainPreview } from '@/components/common/element-view';
import { NewBadge, newMarkers } from '@/components/common/new-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Course,
  courseStats,
  imageSrc,
  moduleContent,
  NewIds,
  sectionGroups,
} from '@/services/curriculum-api';
import { useLearnerApi } from '@/services/learner-api';
import { logger } from '@/utils/logger';

function formatMinutes(minutes: number): string {
  if (minutes <= 0) return '0 min';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hour${hours === 1 ? '' : 's'}` : `${hours} h ${rest} min`;
}

interface CourseLandingProps {
  /** Renders this course instead of fetching, for the authoring preview. */
  previewCourse?: Course;
  /** Preview drops the back link and makes the Course content button inert. */
  preview?: boolean;
}

const CourseLanding = ({ previewCourse, preview = false }: CourseLandingProps) => {
  const api = useLearnerApi();
  const { courseId } = useParams<{ courseId: string }>();
  const navigate = useNavigate();
  const [fetched, setFetched] = useState<Course | null>(null);
  const [newIds, setNewIds] = useState<NewIds | null>(null);
  const course = previewCourse ?? fetched;
  const [loading, setLoading] = useState(!previewCourse);
  const [error, setError] = useState<string | null>(null);
  const [openModuleId, setOpenModuleId] = useState<string | null>(null);

  const fetchCourse = useCallback(async () => {
    // Preview is handed its course directly; there is nothing to load.
    if (previewCourse || !courseId) return;
    try {
      setLoading(true);
      setError(null);
      // One call for both kinds of visitor: a link holder can have been part
      // way through when a new version went live just as a member can.
      const withNew = await api.getCourseWithNewIds(courseId);
      setFetched(withNew?.course ?? null);
      setNewIds(withNew?.newIds ?? null);
    } catch (err) {
      logger.error('Error loading course:', err);
      setError('Failed to load this course');
    } finally {
      setLoading(false);
    }
  }, [courseId, previewCourse]);

  useEffect(() => {
    fetchCourse();
  }, [fetchCourse]);

  if (loading) {
    return (
      <div className="page-container flex flex-col">
        <div className="text-center">Loading course...</div>
      </div>
    );
  }

  if (error || !course) {
    return (
      <div className="page-container flex flex-col">
        <Link to="/learning" className="mb-4 w-fit text-dark-gray hover:text-green">
          ← All courses
        </Link>
        <Card className="bg-light-gray">
          <CardContent className="py-16 text-center">
            <p>{error ?? 'Course not found.'}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const stats = courseStats(course);
  const groups = sectionGroups(course);
  const isNew = newMarkers(newIds);
  const cover = imageSrc(course.imageData, course.imageType);
  const updated = new Date(course.updatedAt).toLocaleDateString();
  const published = course.publishedAt ? new Date(course.publishedAt).toLocaleDateString() : null;

  const bulletList = (items: string[]) => (
    <ul className="flex flex-col gap-2">
      {items.map((item, index) => (
        <li key={index} className="flex items-start gap-2 text-dark-gray">
          <CheckIcon className="mt-1 w-4 h-4 shrink-0 text-green" />
          <span className="min-w-0 break-words">{item}</span>
        </li>
      ))}
    </ul>
  );

  return (
    <div className={preview ? 'flex flex-col' : 'page-container flex flex-col'}>
      {!preview && (
        <Button
          onClick={() => navigate('/learning')}
          variant="ghost"
          className="mb-4 w-fit gap-2 px-0 text-dark-gray hover:text-green-hover"
        >
          <ArrowLeftIcon className="w-5 h-5" /> All courses
        </Button>
      )}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* ---- Main column ---- */}
        {/* min-w-0 lets this column shrink; without it wide content stretches the
            grid track and pushes the sidebar card off screen. */}
        <div className="flex min-w-0 flex-col gap-6">
          {/* Course header */}
          <header>
            <h1 className="page-hero-title break-words font-bold text-dark-gray">{course.title}</h1>

            {course.shortDescription && (
              <p className="mt-3 break-words text-lg text-dark-gray">{course.shortDescription}</p>
            )}

            {course.tags.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {course.tags.map((tag) => (
                  <Badge
                    key={tag}
                    variant="outline"
                    className="border-2 border-navy px-2 text-navy"
                  >
                    {tag}
                  </Badge>
                ))}
              </div>
            )}

            {course.instructors.length > 0 && (
              <p className="mt-4 text-dark-gray">
                <span className="font-semibold">
                  {course.instructors.length === 1 ? 'Author' : 'Authors'}:
                </span>{' '}
                {course.instructors.map((person) => person.name).join(', ')}
              </p>
            )}

            <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-dark-gray">
              <span>Last updated {updated}</span>
              {published && <span>Published {published}</span>}
              {course.languages.length > 0 && <span>{course.languages.join(', ')}</span>}
            </p>
          </header>

          {/* What you'll learn */}
          {course.whatYouWillLearn.length > 0 && (
            <Card className="border-2 border-navy/30 bg-light-gray shadow-sm">
              <CardHeader className="p-4">
                <CardTitle className="text-lg text-dark-gray">What you&rsquo;ll learn</CardTitle>
              </CardHeader>
              <CardContent>{bulletList(course.whatYouWillLearn)}</CardContent>
            </Card>
          )}

          {/* Module preview, grouped into the sections that number them */}
          <Card className="bg-light-gray shadow-sm">
            <CardHeader className="p-4">
              <CardTitle className="text-lg text-dark-gray">Course content</CardTitle>
              <p className="text-sm text-dark-gray">
                {course.sections.length} section{course.sections.length === 1 ? '' : 's'} ·{' '}
                {course.modules.length} module{course.modules.length === 1 ? '' : 's'} ·{' '}
                {formatMinutes(stats.totalMinutes)} total
              </p>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {course.modules.length === 0 ? (
                <p className="text-dark-gray">No modules yet.</p>
              ) : (
                groups.map((group) => (
                  <div key={group.section.id} className="flex flex-col gap-2">
                    <h3
                      className="flex flex-wrap items-center gap-2 break-words font-semibold
                        text-dark-gray"
                    >
                      <span>
                        {group.section.number}. {group.section.title}
                      </span>
                      {isNew.section(group.section.id) && <NewBadge />}
                    </h3>

                    {group.modules.length === 0 && (
                      <p className="text-sm text-dark-gray">Nothing in this section yet.</p>
                    )}

                    {group.modules.map((module) => {
                      const isOpen = openModuleId === module.id;

                      return (
                        <div key={module.id} className="rounded-lg border border-gray-300 bg-white">
                          <button
                            onClick={() => setOpenModuleId(isOpen ? null : module.id)}
                            className="flex w-full items-center gap-3 px-4 py-3 text-left"
                            aria-expanded={isOpen}
                          >
                            <ChevronDownIcon
                              className={`w-5 h-5 shrink-0 text-dark-gray transition-transform
                                duration-200 ${isOpen ? 'rotate-180' : ''}`}
                            />
                            <span className="min-w-0 flex-1">
                              <span
                                className="flex flex-wrap items-center gap-2 break-words
                                  font-semibold text-dark-gray"
                              >
                                <span>
                                  {module.number} {module.title}
                                </span>
                                {isNew.module(module.id, module.sectionId) && <NewBadge />}
                              </span>
                              <span className="block text-sm text-dark-gray">
                                {module.elements.length} item
                                {module.elements.length === 1 ? '' : 's'}
                                {module.quizzes.length > 0 &&
                                  ` · ${module.quizzes.length} quiz${module.quizzes.length === 1 ? '' : 'zes'}`}{' '}
                                · {formatMinutes(module.estimatedMinutes)}
                              </span>
                            </span>
                          </button>

                          {isOpen && (
                            <ul className="border-t border-gray-300 px-4 py-3">
                              {moduleContent(module).map((item) => (
                                <li
                                  key={item.id}
                                  className="flex items-center gap-2 py-1 text-sm text-dark-gray"
                                >
                                  {item.kind === 'quiz' ? (
                                    <QuestionMarkCircleIcon className="w-4 h-4 shrink-0" />
                                  ) : item.element.type === 'YOUTUBE' ? (
                                    <PlayCircleIcon className="w-4 h-4 shrink-0" />
                                  ) : (
                                    <DocumentTextIcon className="w-4 h-4 shrink-0" />
                                  )}
                                  <span className="min-w-0 flex-1 truncate">
                                    {item.kind === 'quiz'
                                      ? plainPreview(item.quiz.title, 70)
                                      : item.element.type === 'TEXT'
                                        ? plainPreview(item.element.textContent ?? 'Article')
                                        : item.element.type === 'YOUTUBE'
                                          ? plainPreview(item.element.videoUrl ?? 'Video')
                                          : plainPreview(
                                              item.element.fileName ?? item.element.type,
                                            )}
                                  </span>
                                  {item.kind === 'quiz' ? (
                                    <span className="shrink-0">
                                      {item.quiz.questions.length} question
                                      {item.quiz.questions.length === 1 ? '' : 's'}
                                    </span>
                                  ) : item.element.durationMinutes ? (
                                    <span className="shrink-0">
                                      {item.element.durationMinutes} min
                                    </span>
                                  ) : null}
                                </li>
                              ))}
                              {moduleContent(module).length === 0 && (
                                <li className="py-1 text-sm text-dark-gray">
                                  Nothing in here yet.
                                </li>
                              )}
                            </ul>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {/* Prerequisites */}
          {course.prerequisites.length > 0 && (
            <Card className="bg-light-gray shadow-sm">
              <CardHeader className="p-4">
                <CardTitle className="text-lg text-dark-gray">Prerequisites</CardTitle>
              </CardHeader>
              <CardContent>{bulletList(course.prerequisites)}</CardContent>
            </Card>
          )}

          {/* Full description */}
          {course.description && (
            <Card className="bg-light-gray shadow-sm">
              <CardHeader className="p-4">
                <CardTitle className="text-lg text-dark-gray">Description</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap break-words text-dark-gray">
                  {course.description}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Instructors */}
          {course.instructors.length > 0 && (
            <Card className="bg-light-gray shadow-sm">
              <CardHeader className="p-4">
                <CardTitle className="text-lg text-dark-gray">
                  {course.instructors.length === 1 ? 'Instructor' : 'Instructors'}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-6">
                {course.instructors.map((person) => {
                  const photo = imageSrc(person.photoData, person.photoType);

                  return (
                    <div key={person.id} className="flex flex-wrap items-start gap-4">
                      <div
                        className="flex h-24 w-24 shrink-0 items-center justify-center
                          overflow-hidden rounded-full border border-gray-300 bg-white"
                      >
                        {photo ? (
                          <img src={photo} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <span className="text-2xl font-bold text-navy">
                            {person.name.charAt(0).toUpperCase()}
                          </span>
                        )}
                      </div>
                      <div className="min-w-60 flex-1">
                        <p className="text-lg font-semibold text-dark-gray">{person.name}</p>
                        {person.title && (
                          <p className="text-sm font-medium text-dark-gray">{person.title}</p>
                        )}
                        {person.bio && (
                          <p className="mt-2 whitespace-pre-wrap break-words text-dark-gray">
                            {person.bio}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}
        </div>

        {/* ---- Sidebar ---- */}
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <Card className="gap-0 overflow-hidden bg-light-gray p-0 shadow-lg">
            <div
              className="flex aspect-video items-center justify-center overflow-hidden bg-navy/10"
            >
              {cover ? (
                <img src={cover} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="text-sm text-dark-gray">No photo</span>
              )}
            </div>

            <CardContent className="flex flex-col gap-4 p-4">
              <Button
                onClick={() => !preview && navigate(`/learning/${course.id}/content`)}
                title={preview ? 'Disabled while previewing' : undefined}
                className="w-full bg-navy py-6 text-md text-white hover:bg-navbar-hover"
              >
                Course content
              </Button>

              <p className="text-sm font-semibold text-dark-gray">This course includes:</p>
              <ul className="flex flex-col gap-2 text-sm text-dark-gray">
                <li className="flex items-center gap-2">
                  <PlayCircleIcon className="w-5 h-5 shrink-0" />
                  {formatMinutes(stats.videoMinutes)} of video
                </li>
                <li className="flex items-center gap-2">
                  <DocumentTextIcon className="w-5 h-5 shrink-0" />
                  {stats.articles} article{stats.articles === 1 ? '' : 's'}
                </li>
                <li className="flex items-center gap-2">
                  <QuestionMarkCircleIcon className="w-5 h-5 shrink-0" />
                  {stats.quizzes} quiz{stats.quizzes === 1 ? '' : 'zes'}
                </li>
                <li className="flex items-center gap-2">
                  <ClockIcon className="w-5 h-5 shrink-0" />
                  {formatMinutes(stats.totalMinutes)} total
                </li>
              </ul>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
};

export default CourseLanding;
