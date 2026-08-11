/**
 * File: http-errors.ts
 * Description: Maps thrown errors onto HTTP responses without leaking schema detail.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import { Response } from 'express';

import { logger } from '@/config/logger';

import { Prisma } from '../../generated/prisma';

/**
 * Turning a thrown error into a response.
 *
 * Services throw plain `Error`s whose messages are written for the person using
 * the app ("module 2.3 already exists"), so those are safe to pass on. Anything
 * the database throws is not: a Prisma error names columns, constraints and
 * sometimes values, which is a free schema tour for anyone poking at the API.
 * Those are logged in full and answered with something generic.
 *
 * Status used to be decided by `message.includes('not found')`, which made any
 * message containing that phrase a 404 by accident. NotFoundError says it
 * outright instead.
 */
export class NotFoundError extends Error {}

/** Thrown when the caller may not do this. Distinct from "does not exist". */
export class ForbiddenError extends Error {}

function isDatabaseError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError ||
    error instanceof Prisma.PrismaClientUnknownRequestError ||
    error instanceof Prisma.PrismaClientValidationError ||
    error instanceof Prisma.PrismaClientInitializationError ||
    error instanceof Prisma.PrismaClientRustPanicError
  );
}

/**
 * Logs the real error and sends the client the most it should know.
 * `fallback` describes the operation, for the log and for the generic reply.
 */
export function fail(res: Response, error: unknown, fallback: string) {
  if (error instanceof NotFoundError) {
    logger.info({ operation: fallback, reason: error.message }, 'request failed: not found');
    return res.status(404).send({ errorMessage: error.message });
  }

  if (error instanceof ForbiddenError) {
    logger.warn({ operation: fallback, reason: error.message }, 'request failed: forbidden');
    return res.status(403).send({ errorMessage: error.message });
  }

  if (isDatabaseError(error)) {
    // Logged in full; the client gets nothing about the schema.
    logger.error({ operation: fallback, err: error }, 'request failed: database error');
    return res.status(400).send({ errorMessage: fallback });
  }

  if (error instanceof Error) {
    logger.warn({ operation: fallback, reason: error.message }, 'request failed');
    return res.status(400).send({ errorMessage: error.message });
  }

  logger.error({ operation: fallback, err: error }, 'request failed: unknown error');
  return res.status(400).send({ errorMessage: fallback });
}
