/**
 * File: logger.ts
 * Description: Browser logging with levels, silent below warn in production builds.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */

/**
 * Why this exists rather than bare `console`.
 *
 * TTG Technology Standards §3.10.3 requires debug features and unintended
 * security disclosures to be off in production. Scattered `console.log` calls
 * were shipping to every user's browser console, and one of them printed the
 * entire decoded JWT — claims, roles, subject and expiry — into a place any
 * bystander or browser extension can read (§3.4.1).
 *
 * `debug` and `info` are compiled to no-ops in a production build, so the
 * developer ergonomics survive locally without following users into production.
 * `warn` and `error` always run: a user reporting a problem needs something in
 * the console worth reading.
 */
/**
 * Deliberately `process.env.NODE_ENV` rather than `import.meta.env.DEV`.
 *
 * `import.meta` is ES-module-only syntax that the CommonJS transform Jest uses
 * cannot compile, which made every component test that transitively imported
 * this file fail to build. `process.env.NODE_ENV` is statically replaced by
 * Vite (see the `define` block in vite.config.ts), so the browser never
 * evaluates a `process` reference at all and the dead branches drop out of the
 * production bundle.
 *
 * Tested positively — `=== 'development'` rather than `!== 'production'`. The
 * negative form reads as equivalent but makes every environment except a
 * production build count as development, including Jest, so a passing test run
 * prints debug output it should be swallowing.
 *
 * An earlier version guarded this with `typeof process !== 'undefined'`. That
 * guard is *not* replaced by Vite, and `process` genuinely does not exist in a
 * browser — so it evaluated false in every browser, silencing debug and info
 * during local development, which is exactly when they are wanted.
 */
const isDevelopment = process.env.NODE_ENV === 'development';

type LogArgs = readonly unknown[];

export const logger = {
  debug: (...args: LogArgs): void => {
    if (isDevelopment) console.debug(...args);
  },
  info: (...args: LogArgs): void => {
    if (isDevelopment) console.info(...args);
  },
  warn: (...args: LogArgs): void => {
    console.warn(...args);
  },
  error: (...args: LogArgs): void => {
    console.error(...args);
  },
};

export default logger;
