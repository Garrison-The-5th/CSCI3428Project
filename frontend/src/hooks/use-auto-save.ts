/**
 * File: use-auto-save.ts
 * Description: Use auto save for the learning platform.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { logger } from '@/utils/logger';

/**
 * Saves a value a short while after typing stops, instead of on a button press.
 *
 * Guards worth knowing about:
 * - The first render never saves, or opening a page would rewrite every record.
 * - A save is skipped when the value matches what was last persisted, so
 *   re-renders and refetches do not cause write loops.
 * - Only the newest value is written; a save in flight is superseded rather than
 *   racing, so a fast typist cannot land an older value last.
 */
export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export function useAutoSave<T>(
  value: T,
  save: (value: T) => Promise<unknown>,
  { delay = 700, enabled = true }: { delay?: number; enabled?: boolean } = {},
) {
  const [state, setState] = useState<SaveState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef<string | null>(null);
  const inFlight = useRef(0);
  const saveRef = useRef(save);

  // Keep the latest callback without making it a dependency of the effect,
  // which would restart the timer on every parent render.
  saveRef.current = save;

  useEffect(() => {
    if (!enabled) return;

    const serialised = JSON.stringify(value);

    // First pass just records the starting value.
    if (lastSaved.current === null) {
      lastSaved.current = serialised;
      return;
    }

    if (serialised === lastSaved.current) return;

    if (timer.current) clearTimeout(timer.current);

    timer.current = setTimeout(async () => {
      const ticket = ++inFlight.current;
      setState('saving');
      try {
        await saveRef.current(value);
        // A newer save started while this was away — let that one report.
        if (ticket !== inFlight.current) return;
        lastSaved.current = serialised;
        setState('saved');
      } catch (err) {
        if (ticket !== inFlight.current) return;
        logger.error('Auto-save failed:', err);
        setState('error');
      }
    }, delay);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value, delay, enabled]);

  /** Call after saving elsewhere, so the next edit is measured from this value. */
  const markSaved = useCallback((next: T) => {
    lastSaved.current = JSON.stringify(next);
    setState('saved');
  }, []);

  return { state, markSaved };
}

/** Short status line for an auto-saving form. */
export function saveLabel(state: SaveState): string {
  return state === 'saving'
    ? 'Saving...'
    : state === 'saved'
      ? 'Saved'
      : state === 'error'
        ? 'Could not save'
        : '';
}
