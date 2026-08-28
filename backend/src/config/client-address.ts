/**
 * File: client-address.ts
 * Description: Resolves the real caller address through the proxy chain.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import { Application, Request } from 'express';

import { logger } from '@/config/logger';

/**
 * Working out the real caller address when the app runs behind a proxy.
 *
 * Locally there is no proxy and Express's `req.ip` is already the caller. In
 * production the chain is Cloudflare -> Kubernetes ingress -> this container, so
 * `req.ip` is the ingress address and is identical for every visitor. Anything
 * keyed on it (the public rate limiter) collapses into a single shared bucket.
 *
 * The fix has to be careful rather than permissive. `trust proxy: true` tells
 * Express to believe the whole `X-Forwarded-For` chain, which a caller can write
 * freely — that turns the rate limiter off entirely, because an attacker just
 * sends a different fake address each request and lands in a fresh bucket every
 * time. So the trusted portion of the chain is configuration, never a default.
 */

/**
 * Parses the TRUST_PROXY environment variable into what `app.set('trust proxy')`
 * expects.
 *
 *   unset / "false"     no proxy; use the socket address (correct for local dev)
 *   a number, e.g. "2"  trust that many hops closest to this server
 *   a comma-separated   trust these proxy addresses/subnets
 *     list of IPs/CIDRs
 *   "true"              trust everything (accepted, but warned about at startup)
 */
export function parseTrustProxy(raw: string | undefined): boolean | number | string[] {
  const value = raw?.trim();
  if (!value || value === 'false') return false;
  if (value === 'true') return true;

  const hops = Number(value);
  if (Number.isInteger(hops) && hops >= 0) return hops;

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** Whether we are behind a proxy we have been told to believe. */
let behindTrustedProxy = false;

/**
 * Whether the forwarding headers are worth reading.
 *
 * Asked by anything that has to take the caller's word for something the proxy
 * rewrote — the caller's address here, the host the app was reached on in
 * `config/app-url.ts`. Unproxied, those headers are caller-supplied text.
 */
export function isBehindTrustedProxy(): boolean {
  return behindTrustedProxy;
}

export function configureTrustProxy(app: Application) {
  const setting = parseTrustProxy(process.env.TRUST_PROXY);
  app.set('trust proxy', setting);
  behindTrustedProxy = setting !== false;

  if (setting === false) {
    // Expected locally. In production it means the rate limiter is keying every
    // visitor on the ingress address, so say so loudly rather than silently.
    const message = 'TRUST_PROXY is not set: using the direct socket address as the caller IP.';
    if (process.env.NODE_ENV === 'production') {
      logger.warn(
        `${message} Behind Cloudflare and the k8s ingress this makes every visitor ` +
          'share one rate-limit bucket. Set TRUST_PROXY to the number of trusted hops.',
      );
    } else {
      logger.info(`${message} (Correct for local development — no proxy in front.)`);
    }
    return;
  }

  if (setting === true) {
    logger.warn(
      'TRUST_PROXY=true trusts the entire X-Forwarded-For chain, which callers can ' +
        'forge. Prefer a hop count or an explicit proxy subnet list.',
    );
    return;
  }

  logger.info({ trustProxy: setting }, 'trust proxy configured');
}

/**
 * A conservative shape check. The result becomes a Map key, so we do not want a
 * long attacker-supplied string in there, and anything that is not plausibly an
 * address is not worth trusting.
 */
function looksLikeAddress(value: string): boolean {
  return value.length > 0 && value.length <= 45 && /^[0-9a-fA-F.:]+$/.test(value);
}

/**
 * The caller's address, for rate limiting and logging.
 *
 * Prefers Cloudflare's `CF-Connecting-IP`, which Cloudflare overwrites on every
 * request, so unlike `X-Forwarded-For` a caller cannot pre-set it to something
 * false. Only consulted when we are behind a proxy we trust — if the app is
 * reachable directly, that header is just another thing the caller can type.
 */
export function clientAddress(req: Request): string {
  if (behindTrustedProxy) {
    const forwarded = req.get('CF-Connecting-IP')?.trim();
    if (forwarded && looksLikeAddress(forwarded)) return forwarded;
  }

  return req.ip ?? 'unknown';
}
