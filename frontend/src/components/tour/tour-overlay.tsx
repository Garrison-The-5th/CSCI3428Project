/**
 * File: tour-overlay.tsx
 * Description: The walkthrough's spotlight — a dimmed screen with holes cut around what
 *   a step points at, and the card that explains it.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-10-30
 */
import { XMarkIcon } from '@heroicons/react/24/outline';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { Button } from '@/components/ui/button';

/** Space left around a spotlit element, so its edge is not flush with the dim. */
const PADDING = 6;
/** Space kept between the card and the edge of the screen, or its target. */
const GAP = 12;
/** Below this width the card spans the screen rather than sitting beside its target. */
const NARROW = 640;
/**
 * Corner radius of the cut-out and of the green ring around it — the same
 * radius on both, so the dim's corners never show inside the ring. Matches
 * Tailwind's `rounded-lg` (`--radius`, 0.75rem).
 */
const RADIUS = 12;
/** How long the cut-out takes to glide from one target to the next. */
const HOLE_MS = 220;

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface TourOverlayProps {
  /** Elements to light up. Empty means a centred card over a plain dim. */
  targets: HTMLElement[];
  title: string;
  body: string;
  /** "3 of 15". */
  stepNumber: number;
  stepCount: number;
  /**
   * The card's main button. Null on a step that waits for the learner to act —
   * the card then says what to do and offers no shortcut past it.
   */
  actionLabel: string | null;
  onAction: () => void;
  /** Absent where going back makes no sense, such as the first step. */
  onBack?: () => void;
  onSkip: () => void;
  /**
   * Whether the spotlit elements take clicks. On for the "do it to continue"
   * steps, which wait for exactly that click; off otherwise, so that clicking
   * Learning while being told what Learning is does not walk off the tour.
   */
  interactive: boolean;
  /** True while the target is still being looked for — the card waits rather than guesses. */
  searching?: boolean;
  /** The tour has just ended: fade the whole overlay away and take no more input. */
  leaving?: boolean;
}

/** Where an element sits on screen, with the spotlight's breathing room added. */
function measure(element: HTMLElement): Rect {
  const rect = element.getBoundingClientRect();
  return {
    top: rect.top - PADDING,
    left: rect.left - PADDING,
    width: rect.width + PADDING * 2,
    height: rect.height + PADDING * 2,
  };
}

/** Same rects, to the pixel. */
function sameRects(a: Rect[], b: Rect[]) {
  return (
    a.length === b.length &&
    a.every(
      (rect, index) =>
        Math.round(rect.top) === Math.round(b[index].top) &&
        Math.round(rect.left) === Math.round(b[index].left) &&
        Math.round(rect.width) === Math.round(b[index].width) &&
        Math.round(rect.height) === Math.round(b[index].height),
    )
  );
}

/** One cut-out, with rounded corners. The direction does not matter under even-odd. */
function holePath({ top, left, width, height }: Rect) {
  const r = Math.max(0, Math.min(RADIUS, width / 2, height / 2));
  const w = width - 2 * r;
  const h = height - 2 * r;
  return (
    `M${left + r},${top} h${w} a${r},${r} 0 0 1 ${r},${r} v${h} ` +
    `a${r},${r} 0 0 1 ${-r},${r} h${-w} a${r},${r} 0 0 1 ${-r},${-r} v${-h} ` +
    `a${r},${r} 0 0 1 ${r},${-r} z`
  );
}

/** A rect shrunk to nothing at its own centre — where a new hole grows from, or an old one goes. */
const collapse = (rect: Rect): Rect => ({
  top: rect.top + rect.height / 2,
  left: rect.left + rect.width / 2,
  width: 0,
  height: 0,
});

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * The cut-outs part way from one step's targets to the next's. Holes are paired
 * in order; one without a partner grows from, or shrinks to, its own centre.
 */
function interpolate(from: Rect[], to: Rect[], t: number): Rect[] {
  const mix = (a: number, b: number) => a + (b - a) * t;
  return Array.from({ length: Math.max(from.length, to.length) }, (_, index) => {
    const a = from[index] ?? collapse(to[index]);
    const b = to[index] ?? collapse(from[index]);
    return {
      top: mix(a.top, b.top),
      left: mix(a.left, b.left),
      width: mix(a.width, b.width),
      height: mix(a.height, b.height),
    };
  });
}

/** The user has asked the system for less motion. */
function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/**
 * Where the card goes: beside its target if there is room — right, then below,
 * then left, then above — and centred when there is no target. On a narrow
 * screen it spans the width, above or below the target, whichever side has more
 * room. Always clamped inside the viewport.
 */
function placeCard(target: Rect | null, card: { width: number; height: number }) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const clampLeft = (left: number) => Math.min(Math.max(left, GAP), vw - card.width - GAP);
  const clampTop = (top: number) => Math.min(Math.max(top, GAP), vh - card.height - GAP);

  if (!target) {
    return { top: clampTop((vh - card.height) / 2), left: clampLeft((vw - card.width) / 2) };
  }

  if (vw < NARROW) {
    const below = target.top + target.height + GAP;
    const roomBelow = vh - below;
    const roomAbove = target.top - GAP;
    const top =
      roomBelow >= card.height || roomBelow >= roomAbove ? below : roomAbove - card.height;
    return { top: clampTop(top), left: GAP };
  }

  const right = target.left + target.width + GAP;
  if (right + card.width <= vw - GAP) {
    return { top: clampTop(target.top), left: right };
  }
  const below = target.top + target.height + GAP;
  if (below + card.height <= vh - GAP) {
    return { top: below, left: clampLeft(target.left) };
  }
  const left = target.left - GAP - card.width;
  if (left >= GAP) {
    return { top: clampTop(target.top), left };
  }
  return { top: clampTop(target.top - GAP - card.height), left: clampLeft(target.left) };
}

/** How long the card takes to fade out, or in. */
const FADE_MS = 150;
/** The card fades in once its target has stayed put this long — a scroll has finished. */
const SETTLE_MS = 80;
/** Fade in after this long regardless, for a page that never quite stops moving. */
const MAX_SETTLE_MS = 700;
/** A target still being looked for after this long gets a "One moment…" card. */
const SEARCHING_GRACE_MS = 400;

/** What the card is showing — kept apart from the props so the old step can fade out. */
interface Shown {
  targets: HTMLElement[];
  title: string;
  body: string;
  stepNumber: number;
  actionLabel: string | null;
  hasBack: boolean;
  interactive: boolean;
  searching: boolean;
}

/** Which step a snapshot is of. A change of key fades the card out and back in. */
const keyOf = (shown: Shown) =>
  `${shown.stepNumber}|${shown.title}|${shown.searching ? '' : shown.body}|${shown.searching}`;

/** Same step and the same details, so there is nothing to update. */
function sameShown(a: Shown, b: Shown) {
  return (
    keyOf(a) === keyOf(b) &&
    a.actionLabel === b.actionLabel &&
    a.hasBack === b.hasBack &&
    a.interactive === b.interactive &&
    a.targets.length === b.targets.length &&
    a.targets.every((element, index) => element === b.targets[index])
  );
}

/**
 * The spotlight itself.
 *
 * The dim is one SVG path with a hole per target, drawn with the even-odd rule.
 * A hole is genuinely empty, so whatever is under it stays visible, clickable
 * and reachable by assistive technology — a cut-out faked with a box-shadow
 * would leave an element covering the target. Where a step is not waiting for a
 * click, a transparent blocker sits in the hole instead, so the target can be
 * seen but not used.
 *
 * Positions are recomputed every animation frame while a step is shown. That
 * covers everything that can move a target — scrolling, a resize, the sidebar
 * sliding in, a page finishing its layout — with one mechanism, and does no
 * work when nothing changed.
 *
 * Moving between steps, the dim stays up and the card never slides: it fades
 * out where it was, the cut-out glides to the new target while the card is
 * invisible, and once that target has stopped moving (a scroll into view, a
 * page settling) the card fades in beside it. The whole overlay fades in when
 * the tour appears and out when it ends. A target
 * that is still being looked for keeps the card hidden rather than parking it
 * in the middle of the screen, unless the wait runs long enough to need a
 * "One moment…".
 *
 * Focus moves into the card on each step and is kept there, Tab and Shift+Tab
 * cycling through its buttons — and through the target itself on a step that
 * waits for it to be used, which is the only way a keyboard user could. Esc
 * skips the tour; Replay on the Profile page brings it back, so there is no
 * confirmation to dismiss first.
 */
const TourOverlay = ({
  targets,
  title,
  body,
  stepNumber,
  stepCount,
  actionLabel,
  onAction,
  onBack,
  onSkip,
  interactive,
  searching = false,
  leaving = false,
}: TourOverlayProps) => {
  const titleId = useId();
  const bodyId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const reducedMotion = prefersReducedMotion();

  const incoming: Shown = {
    targets,
    title,
    body,
    stepNumber,
    actionLabel,
    hasBack: Boolean(onBack),
    interactive,
    searching,
  };
  const latest = useRef(incoming);
  latest.current = incoming;

  const [shown, setShown] = useState<Shown>(incoming);
  /**
   * `out` — the previous step fading away.
   * `wait` — the new step in place but invisible, until its target settles.
   * `in` — visible and usable.
   */
  const [phase, setPhase] = useState<'out' | 'wait' | 'in'>('wait');

  /** Where the targets really are: the card and the green rings follow these. */
  const [rects, setRects] = useState<Rect[]>([]);
  /** The cut-outs as drawn — the same, except while gliding between steps. */
  const [holes, setHoles] = useState<Rect[]>([]);
  const drawnHoles = useRef<Rect[]>([]);
  const morph = useRef<{ from: Rect[]; start: number } | null>(null);
  /** False for the first frame, so the overlay fades in rather than appearing. */
  const [entered, setEntered] = useState(reducedMotion);
  const [cardSize, setCardSize] = useState({ width: 360, height: 200 });
  const [viewport, setViewport] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  /** When the target or the card last moved or changed size. */
  const lastMove = useRef(performance.now());

  // A new step: fade the old one out first, unless nobody can see it anyway.
  const incomingKey = keyOf(incoming);
  useLayoutEffect(() => {
    const next = latest.current;
    if (incomingKey === keyOf(shown)) {
      if (!sameShown(shown, next)) setShown(next);
      return;
    }
    if (phase === 'out') {
      // Already fading; the timer swaps to whatever step is latest by then.
      return;
    }
    if (phase === 'in' && !reducedMotion) {
      setPhase('out');
    } else {
      lastMove.current = performance.now();
      setShown(next);
      setPhase('wait');
    }
  });

  // Faded out: swap to the step that is waiting.
  useEffect(() => {
    if (phase !== 'out') return;
    const timer = window.setTimeout(() => {
      lastMove.current = performance.now();
      setShown(latest.current);
      setPhase('wait');
    }, FADE_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  // In place: fade in once nothing is moving, or show "One moment…" after a long search.
  useEffect(() => {
    if (phase !== 'wait') return;
    if (shown.searching) {
      const timer = window.setTimeout(() => setPhase('in'), SEARCHING_GRACE_MS);
      return () => window.clearTimeout(timer);
    }
    const started = performance.now();
    let frame = 0;
    const check = () => {
      const now = performance.now();
      const settled = now - lastMove.current >= SETTLE_MS && morph.current === null;
      if (settled || now - started >= MAX_SETTLE_MS) {
        setPhase('in');
        return;
      }
      frame = window.requestAnimationFrame(check);
    };
    frame = window.requestAnimationFrame(check);
    return () => window.cancelAnimationFrame(frame);
  }, [phase, shown]);

  // Bring the main target into view once per step, while the card is hidden.
  useEffect(() => {
    shown.targets[0]?.scrollIntoView?.({
      block: 'center',
      inline: 'nearest',
      behavior: reducedMotion ? 'auto' : 'smooth',
    });
    // Only when the element changes, not on every re-measure.
  }, [shown.targets[0]]);

  // Fade the overlay in on its first frame.
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setEntered(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  // Follow the targets wherever they move, gliding the cut-out over from the
  // last step's. Measured before paint on a change of target, so the spotlight
  // never draws a frame around the old one.
  useLayoutEffect(() => {
    morph.current = reducedMotion ? null : { from: drawnHoles.current, start: performance.now() };
    let frame = 0;
    const tick = () => {
      const now = performance.now();
      const live = shown.targets.map(measure);
      setRects((current) => {
        if (sameRects(current, live)) return current;
        lastMove.current = now;
        return live;
      });

      let drawn = live;
      if (morph.current) {
        const t = (now - morph.current.start) / HOLE_MS;
        if (t >= 1) morph.current = null;
        else drawn = interpolate(morph.current.from, live, easeInOut(t));
      }
      drawnHoles.current = drawn;
      setHoles((current) => (sameRects(current, drawn) ? current : drawn));

      setViewport((current) =>
        current.width === window.innerWidth && current.height === window.innerHeight
          ? current
          : { width: window.innerWidth, height: window.innerHeight },
      );
      frame = window.requestAnimationFrame(tick);
    };
    tick();
    return () => window.cancelAnimationFrame(frame);
  }, [shown.targets]);

  // The card's own size decides where it fits.
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const { width, height } = card.getBoundingClientRect();
    setCardSize((current) => {
      if (
        Math.round(current.width) === Math.round(width) &&
        Math.round(current.height) === Math.round(height)
      ) {
        return current;
      }
      lastMove.current = performance.now();
      return { width, height };
    });
  });

  // Focus into the card on every step, so a screen reader starts on its title.
  useEffect(() => {
    cardRef.current?.focus({ preventScroll: true });
  }, [shown.title, shown.stepNumber]);

  // Keep focus inside the card (plus the target, when it is to be used), and Esc to skip.
  useEffect(() => {
    if (leaving) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onSkip();
        return;
      }
      if (event.key !== 'Tab' || !cardRef.current) return;

      const focusable = [
        ...cardRef.current.querySelectorAll<HTMLElement>('button:not([disabled])'),
        ...(shown.interactive ? shown.targets : []),
      ];
      if (focusable.length === 0) return;

      const index = focusable.indexOf(document.activeElement as HTMLElement);
      const nextIndex = event.shiftKey
        ? index <= 0
          ? focusable.length - 1
          : index - 1
        : index === -1 || index === focusable.length - 1
          ? 0
          : index + 1;
      event.preventDefault();
      focusable[nextIndex].focus();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [leaving, onSkip, shown.interactive, shown.targets]);

  const visible = phase === 'in' && !leaving;
  // A card mid-fade belongs to a step that has already gone: a second Enter on
  // its Next must not skip the step after.
  const act = (handler?: () => void) => () => {
    if (visible) handler?.();
  };

  const anchor = rects[0] ?? null;
  const position = placeCard(anchor, cardSize);
  const narrow = viewport.width < NARROW;

  // Outer rectangle clockwise, each hole anticlockwise; even-odd empties the holes.
  const cutOuts = holes
    .filter((r) => r.width >= 1 && r.height >= 1)
    .map(holePath)
    .join(' ');
  const path = `M0,0 H${viewport.width} V${viewport.height} H0 z ${cutOuts}`;
  const fade = reducedMotion ? '' : 'transition-opacity duration-150 ease-out';
  const opacity = visible ? 'opacity-100' : 'opacity-0';

  return createPortal(
    <div
      className={`tour-overlay fixed inset-0 z-[60] pointer-events-none
        ${reducedMotion ? '' : 'transition-opacity duration-200 ease-out'}
        ${entered && !leaving ? 'opacity-100' : 'opacity-0'}`}
    >
      <svg
        className="absolute inset-0 h-full w-full"
        width={viewport.width}
        height={viewport.height}
        aria-hidden="true"
      >
        <path
          d={path}
          fillRule="evenodd"
          className={`${leaving ? 'pointer-events-none' : 'pointer-events-auto'} fill-black/55`}
        />
      </svg>

      {rects.map((rect, index) => (
        <div
          key={index}
          aria-hidden="true"
          className={`absolute ring-2 ring-green ring-offset-2 ring-offset-transparent
          ${shown.interactive || leaving ? 'pointer-events-none' : 'pointer-events-auto'}
          ${fade} ${opacity}`}
          style={{
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
            borderRadius: RADIUS,
          }}
        />
      ))}

      <div
        ref={cardRef}
        role="dialog"
        // Not modal: on a "do it" step the target outside this card is the
        // thing to use, and aria-modal would hide it from assistive technology.
        aria-modal="false"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        data-testid="tour-card"
        className={`absolute rounded-xl border border-border bg-popover p-5
          text-popover-foreground shadow-xl outline-none ${fade} ${opacity}
          ${visible ? 'pointer-events-auto' : 'pointer-events-none'}`}
        style={{
          top: position.top,
          left: position.left,
          width: narrow ? viewport.width - GAP * 2 : 360,
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">
              {shown.stepNumber} of {stepCount}
            </p>
            <h2 id={titleId} className="mt-1 text-lg font-bold">
              {shown.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onSkip}
            className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent
              hover:text-accent-foreground"
            aria-label="Skip tour"
            title="Skip tour (Esc)"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <p id={bodyId} className="mt-2 text-sm leading-relaxed">
          {shown.searching ? 'One moment…' : shown.body}
        </p>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onSkip}
            className="px-2 text-muted-foreground hover:text-foreground"
          >
            Skip tour
          </Button>
          <div className="flex items-center gap-2">
            {shown.hasBack && (
              <Button type="button" variant="outline" onClick={act(onBack)}>
                Back
              </Button>
            )}
            {shown.actionLabel && (
              <Button
                type="button"
                onClick={act(onAction)}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {shown.actionLabel}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Announced as each step arrives, without moving the reader's place. */}
      <p className="sr-only" aria-live="polite">
        {visible && !shown.searching
          ? `Tour step ${shown.stepNumber} of ${stepCount}: ${shown.title}. ${shown.body}`
          : ''}
      </p>
    </div>,
    document.body,
  );
};

export default TourOverlay;
