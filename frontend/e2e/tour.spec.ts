/**
 * File: tour.spec.ts
 * Description: End-to-end tests for the first-login walkthrough and the default
 *   tutorial it leads into, in a real browser against a real realm.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-10-30
 */
import { expect, type Page, test } from '@playwright/test';

/**
 * Two accounts, because "first login" can only happen once per account.
 *
 * - E2E_FRESH_USER: a Keycloak account that has never signed in to this
 *   database. The first-login test is the only one that uses it, and it is only
 *   fresh once — point it at a new account (or a reset database) for each run.
 * - E2E_TEST_USER: any account. Used for replay and skip, which work however
 *   many times they run.
 *
 * Both are skipped rather than omitted when not configured, as the signed-in
 * specs in critical-flows.spec.ts are, so the gap shows in the report.
 */
const fresh = {
  user: process.env.E2E_FRESH_USER,
  password: process.env.E2E_FRESH_PASSWORD,
};
const regular = {
  user: process.env.E2E_TEST_USER,
  password: process.env.E2E_TEST_PASSWORD,
};

const card = (page: Page) => page.getByTestId('tour-card');

/** Signs in through the realm's own login page, as a person would. */
async function signIn(page: Page, user: string, password: string) {
  await page.goto('/login');
  await page
    .getByRole('button', { name: /sign in|log ?in/i })
    .first()
    .click();
  await page.getByLabel(/username|email/i).fill(user);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: /sign in|log ?in/i }).click();
  // Back in the app with the shell drawn. Where exactly depends on the account:
  // an admin's sign-in lands on the admin dashboard, a learner's on Home.
  await expect(page.locator('.app-sidebar')).toBeVisible();
}

/** The card is showing this step, by its counter. */
async function expectStep(page: Page, number: number, title: RegExp) {
  await expect(card(page)).toContainText(`${number} of 15`);
  await expect(card(page)).toContainText(title);
}

/**
 * Every step, start to finish, doing what each one asks — clicking the real
 * sidebar item, the real course card and the real Start button, not a button
 * in the card standing in for them.
 */
async function walkTheWholeTour(page: Page) {
  const next = () =>
    card(page)
      .getByRole('button', { name: /^next$/i })
      .click();

  await expectStep(page, 1, /welcome/i);
  await card(page)
    .getByRole('button', { name: /start the tour/i })
    .click();

  await expectStep(page, 2, /home/i);
  await next();

  await expectStep(page, 3, /profile/i);
  await expect(card(page).getByRole('button', { name: /^next$/i })).toHaveCount(0);
  await page.locator('[data-tour="nav-profile"]').click();
  await expect(page).toHaveURL(/\/profile$/);

  await expectStep(page, 4, /your details/i);
  await next();
  await expectStep(page, 5, /privacy/i);
  await next();
  await expectStep(page, 6, /learning/i);
  await next();
  await expectStep(page, 7, /quizzes/i);
  await next();
  await expectStep(page, 8, /contact/i);
  await next();

  // The tour takes them back Home itself for the tutorial card.
  await expect(page).toHaveURL(/\/$/);
  await expectStep(page, 9, /your first course/i);
  // On Home while the tutorial is outstanding; on Learning once it is finished.
  // The card's wording says which the tour settled on, once Home has loaded.
  await expect(card(page)).toContainText(/click it to open it|click learning/i);
  if (/click learning/i.test((await card(page).textContent()) ?? '')) {
    await page.locator('[data-tour="nav-learning"]').click();
    await page.locator('[data-tour="learning-tutorial-card"]').click();
  } else {
    await page.locator('[data-tour="outstanding-tutorial-card"]').click();
  }
  await expect(page).toHaveURL(/\/learning\/[^/]+$/);

  await expectStep(page, 10, /a course page/i);
  await page.locator('[data-tour="start-course-button"]').click();
  await expect(page).toHaveURL(/\/learning\/[^/]+\/content/);

  await expectStep(page, 11, /course content/i);
  await next();
  await expectStep(page, 12, /what you are reading/i);
  await next();

  await expectStep(page, 13, /moving through a course/i);
  // A one-item tutorial draws no Previous/Next, and the step falls back to Next.
  // The card's wording says which, once the player has rendered.
  await expect(card(page)).toContainText(/try it|in a longer course/i);
  if (/try it/i.test((await card(page).textContent()) ?? '')) {
    await page.keyboard.press('ArrowRight');
  } else {
    await next();
  }

  await expectStep(page, 14, /learning tools and notes/i);
  await next();

  await expectStep(page, 15, /you.re ready/i);
  await card(page)
    .getByRole('button', { name: /finish/i })
    .click();
  await expect(card(page)).toBeHidden();
}

test.describe('the first-login tour', () => {
  test.skip(
    !fresh.user || !fresh.password,
    'Set E2E_FRESH_USER and E2E_FRESH_PASSWORD (an account that has never signed in) to run.',
  );

  test('greets a brand-new account and walks them into the tutorial', async ({ page }) => {
    await signIn(page, fresh.user!, fresh.password!);

    await walkTheWholeTour(page);

    // Marked complete on the account: signing in again does not show it.
    await page.context().clearCookies();
    await signIn(page, fresh.user!, fresh.password!);
    await page.waitForLoadState('networkidle');
    await expect(card(page)).toBeHidden();
  });
});

test.describe('replaying and skipping the tour', () => {
  test.skip(
    !regular.user || !regular.password,
    'Set E2E_TEST_USER and E2E_TEST_PASSWORD to run these.',
  );

  test.beforeEach(async ({ page }) => {
    await signIn(page, regular.user!, regular.password!);
    // Whatever state the account was left in, start these from "not running".
    const shown = await card(page)
      .waitFor({ state: 'visible', timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (shown) {
      await page.keyboard.press('Escape');
      await expect(card(page)).toBeHidden();
    }
  });

  test('Replay tour on Profile runs the whole tour again', async ({ page }) => {
    await page.goto('/profile');
    await page.getByRole('button', { name: /replay tour/i }).click();
    await expect(page).toHaveURL(/\/$/);

    await walkTheWholeTour(page);

    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(card(page)).toBeHidden();
  });

  test('Skip tour is remembered across a reload', async ({ page }) => {
    await page.goto('/profile');
    await page.getByRole('button', { name: /replay tour/i }).click();
    await expect(card(page)).toBeVisible();

    await card(page)
      .getByRole('button', { name: /^skip tour$/i })
      .first()
      .click();
    await expect(card(page)).toBeHidden();

    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(card(page)).toBeHidden();
  });

  /** It is a multi-page flow; a reload in the middle must land on the same step. */
  test('a reload mid-tour resumes at the same step', async ({ page }) => {
    await page.goto('/profile');
    await page.getByRole('button', { name: /replay tour/i }).click();
    await card(page)
      .getByRole('button', { name: /start the tour/i })
      .click();
    await expectStep(page, 2, /home/i);

    await page.reload();

    await expectStep(page, 2, /home/i);
    await page.keyboard.press('Escape');
  });

  test('the tutorial is on the Learning page, marked Start here', async ({ page }) => {
    await page.goto('/learning');
    const tutorial = page.locator('[data-tour="learning-tutorial-card"]');
    await expect(tutorial).toBeVisible();
    await expect(tutorial).toContainText(/start here/i);
  });
});
