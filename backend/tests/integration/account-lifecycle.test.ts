/**
 * File: account-lifecycle.test.ts
 * Description: API integration tests for a learning account's whole life under a
 *   shared Keycloak login — signing up, being deleted, coming back with the same
 *   email, and arriving by a one-time link first.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Date: 2026-11-11
 */
import { createHash, generateKeyPairSync, randomBytes } from 'crypto';
import type { Express } from 'express';
import { readFileSync } from 'fs';
import jwt from 'jsonwebtoken';
import { join } from 'path';
import request from 'supertest';

import { prisma } from '../../prisma/prisma-client';
import { hasDatabase } from '../setup-integration';

/**
 * The login is Keycloak's and is shared with other apps, so deleting somebody
 * here removes their learning account and nothing else. Their Keycloak account
 * — and its fixed id, `sub` — survives, and the same person signing in again
 * presents the same `sub` and the same email. Every test below is written from
 * that point of view: a "returning" user is the same subject, not a new one.
 *
 * Tokens are real, signed by a key made for this file, exactly as in
 * default-tutorial.test.ts.
 */
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const ISSUER = `${(process.env.KEYCLOAK_URL ?? 'http://localhost:4000').replace(/\/+$/, '')}/realms/${
  process.env.KEYCLOAK_REALM ?? 'learningapp'
}`;
const CLIENT = (process.env.KEYCLOAK_CLIENT_ID ?? 'learning-client').split(',')[0].trim();

function tokenFor(
  email: string,
  { subject = `kc-${email}`, verified = true, roles = [] as string[] } = {},
) {
  return jwt.sign(
    {
      azp: CLIENT,
      email,
      email_verified: verified,
      name: email.split('@')[0],
      resource_access: { [CLIENT]: { roles } },
    },
    privateKey.export({ type: 'pkcs8', format: 'pem' }),
    { algorithm: 'RS256', issuer: ISSUER, subject, expiresIn: '5m' },
  );
}

const ADMIN = () => tokenFor('admin@example.com', { roles: ['admin'] });
const hash = (token: string) => createHash('sha256').update(token).digest('hex');

/** A published course with a snapshot behind it — something a learner can actually open. */
async function publishedCourse(title: string) {
  const course = await prisma.course.create({
    data: { title, published: true, publishedVersion: 1 },
  });
  await prisma.coursePublication.create({
    data: {
      courseId: course.id,
      version: 1,
      snapshot: { id: course.id, title, modules: [], sections: [] },
    },
  });
  return course;
}

/**
 * What sending somebody a private link leaves behind: the assignment, and a
 * User row for the address with no Keycloak account bound to it yet.
 */
async function sendLink(email: string, courseId: string) {
  const token = randomBytes(24).toString('base64url');
  await prisma.user.upsert({ where: { email }, update: {}, create: { email } });
  await prisma.assignment.create({
    data: { type: 'LINK', email, courseId, tokenHash: hash(token) },
  });
  return token;
}

const describeWithDatabase = hasDatabase ? describe : describe.skip;

describeWithDatabase('a learning account under a shared login', () => {
  let app: Express;

  beforeAll(() => {
    process.env.PUBLICKEY = publicKey
      .export({ type: 'spki', format: 'pem' })
      .toString()
      .replace(/-----[^-]+-----/g, '')
      .replace(/\s+/g, '');
    // No Keycloak admin access in a test: the delete must still work, and must
    // never try to reach the shared realm.
    delete process.env.KEYCLOAK_SERVICE_CLIENT_ID;
    delete process.env.KEYCLOAK_SERVICE_CLIENT_SECRET;
    delete process.env.REQUIRE_VERIFIED_EMAIL;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    app = require('@/index').app;
  });

  afterEach(() => {
    delete process.env.REQUIRE_VERIFIED_EMAIL;
  });

  const learning = (token: string) =>
    request(app).get('/curriculum/courses').set('Authorization', `Bearer ${token}`);

  const courseIds = (body: { courses?: Array<{ id: string }> }) =>
    (body.courses ?? []).map((course) => course.id);

  describe('signing up', () => {
    it('makes a learning account on the first request, bound to the Keycloak account', async () => {
      const response = await learning(tokenFor('new@example.com', { subject: 'kc-new' }));

      expect(response.status).toBe(200);
      const user = await prisma.user.findUnique({ where: { email: 'new@example.com' } });
      expect(user).toMatchObject({ keycloakSubject: 'kc-new' });
    });

    /** A first sign-in fires several requests at once; none of them may fail. */
    it('answers every request of a first sign-in, however they race', async () => {
      const token = tokenFor('racer@example.com', { subject: 'kc-racer' });
      const responses = await Promise.all([
        learning(token),
        request(app).get('/curriculum/dashboard').set('Authorization', `Bearer ${token}`),
        request(app).get('/me/tour').set('Authorization', `Bearer ${token}`),
        learning(token),
      ]);

      expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200]);
      expect(await prisma.user.count({ where: { email: 'racer@example.com' } })).toBe(1);
    });
  });

  describe('an admin deleting the account', () => {
    const email = 'leaver@example.com';
    const subject = 'kc-leaver';

    /** Signs them in, gives them something to lose, then deletes them. */
    async function deleteAfterUse() {
      expect((await learning(tokenFor(email, { subject }))).status).toBe(200);
      const course = await publishedCourse('Manual handling');
      await prisma.assignment.create({
        data: { type: 'PLATFORM', email, courseId: course.id, tokenHash: hash(email) },
      });
      const before = await prisma.user.update({
        where: { email },
        data: { tourStatus: 'COMPLETED', lastSignInAt: new Date() },
      });

      const response = await request(app)
        .delete(`/auth/users/${before.id}`)
        .set('Authorization', `Bearer ${ADMIN()}`);
      expect(response.status).toBe(200);

      return { before, course };
    }

    it('removes the learning account and everything assigned to the address', async () => {
      const { before } = await deleteAfterUse();

      expect(await prisma.user.findUnique({ where: { id: before.id } })).toBeNull();
      expect(await prisma.assignment.count({ where: { email } })).toBe(0);
    });

    /**
     * The point of the change: their Keycloak account still exists, so coming
     * back is a sign-in with the same subject and email — and it has to give
     * them a brand-new, empty learning account rather than an error or the old
     * one.
     */
    it('lets the same person come back with the same email as a fresh learner', async () => {
      const { before, course } = await deleteAfterUse();

      const response = await learning(tokenFor(email, { subject }));

      expect(response.status).toBe(200);
      expect(courseIds(response.body)).not.toContain(course.id);
      const after = await prisma.user.findUnique({ where: { email } });
      expect(after).not.toBeNull();
      expect(after!.id).not.toBe(before.id);
      expect(after).toMatchObject({ keycloakSubject: subject, tourStatus: 'NOT_STARTED' });
    });

    it('lets them be assigned work again, and finds it when they sign back in', async () => {
      await deleteAfterUse();
      const course = await publishedCourse('Fire safety');
      await prisma.assignment.create({
        data: { type: 'PLATFORM', email, courseId: course.id, tokenHash: hash(`${email}-2`) },
      });

      const response = await learning(tokenFor(email, { subject }));

      expect(response.status).toBe(200);
      expect(courseIds(response.body)).toContain(course.id);
    });

    it('lets a deleted person who is then sent a link sign back in without a conflict', async () => {
      await deleteAfterUse();
      const course = await publishedCourse('Induction');
      await sendLink(email, course.id);

      const response = await learning(tokenFor(email, { subject }));

      expect(response.status).toBe(200);
      expect(await prisma.user.findUnique({ where: { email } })).toMatchObject({
        keycloakSubject: subject,
      });
    });
  });

  describe('somebody sent a one-time link, then making an account', () => {
    const email = 'linked@example.com';

    it('opens the link as a guest before they have an account', async () => {
      const course = await publishedCourse('Induction');
      const token = await sendLink(email, course.id);

      const response = await request(app).get(`/public/assignments/${token}/session`);

      expect(response.status).toBe(200);
    });

    it('signs up and in with that email without an error', async () => {
      const course = await publishedCourse('Induction');
      await sendLink(email, course.id);

      const response = await learning(tokenFor(email, { subject: 'kc-linked' }));

      expect(response.status).toBe(200);
      // The row the link made is now theirs, rather than a second one.
      expect(await prisma.user.count({ where: { email } })).toBe(1);
      expect(await prisma.user.findUnique({ where: { email } })).toMatchObject({
        keycloakSubject: 'kc-linked',
      });
    });

    it('signs in without an error before they have verified their email', async () => {
      const course = await publishedCourse('Induction');
      await sendLink(email, course.id);

      const response = await learning(tokenFor(email, { subject: 'kc-linked', verified: false }));

      expect(response.status).toBe(200);
    });

    /**
     * Only PLATFORM assignments reach the Learning tab, so a course sent by link
     * used to vanish the moment they signed up. Their first sign-in now moves
     * it onto the account.
     */
    it('finds the course they were sent by link on their Learning tab', async () => {
      const course = await publishedCourse('Induction');
      await sendLink(email, course.id);

      const response = await learning(tokenFor(email, { subject: 'kc-linked' }));

      expect(courseIds(response.body)).toContain(course.id);
      expect(await prisma.assignment.findFirst({ where: { email } })).toMatchObject({
        type: 'PLATFORM',
      });
    });

    /** The old URL now tells them where the work went, rather than opening it as a guest. */
    it('turns the old link into a "sign in to reach it" page', async () => {
      const course = await publishedCourse('Induction');
      const token = await sendLink(email, course.id);
      await learning(tokenFor(email, { subject: 'kc-linked' }));

      const response = await request(app).get(`/public/assignments/${token}/session`);

      expect(response.status).not.toBe(200);
      expect(response.body.reason).toBe('sign-in');
    });

    /** A one-time quiz is reached only through its link — for account holders too. */
    it('leaves a one-time quiz on its link', async () => {
      const quiz = await prisma.quiz.create({
        data: { title: 'Exit check', type: 'ONE_TIME', published: true },
      });
      const token = randomBytes(24).toString('base64url');
      await prisma.user.create({ data: { email } });
      await prisma.assignment.create({
        data: { type: 'LINK', email, quizId: quiz.id, tokenHash: hash(token) },
      });

      await learning(tokenFor(email, { subject: 'kc-linked' }));

      expect(await prisma.assignment.findFirst({ where: { email } })).toMatchObject({
        type: 'LINK',
      });
      expect((await request(app).get(`/public/assignments/${token}/session`)).status).toBe(200);
    });

    /** A quiz set built around a one-time quiz goes by link for the same reason. */
    it('leaves a quiz set holding a one-time quiz on its link', async () => {
      const set = await publishedCourse('Exit check set');
      const section = await prisma.section.create({
        data: { courseId: set.id, number: '1', sortKey: '1', title: 'Exit check' },
      });
      await prisma.quiz.create({
        data: { title: 'Exit check', type: 'ONE_TIME', published: true, sectionId: section.id },
      });
      await sendLink(email, set.id);

      await learning(tokenFor(email, { subject: 'kc-linked' }));

      expect(await prisma.assignment.findFirst({ where: { email } })).toMatchObject({
        type: 'LINK',
      });
    });

    /** The author turned it off; signing up must not turn it back on. */
    it('leaves a revoked link revoked', async () => {
      const course = await publishedCourse('Induction');
      await sendLink(email, course.id);
      await prisma.assignment.updateMany({ where: { email }, data: { revokedAt: new Date() } });

      const response = await learning(tokenFor(email, { subject: 'kc-linked' }));

      expect(courseIds(response.body)).not.toContain(course.id);
      expect(await prisma.assignment.findFirst({ where: { email } })).toMatchObject({
        type: 'LINK',
      });
    });

    /** Someone else's link to their own address is not theirs to collect. */
    it('moves nothing sent to a different address', async () => {
      const course = await publishedCourse('Induction');
      await sendLink('colleague@example.com', course.id);

      await learning(tokenFor(email, { subject: 'kc-linked' }));

      expect(
        await prisma.assignment.findFirst({ where: { email: 'colleague@example.com' } }),
      ).toMatchObject({ type: 'LINK' });
    });
  });

  describe('a learner erasing their own data', () => {
    const email = 'eraser@example.com';
    const subject = 'kc-eraser';

    async function eraseOwnData() {
      const token = tokenFor(email, { subject });
      expect((await learning(token)).status).toBe(200);
      const before = await prisma.user.findUniqueOrThrow({ where: { email } });

      const response = await request(app)
        .delete('/me/data')
        .set('Authorization', `Bearer ${token}`);
      expect(response.status).toBe(200);
      return before;
    }

    it('takes the email off the record', async () => {
      const before = await eraseOwnData();

      const erased = await prisma.user.findUniqueOrThrow({ where: { id: before.id } });
      expect(erased.email).toMatch(/@erased\.invalid$/);
    });

    it('releases the erased record from their Keycloak account', async () => {
      const before = await eraseOwnData();

      const erased = await prisma.user.findUniqueOrThrow({ where: { id: before.id } });
      expect(erased.keycloakSubject).toBeNull();
    });

    /**
     * The erased record used to keep the Keycloak id, so the next sign-in found
     * it again and copied the real email back onto it: the erased account came
     * back instead of a fresh one.
     */
    it('signs them back in as a fresh learner, not the erased record', async () => {
      const before = await eraseOwnData();

      const response = await learning(tokenFor(email, { subject }));

      expect(response.status).toBe(200);
      const erased = await prisma.user.findUniqueOrThrow({ where: { id: before.id } });
      expect(erased.email).toMatch(/@erased\.invalid$/);
      expect(erased.keycloakSubject).toBeNull();
      const fresh = await prisma.user.findUniqueOrThrow({ where: { email } });
      expect(fresh.id).not.toBe(before.id);
    });

    /**
     * The unverified half: the real address was never copied back, so they
     * stayed signed in as the erased placeholder and nothing assigned to their
     * real email reached them.
     */
    it('finds work assigned to their real email after signing back in', async () => {
      await eraseOwnData();
      const course = await publishedCourse('Fire safety');
      await prisma.assignment.create({
        data: { type: 'PLATFORM', email, courseId: course.id, tokenHash: hash(email) },
      });

      const response = await learning(tokenFor(email, { subject, verified: false }));

      expect(courseIds(response.body)).toContain(course.id);
    });

    /**
     * Somebody erased before the fix: their row is still bound. Both the
     * sign-in safety net and the migration must release it.
     */
    describe('erased before erasure released the login', () => {
      async function erasedStillBound() {
        return prisma.user.create({
          data: {
            email: 'erased-1-1700000000000@erased.invalid',
            keycloakSubject: subject,
          },
        });
      }

      it('gives them a fresh account on their next sign-in', async () => {
        const old = await erasedStillBound();

        const response = await learning(tokenFor(email, { subject }));

        expect(response.status).toBe(200);
        expect(await prisma.user.findUniqueOrThrow({ where: { id: old.id } })).toMatchObject({
          email: old.email,
          keycloakSubject: null,
        });
        expect(await prisma.user.findUniqueOrThrow({ where: { email } })).toMatchObject({
          keycloakSubject: subject,
        });
      });

      /** The deploy-time repair, run as written in the migration file. */
      it('is released by the migration, and nobody else is', async () => {
        const old = await erasedStillBound();
        const live = await prisma.user.create({
          data: { email: 'live@example.com', keycloakSubject: 'kc-live' },
        });

        await prisma.$executeRawUnsafe(
          readFileSync(
            join(
              __dirname,
              '../../prisma/migrations/20261111120000_release_erased_users/migration.sql',
            ),
            'utf8',
          ),
        );

        expect(
          (await prisma.user.findUniqueOrThrow({ where: { id: old.id } })).keycloakSubject,
        ).toBeNull();
        expect(
          (await prisma.user.findUniqueOrThrow({ where: { id: live.id } })).keycloakSubject,
        ).toBe('kc-live');
      });
    });
  });
});
