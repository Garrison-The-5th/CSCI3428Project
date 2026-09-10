/**
 * File: edit-lease-service.ts
 * Description: Who currently has a module or a question open, so two authors do
 *   not overwrite each other.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-09-04
 */
import EditLeaseGateway from '@/gateways/edit-lease-gateway/edit-lease-gateway';

import { EditScope } from '../../../generated/prisma';

/**
 * How long a claim survives without a heartbeat.
 *
 * The editor renews every `EDIT_LEASE_HEARTBEAT_MS`, so this is several beats'
 * grace: a slow request or a browser that was busy for a moment must not hand
 * somebody's module to the next person to glance at it. The cost of it being
 * generous is that a closed tab locks a module for this long, which is a far
 * smaller annoyance than losing work to a race.
 */
export const EDIT_LEASE_TTL_MS = 45_000;

/** How often the holder should renew. Sent to the client so there is one answer. */
export const EDIT_LEASE_HEARTBEAT_MS = 15_000;

/** One live claim, as the editor needs to render it. */
export interface Lease {
  scope: EditScope;
  targetId: string;
  userId: number;
  /** What the lock says. First name where there is one, else the address. */
  holder: string;
  mine: boolean;
}

/** "Jacob Matthews" reads as "Jacob" on a lock; an address has no first name. */
export function firstName(user: { name: string | null; email: string }): string {
  const given = (user.name ?? '').trim().split(/\s+/)[0];
  return given || user.email;
}

function staleBefore() {
  return new Date(Date.now() - EDIT_LEASE_TTL_MS);
}

/**
 * Advisory claims on the pieces of a course two people might edit at once.
 *
 * Advisory, not enforced at the database: the writes themselves are still
 * allowed, and this only decides what the editor greys out. That is deliberate.
 * A hard lock would need a reliable release, and a browser has no reliable way
 * to say it has gone — so the failure mode of enforcing would be content nobody
 * can edit, which is worse than the race it prevents.
 *
 * Two scopes, and the difference matters. A module is claimed whole, because
 * editing one is really editing the sections and elements inside it and there is
 * no smaller unit an author works in. A question is claimed on its own, because
 * two people writing different questions in the same quiz is ordinary
 * collaboration and locking the quiz would stop it for no reason.
 */
export default class EditLeaseService {
  /**
   * Takes or renews a claim.
   *
   * Returns whether it was granted and who holds it either way, so one call
   * serves both the first click and every heartbeat after it — and so a refusal
   * arrives with the name to show rather than sending the client back for it.
   */
  static async claim(courseId: string, scope: EditScope, targetId: string, userId: number) {
    const lease = await EditLeaseGateway.claim(courseId, scope, targetId, userId, staleBefore());

    if (!lease) return { granted: false, holder: null as string | null };

    return {
      granted: lease.userId === userId,
      holder: firstName(lease.user),
      holderId: lease.userId,
    };
  }

  static async release(scope: EditScope, targetId: string, userId: number) {
    const { count } = await EditLeaseGateway.release(scope, targetId, userId);
    return { released: count > 0 };
  }

  /** Everything this person holds in one course, given up at once on leaving. */
  static async releaseAll(courseId: string, userId: number) {
    const { count } = await EditLeaseGateway.releaseAll(courseId, userId);
    return { released: count };
  }

  /**
   * What is locked in this course right now, from the asker's point of view.
   *
   * Their own claims come back marked `mine` rather than filtered out: the
   * editor needs them to know which module it is still holding, and dropping
   * them here would have it fight itself for its own lock.
   */
  static async listForCourse(courseId: string, userId: number): Promise<Lease[]> {
    const leases = await EditLeaseGateway.listLive(courseId, staleBefore());

    return leases.map((lease) => ({
      scope: lease.scope,
      targetId: lease.targetId,
      userId: lease.userId,
      holder: firstName(lease.user),
      mine: lease.userId === userId,
    }));
  }
}
