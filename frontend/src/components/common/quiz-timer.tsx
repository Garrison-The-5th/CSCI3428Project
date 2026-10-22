/**
 * File: quiz-timer.tsx
 * Description: The countdown on a timed quiz — a small ring that follows the learner around.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
/**
 * The countdown on a timed quiz — a small ring that follows the learner around.
 *
 * Fixed to the viewport rather than placed in the page, because the one thing a
 * timer must never do is scroll out of sight. It is draggable so it can be moved
 * off whatever it happens to be covering, and clamped to the window so it cannot
 * be dropped somewhere unreachable.
 *
 * The countdown is a display of a deadline the server owns. Nothing here decides
 * how long anyone has; QuizRunner holds the deadline and passes the seconds left.
 */
import { useEffect, useRef, useState } from 'react';

interface QuizTimerProps {
  secondsLeft: number;
  /** The full allowance, so the ring knows what fraction is gone. */
  totalSeconds: number;
}

/** Where it sits, as a distance from the top-right of the window. */
const INITIAL = { right: 24, top: 88 };
const SIZE = 72;
const STROKE = 6;

/** "9:05" — minutes and seconds, which is what a countdown wants to read as. */
function formatCountdown(seconds: number): string {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  return `${minutes}:${String(safe % 60).padStart(2, '0')}`;
}

/**
 * The countdown ring shown during a timed quiz. It floats over the page and can be dragged out of
 * the way.
 */
const QuizTimer = ({ secondsLeft, totalSeconds }: QuizTimerProps) => {
  const [position, setPosition] = useState(INITIAL);
  const dragFrom = useRef<{ x: number; y: number; right: number; top: number } | null>(null);

  // Keep it on screen when the window shrinks. Without this, a timer parked at
  // the right edge of a wide window is off the side of a narrow one.
  useEffect(() => {
    /** Pulls the timer back on screen after the window shrinks. */
    const clamp = () => {
      setPosition((current) => ({
        right: Math.min(current.right, Math.max(0, window.innerWidth - SIZE)),
        top: Math.min(current.top, Math.max(0, window.innerHeight - SIZE)),
      }));
    };
    window.addEventListener('resize', clamp);
    return () => window.removeEventListener('resize', clamp);
  }, []);

  /** Starts moving the timer, capturing the pointer. */
  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    dragFrom.current = {
      x: event.clientX,
      y: event.clientY,
      right: position.right,
      top: position.top,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  /** Moves the timer with the pointer, keeping it on screen. */
  const drag = (event: React.PointerEvent<HTMLDivElement>) => {
    const from = dragFrom.current;
    if (!from) return;

    setPosition({
      // Right-anchored, so moving the pointer right reduces the offset.
      right: Math.min(
        Math.max(0, from.right - (event.clientX - from.x)),
        Math.max(0, window.innerWidth - SIZE),
      ),
      top: Math.min(
        Math.max(0, from.top + (event.clientY - from.y)),
        Math.max(0, window.innerHeight - SIZE),
      ),
    });
  };

  /** Stops moving the timer. */
  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    dragFrom.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const safeTotal = Math.max(1, totalSeconds);
  const fraction = Math.max(0, Math.min(1, secondsLeft / safeTotal));
  const radius = (SIZE - STROKE) / 2;
  const circumference = 2 * Math.PI * radius;

  // Under a minute is the point where someone needs to feel it, so the ring goes
  // red there rather than counting down in the same colour throughout.
  const urgent = secondsLeft <= 60;

  return (
    <div
      role="timer"
      aria-live="off"
      aria-label={`${formatCountdown(secondsLeft)} remaining`}
      onPointerDown={startDrag}
      onPointerMove={drag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      style={{ right: position.right, top: position.top, width: SIZE, height: SIZE }}
      className="fixed z-50 cursor-grab touch-none select-none rounded-full bg-white shadow-lg
        ring-1 ring-gray-300 active:cursor-grabbing"
      title="Time remaining — drag to move"
    >
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={radius}
          fill="none"
          strokeWidth={STROKE}
          className="stroke-gray-300"
        />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={radius}
          fill="none"
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={`${fraction * circumference} ${circumference}`}
          // Start at 12 o'clock and drain clockwise.
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          className={urgent ? 'stroke-danger-hover' : 'stroke-[#5b9748]'}
        />
      </svg>

      <span className="absolute inset-0 flex items-center justify-center">
        <span
          className={`text-sm font-bold tabular-nums
            ${urgent ? 'text-danger-hover' : 'text-dark-gray'}`}
        >
          {formatCountdown(secondsLeft)}
        </span>
      </span>
    </div>
  );
};

export default QuizTimer;
