/**
 * File: index.ts
 * Description: Express entry point — security middleware, routing, error handling,
 *   retention sweeps.
 * Author: TTG Full-Stack Web Boilerplate
 * Modified by: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Date: 2026-10-30
 */
import 'dotenv/config'; // Load environment variables from .env file
// import these to ensure controllers are registered
import '@/controllers/assignment-controller/assignment-controller';
import '@/controllers/auth-controller/auth-controller';
import '@/controllers/config-controller/config-controller';
import '@/controllers/course-map-controller/course-map-controller';
import '@/controllers/curriculum-controller/curriculum-controller';
import '@/controllers/privacy-controller/privacy-controller';
import '@/controllers/public-controller/public-assignment-controller';
import '@/controllers/quiz-controller/quiz-controller';
import '@/controllers/table-controller/table-controller';
import '@/controllers/tour-controller/tour-controller';

import cors from 'cors';
import express from 'express';
import helmet from 'helmet';

import { AppRouter } from '@/app-router';
import { configureTrustProxy } from '@/config/client-address';
import { logger, safeForLog } from '@/config/logger';
import { enforceJsonContentType } from '@/controllers/middleware/content-type';
import { rateLimit } from '@/controllers/middleware/rate-limit';
import { requestLogger } from '@/controllers/middleware/request-logger';
import CurriculumService, {
  RECYCLE_BIN_DAYS,
} from '@/services/curriculum-service/curriculum-service';
import { ensureDefaultTutorial } from '@/services/default-tutorial-service/default-tutorial-bootstrap';
import EmailService from '@/services/email-service/email-service';
import PublicationService, {
  ARCHIVE_DAYS,
} from '@/services/publication-service/publication-service';

import { connectDB, disconnectDB } from '../prisma/prisma-client';

const app = express();

// Decide how much of the X-Forwarded-For chain to believe before any route runs.
// Without this every caller behind the ingress looks like the same IP.
configureTrustProxy(app);

/**
 * Security headers (TTG Technology Standards §3.10.4).
 *
 * Everything the standard lists comes from helmet's defaults except the two
 * tuned below. The CSP is written for this app specifically rather than left on
 * helmet's default, because the learner player embeds YouTube and renders
 * uploaded media from `data:` URIs — a default policy would silently break both.
 */
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // Vite injects styles inline, and the model tints are computed from
        // author-chosen colours at render time.
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        // Uploaded media is stored base64 and served inline as a data: URI.
        imgSrc: ["'self'", 'data:', 'blob:'],
        // The course player embeds YouTube; PDFs render from data: URIs.
        frameSrc: [
          "'self'",
          'https://www.youtube.com',
          'https://www.youtube-nocookie.com',
          'data:',
        ],
        objectSrc: ["'self'", 'data:'],
        // Keycloak sits on its own origin, so token calls must be allowed out.
        connectSrc: ["'self'", process.env.KEYCLOAK_URL ?? 'http://localhost:4000'],
        fontSrc: ["'self'", 'data:'],
        // Nothing may embed this app (§3.10.4, frame-ancestors).
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
      },
    },
    // HSTS on every response including subdomains (§3.10.4).
    strictTransportSecurity: { maxAge: 31_536_000, includeSubDomains: true, preload: true },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    // Hides `X-Powered-By: Express` (§3.10.3 — no version disclosure).
    hidePoweredBy: true,
    // Cross-origin isolation would block the YouTube embed, so it stays off and
    // frame-ancestors above carries the clickjacking protection instead.
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
  }),
);

// CORS is only needed in development when frontend and backend run on different origins
// Production uses same-origin requests (e.g., https://app.ttgteams.com/api) via reverse proxy
const isDevelopment = process.env.NODE_ENV !== 'production';
logger.info({ isDevelopment }, 'starting server');

if (isDevelopment) {
  /**
   * A strict allow list even locally (§3.10.5). The previous `origin: '*'`
   * meant any page a developer happened to have open could call this API with
   * their session, and the standard names an allow list explicitly. The Vite
   * dev server is the only legitimate browser origin in development.
   */
  const allowedOrigins = (
    process.env.CORS_ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173'
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.use(
    cors({
      // `!origin` covers curl and server-to-server calls, which send none.
      // The "null" origin is never accepted (§3.10.5).
      origin: (origin, callback) =>
        !origin || allowedOrigins.includes(origin)
          ? callback(null, true)
          : callback(new Error(`Origin ${origin} is not allowed`)),
      credentials: true,
      exposedHeaders: ['Content-Disposition'],
    }),
  );
  logger.info({ allowedOrigins }, 'CORS enabled for development');
} else {
  logger.info('production mode - CORS disabled (same-origin requests)');
}

// One structured log line per request, with the caller and outcome (§3.4.2).
app.use(requestLogger);

/**
 * Body parsing, with a ceiling (§3.7 anti-automation, §3.8.1).
 *
 * Unbounded was a denial-of-service path: course media travels base64 inside
 * the JSON body, so a single request could previously stream unlimited data
 * into memory. 2 MB comfortably clears the largest legitimate payload — a
 * course tree without media — while file uploads go through multer, which has
 * its own 10 MB per-file limit.
 */
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT ?? '2mb' }));

// Reject bodies that are not JSON before any handler sees them (§3.9.2).
app.use(enforceJsonContentType);

/**
 * Global anti-automation backstop (§3.7).
 *
 * Deliberately generous — a dashboard load legitimately fans out several calls,
 * and this must never be what a real user hits. It exists to blunt a scripted
 * flood from one address before it reaches the database. Routes that warrant a
 * tighter, per-account limit declare their own with `subject: 'user'`, which
 * this cannot do because the caller is not yet authenticated here.
 */
app.use(rateLimit({ max: 600, windowMs: 60_000, subject: 'ip', scope: 'global' }));

// Register all application routes defined in the AppRouter singleton
app.use(AppRouter.getInstance());

/**
 * Last-resort error handler (§3.4.4).
 *
 * Two rules the standard sets, both previously missed. A generic message goes
 * to the caller — the old handler returned `err.message` verbatim, which leaks
 * internals such as constraint names and file paths. And every failure carries
 * a correlation id, logged alongside the real error, so support can find the
 * one log line that matters from a screenshot.
 *
 * The exceptions are deliberate: upload rejections and validation errors are
 * *for* the user, and saying "file is too large" is the entire point of them.
 */
app.use(
  (
    err: Error & { code?: string; status?: number; expose?: boolean },
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    if (res.headersSent) return next(err);

    const correlationId = (req as express.Request & { correlationId?: string }).correlationId;

    if (err?.code === 'LIMIT_FILE_SIZE') {
      logger.warn({ correlationId, err: err.message }, 'upload rejected: too large');
      return res.status(400).send({ errorMessage: 'File is too large. The limit is 10MB.' });
    }

    // Malformed JSON from body-parser: the caller can act on this, and it
    // discloses nothing about the server.
    if (err instanceof SyntaxError && 'body' in err) {
      return res.status(400).send({ errorMessage: 'Request body is not valid JSON.' });
    }

    if (err?.code === 'LIMIT_UNEXPECTED_FILE' || err?.expose === true) {
      return res.status(err.status ?? 400).send({ errorMessage: safeForLog(err.message) });
    }

    logger.error(
      { correlationId, err: { message: err?.message, stack: err?.stack } },
      'unhandled request error',
    );

    return res.status(500).send({
      errorMessage: 'Something went wrong. Quote this reference if you contact support.',
      correlationId,
    });
  },
);

/**
 * Connects to the database, starts the HTTP server and the recycle-bin sweep, and wires up graceful
 * shutdown. Exits the process if the database cannot be reached.
 */
async function startServer() {
  try {
    await connectDB();
    logger.info('successfully connected to the database');
  } catch (error) {
    logger.fatal({ err: error }, 'failed to start server');
    process.exit(1);
  }

  const server = app.listen(5002, () => {
    logger.info({ port: 5002 }, 'server running');
  });

  // Say once, at boot, whether this deployment can send mail — see
  // EmailService.reportConfiguration. Never throws and never blocks readiness.
  EmailService.reportConfiguration();

  /*
    Make sure the default tutorial exists and is published.

    Here rather than in the seed because production never runs the seed — the
    container runs `migrate deploy` and then this file — and rather than in a
    migration because only PublicationService can build the snapshot learners
    read. Does nothing after the first start. Never throws, and is not awaited
    before listening: a slow or failed attempt must not hold the API back, and
    the next start tries again. See `ensureDefaultTutorial`.
  */
  void ensureDefaultTutorial();

  /**
   * Expire the recycle bin.
   *
   * The admin dashboard sweeps on read, which covers every instance anyone
   * actually looks at. This is the backstop for the case where nobody does: it
   * runs once at startup and daily after, so an untouched deployment still keeps
   * its promise that deleted content is gone after two weeks. `unref` keeps the
   * timer from holding the process open during shutdown.
   */
  const sweepOnce = async () => {
    await CurriculumService.purgeExpired();
    await PublicationService.purgeExpired();
  };

  await sweepOnce();
  const sweep = setInterval(() => void sweepOnce(), 24 * 60 * 60 * 1000);
  sweep.unref();
  logger.info(
    { recycleBinDays: RECYCLE_BIN_DAYS, archiveDays: ARCHIVE_DAYS },
    'retention sweep scheduled',
  );

  const shutdown = (signal: string) => async () => {
    logger.info({ signal }, 'shutting down gracefully');
    clearInterval(sweep);
    server.close(async () => {
      await disconnectDB();
      process.exit(0);
    });
  };

  // Graceful shutdown
  process.on('SIGINT', shutdown('SIGINT'));
  process.on('SIGTERM', shutdown('SIGTERM'));
}

/**
 * Unhandled rejections and uncaught exceptions must not die silently (§3.4.4,
 * "a last resort error handler is defined to catch all unhandled exceptions").
 */
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'unhandled promise rejection');
});
process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'uncaught exception — exiting');
  process.exit(1);
});

// Started unless this file was imported by a test, which drives `app` directly.
if (require.main === module) {
  startServer();
}

export { app, startServer };
