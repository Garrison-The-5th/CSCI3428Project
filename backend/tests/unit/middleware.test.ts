/**
 * File: middleware.test.ts
 * Description: Unit tests for rate limiting, upload quotas, content-type
 *   enforcement and role gates.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import type { NextFunction, Request, Response } from 'express';

import {
  requireAnyRole,
  requireRole,
} from '@/controllers/auth-controller/authorization-middleware';
import { enforceJsonContentType } from '@/controllers/middleware/content-type';
import {
  __resetRateLimitState,
  enforceUploadQuota,
  rateLimit,
  UPLOAD_MAX_BYTES_PER_WINDOW,
  UPLOAD_MAX_FILES_PER_WINDOW,
} from '@/controllers/middleware/rate-limit';

jest.mock('@/gateways/curriculum-gateway/curriculum-gateway');

/** A response double that records what the handler did to it. */
function responseDouble() {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    send(payload: unknown) {
      this.body = payload;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
  };
  return res as unknown as Response & typeof res;
}

function requestDouble(overrides: Record<string, unknown> = {}): Request {
  return {
    method: 'GET',
    path: '/curriculum/courses',
    ip: '10.0.0.1',
    headers: {},
    get: () => undefined,
    ...overrides,
  } as unknown as Request;
}

beforeEach(() => __resetRateLimitState());

describe('rateLimit', () => {
  it('allows requests up to the limit', () => {
    const limiter = rateLimit({ max: 3, windowMs: 60_000, scope: 'test' });
    const next = jest.fn() as NextFunction;

    for (let i = 0; i < 3; i += 1) limiter(requestDouble(), responseDouble(), next);

    expect(next).toHaveBeenCalledTimes(3);
  });

  it('refuses the request that exceeds the limit, with 429 and Retry-After', () => {
    const limiter = rateLimit({ max: 2, windowMs: 60_000, scope: 'test' });
    const next = jest.fn() as NextFunction;

    limiter(requestDouble(), responseDouble(), next);
    limiter(requestDouble(), responseDouble(), next);

    const blocked = responseDouble();
    limiter(requestDouble(), blocked, next);

    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['Retry-After']).toBeDefined();
    expect(next).toHaveBeenCalledTimes(2);
  });

  it('keeps separate buckets per caller address', () => {
    const limiter = rateLimit({ max: 1, windowMs: 60_000, scope: 'test' });
    const next = jest.fn() as NextFunction;

    limiter(requestDouble({ ip: '10.0.0.1' }), responseDouble(), next);
    limiter(requestDouble({ ip: '10.0.0.2' }), responseDouble(), next);

    // Two different callers, so neither has been blocked.
    expect(next).toHaveBeenCalledTimes(2);
  });

  /**
   * Keying on the user matters: an office behind one NAT address should not
   * share a bucket, and one account should not escape its limit by moving.
   */
  it('keys on the user id when the subject is "user"', () => {
    const limiter = rateLimit({ max: 1, windowMs: 60_000, subject: 'user', scope: 'test' });
    const next = jest.fn() as NextFunction;

    const first = requestDouble({ ip: '10.0.0.1', user: { id: 7 } });
    const sameUserElsewhere = requestDouble({ ip: '203.0.113.9', user: { id: 7 } });

    limiter(first, responseDouble(), next);
    const blocked = responseDouble();
    limiter(sameUserElsewhere, blocked, next);

    expect(blocked.statusCode).toBe(429);
  });

  it('separates different users on the same address', () => {
    const limiter = rateLimit({ max: 1, windowMs: 60_000, subject: 'user', scope: 'test' });
    const next = jest.fn() as NextFunction;

    limiter(requestDouble({ user: { id: 1 } }), responseDouble(), next);
    limiter(requestDouble({ user: { id: 2 } }), responseDouble(), next);

    expect(next).toHaveBeenCalledTimes(2);
  });

  it('starts a fresh window once the old one expires', () => {
    jest.useFakeTimers();
    const limiter = rateLimit({ max: 1, windowMs: 1_000, scope: 'test' });
    const next = jest.fn() as NextFunction;

    limiter(requestDouble(), responseDouble(), next);
    jest.advanceTimersByTime(1_500);
    limiter(requestDouble(), responseDouble(), next);

    expect(next).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });

  it('keeps separate buckets per scope', () => {
    const reads = rateLimit({ max: 1, windowMs: 60_000, scope: 'reads' });
    const writes = rateLimit({ max: 1, windowMs: 60_000, scope: 'writes' });
    const next = jest.fn() as NextFunction;

    reads(requestDouble(), responseDouble(), next);
    writes(requestDouble(), responseDouble(), next);

    expect(next).toHaveBeenCalledTimes(2);
  });
});

describe('enforceUploadQuota — §3.8.1', () => {
  const oneMegabyte = { size: 1024 * 1024 } as Express.Multer.File;

  it('passes a request with no file straight through', () => {
    const next = jest.fn() as NextFunction;
    enforceUploadQuota(requestDouble({ user: { id: 1 } }), responseDouble(), next);
    expect(next).toHaveBeenCalled();
  });

  it('allows uploads inside the hourly budget', () => {
    const next = jest.fn() as NextFunction;

    for (let i = 0; i < 5; i += 1) {
      enforceUploadQuota(
        requestDouble({ user: { id: 1 }, file: oneMegabyte }),
        responseDouble(),
        next,
      );
    }

    expect(next).toHaveBeenCalledTimes(5);
  });

  it('refuses once the file count is spent', () => {
    const next = jest.fn() as NextFunction;
    const tiny = { size: 1 } as Express.Multer.File;

    for (let i = 0; i < UPLOAD_MAX_FILES_PER_WINDOW; i += 1) {
      enforceUploadQuota(requestDouble({ user: { id: 1 }, file: tiny }), responseDouble(), next);
    }

    const blocked = responseDouble();
    enforceUploadQuota(requestDouble({ user: { id: 1 }, file: tiny }), blocked, next);

    expect(blocked.statusCode).toBe(429);
    expect(blocked.body).toMatchObject({ errorMessage: expect.stringMatching(/hourly upload/) });
  });

  it('refuses once the byte budget is spent, even with few files', () => {
    const next = jest.fn() as NextFunction;
    const huge = { size: UPLOAD_MAX_BYTES_PER_WINDOW } as Express.Multer.File;

    enforceUploadQuota(requestDouble({ user: { id: 1 }, file: huge }), responseDouble(), next);

    const blocked = responseDouble();
    enforceUploadQuota(requestDouble({ user: { id: 1 }, file: { size: 1 } }), blocked, next);

    expect(blocked.statusCode).toBe(429);
  });

  it('budgets each user separately', () => {
    const next = jest.fn() as NextFunction;
    const huge = { size: UPLOAD_MAX_BYTES_PER_WINDOW } as Express.Multer.File;

    enforceUploadQuota(requestDouble({ user: { id: 1 }, file: huge }), responseDouble(), next);

    const other = responseDouble();
    enforceUploadQuota(requestDouble({ user: { id: 2 }, file: { size: 1 } }), other, next);

    expect(other.statusCode).toBe(200);
  });
});

describe('enforceJsonContentType — §3.9.2', () => {
  it.each(['GET', 'DELETE', 'HEAD'])('lets %s through without a Content-Type', (method) => {
    const next = jest.fn() as NextFunction;
    enforceJsonContentType(requestDouble({ method }), responseDouble(), next);
    expect(next).toHaveBeenCalled();
  });

  it('accepts application/json', () => {
    const next = jest.fn() as NextFunction;
    enforceJsonContentType(
      requestDouble({
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': '20' },
      }),
      responseDouble(),
      next,
    );
    expect(next).toHaveBeenCalled();
  });

  it('accepts application/json with a charset parameter', () => {
    const next = jest.fn() as NextFunction;
    enforceJsonContentType(
      requestDouble({
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8', 'content-length': '20' },
      }),
      responseDouble(),
      next,
    );
    expect(next).toHaveBeenCalled();
  });

  it('accepts multipart/form-data, which uploads legitimately use', () => {
    const next = jest.fn() as NextFunction;
    enforceJsonContentType(
      requestDouble({
        method: 'POST',
        headers: { 'content-type': 'multipart/form-data; boundary=x', 'content-length': '500' },
      }),
      responseDouble(),
      next,
    );
    expect(next).toHaveBeenCalled();
  });

  it('refuses an unexpected content type with 415', () => {
    const res = responseDouble();
    enforceJsonContentType(
      requestDouble({
        method: 'POST',
        headers: { 'content-type': 'text/xml', 'content-length': '20' },
      }),
      res,
      jest.fn() as NextFunction,
    );
    expect(res.statusCode).toBe(415);
  });

  it('refuses a body with no content type at all', () => {
    const res = responseDouble();
    enforceJsonContentType(
      requestDouble({ method: 'POST', headers: { 'content-length': '20' } }),
      res,
      jest.fn() as NextFunction,
    );
    expect(res.statusCode).toBe(415);
  });

  /** Several routes act purely on their URL — publishing, revoking a link. */
  it('lets a body-less POST through', () => {
    const next = jest.fn() as NextFunction;
    enforceJsonContentType(
      requestDouble({ method: 'POST', headers: { 'content-length': '0' } }),
      responseDouble(),
      next,
    );
    expect(next).toHaveBeenCalled();
  });
});

describe('role gates — §3.4.2', () => {
  it('refuses an unauthenticated caller with 401', () => {
    const res = responseDouble();
    requireRole('admin')(requestDouble() as never, res, jest.fn() as NextFunction);
    expect(res.statusCode).toBe(401);
  });

  it('refuses a caller without the role with 403', () => {
    const res = responseDouble();
    requireRole('admin')(
      requestDouble({ auth: { roles: ['contributor'], email: 'a@b.c' } }) as never,
      res,
      jest.fn() as NextFunction,
    );
    expect(res.statusCode).toBe(403);
  });

  it('admits a caller holding the role', () => {
    const next = jest.fn() as NextFunction;
    requireRole('admin')(
      requestDouble({ auth: { roles: ['admin'], email: 'a@b.c' } }) as never,
      responseDouble(),
      next,
    );
    expect(next).toHaveBeenCalled();
  });

  it('admits a caller holding any one of several allowed roles', () => {
    const next = jest.fn() as NextFunction;
    requireAnyRole(['admin', 'contributor'])(
      requestDouble({ auth: { roles: ['contributor'], email: 'a@b.c' } }) as never,
      responseDouble(),
      next,
    );
    expect(next).toHaveBeenCalled();
  });
});
