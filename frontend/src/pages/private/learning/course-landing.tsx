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
 *               languages), "What you'll learn", collapsible section preview,
 *               prerequisites, full description, instructors.
 * Right column: cover photo, a button into the player, and the course totals.
 */
import {
  ArrowLeftIcon,
  ArrowRightCircleIcon,
  CheckCircleIcon,
  CheckIcon,
  ChevronDownIcon,
  ClockIcon,
  DocumentTextIcon,
  LockClosedIcon,
  PlayCircleIcon,
  QuestionMarkCircleIcon,
} from '@heroicons/react/24/outline';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { plainPreview } from '@/components/common/element-view';
import { NewBadge, newMarkers } from '@/components/common/new-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  flattenCourse,
  hasStartedCourse,
  itemDoneFor,
  itemId,
  moduleUnlocked,
  NO_PROGRESS,
  resumeItem,
  sectionUnlocked,
  unlockedItemIds,
} from '@/services/course-progress';
import {
  Course,
  courseStats,
  imageSrc,
  LearnerProgress,
  moduleGroups,
  NewIds,
  sectionContent,
} from '@/services/curriculum-api';
import { useLearnerApi } from '@/services/learner-api';
import { logger } from '@/utils/logger';

/** A duration for display: "45 min", "2 hours" or "1 h 30 min". */
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

/**
 * The overview a learner sees after picking a course card: description, outcomes, prerequisites,
 * length, deadline and a Start/Continue button. With `preview` it shows an author's draft.
 */
const CourseLanding = ({ previewCourse, preview = false }: CourseLandingProps) => {
  const api = useLearnerApi();
  const { courseId } = useParams<{ courseId: string }>();
  const navigate = useNavigate();
  const [fetched, setFetched] = useState<Course | null>(null);
  const [newIds, setNewIds] = useState<NewIds | null>(null);
  const course = previewCourse ?? fetched;
  const [loading, setLoading] = useState(!previewCourse);
  const [error, setError] = useState<string | null>(null);
  const [openSectionId, setOpenSectionId] = useState<string | null>(null);
  /**
   * How far they have got. Needed here as well as in the player now that the
   * content box is a set of shortcuts: a link that jumps into locked content
   * would be a worse dead end than no link at all.
   */
  const [progress, setProgress] = useState<LearnerProgress>(NO_PROGRESS);

  const fetchCourse = useCallback(async () => {
    // Preview is handed its course directly; there is nothing to load.
    if (previewCourse || !courseId) return;
    try {
      setLoading(true);
      setError(null);
      // One call for both kinds of visitor: a link holder can have been part
      // way through when a new version went live just as a member can.
      const [withNew, learnerProgress] = await Promise.all([
        api.getCourseWithNewIds(courseId),
        // Progress is a nicety here rather than the point of the page, so a
        // failure to read it leaves the shortcuts locked rather than the page
        // broken.
        api.getProgress().catch(() => NO_PROGRESS),
      ]);
      setFetched(withNew?.course ?? null);
      setNewIds(withNew?.newIds ?? null);
      setProgress(learnerProgress);
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

  /**
   * The course flattened into reading order, and what that opens.
   *
   * In the authoring preview there is no progress to read, so a sequential
   * course shows everything past the first item locked — which is exactly what
   * a learner arriving fresh would see, and the honest thing to preview.
   */
  const items = useMemo(() => (course ? flattenCourse(course) : []), [course]);

  /**
   * Past its deadline, this course is shut.
   *
   * The server decides it — `locked` comes back on the course — because a lock
   * worked out from the browser's clock is one the learner can move, and that
   * clock is not the one their deadline was set against.
   *
   * An author previewing their own course is never locked out of it: a deadline
   * belongs to a learner's assignment, and there is no assignment behind a
   * preview.
   */
  const locked = !preview && course?.locked === true;

  /**
   * Nothing is unlocked once the deadline has gone, which is what closes every
   * shortcut in the content box at once. They already draw a padlock and refuse
   * a click for anything outside this set, so a closed course reuses the whole
   * of that rather than growing a second disabled state alongside it.
   */
  const unlocked = useMemo(
    () => (course && !locked ? unlockedItemIds(course, items, progress) : new Set<string>()),
    [course, items, progress, locked],
  );

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
  const groups = moduleGroups(course);
  const isNew = newMarkers(newIds);
  const cover = imageSrc(course.imageData, course.imageType);
  const updated = new Date(course.updatedAt).toLocaleDateString();
  const published = course.publishedAt ? new Date(course.publishedAt).toLocaleDateString() : null;

  const itemDone = itemDoneFor(course, progress);
  const started = hasStartedCourse(course, progress);

  const dueOn = course.dueDate ? new Date(course.dueDate).toLocaleDateString() : null;

  /** Why a shortcut is doing nothing, when it is the deadline doing it. */
  const lockedReason = dueOn
    ? `This course closed on ${dueOn} and can no longer be opened`
    : 'This course has closed and can no longer be opened';

  /**
   * Opening the player at a particular item.
   *
   * The item id goes in the URL rather than in navigation state so a shortcut
   * survives a reload and can be copied to somebody — and so the player has one
   * way of being told where to start rather than two.
   */
  const openAt = (id?: string) => {
    // Belt as well as braces. Every shortcut below is disabled once the deadline
    // has passed, but they are disabled in a dozen places and this is one — so
    // the refusal lives at the single door rather than only on the handles.
    if (preview || locked) return;
    navigate(`/learning/${course.id}/content${id ? `?item=${encodeURIComponent(id)}` : ''}`);
  };

  /** Where Continue drops them: the last thing they actually opened. */
  const resumeAt = resumeItem(course, items, unlocked, progress);

  /** A ticked bullet list, for outcomes and prerequisites. */
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

          {/*
            Course content — also the way in.
            Every row here is a shortcut into the player: a module heading jumps
            to the start of that module, a section heading to that section, and a
            line inside an open section straight to that item. Anything the
            learner has not reached yet carries a padlock on the right of its
            title and does nothing when clicked, so the shortcut can never take
            somebody somewhere the player would refuse to show them.
          */}
          <Card className="bg-light-gray shadow-sm">
            <CardHeader className="p-4">
              <CardTitle className="text-lg text-dark-gray">Course content</CardTitle>
              <p className="text-sm text-dark-gray">
                {course.modules.length} module{course.modules.length === 1 ? '' : 's'} ·{' '}
                {course.sections.length} section{course.sections.length === 1 ? '' : 's'} ·{' '}
                {formatMinutes(stats.totalMinutes)} total
              </p>
              {!preview && course.sections.length > 0 && (
                <p className={`text-sm ${locked ? 'font-medium text-danger' : 'text-dark-gray'}`}>
                  {locked
                    ? dueOn
                      ? `Closed on ${dueOn}. Nothing here can be opened.`
                      : 'Closed. Nothing here can be opened.'
                    : course.sequential
                      ? 'Pick anything you have reached to jump straight to it.'
                      : 'Pick anything to jump straight to it.'}
                </p>
              )}
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {course.sections.length === 0 ? (
                <p className="text-dark-gray">No sections yet.</p>
              ) : (
                groups.map((group) => {
                  const moduleOpen = moduleUnlocked(course, items, unlocked, group.sections);
                  // Where a click on the module heading lands: the first thing
                  // inside it they can actually open.
                  const moduleEntry =
                    items.find(
                      (item) =>
                        group.sections.some((section) => section.id === item.sectionId) &&
                        unlocked.has(itemId(item)),
                    ) ?? null;

                  return (
                    <div key={group.module.id} className="flex flex-col gap-2">
                      <button
                        onClick={() => moduleEntry && openAt(itemId(moduleEntry))}
                        disabled={preview || !moduleOpen || !moduleEntry}
                        title={
                          locked
                            ? lockedReason
                            : moduleOpen
                              ? preview
                                ? 'Disabled while previewing'
                                : `Go to ${group.module.title}`
                              : 'Finish the previous module to open this one'
                        }
                        className={`flex w-full items-center gap-2 rounded-md px-1 py-1 text-left ${
                          moduleOpen && moduleEntry && !preview
                            ? 'cursor-pointer hover:bg-white/60'
                            : 'cursor-default'
                          }`}
                      >
                        <span
                          className={`flex min-w-0 flex-1 flex-wrap items-center gap-2 break-words
                            font-semibold ${moduleOpen ? 'text-dark-gray' : 'text-dark-gray/50'}`}
                        >
                          <span>
                            {group.module.number}. {group.module.title}
                          </span>
                          {isNew.module(group.module.id) && <NewBadge />}
                        </span>
                        {moduleOpen ? (
                          moduleEntry &&
                          !preview && (
                            <ArrowRightCircleIcon
                              className="w-5 h-5 shrink-0 text-navy"
                              aria-hidden="true"
                            />
                          )
                        ) : (
                          <LockClosedIcon
                            className="w-5 h-5 shrink-0 text-dark-gray/50"
                            aria-label="Locked"
                          />
                        )}
                      </button>

                      {group.sections.length === 0 && (
                        <p className="text-sm text-dark-gray">Nothing in this module yet.</p>
                      )}

                      {group.sections.map((section) => {
                        const isOpen = openSectionId === section.id;
                        const open = sectionUnlocked(course, items, unlocked, section.id);
                        const sectionEntry =
                          items.find(
                            (item) => item.sectionId === section.id && unlocked.has(itemId(item)),
                          ) ?? null;
                        const finished =
                          open &&
                          items
                            .filter((item) => item.sectionId === section.id)
                            .every((item) => itemDone(item));

                        return (
                          <div
                            key={section.id}
                            className="rounded-lg border border-gray-300 bg-white"
                          >
                            <div className="flex w-full items-center gap-1 px-2 py-1">
                              {/* Expanding and jumping are separate targets on
                                  purpose: wanting to see what is inside a section
                                  is not the same as wanting to be taken there. */}
                              <button
                                onClick={() => setOpenSectionId(isOpen ? null : section.id)}
                                className="shrink-0 rounded-md p-2 text-dark-gray
                                  hover:bg-light-gray"
                                aria-expanded={isOpen}
                                aria-label={isOpen ? 'Hide contents' : 'Show contents'}
                              >
                                <ChevronDownIcon
                                  className={`w-5 h-5 transition-transform duration-200
                                    ${isOpen ? 'rotate-180' : ''}`}
                                />
                              </button>

                              <button
                                onClick={() => sectionEntry && openAt(itemId(sectionEntry))}
                                disabled={preview || !open || !sectionEntry}
                                title={
                                  locked
                                    ? lockedReason
                                    : open
                                      ? preview
                                        ? 'Disabled while previewing'
                                        : `Go to ${section.title}`
                                      : 'Finish the item before this one to unlock it'
                                }
                                className={`flex min-w-0 flex-1 items-center gap-3 rounded-md px-2
                                  py-2 text-left ${
                                    open && sectionEntry && !preview
                                      ? 'cursor-pointer hover:bg-light-gray'
                                      : 'cursor-default'
                                  }`}
                              >
                                <span className="min-w-0 flex-1">
                                  <span
                                    className={`flex flex-wrap items-center gap-2 break-words
                                      font-semibold
                                      ${open ? 'text-dark-gray' : 'text-dark-gray/50'}`}
                                  >
                                    <span>
                                      {section.number} {section.title}
                                    </span>
                                    {isNew.section(section.id, section.moduleId) && <NewBadge />}
                                  </span>
                                  <span
                                    className={`block text-sm
                                      ${open ? 'text-dark-gray' : 'text-dark-gray/50'}`}
                                  >
                                    {section.elements.length} item
                                    {section.elements.length === 1 ? '' : 's'}
                                    {section.quizzes.length > 0 &&
                                      ` · ${section.quizzes.length} quiz${section.quizzes.length === 1 ? '' : 'zes'}`}{' '}
                                    · {formatMinutes(section.estimatedMinutes)}
                                  </span>
                                </span>

                                {/* The padlock the spec asks for, on the right of
                                    the title. A finished section gets a tick
                                    instead; one in progress gets the arrow. */}
                                {!open ? (
                                  <LockClosedIcon
                                    className="w-5 h-5 shrink-0 text-dark-gray/50"
                                    aria-label="Locked"
                                  />
                                ) : finished ? (
                                  <CheckCircleIcon
                                    className="w-5 h-5 shrink-0 text-green"
                                    aria-label="Finished"
                                  />
                                ) : (
                                  !preview && (
                                    <ArrowRightCircleIcon
                                      className="w-5 h-5 shrink-0 text-navy"
                                      aria-hidden="true"
                                    />
                                  )
                                )}
                              </button>
                            </div>

                            {isOpen && (
                              <ul className="border-t border-gray-300 px-2 py-2">
                                {sectionContent(section).map((item) => {
                                  const itemOpen = unlocked.has(item.id);

                                  return (
                                    <li key={item.id}>
                                      <button
                                        onClick={() => openAt(item.id)}
                                        disabled={preview || !itemOpen}
                                        title={
                                          locked
                                            ? lockedReason
                                            : itemOpen
                                              ? preview
                                                ? 'Disabled while previewing'
                                                : 'Go to this item'
                                              : 'Finish the item before this one to unlock it'
                                        }
                                        className={`flex w-full items-center gap-2 rounded-md px-2
                                          py-1 text-left text-sm ${
                                            itemOpen
                                              ? 'text-dark-gray' +
                                                (preview ? '' : ' hover:bg-light-gray')
                                              : 'cursor-not-allowed text-dark-gray/40'
                                          }`}
                                      >
                                        {!itemOpen ? (
                                          <LockClosedIcon className="w-4 h-4 shrink-0" />
                                        ) : item.kind === 'quiz' ? (
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
                                      </button>
                                    </li>
                                  );
                                })}
                                {sectionContent(section).length === 0 && (
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
                  );
                })
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
              {/*
                Start or Continue, decided by whether they have touched this
                course before. "Continue" resumes at the first thing they have
                not finished rather than at the top, because that is what the
                word promises.
              */}
              <Button
                onClick={() => openAt(started && resumeAt ? itemId(resumeAt) : undefined)}
                disabled={locked}
                title={locked ? lockedReason : preview ? 'Disabled while previewing' : undefined}
                className="w-full bg-navy py-6 text-md text-white hover:bg-navbar-hover
                  disabled:cursor-not-allowed disabled:bg-dark-gray/40"
              >
                {locked ? 'Closed' : started ? 'Continue' : 'Start course'}
              </Button>

              {/* Said plainly under the button as well as in its tooltip: a
                  greyed-out button that gives no reason reads as a fault. */}
              {locked && (
                <p className="-mt-2 flex items-start gap-2 text-center text-sm text-danger">
                  <LockClosedIcon className="mt-0.5 w-4 h-4 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 text-left">
                    {dueOn ? `The deadline passed on ${dueOn}.` : 'The deadline has passed.'} Ask
                    whoever assigned this if you still need it.
                  </span>
                </p>
              )}

              {!locked && started && resumeAt && (
                <p className="-mt-2 break-words text-center text-sm text-dark-gray">
                  Picks up at{' '}
                  {resumeAt.kind === 'quiz'
                    ? plainPreview(resumeAt.quiz.title, 50)
                    : plainPreview(
                        resumeAt.element.textContent ??
                          resumeAt.element.fileName ??
                          resumeAt.element.type,
                        50,
                      )}
                </p>
              )}
              {!locked && started && !resumeAt && (
                <p className="-mt-2 text-center text-sm text-dark-gray">
                  You have worked through everything here.
                </p>
              )}

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
