/**
 * File: landing-page-editor.tsx
 * Description: Landing Page Editor — everything a learner sees on the course overview.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
/**
 * Landing Page Editor — everything a learner sees on the course overview.
 *
 * Every field saves itself shortly after typing stops; there are no save buttons.
 */
import { ArrowUpTrayIcon } from '@heroicons/react/24/outline';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import ToggleSwitch from '@/components/ui/toggle-switch';
import { saveLabel, useAutoSave } from '@/hooks/use-auto-save';
import { Course, curriculumApi, IMAGE_ONLY_ACCEPT, imageSrc } from '@/services/curriculum-api';

interface Props {
  course: Course;
  onRefresh: () => Promise<void>;
  onNotify: (message: string, type?: 'success' | 'error') => void;
  run: (action: () => Promise<unknown>, success: string, failure: string) => Promise<boolean>;
}

const inputClass = 'bg-white text-dark-gray';
const primaryBtn = 'bg-navy text-white hover:bg-navy-hover';
const splitCommas = (v: string) =>
  v
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
const splitLines = (v: string) =>
  v
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean);
/**
 * The date a deadline of this many days would land on, for the hint under the
 * field.
 *
 * The author is setting a length, not a date, so the date is the part they
 * cannot see for themselves — "14" says nothing about whether that clears the
 * end of the month. Worked out from today because today is when they are
 * looking; the real one is stamped when the lesson is actually handed over.
 */
const dueIfAssignedToday = (days: string) => {
  const parsed = Number(days);
  if (!Number.isInteger(parsed) || parsed < 1) return null;
  return new Date(Date.now() + parsed * 86_400_000).toLocaleDateString();
};

const LandingPageEditor = ({ course, onRefresh, run }: Props) => {
  const coverRef = useRef<HTMLInputElement>(null);

  const [draft, setDraft] = useState({
    title: '',
    shortDescription: '',
    description: '',
    tags: '',
    languages: '',
    whatYouWillLearn: '',
    prerequisites: '',
    daysRemaining: '',
  });

  useEffect(() => {
    setDraft({
      title: course.title,
      shortDescription: course.shortDescription ?? '',
      description: course.description ?? '',
      tags: course.tags.join(', '),
      languages: course.languages.join(', '),
      whatYouWillLearn: course.whatYouWillLearn.join('\n'),
      prerequisites: course.prerequisites.join('\n'),
      daysRemaining: course.daysRemaining == null ? '' : String(course.daysRemaining),
    });
  }, [course.id]);

  const { state } = useAutoSave(draft, async (value) => {
    if (!value.title.trim()) return;
    await curriculumApi.updateCourse(course.id, {
      title: value.title.trim(),
      shortDescription: value.shortDescription.trim() || null,
      description: value.description.trim() || null,
      tags: splitCommas(value.tags),
      languages: splitCommas(value.languages),
      whatYouWillLearn: splitLines(value.whatYouWillLearn),
      prerequisites: splitLines(value.prerequisites),
      // Blank clears the deadline; anything that is not a whole number of days
      // is left alone rather than written as a clearance, so a half-typed "1"
      // on the way to "14" cannot wipe what is already set.
      daysRemaining: value.daysRemaining.trim() === '' ? null : Number(value.daysRemaining),
      // instructorIds is deliberately omitted: the picker has been removed, and
      // sending an empty list would wipe whoever is already credited.
    });
    await onRefresh();
  });

  const field = (label: string, node: React.ReactNode, hint?: string) => (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium text-dark-gray">{label}</span>
      {node}
      {hint && <span className="text-xs text-dark-gray">{hint}</span>}
    </label>
  );

  return (
    <Card className="bg-light-gray shadow-sm">
      <CardHeader className="flex-row items-center justify-between gap-4 p-4">
        <CardTitle className="text-lg text-dark-gray">Landing page</CardTitle>
        <span className="text-xs text-dark-gray">{saveLabel(state)}</span>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        {/* Cover photo */}
        <div className="flex flex-wrap items-center gap-4">
          <div
            className="flex h-24 w-32 shrink-0 items-center justify-center overflow-hidden
              rounded-lg border border-gray-300 bg-white"
          >
            {imageSrc(course.imageData, course.imageType) ? (
              <img
                src={imageSrc(course.imageData, course.imageType)!}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="text-xs text-dark-gray">No photo</span>
            )}
          </div>
          <div>
            <input
              ref={coverRef}
              type="file"
              accept={IMAGE_ONLY_ACCEPT}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  run(
                    () => curriculumApi.uploadCourseImage(course.id, file),
                    'Cover photo updated',
                    'Failed to upload cover photo',
                  );
                }
                e.target.value = '';
              }}
            />
            <Button onClick={() => coverRef.current?.click()} className={primaryBtn}>
              <ArrowUpTrayIcon className="w-5 h-5" /> Upload cover photo
            </Button>
            <p className="mt-1 text-xs text-dark-gray">
              JPEG, PNG, GIF, WebP, SVG, BMP or HEIC, up to 10MB.
            </p>
          </div>
        </div>

        {field(
          'Title',
          <Input
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            className={inputClass}
          />,
        )}

        {field(
          'Short description',
          <Input
            value={draft.shortDescription}
            onChange={(e) => setDraft({ ...draft, shortDescription: e.target.value })}
            className={inputClass}
          />,
          'The single line shown under the title.',
        )}

        {field(
          'Full description',
          <Textarea
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            rows={4}
            className={`${inputClass} resize-none`}
          />,
        )}

        <div className="flex flex-wrap gap-4">
          <div className="min-w-60 flex-1">
            {field(
              'Tags',
              <Input
                value={draft.tags}
                onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
                placeholder="Safety, Compliance"
                className={inputClass}
              />,
              'Separate with commas.',
            )}
          </div>
          <div className="min-w-60 flex-1">
            {field(
              'Languages',
              <Input
                value={draft.languages}
                onChange={(e) => setDraft({ ...draft, languages: e.target.value })}
                placeholder="English, French"
                className={inputClass}
              />,
              'Separate with commas.',
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-4">
          <div className="min-w-60 flex-1">
            {field(
              "What you'll learn",
              <Textarea
                value={draft.whatYouWillLearn}
                onChange={(e) => setDraft({ ...draft, whatYouWillLearn: e.target.value })}
                rows={4}
                placeholder={'Spot common hazards\nRun a site inspection'}
                className={`${inputClass} resize-none`}
              />,
              'One bullet per line.',
            )}
          </div>
          <div className="min-w-60 flex-1">
            {field(
              'Prerequisites',
              <Textarea
                value={draft.prerequisites}
                onChange={(e) => setDraft({ ...draft, prerequisites: e.target.value })}
                rows={4}
                placeholder={'Completed onboarding\nBasic tool training'}
                className={`${inputClass} resize-none`}
              />,
              'One bullet per line.',
            )}
          </div>
        </div>

        <hr className="h-px border-t-0 bg-gray-300" />

        <div className="flex flex-wrap items-start gap-8">
          {/* A deadline is a length rather than a date. The same lesson goes out
              to different people at different times, and one fixed date would
              give the last of them a week and the first of them a month — so
              the author says how long somebody gets, and the date is worked out
              when it is actually handed over. */}
          <label className="flex flex-col gap-1 text-sm font-medium text-dark-gray">
            Days remaining
            <Input
              type="number"
              min={1}
              value={draft.daysRemaining}
              onChange={(e) => setDraft({ ...draft, daysRemaining: e.target.value })}
              placeholder="No deadline"
              className={`${inputClass} max-w-32`}
            />
            <span className="max-w-56 text-xs font-normal text-dark-gray">
              How long a learner gets once this is assigned to them.
              {dueIfAssignedToday(draft.daysRemaining) &&
                ` Assigned today, it would be due ${dueIfAssignedToday(draft.daysRemaining)}.`}
            </span>
          </label>

          <ToggleSwitch
            checked={course.sequential}
            onChange={(v) =>
              run(
                () => curriculumApi.updateCourse(course.id, { sequential: v }),
                v ? 'Sections now unlock in order' : 'Sections can be taken in any order',
                'Failed to change section order rule',
              )
            }
            label="Unlock sections in order"
            hint="Each section stays locked until the one before is finished"
          />
        </div>
      </CardContent>
    </Card>
  );
};

export default LandingPageEditor;
