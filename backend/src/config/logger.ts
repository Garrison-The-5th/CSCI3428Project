/**
 * File: logger.ts
 * Description: Structured logging with levels, UTC timestamps, redaction and security events.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import pino, { type Logger } from 'pino';

/**
 * Why a logger rather than `console`.
 *
 * TTG Technology Standards §1.7 requires "a consistent logging framework ...
 * configuring different log levels", §3.4.1 forbids logging credentials, and
 * §3.4.3 asks for UTC timestamps so that a post-incident timeline can be
 * reconstructed across services. `console.log` gives none of those.
 *
 * The redaction list below is the important part. Assignment tokens are
 * credentials — anyone holding one acts as the learner it was issued to — so a
 * token reaching a log file is the same class of mistake as logging a password.
 * Redaction is applied centrally rather than trusted to each call site, because
 * a rule enforced in one place cannot be forgotten in thirty.
 */

/** Paths pino blanks out wherever they appear in a logged object. */
const REDACTED_PATHS = [
  'token',
  '*.token',
  'assignment.token',
  'req.headers.authorization',
  'req.headers.cookie',
  'headers.authorization',
  'password',
  '*.password',
  'refreshToken',
  '*.refreshToken',
  'clientSecret',
  '*.clientSecret',
  'body.answers',
];

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Level comes from LOG_LEVEL so an incident can be debugged without a redeploy.
 * Defaults are deliberately different per environment: `debug` locally, `info`
 * in production, where debug volume would bury the events that matter.
 */
const level = process.env.LOG_LEVEL ?? (isProduction ? 'info' : 'debug');

export const logger: Logger = pino({
  level,
  // ISO-8601 in UTC (§3.4.3). pino's default is epoch milliseconds, which is
  // unreadable in an incident and ambiguous about zone.
  timestamp: () => `,"time":"${new Date().toISOString()}"`,
  redact: { paths: REDACTED_PATHS, censor: '[REDACTED]' },
  formatters: {
    // `level: "warn"` reads better in a log aggregator than `level: 40`.
    level: (label) => ({ level: label }),
  },
  base: { service: 'learning-platform-api' },
  // Human-readable locally; raw JSON in production for log aggregation.
  ...(isProduction
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
        },
      }),
});

/**
 * What kind of security-relevant thing happened.
 *
 * §3.4.1 requires security-relevant events to be logged, and §3.4.2 requires
 * *all* authentication and access-control decisions — successes as much as
 * failures. Naming them as a closed set keeps the log queryable: an auditor can
 * ask for every `access.denied` without knowing how each call site phrased it.
 */
export type SecurityEvent =
  | 'auth.success'
  | 'auth.failure'
  | 'auth.missing-token'
  | 'access.granted'
  | 'access.denied'
  | 'access.role-denied'
  | 'token.resolved'
  | 'token.rejected'
  | 'ratelimit.exceeded'
  | 'upload.rejected'
  | 'data.exported'
  | 'data.erased'
  | 'user.deleted'
  | 'role.granted'
  | 'role.revoked';

/** Metadata attached to a security event. Never carries the credential itself. */
export interface SecurityContext {
  /** The acting user, when known. */
  userId?: number;
  email?: string;
  /** Caller address, already resolved through the proxy chain. */
  ip?: string;
  method?: string;
  path?: string;
  /** Which course, section, quiz or assignment the decision was about. */
  resource?: string;
  /** Why a decision went the way it did — never free-form user input. */
  reason?: string;
}

/**
 * Records one security-relevant decision.
 *
 * Failures log at `warn` and successes at `info`, so a production deployment
 * running at `info` keeps the full audit trail while `warn`-level alerting
 * still surfaces only the things worth waking someone for.
 */
export function logSecurityEvent(event: SecurityEvent, context: SecurityContext = {}): void {
  const failed =
    event.endsWith('.failure') ||
    event.endsWith('.denied') ||
    event.endsWith('.rejected') ||
    event.endsWith('.exceeded') ||
    event === 'auth.missing-token';

  logger[failed ? 'warn' : 'info']({ event, ...context, audit: true }, `security: ${event}`);
}

/**
 * Strips anything that could forge a new log line out of a value taken from a
 * request. Guards against log injection (§3.4.3) — a crafted path or email
 * should not be able to write a convincing fake entry above or below its own.
 */
export function safeForLog(value: unknown, max = 200): string {
  return String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, max);
}

export default logger;
