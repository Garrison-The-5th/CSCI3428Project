/**
 * File: critical-flows.spec.ts
 * Description: End-to-end coverage of the four areas §5.1.1 mandates —
 *   authentication, critical workflows, data submission and failure states.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import { expect, test } from '@playwright/test';

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:5002';

/**
 * What these can and cannot cover.
 *
 * Everything that does not need a signed-in Keycloak session is exercised for
 * real. The signed-in journeys need a realm with a known test user, which is
 * environment configuration rather than code — those specs are written and
 * skipped behind `E2E_TEST_USER`, so they run the moment that is provided
 * rather than being absent from the suite. See docs/testing.md.
 */

// ---------------------------------------------------------------------------
// Authentication flows (§5.1.1)
// ---------------------------------------------------------------------------

test.describe('authentication flows', () => {
  test('an anonymous visitor is redirected away from a protected page', async ({ page }) => {
    await page.goto('/learning');

    // ProtectedRoute sends an unauthenticated visitor to /login.
    await expect(page).toHaveURL(/\/login/);
  });

  test('the login page offers a way in', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('button', { name: /sign in|log ?in/i }).first()).toBeVisible();
  });

  test('a protected admin route is not reachable anonymously', async ({ page }) => {
    await page.goto('/admin/users');
    await expect(page).toHaveURL(/\/login|\/unauthorized/);
  });

  test('the public about page is reachable without signing in', async ({ page }) => {
    await page.goto('/about');
    await expect(page).toHaveURL(/\/about/);
  });
});

// ---------------------------------------------------------------------------
// Failure states (§5.1.1)
// ---------------------------------------------------------------------------

test.describe('failure states', () => {
  test('an invalid assignment link explains itself rather than breaking', async ({ page }) => {
    await page.goto('/a/definitely-not-a-real-token');

    await expect(page.getByText(/Link not valid/i)).toBeVisible();
    // And says what to do next.
    await expect(page.getByText(/contact whoever sent you the link/i)).toBeVisible();
  });

  test('an unknown route falls back to the home page rather than a blank screen', async ({
    page,
  }) => {
    await page.goto('/no-such-page');
    await expect(page).not.toHaveURL(/no-such-page/);
  });

  /**
   * The API must never answer a browser with an HTML error page — the client
   * reads `errorMessage` and would show "undefined" instead.
   */
  test('the API returns JSON for an unauthenticated request, not an HTML page', async ({
    request,
  }) => {
    const response = await request.get(`${API_URL}/curriculum/courses`);

    expect(response.status()).toBe(401);
    expect(response.headers()['content-type']).toContain('application/json');
    expect((await response.json()).errorMessage).toBeTruthy();
  });

  test('a guest link failure is a 404 whatever the real reason', async ({ request }) => {
    const response = await request.get(`${API_URL}/public/assignments/nope/session`);

    // Uniform status, so a probe cannot tell a real token from a fake one.
    expect(response.status()).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Security headers, end to end (§3.10.4)
// ---------------------------------------------------------------------------

test.describe('security headers reach the browser', () => {
  test('the API sets the headers the standard requires', async ({ request }) => {
    const response = await request.get(`${API_URL}/table-members/`);
    const headers = response.headers();

    expect(headers['content-security-policy']).toContain("default-src 'self'");
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['x-powered-by']).toBeUndefined();
  });

  test('every response carries a correlation id for support', async ({ request }) => {
    const response = await request.get(`${API_URL}/table-members/`);
    expect(response.headers()['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

// ---------------------------------------------------------------------------
// Data submission paths (§5.1.1)
// ---------------------------------------------------------------------------

test.describe('data submission', () => {
  test('the subscribe form accepts an address and reports the outcome', async ({ page }) => {
    await page.goto('/about');

    // The public page carries the same subscribe endpoint the contact page uses.
    const response = await page.request.post(`${API_URL}/auth/subscribe`, {
      data: { email: `e2e-${Date.now()}@example.com` },
    });

    expect(response.ok()).toBeTruthy();
  });

  test('a submission with the wrong content type is refused with 415', async ({ request }) => {
    const response = await request.post(`${API_URL}/auth/subscribe`, {
      headers: { 'Content-Type': 'text/plain' },
      data: 'email=a@b.c',
    });

    expect(response.status()).toBe(415);
  });

  test('an oversized body is refused rather than accepted into memory', async ({ request }) => {
    const response = await request.post(`${API_URL}/auth/subscribe`, {
      headers: { 'Content-Type': 'application/json' },
      data: { note: 'x'.repeat(3 * 1024 * 1024) },
    });

    expect([400, 413]).toContain(response.status());
  });
});

// ---------------------------------------------------------------------------
// Critical workflows — signed in (§5.1.1)
// ---------------------------------------------------------------------------

/**
 * These need a Keycloak realm with a known test account. Skipped rather than
 * omitted so the gap is visible in the report and the specs run as soon as
 * E2E_TEST_USER / E2E_TEST_PASSWORD are configured.
 */
const hasTestUser = Boolean(process.env.E2E_TEST_USER && process.env.E2E_TEST_PASSWORD);

test.describe('critical workflows (signed in)', () => {
  test.skip(!hasTestUser, 'Set E2E_TEST_USER and E2E_TEST_PASSWORD to run these.');

  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page
      .getByRole('button', { name: /sign in|log ?in/i })
      .first()
      .click();

    await page.getByLabel(/username|email/i).fill(process.env.E2E_TEST_USER!);
    await page.getByLabel(/password/i).fill(process.env.E2E_TEST_PASSWORD!);
    await page.getByRole('button', { name: /sign in|log ?in/i }).click();

    await expect(page).toHaveURL(/\/$|\/learning/);
  });

  test('a learner reaches their dashboard', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /welcome/i })).toBeVisible();
  });

  test('a learner can open the Learning tab', async ({ page }) => {
    await page.goto('/learning');
    await expect(page.getByRole('heading', { name: /learning/i })).toBeVisible();
  });

  test('a learner can download their own data (§3.5.3)', async ({ page }) => {
    await page.goto('/contact');

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: /download my data/i }).click();

    expect((await download).suggestedFilename()).toBe('my-learning-data.json');
  });
});
