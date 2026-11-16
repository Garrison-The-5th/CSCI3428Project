/**
 * File: default-tutorial.test.ts
 * Description: API integration tests for the default tutorial and the tour —
 *   who can read it, who can change it, and that nobody can take it away.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-10-30
 */
import { createHash, generateKeyPairSync, randomBytes } from 'crypto';
import type { Express } from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';

import { prisma } from '../../prisma/prisma-client';
import { hasDatabase } from '../setup-integration';

/**
 * Real tokens, signed by a key made for this file.
 *
 * The middleware reads the pinned key once, when it is first imported, so the
 * key has to be in the environment before anything pulls the app in — which is
 * why the app is `require`d in `beforeAll` rather than imported at the top.
 * Everything else about the token is what Keycloak would send: the realm's
 * issuer, the app's client as `azp`, and the client roles under it.
 */
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const ISSUER = `${(process.env.KEYCLOAK_URL ?? 'http://localhost:4000').replace(/\/+$/, '')}/realms/${
  process.env.KEYCLOAK_REALM ?? 'learningapp'
}`;
const CLIENT = (process.env.KEYCLOAK_CLIENT_ID ?? 'learning-client').split(',')[0].trim();

function tokenFor(email: string, roles: string[] = []) {
  return jwt.sign(
    {
      azp: CLIENT,
      email,
      email_verified: true,
      name: email.split('@')[0],
      resource_access: { [CLIENT]: { roles } },
    },
    privateKey.export({ type: 'pkcs8', format: 'pem' }),
    { algorithm: 'RS256', issuer: ISSUER, subject: `kc-${email}`, expiresIn: '5m' },
  );
}

const describeWithDatabase = hasDatabase ? describe : describe.skip;

describeWithDatabase('the default tutorial over HTTP', () => {
  let app: Express;
  let ensureDefaultTutorial: () => Promise<string | null>;
  let clearCache: () => void;
  let tutorialId: string;

  beforeAll(() => {
    process.env.PUBLICKEY = publicKey
      .export({ type: 'spki', format: 'pem' })
      .toString()
      .replace(/-----[^-]+-----/g, '')
      .replace(/\s+/g, '');
    /* eslint-disable @typescript-eslint/no-require-imports */
    app = require('@/index').app;
    ensureDefaultTutorial =
      require('@/services/default-tutorial-service/default-tutorial-bootstrap').ensureDefaultTutorial;
    clearCache = require('@/services/default-tutorial-service/default-tutorial-service').default
      .clearCache;
    /* eslint-enable @typescript-eslint/no-require-imports */
  });

  // Every table is emptied after each test, so the tutorial is made afresh.
  beforeEach(async () => {
    clearCache();
    tutorialId = (await ensureDefaultTutorial())!;
    expect(tutorialId).toBeTruthy();
  });

  const learner = () => tokenFor('learner@example.com');
  const contributor = () => tokenFor('author@example.com', ['contributor']);
  const admin = () => tokenFor('admin@example.com', ['admin']);

  describe('reading', () => {
    /** Nobody assigned it to them, and they have it anyway. */
    it('is on the Learning tab of a learner nobody has assigned anything to', async () => {
      const response = await request(app)
        .get('/curriculum/courses')
        .set('Authorization', `Bearer ${learner()}`);

      expect(response.status).toBe(200);
      const ids = (response.body.courses ?? response.body).map((c: { id: string }) => c.id);
      expect(ids).toContain(tutorialId);
    });

    /** Listing it and then refusing to open it is the failure this guards. */
    it('opens for that learner, with no deadline', async () => {
      const response = await request(app)
        .get(`/curriculum/courses/${tutorialId}`)
        .set('Authorization', `Bearer ${learner()}`);

      expect(response.status).toBe(200);
      expect(response.body.course).toMatchObject({
        id: tutorialId,
        isDefaultTutorial: true,
        dueDate: null,
        locked: false,
      });
    });

    it('is on their dashboard as outstanding, flagged', async () => {
      const response = await request(app)
        .get('/curriculum/dashboard')
        .set('Authorization', `Bearer ${learner()}`);

      expect(response.status).toBe(200);
      const dashboard = response.body.dashboard ?? response.body;
      expect(dashboard.outstandingCourses).toEqual([
        expect.objectContaining({ courseId: tutorialId, isDefaultTutorial: true }),
      ]);
    });

    it('opens for a guest holding a link to some other course', async () => {
      const other = await prisma.course.create({
        data: { title: 'Fire safety', published: true, publishedVersion: 1 },
      });
      await prisma.coursePublication.create({
        data: {
          courseId: other.id,
          version: 1,
          snapshot: { id: other.id, title: 'Fire safety', models: [], sections: [] },
        },
      });
      const token = randomBytes(24).toString('base64url');
      await prisma.assignment.create({
        data: {
          type: 'LINK',
          email: 'guest@example.com',
          courseId: other.id,
          tokenHash: createHash('sha256').update(token).digest('hex'),
        },
      });

      const response = await request(app).get(`/public/assignments/${token}/courses`);

      expect(response.status).toBe(200);
      const ids = (response.body.courses ?? response.body).map((c: { id: string }) => c.id);
      expect(ids).toEqual(expect.arrayContaining([other.id, tutorialId]));
    });
  });

  describe('changing it', () => {
    it('refuses a learner', async () => {
      const response = await request(app)
        .put(`/curriculum/courses/${tutorialId}`)
        .set('Authorization', `Bearer ${learner()}`)
        .send({ title: 'Mine now' });

      expect(response.status).toBe(403);
    });

    /**
     * An author can edit every ordinary course they were given — but not this
     * one, on any route that writes to it.
     */
    it.each([
      ['update the course', 'put', () => `/curriculum/courses/${tutorialId}`, { title: 'x' }],
      ['publish it', 'post', () => `/curriculum/courses/${tutorialId}/publish`, {}],
      ['add a model', 'post', () => `/curriculum/courses/${tutorialId}/models`, { title: 'x' }],
      [
        'add a section',
        'post',
        () => `/curriculum/courses/${tutorialId}/sections`,
        { title: 'x', type: 'TEXT' },
      ],
      [
        'name contributors',
        'put',
        () => `/curriculum/courses/${tutorialId}/contributors`,
        { emails: ['author@example.com'] },
      ],
      ['delete it', 'delete', () => `/curriculum/courses/${tutorialId}`, undefined],
    ] as const)('refuses a contributor who tries to %s', async (_label, method, path, body) => {
      const response = await request(app)
        [method](path())
        .set('Authorization', `Bearer ${contributor()}`)
        .send(body);

      expect(response.status).toBe(403);
      expect(response.body.errorMessage).toBe('Only admins can edit the default tutorial');
    });

    it('refuses a contributor on its models, sections and quizzes', async () => {
      const section = await prisma.section.findFirstOrThrow({ where: { courseId: tutorialId } });
      const model = await prisma.model.findFirstOrThrow({ where: { courseId: tutorialId } });
      const token = contributor();

      // One at a time: the first request signs this person in and creates their
      // row, and several racing to do that is a different test.
      const writes = [
        () =>
          request(app)
            .put(`/curriculum/sections/${section.id}`)
            .set('Authorization', `Bearer ${token}`)
            .send({ title: 'x' }),
        () =>
          request(app)
            .put(`/curriculum/sections/${section.id}`)
            .set('Authorization', `Bearer ${token}`)
            .send({ textContent: 'x' }),
        () =>
          request(app)
            .put(`/curriculum/models/${model.id}`)
            .set('Authorization', `Bearer ${token}`)
            .send({ title: 'x' }),
        () =>
          request(app)
            .delete(`/curriculum/sections/${section.id}`)
            .set('Authorization', `Bearer ${token}`),
        () =>
          request(app)
            .get(`/curriculum/courses/${tutorialId}/deleted`)
            .set('Authorization', `Bearer ${token}`),
        () =>
          request(app)
            .post('/quizzes')
            .set('Authorization', `Bearer ${token}`)
            .send({ title: 'x', sectionId: section.id }),
      ];

      for (const write of writes) expect((await write()).status).toBe(403);
    });

    it('is left out of a contributor’s editor list', async () => {
      const response = await request(app)
        .get('/curriculum/courses/editable')
        .set('Authorization', `Bearer ${contributor()}`);

      const ids = (response.body.courses ?? []).map((c: { id: string }) => c.id);
      expect(ids).not.toContain(tutorialId);
    });

    it('lets an admin edit it', async () => {
      const response = await request(app)
        .put(`/curriculum/courses/${tutorialId}`)
        .set('Authorization', `Bearer ${admin()}`)
        .send({ title: 'Start here' });

      expect(response.status).toBe(200);
      expect(response.body.course.title).toBe('Start here');
    });

    /** Edits wait for Publish, exactly as on any course. */
    it('keeps serving learners the published version until an admin publishes', async () => {
      await request(app)
        .put(`/curriculum/courses/${tutorialId}`)
        .set('Authorization', `Bearer ${admin()}`)
        .send({ title: 'Start here' });

      const before = await request(app)
        .get(`/curriculum/courses/${tutorialId}`)
        .set('Authorization', `Bearer ${learner()}`);
      expect(before.body.course.title).toBe('Getting started');

      await request(app)
        .post(`/curriculum/courses/${tutorialId}/publish`)
        .set('Authorization', `Bearer ${admin()}`);

      const after = await request(app)
        .get(`/curriculum/courses/${tutorialId}`)
        .set('Authorization', `Bearer ${learner()}`);
      expect(after.body.course.title).toBe('Start here');
    });
  });

  /**
   * The tutorial on the two-layer structure: one model, "Welcome", holding one
   * TEXT section, "Welcome to the platform", with its text on the section.
   */
  describe('its structure', () => {
    it('is one Welcome model holding one TEXT section with the welcome text', async () => {
      const models = await prisma.model.findMany({ where: { courseId: tutorialId } });
      const sections = await prisma.section.findMany({ where: { courseId: tutorialId } });

      expect(models.map((model) => [model.number, model.title])).toEqual([[1, 'Welcome']]);
      expect(sections).toEqual([
        expect.objectContaining({
          modelId: models[0].id,
          number: '1.1',
          title: 'Welcome to the platform',
          type: 'TEXT',
          textContent: '<p>Tutorial content coming soon.</p>',
        }),
      ]);
    });

    it('reaches a learner as models and typed sections, with the text showing', async () => {
      const response = await request(app)
        .get(`/curriculum/courses/${tutorialId}`)
        .set('Authorization', `Bearer ${learner()}`);

      const course = response.body.course;
      expect(course.models.map((model: { title: string }) => model.title)).toEqual(['Welcome']);
      expect(course.sections).toEqual([
        expect.objectContaining({
          title: 'Welcome to the platform',
          type: 'TEXT',
          textContent: '<p>Tutorial content coming soon.</p>',
          quizzes: [],
        }),
      ]);
      expect(course).not.toHaveProperty('modules');
      expect(course.sections[0]).not.toHaveProperty('elements');
    });

    /** A start-up against the migrated tutorial has nothing left to do. */
    it('still satisfies ensureDefaultTutorial once it exists', async () => {
      const before = await prisma.section.count({ where: { courseId: tutorialId } });
      const versions = await prisma.coursePublication.count({ where: { courseId: tutorialId } });

      expect(await ensureDefaultTutorial()).toBe(tutorialId);

      expect(await prisma.section.count({ where: { courseId: tutorialId } })).toBe(before);
      expect(await prisma.coursePublication.count({ where: { courseId: tutorialId } })).toBe(
        versions,
      );
    });

    /** `type` is required on creation — the API refuses a section with none. */
    it('refuses to add a section with no type', async () => {
      const response = await request(app)
        .post(`/curriculum/courses/${tutorialId}/sections`)
        .set('Authorization', `Bearer ${admin()}`)
        .send({ title: 'Blank' });

      expect(response.status).toBe(400);
      expect(response.body.errorMessage).toMatch(/type is required/);
      expect(await prisma.section.count({ where: { courseId: tutorialId } })).toBe(1);
    });
  });

  describe('nobody can take it away', () => {
    it('refuses to delete it, even for an admin', async () => {
      const response = await request(app)
        .delete(`/curriculum/courses/${tutorialId}`)
        .set('Authorization', `Bearer ${admin()}`);

      expect(response.status).toBe(403);
      expect(response.body.errorMessage).toMatch(/cannot be deleted/);
      expect((await prisma.course.findUnique({ where: { id: tutorialId } }))?.deletedAt).toBeNull();
    });

    it('refuses to unpublish it, even for an admin', async () => {
      const response = await request(app)
        .put(`/curriculum/courses/${tutorialId}`)
        .set('Authorization', `Bearer ${admin()}`)
        .send({ published: false });

      expect(response.status).toBe(403);
      expect((await prisma.course.findUnique({ where: { id: tutorialId } }))?.published).toBe(true);
    });

    it('refuses to assign it', async () => {
      const response = await request(app)
        .post('/assignments')
        .set('Authorization', `Bearer ${admin()}`)
        .send({ email: 'learner@example.com', courseId: tutorialId });

      expect(response.status).toBe(403);
      expect(await prisma.assignment.count()).toBe(0);
    });

    /** The partial unique index, not just the bootstrap's own check. */
    it('allows only one default tutorial in the database', async () => {
      await expect(
        prisma.course.create({ data: { title: 'Second', isDefaultTutorial: true } }),
      ).rejects.toThrow();
    });

    it('is created only once however many times start-up runs', async () => {
      await ensureDefaultTutorial();
      await ensureDefaultTutorial();

      expect(await prisma.course.count({ where: { isDefaultTutorial: true } })).toBe(1);
      expect(await prisma.coursePublication.count({ where: { courseId: tutorialId } })).toBe(1);
    });
  });

  describe('/me/tour', () => {
    it('starts a brand-new account at NOT_STARTED, pointing at the tutorial', async () => {
      const response = await request(app)
        .get('/me/tour')
        .set('Authorization', `Bearer ${learner()}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        status: 'NOT_STARTED',
        step: 0,
        tutorialCourseId: tutorialId,
      });
    });

    it('remembers where they got to', async () => {
      const token = learner();
      await request(app)
        .put('/me/tour')
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'IN_PROGRESS', step: 6 });

      const response = await request(app).get('/me/tour').set('Authorization', `Bearer ${token}`);

      expect(response.body).toMatchObject({ status: 'IN_PROGRESS', step: 6 });
    });

    it('refuses a step outside the script', async () => {
      const response = await request(app)
        .put('/me/tour')
        .set('Authorization', `Bearer ${learner()}`)
        .send({ status: 'IN_PROGRESS', step: 99 });

      expect(response.status).toBe(400);
    });

    /**
     * The first page load makes several calls at once for a person with no row
     * yet. Every one must succeed — the tour's in particular, or it never
     * starts on the first sign-in.
     */
    it('answers every request of a brand-new person’s first page load', async () => {
      const token = tokenFor('brand-new@example.com');
      const responses = await Promise.all([
        request(app).get('/me/tour').set('Authorization', `Bearer ${token}`),
        request(app).get('/curriculum/dashboard').set('Authorization', `Bearer ${token}`),
        request(app).get('/curriculum/courses/editable').set('Authorization', `Bearer ${token}`),
        request(app).get('/curriculum/courses').set('Authorization', `Bearer ${token}`),
      ]);

      expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200]);
      expect(await prisma.user.count({ where: { email: 'brand-new@example.com' } })).toBe(1);
    });

    it('needs a signed-in user', async () => {
      const response = await request(app).put('/me/tour').send({ status: 'SKIPPED', step: 0 });

      expect(response.status).toBe(401);
    });
  });
});
