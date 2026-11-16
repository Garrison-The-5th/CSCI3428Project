/**
 * File: lock-overlay.tsx
 * Description: The one way something is shown as locked.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-09-04
 */
/**
 * Locked out: an opaque grey sheet over something, and nothing under it can be
 * clicked.
 *
 * One component so that every lock in the app looks and behaves the same. What
 * is being locked differs — a model somebody else has open, a question being
 * written, a quiz's kind after it has been published — but "you cannot touch
 * this right now" is one idea and should read as one thing.
 *
 * Two halves make it a lock rather than a tint. The sheet is opaque enough that
 * the content beneath reads as unavailable rather than merely faded, and
 * `pointer-events` are killed on the children so a click cannot reach a button
 * underneath — a greyed-out look with a live button below it is the worst of
 * both, because it invites exactly the edit the lock exists to prevent.
 *
 * `inert` carries the same rule to the keyboard, which the mouse rule does not:
 * without it a tab press still lands inside, and someone navigating by keyboard
 * would find the "locked" controls perfectly usable.
 */
import { LockClosedIcon } from '@heroicons/react/24/outline';
import { ReactNode } from 'react';

interface LockOverlayProps {
  /** Off, and this renders its children untouched — no wrapper, no cost. */
  locked: boolean;
  /**
   * Why it is locked, shown on the sheet. Kept short: it sits over content and
   * a paragraph here hides more than it explains.
   */
  reason?: string;
  /** Smaller type and a hidden icon, for locking something the size of a row. */
  compact?: boolean;
  /**
   * Classes for the wrapper, so a caller can bound the sheet to the control.
   *
   * The wrapper is a block by default and so fills its column, which is right
   * for locking a model and wrong for locking a dropdown — the grey ran the
   * width of the pane and covered empty space beside the thing it was about.
   * `w-fit` is the usual answer.
   */
  className?: string;
  children: ReactNode;
}

const LockOverlay = ({
  locked,
  reason,
  compact = false,
  className = '',
  children,
}: LockOverlayProps) => {
  if (!locked) return <>{children}</>;

  return (
    <div className={`relative isolate ${className}`}>
      {/*
        `inert` takes the content out of the tab order and out of the
        accessibility tree, which is the honest description of it: there is
        nothing here to interact with. The pointer-events rule is kept as well
        rather than replaced by it — inert is the newer of the two, and a click
        landing on a live button is not a failure worth risking on support.
      */}
      <div className="pointer-events-none select-none" inert>
        {children}
      </div>

      {/*
        Opaque enough that what is under it reads as unavailable rather than
        merely dimmed. A light tint is ambiguous — it looks like a hover state,
        or like the control is simply pale — and the whole job of this sheet is
        to say "not this one, not now" without anyone having to try it.

        `inset-px` rather than `inset-0` so the sheet stops one pixel short on
        every side and the child's own border stays visible around it. Covering
        the border erased the outline of the thing being locked, which left a
        grey slab with no shape to it — the reader could no longer see that it
        was a dropdown. Keeping the frame says what is locked; the sheet says
        that it is. The radius matches the `rounded-md` its callers use, so the
        sheet follows the border's curve instead of cutting across it.
      */}
      <div
        className="absolute inset-px z-10 flex items-center justify-center gap-2 rounded-md
          bg-light-gray/80 px-3 text-center backdrop-blur-[1px]"
        role="note"
        aria-label={reason ?? 'Locked'}
      >
        {!compact && <LockClosedIcon className="w-5 h-5 shrink-0 text-navy" aria-hidden="true" />}
        {reason && (
          <span
            className={`font-semibold text-white drop-shadow ${compact ? 'text-xs' : 'text-sm'}`}
          >
            {reason}
          </span>
        )}
      </div>
    </div>
  );
};

export default LockOverlay;
