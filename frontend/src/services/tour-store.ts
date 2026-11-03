/**
 * File: tour-store.ts
 * Description: Where the first-login walkthrough keeps its place — the server for
 *   signed-in users, the browser for guests.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-10-30
 */
import HttpHelper from '@/utils/http-helper';
import { logger } from '@/utils/logger';

/** Mirrors the server's `TourStatus` enum. */
export type TourStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED';

/** Where someone is in the walkthrough. */
export interface TourState {
  status: TourStatus;
  step: number;
}

/** What a fresh visitor starts with: never shown the tour. */
export const FRESH_TOUR: TourState = { status: 'NOT_STARTED', step: 0 };

/**
 * Signed-in users: on their User row, so the tour follows them between devices
 * and a second login does not show it again.
 */
export const accountTourStore = {
  load: async (): Promise<TourState & { tutorialCourseId: string | null }> => {
    const response = await HttpHelper.get('me/tour');
    return {
      status: response.status,
      step: response.step,
      tutorialCourseId: response.tutorialCourseId ?? null,
    };
  },
  save: async (state: TourState): Promise<void> => {
    await HttpHelper.put('me/tour', state);
  },
};

/**
 * Guests: in this browser's localStorage, keyed by a hash of their link.
 *
 * A link is not an account — it acts as whoever owns the address — so there is
 * no row on the server that is the guest's alone to keep this on. The browser
 * is the next best place, and localStorage rather than sessionStorage because a
 * one-time link may only be opened once: a guest who reloads, or closes the tab
 * and comes back through the same link, must not lose their place in the tour.
 *
 * Keyed by a hash rather than by the token itself. The token is a credential,
 * and `guest-context.tsx` keeps it in sessionStorage on purpose so that it does
 * not outlive the tab; writing it into a localStorage key would undo that. A
 * hash identifies the link without being usable as one.
 */
export function guestTourStore(token: string) {
  const keyFor = async () => `tour:guest:${await digest(token)}`;

  return {
    load: async (): Promise<TourState> => {
      try {
        const raw = localStorage.getItem(await keyFor());
        if (!raw) return FRESH_TOUR;
        const parsed = JSON.parse(raw) as Partial<TourState>;
        if (!isStatus(parsed.status) || typeof parsed.step !== 'number') return FRESH_TOUR;
        return { status: parsed.status, step: parsed.step };
      } catch (err) {
        // Storage blocked or the value is junk: start fresh rather than fail.
        logger.debug('could not read guest tour state', err);
        return FRESH_TOUR;
      }
    },
    save: async (state: TourState): Promise<void> => {
      try {
        localStorage.setItem(await keyFor(), JSON.stringify(state));
      } catch (err) {
        // A private window can refuse storage. The tour still runs; it just
        // will not be remembered, which is the most anything could do there.
        logger.debug('could not save guest tour state', err);
      }
    },
  };
}

const STATUSES: TourStatus[] = ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED'];

/** Whether a stored value is one of the four statuses. */
function isStatus(value: unknown): value is TourStatus {
  return typeof value === 'string' && (STATUSES as string[]).includes(value);
}

/**
 * SHA-256 of the text as hex, or a short non-cryptographic hash where the
 * browser offers no `crypto.subtle` (it is only available on secure origins).
 *
 * The fallback is still one-way: the point is that the stored key cannot be
 * turned back into a working link, and 32 bits of a 192-bit random token cannot.
 */
export async function digest(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const bytes = await subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
  }

  // FNV-1a.
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16);
}
