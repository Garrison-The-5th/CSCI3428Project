/**
 * File: app-url.test.ts
 * Description: Unit tests for the base URL outgoing links are built on.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Date: 2026-08-27
 */
import type { Application, Request } from 'express';

import { appBaseUrl, configuredBaseUrl, originFromRequest } from '@/config/app-url';
import { configureTrustProxy } from '@/config/client-address';

/** A request carrying nothing but the headers a test cares about. */
function requestWith(headers: Record<string, string>, protocol = 'https'): Request {
  return {
    protocol,
    get: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
}

/** `configureTrustProxy` reads the environment and remembers the answer. */
function withTrustProxy(value: string | undefined) {
  if (value === undefined) delete process.env.TRUST_PROXY;
  else process.env.TRUST_PROXY = value;
  configureTrustProxy({ set: () => undefined } as unknown as Application);
}

describe('configuredBaseUrl', () => {
  const original = process.env.APP_BASE_URL;
  afterEach(() => {
    if (original === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = original;
  });

  it('is null when unset, so the request decides', () => {
    delete process.env.APP_BASE_URL;
    expect(configuredBaseUrl()).toBeNull();
  });

  it('drops a trailing slash, which would otherwise double up in every link', () => {
    process.env.APP_BASE_URL = 'https://learning.ttgteams.com/';
    expect(configuredBaseUrl()).toBe('https://learning.ttgteams.com');
  });

  it('keeps a path, for an app served under one', () => {
    process.env.APP_BASE_URL = 'https://ttgteams.com/learning';
    expect(configuredBaseUrl()).toBe('https://ttgteams.com/learning');
  });

  it('ignores a value that is not an http(s) URL rather than mailing it out', () => {
    process.env.APP_BASE_URL = 'learning.ttgteams.com';
    expect(configuredBaseUrl()).toBeNull();

    process.env.APP_BASE_URL = 'javascript:alert(1)';
    expect(configuredBaseUrl()).toBeNull();
  });
});

describe('originFromRequest', () => {
  afterEach(() => withTrustProxy(undefined));

  it('is the host the request arrived on', () => {
    withTrustProxy(undefined);
    expect(originFromRequest(requestWith({ host: 'learning.ttgteams.com' }))).toBe(
      'https://learning.ttgteams.com',
    );
  });

  it('keeps the port, so a local run links back to the dev server', () => {
    withTrustProxy(undefined);
    expect(originFromRequest(requestWith({ host: 'localhost:5173' }, 'http'))).toBe(
      'http://localhost:5173',
    );
  });

  it('prefers X-Forwarded-Host behind a proxy we have been told to trust', () => {
    withTrustProxy('1');
    const req = requestWith({
      host: 'backend.svc.cluster.local:5002',
      'x-forwarded-host': 'learning.ttgteams.com',
    });
    expect(originFromRequest(req)).toBe('https://learning.ttgteams.com');
  });

  it('takes the first entry when the chain has more than one proxy', () => {
    withTrustProxy('2');
    const req = requestWith({
      host: 'backend:5002',
      'x-forwarded-host': 'learning.ttgteams.com, internal.ingress',
    });
    expect(originFromRequest(req)).toBe('https://learning.ttgteams.com');
  });

  it('ignores X-Forwarded-Host with no proxy in front, where it is caller-supplied text', () => {
    withTrustProxy(undefined);
    const req = requestWith({ host: 'learning.ttgteams.com', 'x-forwarded-host': 'evil.example' });
    expect(originFromRequest(req)).toBe('https://learning.ttgteams.com');
  });

  it('refuses a host that could break out of the URL it is put in', () => {
    withTrustProxy(undefined);
    expect(originFromRequest(requestWith({ host: 'evil.example/path' }))).toBeNull();
    expect(originFromRequest(requestWith({ host: 'user@evil.example' }))).toBeNull();
    expect(originFromRequest(requestWith({ host: 'host name' }))).toBeNull();
  });

  it('is null when the request names no host at all', () => {
    withTrustProxy(undefined);
    expect(originFromRequest(requestWith({}))).toBeNull();
  });
});

describe('appBaseUrl — what a link in an email is built on', () => {
  const original = process.env.APP_BASE_URL;
  afterEach(() => {
    if (original === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = original;
  });

  it('uses the request origin when nothing is configured — the deployment case', () => {
    delete process.env.APP_BASE_URL;
    expect(appBaseUrl('https://learning.ttgteams.com')).toBe('https://learning.ttgteams.com');
  });

  it('lets configuration win, because it is the one source a caller cannot set', () => {
    process.env.APP_BASE_URL = 'https://learning.ttgteams.com';
    expect(appBaseUrl('https://evil.example')).toBe('https://learning.ttgteams.com');
  });

  it('falls back to the dev server only when there is neither', () => {
    delete process.env.APP_BASE_URL;
    expect(appBaseUrl(null)).toBe('http://localhost:5173');
  });

  /**
   * Locally the browser is on the Vite dev server and the API is on another
   * port, so the host the request carries is this process's own — a link built
   * on it would open the API rather than the app.
   */
  it.each(['http://localhost:5002', 'http://127.0.0.1:5002', 'http://[::1]:5002'])(
    'ignores the loopback host %s in favour of the dev server',
    (origin) => {
      delete process.env.APP_BASE_URL;
      expect(appBaseUrl(origin)).toBe('http://localhost:5173');
    },
  );
});
