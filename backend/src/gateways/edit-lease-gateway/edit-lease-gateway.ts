/**
 * File: edit-lease-gateway.ts
 * Description: Database access for advisory editing claims.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-09-04
 */
import { EditScope } from '../../../generated/prisma';
import { prisma } from '../../../prisma/prisma-client';

/** Enough of the holder to say whose name goes on the lock. */
const withHolder = { user: { select: { id: true, email: true, name: true } } };

export default class EditLeaseGateway {
  /**
   * Every claim on this course renewed since `since`, with who holds it.
   *
   * Filtered by time rather than deleted on expiry: a claim lapses because
   * nobody renewed it, and there is no moment anybody is around to notice. The
   * read is what applies the rule, so a stale row is harmless until the next
   * write reuses it.
   */
  static listLive(courseId: string, since: Date) {
    return prisma.editLease.findMany({
      where: { courseId, renewedAt: { gte: since } },
      include: withHolder,
    });
  }

  static find(scope: EditScope, targetId: string) {
    return prisma.editLease.findUnique({
      where: { scope_targetId: { scope, targetId } },
      include: withHolder,
    });
  }

  /**
   * Takes or renews a claim, if nobody else holds a live one.
   *
   * Written as a conditional `updateMany` followed by a create so the whole
   * thing is decided by the database rather than by a read the caller acted on
   * a moment later. Two authors clicking into the same module at the same
   * instant both pass a prior `find`; only one of them passes this.
   */
  static async claim(
    courseId: string,
    scope: EditScope,
    targetId: string,
    userId: number,
    staleBefore: Date,
  ) {
    const now = new Date();

    // Mine already, or lapsed and therefore anybody's. Both are a renewal.
    const { count } = await prisma.editLease.updateMany({
      where: {
        scope,
        targetId,
        OR: [{ userId }, { renewedAt: { lt: staleBefore } }],
      },
      data: { courseId, userId, renewedAt: now },
    });
    if (count > 0) return EditLeaseGateway.find(scope, targetId);

    try {
      return await prisma.editLease.create({
        data: { courseId, scope, targetId, userId, claimedAt: now, renewedAt: now },
        include: withHolder,
      });
    } catch {
      // Somebody else created it between the update and the create. Their claim
      // stands; the caller compares the holder and reports the refusal.
      return EditLeaseGateway.find(scope, targetId);
    }
  }

  /** Gives up a claim, but only one this person actually holds. */
  static release(scope: EditScope, targetId: string, userId: number) {
    return prisma.editLease.deleteMany({ where: { scope, targetId, userId } });
  }

  /** Gives up everything this person holds in one course, on leaving it. */
  static releaseAll(courseId: string, userId: number) {
    return prisma.editLease.deleteMany({ where: { courseId, userId } });
  }

  /**
   * Clears rows nobody has renewed. Housekeeping only — the read already ignores
   * them, so this never has to run for the rule to hold.
   */
  static purgeStale(staleBefore: Date) {
    return prisma.editLease.deleteMany({ where: { renewedAt: { lt: staleBefore } } });
  }
}
