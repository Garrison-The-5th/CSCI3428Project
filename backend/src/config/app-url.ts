/**
 * File: app-url.ts
 * Description: The app's public address, for links that have to work outside it.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-27
 */
import { Request } from 'express';

import { isBehindTrustedProxy } from '@/config/client-address';
import { logger } from '@/config/logger';

/**
 * Where the app lives, as far as anyone reading an email is concerned.
 *
 * A link in an email is the one URL the app cannot check afterwards. Inside the
 * browser every link is relative to wherever the page already is, so it is right
 * by construction; a link that is posted out has to name a host, and the host it
 * names was `APP_BASE_URL` alone — with `http://localhost:5173` as the fallback.
 * Deployments do not set it, so every assignment mail from production carried a
 * link to the reader's own laptop.
 *
 * So the host is taken from the request that asked for the link to be sent. The
 * admin clicking Assign is on the app, that click reaches this process with the
 * app's own host on it, and in production the frontend and the API are the same
 * origin (`https://learning.ttgteams.com`, with `/api` routed to the backend by
 * the ingress) — so the host on the request is exactly the host the recipient
 * needs. It cannot drift from wherever the app is actually being served, which
 * is the failure this replaces.
 *
 * `APP_BASE_URL` still wins when it is set, for two reasons. It is the only
 * source a caller cannot influence — see `originFromRequest` below — and it is
 * what a split deployment needs, where the address the admin uses is not the
 * address to send learners to.
 */

/** The Vite dev server: right for a local checkout, and wrong everywhere else. */
const DEV_FALLBACK = 'http://localhost:5173';

const stripTrailingSlashes = (value: string) => value.replace(/\/+$/, '');

/**
 * `APP_BASE_URL`, once it has been checked for being a URL at all.
 *
 * A path is kept — a deployment behind `example.com/learning` needs it — and a
 * query or fragment is not, because nothing here would produce one and a value
 * carrying one is a typo. Null when unset or unusable, so the caller falls
 * through to the request rather than mailing out a link built from a broken
 * string.
 */
export function configuredBaseUrl(): string | null {
  const raw = process.env.APP_BASE_URL?.trim();
  if (!raw) return null;

  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      logger.warn({ appBaseUrl: raw }, 'APP_BASE_URL is not an http(s) URL and is being ignored');
      return null;
    }
    return stripTrailingSlashes(`${url.origin}${url.pathname}`);
  } catch {
    logger.warn({ appBaseUrl: raw }, 'APP_BASE_URL is not a valid URL and is being ignored');
    return null;
  }
}

/**
 * A conservative shape check on a host taken off a header.
 *
 * The value ends up inside a URL in an email, so anything that could end the
 * host early — whitespace, a slash, an `@`, a control character — is rejected
 * rather than escaped. Letters, digits, dots, hyphens, a port, and the brackets
 * an IPv6 literal comes in are the whole legal alphabet.
 */
function usableHost(host: string): boolean {
  return host.length > 0 && host.length <= 260 && /^[A-Za-z0-9.\-[\]:]+$/.test(host);
}

/**
 * The origin this request arrived on — `https://learning.ttgteams.com` — or null
 * when the request does not say.
 *
 * `X-Forwarded-Host` and `X-Forwarded-Proto` are only read when `TRUST_PROXY`
 * says there is a proxy in front to have written them; unproxied, they are just
 * two more things the caller can type. The `Host` header is trusted in both
 * cases, which is the one thing worth being explicit about: a caller can send
 * any Host they like, so somebody who can reach this API directly could get a
 * link to their own host into a mail we send. That is why `APP_BASE_URL` takes
 * precedence — setting it pins the host to configuration and closes this off.
 * Unset, the exposure is bounded by the ingress, which routes on the host and so
 * only forwards requests naming a host this app actually answers to.
 */
export function originFromRequest(req: Request): string | null {
  const proxied = isBehindTrustedProxy();

  // A forwarded header is a list when there is more than one proxy; the first
  // entry is the one closest to the client, which is the one the client saw.
  const first = (value: string | undefined) => value?.split(',')[0]?.trim();

  const host =
    (proxied ? first(req.get('x-forwarded-host')) : undefined) || req.get('host')?.trim();
  if (!host || !usableHost(host)) return null;

  // req.protocol already consults X-Forwarded-Proto when trust proxy is set.
  const protocol = req.protocol === 'https' ? 'https' : 'http';
  return `${protocol}://${host}`;
}

/** Hosts that mean "this machine", and so mean nothing to anyone receiving a link. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);

/**
 * Whether an origin only resolves on the machine that produced it.
 *
 * This is what tells a local checkout apart from a deployment, and it is asked
 * of the request rather than of `NODE_ENV` because the answer has to stay right
 * for a staging box that was started in development mode.
 */
function isLoopbackOrigin(origin: string): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(origin).hostname.replace(/^\[|\]$/g, ''));
  } catch {
    return false;
  }
}

/**
 * The base to build an outgoing link on: configuration first, then the request
 * that asked for the link, then the dev server.
 *
 * Callers pass the origin rather than the request itself, because the mail is
 * sent from a service that has no business knowing about Express — and some of
 * it is sent from a background job with no request in scope at all, which is
 * exactly the case the `APP_BASE_URL` fallback is for.
 */
export function appBaseUrl(requestOrigin?: string | null): string {
  const configured = configuredBaseUrl();
  if (configured) return configured;

  /**
   * A loopback host is thrown away rather than used, because locally the API is
   * not where the app is: the browser is on the Vite dev server at :5173 and the
   * request lands here on :5002, so the host it carries is this process's own
   * port. Deployed, the two are one origin behind the ingress and the host is
   * the app's — which is the case this whole fallback exists for.
   */
  if (requestOrigin && !isLoopbackOrigin(requestOrigin)) {
    return stripTrailingSlashes(requestOrigin);
  }

  if (process.env.NODE_ENV === 'production') {
    logger.warn(
      { fallback: DEV_FALLBACK, requestOrigin },
      'no APP_BASE_URL and no usable request host: this link points at the local dev host',
    );
  }

  return DEV_FALLBACK;
}
