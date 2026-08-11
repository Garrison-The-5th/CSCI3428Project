/**
 * File: api-security.test.ts
 * Description: API integration tests driving the real Express stack — security
 *   headers, content-type enforcement, authentication gates and error shape.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import request from 'supertest';

import { app } from '@/index';

import { hasDatabase } from '../setup-integration';

/**
 * These exercise the middleware chain as assembled in `index.ts`, not the
 * individual functions — the unit tests already cover those in isolation. What
 * is being checked here is that they are actually *wired in*, in the right
 * order, which is the failure mode that unit tests cannot see.
 */
const describeWithDatabase = hasDatabase ? describe : describe.skip;

describeWithDatabase('HTTP security headers (§3.10.4)', () => {
  it.each([
    ['content-security-policy', /default-src 'self'/],
    ['x-content-type-options', /nosniff/],
    ['strict-transport-security', /max-age=31536000/],
    ['referrer-policy', /strict-origin-when-cross-origin/],
  ])('sets %s on every response', async (header, pattern) => {
    const response = await request(app).get('/table-members/');
    expect(response.headers[header]).toMatch(pattern);
  });

  it('forbids being framed by anyone', async () => {
    const response = await request(app).get('/table-members/');
    // helmet emits both the modern directive and the legacy header.
    expect(response.headers['content-security-policy']).toMatch(/frame-ancestors 'none'/);
  });

  it('does not advertise the server technology (§3.10.3)', async () => {
    const response = await request(app).get('/table-members/');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('allows the YouTube embed the course player needs', async () => {
    const response = await request(app).get('/table-members/');
    expect(response.headers['content-security-policy']).toMatch(/youtube\.com/);
  });

  it('attaches a correlation id to every response (§3.4.4)', async () => {
    const response = await request(app).get('/table-members/');
    expect(response.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describeWithDatabase('content type enforcement (§3.9.2)', () => {
  it('refuses a POST body that is not JSON with 415', async () => {
    const response = await request(app)
      .post('/auth/subscribe')
      .set('Content-Type', 'text/xml')
      .send('<email>a@b.c</email>');

    expect(response.status).toBe(415);
    expect(response.body.errorMessage).toMatch(/Unsupported Media Type/);
  });

  it('accepts a JSON body', async () => {
    const response = await request(app)
      .post('/auth/subscribe')
      .set('Content-Type', 'application/json')
      .send({ email: 'subscriber@example.com' });

    expect(response.status).not.toBe(415);
  });

  it('lets a GET through without a content type', async () => {
    const response = await request(app).get('/table-members/');
    expect(response.status).not.toBe(415);
  });
});

describeWithDatabase('authentication gates (§3.4.2)', () => {
  it.each([
    ['/curriculum/courses', 'get'],
    ['/curriculum/dashboard', 'get'],
    ['/curriculum/progress', 'get'],
    ['/quizzes', 'get'],
    ['/me/data', 'get'],
  ])('refuses %s without a token', async (path, method) => {
    const agent = request(app) as unknown as Record<string, (p: string) => request.Test>;
    const response = await agent[method](path);

    expect(response.status).toBe(401);
  });

  it('refuses a malformed bearer token', async () => {
    const response = await request(app)
      .get('/curriculum/courses')
      .set('Authorization', 'Bearer not-a-real-jwt');

    expect(response.status).toBe(401);
  });

  /**
   * The refusal must not say *why*. Distinguishing "expired" from "forged"
   * tells an attacker whether they have a real token.
   */
  it('does not disclose why a token failed', async () => {
    const response = await request(app)
      .get('/curriculum/courses')
      .set('Authorization', 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.bad');

    expect(response.status).toBe(401);
    expect(JSON.stringify(response.body)).not.toMatch(/expired|signature|malformed|algorithm/i);
  });

  it('refuses an admin route to an unauthenticated caller', async () => {
    const response = await request(app).get('/auth/all-users');
    expect(response.status).toBe(401);
  });
});

describeWithDatabase('guest link failures (§3.2.1)', () => {
  /**
   * Every failure returns 404 so a probe cannot tell a real token from a fake
   * one, while the body still carries a reason the page can explain.
   */
  it('answers an unknown token with 404 rather than 401 or 403', async () => {
    const response = await request(app).get('/public/assignments/definitely-not-a-token/session');

    expect(response.status).toBe(404);
    expect(response.body.reason).toBe('not-found');
  });

  it('answers every guest route the same way for an unknown token', async () => {
    for (const path of ['courses', 'quizzes', 'dashboard', 'progress']) {
      const response = await request(app).get(`/public/assignments/nope/${path}`);
      expect(response.status).toBe(404);
    }
  });
});

describeWithDatabase('request body limits (§3.7)', () => {
  it('refuses a body past the configured limit', async () => {
    // Comfortably over the 2mb default.
    const huge = { note: 'x'.repeat(3 * 1024 * 1024) };

    const response = await request(app)
      .post('/auth/subscribe')
      .set('Content-Type', 'application/json')
      .send(huge);

    expect([400, 413]).toContain(response.status);
  });

  it('answers malformed JSON with a readable message rather than a stack', async () => {
    const response = await request(app)
      .post('/auth/subscribe')
      .set('Content-Type', 'application/json')
      .send('{"email": ');

    expect(response.status).toBe(400);
    expect(response.body.errorMessage).toMatch(/not valid JSON/);
    expect(JSON.stringify(response.body)).not.toMatch(/at Object|node_modules/);
  });
});

describeWithDatabase('rate limiting (§3.7)', () => {
  it('throttles the public subscribe endpoint', async () => {
    const responses: Array<{ status: number; headers: Record<string, string> }> = [];
    for (let i = 0; i < 8; i += 1) {
      const response = await request(app)
        .post('/auth/subscribe')
        .set('Content-Type', 'application/json')
        .send({ email: `flood${i}@example.com` });
      responses.push({ status: response.status, headers: response.headers });
    }

    const throttled = responses.filter((response) => response.status === 429);
    expect(throttled.length).toBeGreaterThan(0);
    expect(throttled[0]!.headers['retry-after']).toBeDefined();
  });
});
