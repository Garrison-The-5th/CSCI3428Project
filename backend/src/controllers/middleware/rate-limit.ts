/**
 * File: rate-limit.ts
 * Description: Fixed-window rate limiting and the per-user upload quota.
 * Author: TTG Full-Stack Web Boilerplate
 * Modified by: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Date: 2026-08-10
 */
import { NextFunction, Request, Response } from 'express';

import { clientAddress } from '@/config/client-address';
import { logSecurityEvent } from '@/config/logger';
import { MAX_UPLOAD_BYTES } from '@/config/media-upload';
import type { AuthenticatedRequest } from '@/controllers/auth-controller/auth-middleware';

/**
 * Fixed-window rate limiting.
 *
 * Public token routes are reachable without a login, so an unthrottled one lets
 * an attacker grind through tokens. Authenticated routes need it too (§3.7,
 * "anti-automation controls to protect against excessive calls such as mass
 * data exfiltration") — a valid session is not a licence to pull the whole
 * catalogue in a loop.
 *
 * In-memory and per-process: good enough for a single container, but it resets
 * on restart and does not coordinate across replicas — swap in Redis (or a
 * reverse-proxy limiter) before running more than one instance. That limitation
 * is recorded in docs/security-follow-ups.md.
 */
interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Drop stale buckets occasionally so the map cannot grow without bound.
const SWEEP_EVERY_MS = 60_000;
let lastSweep = Date.now();

/**
 * Drops expired buckets, at most once per SWEEP_EVERY_MS, so the in-memory map does not grow with
 * every address ever seen.
 */
function sweep(now: number) {
  if (now - lastSweep < SWEEP_EVERY_MS) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/** How a request is attributed to a caller. */
export type RateLimitSubject = 'ip' | 'user';

/**
 * Identifies the caller. Authenticated routes key on the user id so that an
 * office behind one NAT address does not share a bucket, and so that a single
 * account cannot escape its limit by changing address.
 */
function subjectKey(req: Request, subject: RateLimitSubject): string {
  if (subject === 'user') {
    const user = (req as AuthenticatedRequest).user;
    if (user) return `u:${user.id}`;
  }
  return `ip:${clientAddress(req)}`;
}

/**
 * A fixed-window rate limiter, in memory.
 *
 * `subject` decides what a bucket is keyed on. 'ip' is right for anything
 * unauthenticated; 'user' is right once there is an account, so that an office
 * behind one NAT address does not share a budget and one account cannot escape
 * its limit by moving. `scope` separates unrelated limits that would otherwise
 * share a bucket — reads and writes on the same route, say.
 *
 * In memory means per process: two replicas enforce roughly twice the limit
 * between them, which is accepted here because this exists to stop floods and
 * accidents rather than a determined distributed attacker. Behind a proxy it is
 * only as good as TRUST_PROXY — see config/client-address.ts, without which
 * every caller resolves to the ingress IP and shares one bucket.
 */
export function rateLimit({
  max,
  windowMs,
  subject = 'ip',
  scope,
}: {
  max: number;
  windowMs: number;
  subject?: RateLimitSubject;
  /** Overrides the default per-path-prefix bucketing with a fixed name. */
  scope?: string;
}) {
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    sweep(now);

    const bucketScope = scope ?? req.path.split('/').slice(0, 3).join('/');
    const key = `${subjectKey(req, subject)}:${bucketScope}`;
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    bucket.count += 1;

    if (bucket.count > max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));

      logSecurityEvent('ratelimit.exceeded', {
        ip: clientAddress(req),
        method: req.method,
        path: bucketScope,
        userId: (req as AuthenticatedRequest).user?.id,
        reason: `${bucket.count} requests in a ${windowMs}ms window (limit ${max})`,
      });

      return res.status(429).send({ errorMessage: 'Too many requests. Try again shortly.' });
    }

    return next();
  };
}

// ---- Per-user upload quota ------------------------------------------------

/**
 * §3.8.1 requires "a file size quota and maximum number of files per user ... to
 * ensure that a single user cannot fill up the storage with too many files, or
 * excessively large files". The 10 MB per-file cap alone does not do that: a
 * hundred 10 MB uploads is a gigabyte.
 *
 * A rolling hourly budget rather than a lifetime cap, because authoring
 * legitimately comes in bursts — someone building a course in an afternoon
 * should not be permanently rationed for it.
 */
export const UPLOAD_WINDOW_MS = 60 * 60 * 1000;
export const UPLOAD_MAX_FILES_PER_WINDOW = 60;
export const UPLOAD_MAX_BYTES_PER_WINDOW = 200 * 1024 * 1024; // 200MB/hour

interface UploadBudget {
  files: number;
  bytes: number;
  resetAt: number;
}

const uploadBudgets = new Map<number, UploadBudget>();

/**
 * This user's upload allowance for the current window, starting a fresh one if the last has
 * expired.
 */
function budgetFor(userId: number, now: number): UploadBudget {
  const existing = uploadBudgets.get(userId);
  if (existing && existing.resetAt > now) return existing;

  const fresh: UploadBudget = { files: 0, bytes: 0, resetAt: now + UPLOAD_WINDOW_MS };
  uploadBudgets.set(userId, fresh);
  return fresh;
}

/**
 * Charges a completed upload against the caller's hourly budget, and refuses
 * the next one once either limit is spent.
 *
 * Runs *after* multer, so `req.file` is populated and the real byte count is
 * known — a declared Content-Length cannot be trusted for this.
 */
export function enforceUploadQuota(req: Request, res: Response, next: NextFunction) {
  const user = (req as AuthenticatedRequest).user;
  // No user means an earlier middleware will refuse the request anyway.
  if (!user) return next();

  const file = req.file;
  if (!file) return next();

  const now = Date.now();
  const budget = budgetFor(user.id, now);

  const wouldBeFiles = budget.files + 1;
  const wouldBeBytes = budget.bytes + file.size;

  if (wouldBeFiles > UPLOAD_MAX_FILES_PER_WINDOW || wouldBeBytes > UPLOAD_MAX_BYTES_PER_WINDOW) {
    const minutes = Math.ceil((budget.resetAt - now) / 60_000);
    logSecurityEvent('upload.rejected', {
      userId: user.id,
      email: user.email,
      ip: clientAddress(req),
      reason: `quota: ${budget.files} files / ${budget.bytes} bytes this window`,
    });

    res.setHeader('Retry-After', String(Math.ceil((budget.resetAt - now) / 1000)));
    return res.status(429).send({
      errorMessage:
        `You have reached the hourly upload limit ` +
        `(${UPLOAD_MAX_FILES_PER_WINDOW} files or ` +
        `${Math.round(UPLOAD_MAX_BYTES_PER_WINDOW / 1024 / 1024)}MB). ` +
        `Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
    });
  }

  budget.files = wouldBeFiles;
  budget.bytes = wouldBeBytes;
  return next();
}

/** Clears all counters. Test-only — production relies on the rolling windows. */
export function __resetRateLimitState(): void {
  buckets.clear();
  uploadBudgets.clear();
  lastSweep = Date.now();
}

export { MAX_UPLOAD_BYTES };
