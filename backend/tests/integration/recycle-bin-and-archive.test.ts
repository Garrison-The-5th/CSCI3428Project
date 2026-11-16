/**
 * File: recycle-bin-and-archive.test.ts
 * Description: API integration tests for where deleted things go — the admin
 *   recycle bin (courses and standalone quizzes) and a course's own Archive
 *   (its models, sections and quizzes).
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-11-13
 */
import { generateKeyPairSync } from 'crypto';
import type { Express } from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';

import { prisma } from '../../prisma/prisma-client';
import { hasDatabase } from '../setup-integration';

/**
 * Real tokens, signed by a key made for this file — see the note in
 * `default-tutorial.test.ts` for why the app is required late.
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

describeWithDatabase('deleted items: the recycle bin and the Archive', () => {
  let app: Express;

  beforeAll(() => {
    process.env.PUBLICKEY = publicKey
      .export({ type: 'spki', format: 'pem' })
      .toString()
      .replace(/-----[^-]+-----/g, '')
      .replace(/\s+/g, '');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    app = require('@/index').app;
  });

  const admin = () => tokenFor('admin@example.com', ['admin']);
  const outsider = () => tokenFor('someone-else@example.com', ['contributor']);

  const as = (token: string) => ({
    get: (path: string) => request(app).get(path).set('Authorization', `Bearer ${token}`),
    post: (path: string, body?: object) =>
      request(app).post(path).set('Authorization', `Bearer ${token}`).send(body),
    del: (path: string) => request(app).delete(path).set('Authorization', `Bearer ${token}`),
  });

  /** A lesson with one model, made through the API so every rule applies. */
  async function makeCourse(title = 'Fire safety') {
    const response = await as(admin()).post('/curriculum/courses', { title });
    expect(response.status).toBe(200);
    const course = response.body.course as { id: string; models: Array<{ id: string }> };
    return { courseId: course.id, modelId: course.models[0].id };
  }

  async function addSection(courseId: string, body: object) {
    const response = await as(admin()).post(`/curriculum/courses/${courseId}/sections`, body);
    expect(response.status).toBe(200);
    return response.body.section as { id: string; number: string; type: string };
  }

  describe('creating sections', () => {
    it('makes one section per type, each holding its own content', async () => {
      const { courseId } = await makeCourse();

      const text = await addSection(courseId, {
        title: 'Read',
        type: 'TEXT',
        textContent: '<p>Hi</p>',
      });
      const video = await addSection(courseId, {
        title: 'Watch',
        type: 'YOUTUBE',
        videoUrl: 'https://youtu.be/abc',
      });
      await addSection(courseId, { title: 'Look', type: 'IMAGE' });
      await addSection(courseId, { title: 'File', type: 'PDF' });
      await addSection(courseId, { title: 'Draw', type: 'CANVAS' });
      const quiz = await addSection(courseId, {
        title: 'Check',
        type: 'QUIZ',
        quizType: 'LEARNING_CHECK',
      });

      expect([text.number, video.number, quiz.number]).toEqual(['1.1', '1.2', '1.6']);

      const sections = await prisma.section.findMany({
        where: { courseId },
        orderBy: { sortKey: 'asc' },
        include: { quizzes: true },
      });
      expect(sections.map((section) => section.type)).toEqual([
        'TEXT',
        'YOUTUBE',
        'IMAGE',
        'PDF',
        'CANVAS',
        'QUIZ',
      ]);
      expect(sections[0].textContent).toBe('<p>Hi</p>');
      expect(sections[1].videoUrl).toBe('https://youtu.be/abc');
      // A canvas starts with a layout; a quiz section starts with its quiz.
      expect(sections[4].canvasData).not.toBeNull();
      expect(sections[5].quizzes).toEqual([
        expect.objectContaining({ title: 'Check', type: 'LEARNING_CHECK' }),
      ]);
      // Only the quiz section carries a quiz.
      expect(sections.slice(0, 5).every((section) => section.quizzes.length === 0)).toBe(true);
    });

    it('refuses a section with no type, and writes nothing', async () => {
      const { courseId } = await makeCourse();

      const response = await as(admin()).post(`/curriculum/courses/${courseId}/sections`, {
        title: 'Blank',
      });

      expect(response.status).toBe(400);
      expect(await prisma.section.count({ where: { courseId } })).toBe(0);
    });

    it('no longer has element routes', async () => {
      const { courseId } = await makeCourse();
      const section = await addSection(courseId, { title: 'Read', type: 'TEXT' });

      const create = await as(admin()).post(`/curriculum/sections/${section.id}/elements`, {
        type: 'TEXT',
      });
      const remove = await as(admin()).del(`/curriculum/elements/${section.id}`);

      expect(create.status).toBe(404);
      expect(remove.status).toBe(404);
    });
  });

  describe('the admin recycle bin', () => {
    it('lists courses and standalone quizzes only', async () => {
      const { courseId } = await makeCourse('Kept course');
      const text = await addSection(courseId, { title: 'Read', type: 'TEXT' });
      const quizSection = await addSection(courseId, { title: 'Check', type: 'QUIZ' });
      await addSection(courseId, { title: 'Stays', type: 'TEXT' });
      const extraModel = await as(admin()).post(`/curriculum/courses/${courseId}/models`, {
        title: 'Second',
      });

      // A section, a course quiz and a model are deleted inside a live course…
      await as(admin()).del(`/curriculum/sections/${text.id}`);
      const courseQuiz = await prisma.quiz.findFirstOrThrow({
        where: { sectionId: quizSection.id },
      });
      await as(admin()).del(`/quizzes/${courseQuiz.id}`);
      await as(admin()).del(`/curriculum/models/${extraModel.body.model.id}`);
      // …a whole course is deleted…
      const { courseId: binnedCourseId } = await makeCourse('Binned course');
      await as(admin()).del(`/curriculum/courses/${binnedCourseId}`);
      // …and so is a quiz that belongs to no course.
      const standalone = await prisma.quiz.create({
        data: { title: 'Old exam', deletedAt: new Date() },
      });

      const bin = await as(admin()).get('/curriculum/deleted');
      const quizBin = await as(admin()).get('/quizzes/deleted');

      expect(bin.status).toBe(200);
      expect(Object.keys(bin.body).sort()).toEqual(['courses', 'retentionDays']);
      expect(bin.body.courses.map((course: { id: string }) => course.id)).toEqual([binnedCourseId]);
      expect(bin.body).not.toHaveProperty('models');
      expect(bin.body).not.toHaveProperty('sections');

      // The course quiz is not here: it went to its course's Archive.
      expect(quizBin.body.quizzes.map((quiz: { id: string }) => quiz.id)).toEqual([standalone.id]);
    });

    it('restores courses and standalone quizzes, and leaves models and sections deleted', async () => {
      const { courseId } = await makeCourse('Kept course');
      const section = await addSection(courseId, { title: 'Read', type: 'TEXT' });
      await addSection(courseId, { title: 'Stays', type: 'TEXT' });
      await as(admin()).del(`/curriculum/sections/${section.id}`);
      const { courseId: binnedCourseId } = await makeCourse('Binned course');
      await as(admin()).del(`/curriculum/courses/${binnedCourseId}`);
      const standalone = await prisma.quiz.create({
        data: { title: 'Old exam', deletedAt: new Date() },
      });

      const restored = await as(admin()).post('/curriculum/deleted/restore-all');
      const restoredQuizzes = await as(admin()).post('/quizzes/deleted/restore-all');

      expect(restored.body.restored).toEqual({ courses: 1 });
      expect(restoredQuizzes.body.restored).toBe(1);
      expect(
        (await prisma.course.findUniqueOrThrow({ where: { id: binnedCourseId } })).deletedAt,
      ).toBeNull();
      expect(
        (await prisma.quiz.findUniqueOrThrow({ where: { id: standalone.id } })).deletedAt,
      ).toBeNull();
      // The section deleted inside the live course is still in its Archive.
      expect(
        (await prisma.section.findUniqueOrThrow({ where: { id: section.id } })).deletedAt,
      ).not.toBeNull();
    });

    /** "Empty the recycle bin and check that the section survives." */
    it('empties courses and standalone quizzes, and leaves a course’s Archive alone', async () => {
      const { courseId } = await makeCourse('Kept course');
      const section = await addSection(courseId, { title: 'Read', type: 'TEXT' });
      const quizSection = await addSection(courseId, { title: 'Check', type: 'QUIZ' });
      await addSection(courseId, { title: 'Stays', type: 'TEXT' });
      const extraModel = await as(admin()).post(`/curriculum/courses/${courseId}/models`, {
        title: 'Second',
      });
      await as(admin()).del(`/curriculum/sections/${section.id}`);
      await as(admin()).del(`/curriculum/sections/${quizSection.id}`);
      await as(admin()).del(`/curriculum/models/${extraModel.body.model.id}`);
      const { courseId: binnedCourseId } = await makeCourse('Binned course');
      await as(admin()).del(`/curriculum/courses/${binnedCourseId}`);
      const standalone = await prisma.quiz.create({
        data: { title: 'Old exam', deletedAt: new Date() },
      });

      const purged = await as(admin()).del('/curriculum/deleted');
      const purgedQuizzes = await as(admin()).del('/quizzes/deleted');

      expect(purged.body.purged).toEqual({ courses: 1 });
      expect(purgedQuizzes.body.purged).toBe(1);
      expect(await prisma.course.findUnique({ where: { id: binnedCourseId } })).toBeNull();
      expect(await prisma.quiz.findUnique({ where: { id: standalone.id } })).toBeNull();

      // Everything deleted inside the live course survived, quiz included.
      expect(await prisma.section.findUnique({ where: { id: section.id } })).not.toBeNull();
      expect(await prisma.section.findUnique({ where: { id: quizSection.id } })).not.toBeNull();
      expect(await prisma.quiz.count({ where: { sectionId: quizSection.id } })).toBe(1);
      expect(
        await prisma.model.findUnique({ where: { id: extraModel.body.model.id } }),
      ).not.toBeNull();

      const archive = await as(admin()).get(`/curriculum/courses/${courseId}/deleted`);
      expect(archive.body.sections).toHaveLength(1);
      expect(archive.body.quizzes).toHaveLength(1);
      expect(archive.body.models).toHaveLength(1);
    });
  });

  describe('a course’s Archive', () => {
    it('lists its deleted models, sections and quizzes', async () => {
      const { courseId, modelId } = await makeCourse();
      const text = await addSection(courseId, { title: 'Read', type: 'TEXT' });
      const quizSection = await addSection(courseId, { title: 'Safety check', type: 'QUIZ' });
      await addSection(courseId, { title: 'Stays', type: 'TEXT' });

      const second = await as(admin()).post(`/curriculum/courses/${courseId}/models`, {
        title: 'Second model',
      });
      const secondId = second.body.model.id as string;
      const inside = await addSection(courseId, {
        title: 'Inside',
        type: 'IMAGE',
        modelId: secondId,
      });

      const quiz = await prisma.quiz.findFirstOrThrow({ where: { sectionId: quizSection.id } });
      await as(admin()).del(`/curriculum/sections/${text.id}`);
      await as(admin()).del(`/quizzes/${quiz.id}`);
      await as(admin()).del(`/curriculum/models/${secondId}`);

      const archive = await as(admin()).get(`/curriculum/courses/${courseId}/deleted`);

      expect(archive.status).toBe(200);
      // The deleted model carries the section that comes back with it.
      expect(archive.body.models).toEqual([
        expect.objectContaining({
          id: secondId,
          title: 'Second model',
          deletedAt: expect.any(String),
          sections: [{ id: inside.id, title: 'Inside', type: 'IMAGE' }],
        }),
      ]);
      // A section whose model is live stands on its own.
      expect(archive.body.sections).toEqual([
        expect.objectContaining({
          id: text.id,
          title: 'Read',
          type: 'TEXT',
          deletedAt: expect.any(String),
        }),
      ]);
      // A course quiz is listed as the quiz, under its section's title.
      expect(archive.body.quizzes).toEqual([
        expect.objectContaining({
          id: quiz.id,
          sectionId: quizSection.id,
          sectionTitle: 'Safety check',
          deletedAt: expect.any(String),
        }),
      ]);
      expect(archive.body.retentionDays).toBe(14);

      // What is left in the course closed the gap.
      const live = await prisma.section.findMany({
        where: { courseId, deletedAt: null },
        select: { number: true, modelId: true },
      });
      expect(live).toEqual([{ number: '1.1', modelId }]);
    });

    /** The single access rule: somebody else's course is refused, not emptied. */
    it('refuses someone who may not edit the course', async () => {
      const { courseId } = await makeCourse();

      const response = await as(outsider()).get(`/curriculum/courses/${courseId}/deleted`);

      expect(response.status).toBe(403);
      expect(response.body).not.toHaveProperty('sections');
    });

    it('restores a section to the end of its model', async () => {
      const { courseId } = await makeCourse();
      const first = await addSection(courseId, { title: 'First', type: 'TEXT' });
      await addSection(courseId, { title: 'Second', type: 'TEXT' });

      await as(admin()).del(`/curriculum/sections/${first.id}`);
      const restored = await as(admin()).post(`/curriculum/sections/${first.id}/restore`);

      expect(restored.status).toBe(200);
      const sections = await prisma.section.findMany({
        where: { courseId, deletedAt: null },
        orderBy: { sortKey: 'asc' },
        select: { title: true, number: true },
      });
      expect(sections).toEqual([
        { title: 'Second', number: '1.1' },
        { title: 'First', number: '1.2' },
      ]);
      const archive = await as(admin()).get(`/curriculum/courses/${courseId}/deleted`);
      expect(archive.body.sections).toEqual([]);
    });

    it('brings a model back with its sections, and a quiz back with its section', async () => {
      const { courseId } = await makeCourse();
      await addSection(courseId, { title: 'Stays', type: 'TEXT' });
      const second = await as(admin()).post(`/curriculum/courses/${courseId}/models`, {
        title: 'Second model',
      });
      const secondId = second.body.model.id as string;
      await addSection(courseId, { title: 'Inside', type: 'TEXT', modelId: secondId });
      const quizSection = await addSection(courseId, {
        title: 'Check',
        type: 'QUIZ',
        modelId: secondId,
      });
      const quiz = await prisma.quiz.findFirstOrThrow({ where: { sectionId: quizSection.id } });

      await as(admin()).del(`/curriculum/models/${secondId}`);
      expect(await prisma.section.count({ where: { courseId, deletedAt: null } })).toBe(1);

      const restored = await as(admin()).post(`/curriculum/models/${secondId}/restore`);

      expect(restored.status).toBe(200);
      const sections = await prisma.section.findMany({
        where: { courseId, deletedAt: null },
        orderBy: { sortKey: 'asc' },
        select: { title: true, number: true },
      });
      expect(sections).toEqual([
        { title: 'Stays', number: '1.1' },
        { title: 'Inside', number: '2.1' },
        { title: 'Check', number: '2.2' },
      ]);
      expect(
        (await prisma.quiz.findUniqueOrThrow({ where: { id: quiz.id } })).deletedAt,
      ).toBeNull();

      // And a quiz deleted on its own comes back through its own restore.
      await as(admin()).del(`/quizzes/${quiz.id}`);
      expect(
        (await prisma.section.findUniqueOrThrow({ where: { id: quizSection.id } })).deletedAt,
      ).not.toBeNull();
      await as(admin()).post(`/quizzes/${quiz.id}/restore`);
      expect(
        (await prisma.section.findUniqueOrThrow({ where: { id: quizSection.id } })).deletedAt,
      ).toBeNull();
      expect(
        (await prisma.quiz.findUniqueOrThrow({ where: { id: quiz.id } })).deletedAt,
      ).toBeNull();
    });

    it('permanently deletes one archived section on request', async () => {
      const { courseId } = await makeCourse();
      const section = await addSection(courseId, { title: 'Read', type: 'TEXT' });
      await addSection(courseId, { title: 'Stays', type: 'TEXT' });
      await as(admin()).del(`/curriculum/sections/${section.id}`);

      const purged = await as(admin()).del(`/curriculum/deleted/sections/${section.id}`);

      expect(purged.status).toBe(200);
      expect(await prisma.section.findUnique({ where: { id: section.id } })).toBeNull();
    });

    /** Deleted models and sections still expire after the retention window. */
    it('clears archived items once they are older than the retention window', async () => {
      const { courseId } = await makeCourse();
      const section = await addSection(courseId, { title: 'Read', type: 'TEXT' });
      await addSection(courseId, { title: 'Stays', type: 'TEXT' });
      await as(admin()).del(`/curriculum/sections/${section.id}`);
      await prisma.section.update({
        where: { id: section.id },
        data: { deletedAt: new Date(Date.now() - 15 * 86_400_000) },
      });

      const archive = await as(admin()).get(`/curriculum/courses/${courseId}/deleted`);

      expect(archive.body.sections).toEqual([]);
      expect(await prisma.section.findUnique({ where: { id: section.id } })).toBeNull();
    });
  });
});
