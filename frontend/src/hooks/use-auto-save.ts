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
  // The newest value, so `saveNow` can be a stable callback: taking `value` as a
  // dependency would rebuild it on every keystroke and with it every button that
  // holds one.
  const latest = useRef(value);
  latest.current = value;

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

  /**
   * Writes now instead of waiting out the delay — what a Save button calls.
   *
   * Auto-save is still doing the work; this only skips the pause. Every guard
   * above holds: the pending timer is dropped so the same value is not written
   * twice, and the ticket makes a save already in flight stand down rather than
   * race, so pressing Save mid-keystroke cannot land the older value last.
   *
   * It saves even when nothing has changed, deliberately. Somebody presses Save
   * to be told it is safe, and answering "nothing to do" to a button they just
   * pressed reads as a failure — one redundant write is the cheaper answer.
   */
  const saveNow = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);

    const value = latest.current;
    const serialised = JSON.stringify(value);
    const ticket = ++inFlight.current;

    setState('saving');
    try {
      await saveRef.current(value);
      if (ticket !== inFlight.current) return true;
      lastSaved.current = serialised;
      setState('saved');
      return true;
    } catch (err) {
      if (ticket !== inFlight.current) return false;
      logger.error('Save failed:', err);
      setState('error');
      return false;
    }
  }, []);

  return { state, markSaved, saveNow };
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

/**
 * Status line for something that already exists in the database.
 *
 * Different from `saveLabel` in what it does with `idle`, and the difference is
 * the whole point of it. A form that has never been touched has nothing to
 * report, so `saveLabel` says nothing. A record that is already stored — an
 * element in a section, a question in a quiz — is *saved*, and saying nothing
 * about it reads as the opposite: a video added, sitting safely in the
 * database, showed a blank where every other row showed "Saved", and authors
 * quite reasonably concluded it had not been.
 *
 * `dirty` is the caller's own answer to "does what is on screen match what is
 * stored", which only it can know, and is what keeps this from claiming a
 * half-typed edit has been written.
 */
export function saveStatus(state: SaveState, dirty = false): string {
  if (state === 'saving') return 'Saving...';
  if (state === 'error') return 'Could not save';
  return dirty ? 'Unsaved changes' : 'Saved';
}
