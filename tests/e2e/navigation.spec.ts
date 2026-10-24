import { test, expect } from './fixtures.js';

for (const [route, selector] of [
  ['/videos', '#videos_table'],
  ['/settings', '#client-settings-container'],
  ['/links', '#links-table'],
  ['/monetization', '#crypto-wallet-addresses-table'],
  ['/comments', '#comments-table'],
  ['/reports/videos', '#video-reports-table'],
  ['/reports/comments', '#comment-reports-table'],
] as const) {
  test(`renders ${route} using the real Node and returns through the sidebar`, async ({
    signedInPage: page,
  }) => {
    const response = await page.goto(route);
    expect(response?.status()).toBe(200);
    await expect(page.locator(selector)).toBeVisible();
    await expect(page.locator('#sidenav-main a[href="/settings"]')).toBeVisible();
    await expect(page.locator('#node-link')).toHaveAttribute('href', /^https?:\/\//);
    await page.locator('#sidenav-main a[href="/videos"]').click();
    await expect(page).toHaveURL(/\/videos$/);
    await expect(page.locator('#import-button')).toBeVisible();
  });
}

test('unknown Client routes display a real 404', async ({ page }) => {
  const response = await page.goto('/not-a-route');
  expect(response?.status()).toBe(404);
});

for (const [route, table] of [
  ['/comments', '#comments-table'],
  ['/reports/videos', '#video-reports-table'],
  ['/reports/comments', '#comment-reports-table'],
] as const) {
  test(`moderation view ${route} loads real records without seeded assumptions`, async ({
    signedInPage: page,
  }) => {
    const checked = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/node/contentChecked' &&
        response.request().method() === 'POST'
    );
    await page.goto(route);
    await expect(page.locator(table)).toBeVisible();
    expect((await checked).ok()).toBeTruthy();
    expect(await (await checked).json()).toMatchObject({ isError: false });
  });
}
