/**
 * File: version-diff-view.tsx
 * Description: One archived version, read against the one learners are on.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-09-04
 */
/**
 * One version, with what changed marked on it.
 *
 * The two trees arrive merged from the server — everything either version has,
 * in the live version's order — and this only has to colour them. Green is in
 * the live version and not in the one being read; red is the other way round;
 * everything else draws exactly as it does in the editor, which is what makes
 * the marked items stand out at all.
 *
 * Read-only by design. This is a record of what a course was, and offering to
 * edit it would raise a question nobody has a good answer to — edit it into
 * what?
 */
import { MinusCircleIcon, PlusCircleIcon } from '@heroicons/react/24/outline';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DiffStatus, moduleGroups, sectionContent, VersionDiff } from '@/services/curriculum-api';

/**
 * The one place a verdict becomes a colour.
 *
 * `same` deliberately returns the ordinary editor styling rather than a third
 * tint: a diff where everything is coloured says nothing, because the eye has
 * nothing plain to measure the colours against.
 */
function tint(status: DiffStatus | undefined): string {
  if (status === 'added') return 'border-green bg-green/10';
  if (status === 'removed') return 'border-danger bg-danger/10';
  return 'border-gray-300 bg-white';
}

/** A word for the verdict, for anyone who cannot use the colour. */
function StatusMark({ status }: { status: DiffStatus | undefined }) {
  if (status === 'added') {
    return (
      <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-green">
        <PlusCircleIcon className="w-4 h-4" aria-hidden="true" />
        Added since
      </span>
    );
  }

  if (status === 'removed') {
    return (
      <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-danger">
        <MinusCircleIcon className="w-4 h-4" aria-hidden="true" />
        Not in the live version
      </span>
    );
  }

  return null;
}

/**
 * One archived version laid out by module, marking what is the same as, added to or removed from
 * the live version.
 */
const VersionDiffView = ({ diff }: { diff: VersionDiff }) => {
  const groups = moduleGroups(diff.course);

  return (
    <div className="flex flex-col gap-4">
      <div
        className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-300 bg-white px-4
          py-3"
      >
        <span className="text-sm font-semibold text-dark-gray">
          Version {diff.version}
          {diff.liveVersion !== null && ` compared with version ${diff.liveVersion}, live now`}
        </span>
        {diff.identical ? (
          <Badge className="bg-navy px-2 text-white">Identical to the live version</Badge>
        ) : (
          <>
            <Badge className="bg-green px-2 text-white">Green: added since this version</Badge>
            <Badge className="bg-danger px-2 text-white">Red: gone from the live version</Badge>
          </>
        )}
      </div>

      {diff.liveVersion === null && (
        <p className="text-sm text-dark-gray">
          This course has no live version, so there is nothing to compare against — everything below
          is shown as it stood in version {diff.version}.
        </p>
      )}

      {groups.length === 0 ? (
        <p className="py-8 text-center text-dark-gray">This version had no modules.</p>
      ) : (
        groups.map((group) => (
          <Card
            key={group.module.id}
            className={`border-2 shadow-sm ${tint(diff.status.modules[group.module.id])}`}
          >
            <CardHeader className="flex-row items-center justify-between gap-3 p-4">
              <CardTitle className="min-w-0 break-words text-base text-dark-gray">
                {group.module.number}. {group.module.title}
              </CardTitle>
              <StatusMark status={diff.status.modules[group.module.id]} />
            </CardHeader>

            <CardContent className="flex flex-col gap-2">
              {group.sections.length === 0 ? (
                <p className="text-sm text-dark-gray">Nothing in this module.</p>
              ) : (
                group.sections.map((section) => (
                  <div
                    key={section.id}
                    className={`rounded-lg border-2 p-3 ${tint(diff.status.sections[section.id])}`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="min-w-0 break-words text-sm font-semibold text-dark-gray">
                        {section.number} {section.title}
                      </span>
                      <StatusMark status={diff.status.sections[section.id]} />
                    </div>

                    <ul className="mt-2 flex flex-col gap-1">
                      {sectionContent(section).map((item) => {
                        const status =
                          item.kind === 'quiz'
                            ? diff.status.quizzes[item.id]
                            : diff.status.elements[item.id];

                        return (
                          <li key={item.id}>
                            <div
                              className={`flex flex-wrap items-center justify-between gap-2
                                rounded-md border px-3 py-2 text-sm ${tint(status)}`}
                            >
                              <span className="min-w-0 break-words text-dark-gray">
                                {item.kind === 'quiz'
                                  ? `Quiz — ${item.quiz.title}`
                                  : (item.element.textContent ??
                                    item.element.videoUrl ??
                                    item.element.fileName ??
                                    item.element.type)}
                              </span>
                              <StatusMark status={status} />
                            </div>

                            {/* Questions are diffed too — a version that only
                                differs by one reworded exam is still a different
                                course to sit. */}
                            {item.kind === 'quiz' && item.quiz.questions.length > 0 && (
                              <ul className="mt-1 ml-6 flex flex-col gap-1">
                                {item.quiz.questions.map((question) => (
                                  <li
                                    key={question.id}
                                    className={`flex flex-wrap items-center justify-between gap-2
                                      rounded-md border px-3 py-1 text-xs
                                      ${tint(diff.status.questions[question.id])}`}
                                  >
                                    <span className="min-w-0 break-words text-dark-gray">
                                      {question.order}. {question.prompt}
                                    </span>
                                    <StatusMark status={diff.status.questions[question.id]} />
                                  </li>
                                ))}
                              </ul>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
};

export default VersionDiffView;
