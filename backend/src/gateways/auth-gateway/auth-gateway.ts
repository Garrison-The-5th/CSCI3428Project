/**
 * File: auth-gateway.ts
 * Description: All database access for users.
 * Author: TTG Full-Stack Web Boilerplate
 * Modified by: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Date: 2026-08-10
 */
import { User } from '../../../generated/prisma';

/** What `User.role` holds: the highest app role somebody has. */
export type LocalRole = 'admin' | 'author' | 'user';
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
  /** Every user row. */
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

  /** Users whose local role is plain `user`. */
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

  /** One user by their numeric id, or null. */
  static getUserById(id: number): Promise<User | null> {
    return prisma.user.findUnique({ where: { id } });
  }

  /**
   * The local copy of somebody's highest role. Keycloak is the authority; this
   * is what the Users page falls back on when Keycloak cannot be asked.
   */
  static setRole(id: number, role: LocalRole) {
    return prisma.user.update({ where: { id }, data: { role } });
  }

  /**
   * Deletes the person and everything that is theirs. Progress, attempts,
   * sessions, notes, completions, choices and edit leases cascade from the row;
   * assignments are keyed by address rather than by row, so they go explicitly.
   * Content they wrote or published stays, with the credit set to nobody.
   */
  static async deleteUser(id: number, email: string) {
    const [assignments] = await prisma.$transaction([
      prisma.assignment.deleteMany({ where: { email: { equals: email, mode: 'insensitive' } } }),
      prisma.user.delete({ where: { id } }),
    ]);
    return { assignmentsDeleted: assignments.count };
  }

  /** Stamps the last sign-in time — the only reliable sign that someone has an account. */
  static markSignedIn(id: number) {
    return prisma.user.update({ where: { id }, data: { lastSignInAt: new Date() } });
  }

  /** Exact-match lookup; the caller lower-cases the address first. */
  static async getUserByEmail(email: string): Promise<User | null> {
    return await prisma.user.findUnique({
      where: { email },
    });
  }

  /** The user bound to a Keycloak account id (`sub`), or null if none is bound yet. */
  static getUserBySubject(keycloakSubject: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { keycloakSubject } });
  }

  /** Ties a row to the Keycloak account that signed in as it, for good. */
  static bindSubject(id: number, keycloakSubject: string): Promise<User> {
    return prisma.user.update({ where: { id }, data: { keycloakSubject } });
  }

  /** Changes a user's stored address (used when Keycloak reports a verified new email). */
  static setEmail(id: number, email: string): Promise<User> {
    return prisma.user.update({ where: { id }, data: { email } });
  }

  /** Inserts a user row, optionally already bound to a Keycloak account. */
  static async createUser(data: {
    email: string;
    name: string | null;
    keycloakSubject?: string;
  }): Promise<User> {
    return await prisma.user.create({
      data,
    });
  }

  /** Updates name and/or newsletter subscription; only the fields given change. */
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

  /**
   * Turns the newsletter on for an address, creating the row if needed. An
   * existing name is only replaced when a non-blank one is given.
   */
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

  /** Everyone subscribed to the newsletter, by email. */
  static async getSubscribedUsers(): Promise<User[]> {
    return await prisma.user.findMany({
      where: { subscribed: true },
      orderBy: { email: 'asc' },
    });
  }
}
