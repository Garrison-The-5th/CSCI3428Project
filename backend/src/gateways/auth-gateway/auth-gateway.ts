/**
 * File: auth-gateway.ts
 * Description: All database access for users.
 * Author: TTG Full-Stack Web Boilerplate
 * Modified by: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Date: 2026-08-10
 */
import { User } from '../../../generated/prisma';
import { prisma } from '../../../prisma/prisma-client';

/**
 * Every read and write of the `User` table.
 *
 * The gateway layer is the only place Prisma is touched: services above it deal
 * in domain rules and never in queries, which is what keeps a schema change to
 * one file per table. Nothing here validates or decides — an invalid email is
 * the service's problem, not this one's.
 */
export default class AuthGateway {
  static async getAll(): Promise<User[]> {
    return await prisma.user.findMany();
  }

  /**
   * Everyone, with what the Users page needs to label them: whether they author
   * anything, and whether they have ever actually signed in.
   *
   * Counted rather than joined — the page shows a badge, not a list, and pulling
   * every editable course through would move a lot of data to answer "more than
   * zero?". Being a student is not here because an assignment is keyed on an
   * email address rather than a user id; see `getAssignedEmails`.
   */
  static async getAllWithRoles() {
    return prisma.user.findMany({
      orderBy: [{ name: 'asc' }, { email: 'asc' }],
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        subscribed: true,
        lastSignInAt: true,
        _count: { select: { editableCourses: true } },
      },
    });
  }

  /**
   * Every address that has been given something to learn.
   *
   * Assignments carry an email rather than a user id — that is what lets someone
   * be assigned before they have an account — so the set of students is a
   * distinct list of those addresses, not a relation off User.
   */
  static async getAssignedEmails(): Promise<Set<string>> {
    const rows = await prisma.assignment.findMany({
      distinct: ['email'],
      select: { email: true },
    });
    return new Set(rows.map((row) => row.email.toLowerCase()));
  }

  static async getUsers(): Promise<User[]> {
    return await prisma.user.findMany({
      where: { role: 'user' },
    });
  }

  /** Type-ahead over the people already in the system. */
  static async searchUsers(query: string, { limit = 10, accountsOnly = false } = {}) {
    const term = query.trim();
    return prisma.user.findMany({
      where: {
        ...(term
          ? {
              OR: [
                { email: { contains: term, mode: 'insensitive' } },
                { name: { contains: term, mode: 'insensitive' } },
              ],
            }
          : {}),
        // A User row is minted the moment somebody is assigned work, so its
        // existence proves nothing about whether they can sign in. Having done
        // so is the only reliable mark of a real account — see the note on
        // User.lastSignInAt — and it is what the on-platform picker needs, since
        // enrolling somebody who cannot log in sends them to a door they cannot
        // open.
        ...(accountsOnly ? { lastSignInAt: { not: null } } : {}),
      },
      orderBy: { email: 'asc' },
      take: limit,
      select: { id: true, email: true, name: true },
    });
  }

  /**
   * Whether one exact address belongs to somebody who can sign in.
   *
   * The counterpart of the filter above, for the link-only picker: a private
   * link handed to somebody with an account is a second, weaker way into work
   * that already belongs on their Learning page, so that column refuses the
   * address rather than minting one.
   */
  static async hasAccount(email: string): Promise<boolean> {
    const user = await prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      select: { lastSignInAt: true },
    });
    return user?.lastSignInAt != null;
  }

  static markSignedIn(id: number) {
    return prisma.user.update({ where: { id }, data: { lastSignInAt: new Date() } });
  }

  static async getUserByEmail(email: string): Promise<User | null> {
    return await prisma.user.findUnique({
      where: { email },
    });
  }

  static async createUser(data: { email: string; name: string | null }): Promise<User> {
    return await prisma.user.create({
      data,
    });
  }

  static async updateUser(
    id: number,
    data: { name?: string | null; subscribed?: boolean },
  ): Promise<User> {
    return await prisma.user.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.subscribed !== undefined ? { subscribed: data.subscribed } : {}),
      },
    });
  }

  static async subscribeUser(data: { email: string; name?: string | null }): Promise<User> {
    return await prisma.user.upsert({
      where: {
        email: data.email.toLowerCase(),
      },
      create: {
        email: data.email.toLowerCase(),
        name: data.name?.trim() || null,
        subscribed: true,
      },
      update: {
        subscribed: true,
        ...(data.name?.trim() ? { name: data.name.trim() } : {}),
      },
    });
  }

  static async getSubscribedUsers(): Promise<User[]> {
    return await prisma.user.findMany({
      where: { subscribed: true },
      orderBy: { email: 'asc' },
    });
  }
}
