/**
 * File: edited-tag.tsx
 * Description: "Last edited by …" on something learners cannot see yet.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-09-04
 */
/**
 * Marks one piece of a course as changed since the last publish, and says whose
 * change it was.
 *
 * Two people author the same course, and the thing neither can see from the
 * outline is what the other has touched. The mark answers that at a glance and
 * disappears at the next publish — it means "changed, and not live yet", so it
 * has to stop being true the moment the change ships.
 *
 * A tag rather than a colour on the row itself. Whether something is new,
 * locked, or selected is already carried by colour in these lists, and a fourth
 * meaning competing for the same channel would be read as none of them.
 */
import { PencilSquareIcon } from '@heroicons/react/24/outline';

import { EditMark } from '@/services/curriculum-api';

interface Props {
  /** Absent when this item has no unpublished change — the common case. */
  mark: EditMark | undefined;
}

/** "Last edited by …" on something learners cannot see yet. Renders nothing without a mark. */
const EditedTag = ({ mark }: Props) => {
  if (!mark) return null;

  return (
    <span
      /*
        `min-w-0` and wrapping rather than `shrink-0`.

        The tag sits in a row that also holds a save status and two icon
        buttons, and a name long enough to fill the row used to push those
        buttons past the edge — the delete button ended up unreachable, which is
        a worse failure than a cramped tag. It now gives way and folds onto a
        second line instead, and the rows it sits in reserve the height for two.
      */
      className="inline-flex min-w-0 items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5
        text-left text-[11px] leading-tight font-semibold break-words text-amber-900"
      title={`Changed ${new Date(mark.at).toLocaleString()} — not published yet`}
    >
      <PencilSquareIcon className="w-3 h-3 shrink-0" aria-hidden="true" />
      {/*
        "you" rather than your own name. Seeing your own name reported back
        reads as somebody else having been in here, which is the one thing the
        tag exists to tell you apart from.
      */}
      <span className="min-w-0 break-words">Last edited by: {mark.mine ? 'you' : mark.by}</span>
    </span>
  );
};

export default EditedTag;
