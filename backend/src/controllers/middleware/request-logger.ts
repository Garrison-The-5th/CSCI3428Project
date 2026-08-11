/**
 * File: request-logger.ts
 * Description: Correlation ids and one structured log line per request.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import { randomUUID } from 'node:crypto';

import { NextFunction, Request, Response } from 'express';

import { clientAddress } from '@/config/client-address';
import { logger, safeForLog } from '@/config/logger';

export interface CorrelatedRequest extends Request {
  /** Quoted back to the user on a 500 so support can find the log line. */
  correlationId?: string;
}

/**
 * One line per request, written when the response finishes.
 *
 * Logged on `finish` rather than on arrival so the status and duration are
 * known — a log of requests that does not say how they ended answers almost
 * nothing during an incident.
 *
 * The path is deliberately masked before it is logged. Guest routes carry the
 * assignment token *in the URL*, and that token is a credential (§3.4.1). Until
 * the token moves into a header, masking here is what keeps it out of the logs.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const correlated = req as CorrelatedRequest;
  correlated.correlationId = randomUUID();
  res.setHeader('X-Correlation-Id', correlated.correlationId);

  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

    logger[level](
      {
        correlationId: correlated.correlationId,
        method: req.method,
        path: maskSensitivePath(req.originalUrl),
        status: res.statusCode,
        durationMs: Math.round(durationMs),
        ip: clientAddress(req),
      },
      'request',
    );
  });

  next();
}

/**
 * Replaces an assignment token in a URL with a placeholder.
 *
 * `/public/assignments/<256-bit token>/dashboard` becomes
 * `/public/assignments/:token/dashboard`. Without this every guest request
 * would write a working credential into the access log, where it would then be
 * shipped to whatever aggregates logs and live far longer than the session.
 */
export function maskSensitivePath(url: string): string {
  return safeForLog(url.replace(/(\/public\/assignments\/)[^/?]+/g, '$1:token'), 300);
}
