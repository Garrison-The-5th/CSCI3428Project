/**
 * File: security-config.test.ts
 * Description: Unit tests for logging redaction, proxy trust resolution,
 *   module colour parsing and email redaction.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import type { Request } from 'express';

import { clientAddress, configureTrustProxy, parseTrustProxy } from '@/config/client-address';
import { safeForLog } from '@/config/logger';
import { MODULE_COLORS, parseModuleColor } from '@/config/module-colors';
import { maskSensitivePath } from '@/controllers/middleware/request-logger';
import { redactEmail, redactTokens } from '@/services/email-service/email-service';

jest.mock('@/gateways/curriculum-gateway/curriculum-gateway');

describe('safeForLog — log injection defence (§3.4.3)', () => {
  it.each([
    ['newline', 'user\ninjected'],
    ['carriage return', 'user\rinjected'],
    ['tab', 'user\tinjected'],
    ['CRLF', 'user\r\ninjected'],
  ])('flattens a %s so a forged log line cannot be written', (_label, value) => {
    const output = safeForLog(value);
    expect(output).not.toMatch(/[\r\n\t]/);
    expect(output).toContain('user');
  });

  it('truncates so one value cannot flood the log', () => {
    expect(safeForLog('x'.repeat(1000), 50)).toHaveLength(50);
  });

  it('renders null and undefined as an empty string rather than the words', () => {
    expect(safeForLog(null)).toBe('');
    expect(safeForLog(undefined)).toBe('');
  });
});

describe('redactTokens — assignment links are credentials (§3.4.1)', () => {
  it('masks the token in an assignment URL', () => {
    const body =
      'Open it here:\nhttps://app.example.com/a/8Kf3nQx7bZ2mTvR4pLw9sYc1dHgJ5aEuXo0iNfB\n';
    const output = redactTokens(body);

    expect(output).toContain('/a/[REDACTED]');
    expect(output).not.toContain('8Kf3nQx7bZ2mTvR4pLw9sYc1dHgJ5aEuXo0iNfB');
  });

  it('masks every token when a message carries more than one', () => {
    const output = redactTokens(
      'first https://x/a/AAAAAAAAAAAAAAAAAAAA second https://x/a/BBBBBBBBBBBBBBBBBBBB',
    );
    expect(output.match(/\[REDACTED\]/g)).toHaveLength(2);
  });

  it('leaves ordinary text alone', () => {
    const body = 'You have been enrolled in the course "Fire safety". Sign in at /login';
    expect(redactTokens(body)).toBe(body);
  });
});

describe('redactEmail', () => {
  it('keeps the domain and the first letter, so entries stay correlatable', () => {
    expect(redactEmail('ada@example.com')).toBe('a***@example.com');
  });

  it('does not leak anything from a malformed address', () => {
    expect(redactEmail('not-an-email')).toBe('[REDACTED]');
  });
});

describe('maskSensitivePath', () => {
  /**
   * Guest routes carry the token in the URL. Without masking, every request
   * would write a working credential into the access log.
   */
  it('replaces the token in a public assignment path', () => {
    const masked = maskSensitivePath(
      '/public/assignments/8Kf3nQx7bZ2mTvR4pLw9sYc1dHgJ5aEuXo0iNfB/dashboard',
    );
    expect(masked).toBe('/public/assignments/:token/dashboard');
  });

  it('masks the token even when a query string follows', () => {
    expect(maskSensitivePath('/public/assignments/SOMETOKEN123?x=1')).toContain(':token');
  });

  it('leaves an ordinary path untouched', () => {
    expect(maskSensitivePath('/curriculum/courses/abc-123')).toBe('/curriculum/courses/abc-123');
  });

  it('strips control characters from the path too', () => {
    expect(maskSensitivePath('/curriculum\n/courses')).not.toMatch(/\n/);
  });
});

describe('parseTrustProxy — §3.10.5', () => {
  it('treats unset and "false" as no proxy, which is correct locally', () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy('')).toBe(false);
    expect(parseTrustProxy('false')).toBe(false);
  });

  it('reads a hop count', () => {
    expect(parseTrustProxy('2')).toBe(2);
    expect(parseTrustProxy('0')).toBe(0);
  });

  it('reads a comma-separated proxy list', () => {
    expect(parseTrustProxy('10.0.0.1, 172.16.0.0/12')).toEqual(['10.0.0.1', '172.16.0.0/12']);
  });

  it('accepts "true", which the startup warning then flags as risky', () => {
    expect(parseTrustProxy('true')).toBe(true);
  });
});

describe('clientAddress', () => {
  function requestWith(headers: Record<string, string>, ip = '10.1.2.3'): Request {
    return {
      ip,
      get: (name: string) => headers[name.toLowerCase()],
    } as unknown as Request;
  }

  it('uses the socket address when no proxy is trusted', () => {
    configureTrustProxy({ set: jest.fn() } as never);
    const address = clientAddress(requestWith({ 'cf-connecting-ip': '1.2.3.4' }));

    // The forwarded header is ignored: reachable directly, it is just another
    // thing the caller can type.
    expect(address).toBe('10.1.2.3');
  });

  it('prefers CF-Connecting-IP once behind a trusted proxy', () => {
    process.env.TRUST_PROXY = '2';
    configureTrustProxy({ set: jest.fn() } as never);

    expect(clientAddress(requestWith({ 'cf-connecting-ip': '1.2.3.4' }))).toBe('1.2.3.4');
    delete process.env.TRUST_PROXY;
  });

  it('ignores a forwarded value that is not shaped like an address', () => {
    process.env.TRUST_PROXY = '2';
    configureTrustProxy({ set: jest.fn() } as never);

    expect(clientAddress(requestWith({ 'cf-connecting-ip': 'not an ip' }))).toBe('10.1.2.3');
    delete process.env.TRUST_PROXY;
  });
});

describe('parseModuleColor', () => {
  it('accepts every colour in the palette', () => {
    for (const colour of MODULE_COLORS) {
      expect(parseModuleColor(colour)).toBe(colour);
    }
  });

  it('normalises case', () => {
    expect(parseModuleColor(MODULE_COLORS[0].toUpperCase())).toBe(MODULE_COLORS[0]);
  });

  it('treats empty and null as clearing the tint', () => {
    expect(parseModuleColor('')).toBeNull();
    expect(parseModuleColor(null)).toBeNull();
    expect(parseModuleColor(undefined)).toBeNull();
  });

  /**
   * A closed palette, so a module can only hold a colour the UI knows how to
   * render — and so an arbitrary string cannot reach a style attribute.
   */
  it('refuses a colour outside the palette', () => {
    expect(() => parseModuleColor('#ff0000')).toThrow(/not one of the module colours/);
    expect(() => parseModuleColor('red')).toThrow();
    expect(() => parseModuleColor('javascript:alert(1)')).toThrow();
  });
});
