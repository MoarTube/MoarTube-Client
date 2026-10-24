import { test, expect, signIn, credentials } from './fixtures.js';

for (const route of [
  '/videos',
  '/settings',
  '/links',
  '/monetization',
  '/comments',
  '/reports/videos',
  '/reports/comments',
]) {
  test(`anonymous visitors are redirected from ${route}`, async ({ page }) => {
    await page.goto(route);
    await expect(page).toHaveURL(/\/account\/signin$/);
    await expect(page.locator('#sign-in-form')).toBeVisible();
  });
}

test('sign in to the real Node, retain the session, and sign out', async ({ page }) => {
  await signIn(page);
  await page.reload();
  await expect(page.locator('#import-button')).toBeVisible();
  await page.goto('/account/signin');
  await expect(page).toHaveURL(/\/videos$/);
  await page.getByRole('link', { name: /sign out/i }).click();
  await expect(page).toHaveURL(/\/account\/signin$/);
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/account\/signin$/);
});

test('signing in does not authenticate a separate browser context', async ({
  signedInPage,
  browser,
}) => {
  await expect(signedInPage.locator('#import-button')).toBeVisible();
  const visitor = await browser.newContext();
  try {
    const page = await visitor.newPage();
    await page.goto(new URL('/videos', signedInPage.url()).toString());
    await expect(page).toHaveURL(/\/account\/signin$/);
  } finally {
    await visitor.close();
  }
});

test('incorrect credentials leave the visitor signed out', async ({ page }) => {
  await signIn(page, `${credentials.password}-incorrect-e2e`);
  await expect(page.locator('.swal2-popup')).toBeVisible();
  await expect(page).toHaveURL(/\/account\/signin$/);
  await page.goto('/videos');
  await expect(page).toHaveURL(/\/account\/signin$/);
});

test('empty credentials are rejected by the sign-in form', async ({ page }) => {
  await page.goto('/account/signin');
  await page.locator('#sign-in-button').click();
  await expect(page).toHaveURL(/\/account\/signin$/);
  await expect(page.locator('#sign-in-form')).toBeVisible();
});

test('sign-in works at a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await expect(page.locator('#import-button')).toBeVisible();
});
