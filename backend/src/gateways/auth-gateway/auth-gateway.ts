/**
 * File: auth-gateway.ts
 * Description: All database access for users.
 * Author: TTG Full-Stack Web Boilerplate
 * Modified by: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Date: 2026-08-10
 */
import { User } from '../../../generated/prisma';
import { prisma } from '../../../prisma/prisma-client';

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
  static async searchUsers(query: string, limit = 10) {
    const term = query.trim();
    return prisma.user.findMany({
      where: term
        ? {
            OR: [
              { email: { contains: term, mode: 'insensitive' } },
              { name: { contains: term, mode: 'insensitive' } },
            ],
          }
        : {},
      orderBy: { email: 'asc' },
      take: limit,
      select: { id: true, email: true, name: true },
    });
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
