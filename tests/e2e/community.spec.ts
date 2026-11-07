import { observe } from './fixtures.js';
import { test } from './node-fixtures.js';
import { expect, uniqueName, clientResponse, expectSuccess } from './fixtures.js';
import { randomBytes } from 'node:crypto';

test('adds and removes a Node Icon through personalization settings', async ({
  signedInPage: page,
  viewerPage: viewer,
  publishedVideo: video,
}) => {
  const url = `https://example.test/${uniqueName('icon').replaceAll(' ', '-')}`;
  await page.goto('/settings');
  const form = page.getByRole('form', { name: 'Node Icons', exact: true });
  await form.getByRole('button', { name: 'Add item', exact: true }).click();
  const draft = form.locator('.node-icons-row').last();
  await draft.locator('input').fill(url);
  await draft
    .locator('textarea')
    .fill('<svg xmlns="http://www.w3.org/2000/svg"><circle r="5"/></svg>');
  const added = clientResponse(page, '/settings/node/personalize/icons');
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expectSuccess(added);
  await page.reload();
  // Inputs are populated by the settings editor, so find the row by its live value.
  const index = await form
    .locator('.node-icons-row input')
    .evaluateAll(
      (inputs, target) => inputs.findIndex((input) => (input as HTMLInputElement).value === target),
      url
    );
  expect(index).toBeGreaterThanOrEqual(0);
  await viewer.goto('/watch?v=' + video.id);
  await expect(viewer.locator(`#navbar-settings-buttons a[href="${url}"]`)).toBeVisible();
  await form
    .locator('.node-icons-row')
    .nth(index)
    .getByRole('button', { name: /Remove icon/ })
    .click();
  const removed = clientResponse(page, '/settings/node/personalize/icons');
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expectSuccess(removed);
  await viewer.reload();
  await expect(viewer.locator(`#navbar-settings-buttons a[href="${url}"]`)).toHaveCount(0);
});

test('Node Icons validates an incomplete row', async ({ signedInPage: page }) => {
  await page.goto('/settings');
  const form = page.getByRole('form', { name: 'Node Icons', exact: true });
  await form.getByRole('button', { name: 'Add item', exact: true }).click();
  await form.locator('.node-icons-row').last().locator('input').fill('https://example.test');
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(form.locator('.node-icons-row').last().locator('textarea')).toBeFocused();
});

for (const chain of ['ETH', 'BNB']) {
  test(`add and delete a ${chain} donation address through the Client`, async ({
    signedInPage: page,
  }, testInfo) => {
    const wallet = `0x${randomBytes(20).toString('hex')}`;
    await testInfo.attach('created-wallet.json', {
      body: JSON.stringify({ wallet, chain }),
      contentType: 'application/json',
    });
    await page.goto('/settings');
    const form = page.getByRole('form', { name: 'Monetization', exact: true });
    await expect(form.locator('fieldset')).toHaveJSProperty('disabled', false);
    await form.getByRole('button', { name: 'Add item', exact: true }).click();
    const draft = form.locator('.node-monetization-row').last();
    await expect(draft.locator('[name=currency]')).toBeDisabled();
    await draft.locator('[name=walletAddress]').fill(wallet);
    await draft.locator('[name=chain]').selectOption(chain);
    await draft.locator('[name=currency]').selectOption(chain);
    const added = clientResponse(page, '/settings/node/personalize/monetization/add');
    await form.getByRole('button', { name: 'Save', exact: true }).click();
    await expectSuccess(added);
    await page.reload();
    await expect(form.locator('fieldset')).toHaveJSProperty('disabled', false);
    const index = await form
      .locator('input')
      .evaluateAll(
        (inputs, value) => inputs.findIndex((input) => (input as HTMLInputElement).value === value),
        wallet
      );
    expect(index).toBeGreaterThanOrEqual(0);
    const row = form.locator('.node-monetization-row').nth(index);
    await expect(row).toHaveCount(1);
    const walletId = Number(
      await row.evaluate((element) => (element as HTMLElement & { walletId: number }).walletId)
    );
    expect(Number.isInteger(walletId)).toBe(true);
    expect(walletId).toBeGreaterThan(0);
    await row.getByRole('button', { name: /Remove donation address/ }).click();
    const deleted = clientResponse(page, '/settings/node/personalize/monetization/delete');
    await form.getByRole('button', { name: 'Save', exact: true }).click();
    expect((await deleted).request().postDataJSON()).toEqual({ cryptoWalletAddressId: walletId });
    await expectSuccess(deleted);
    await expect(form.getByRole('status')).toBeEmpty();
    await page.reload();
    await expect(form.locator('fieldset')).toHaveJSProperty('disabled', false);
    expect(
      await form
        .locator('input')
        .evaluateAll(
          (inputs, value) => inputs.some((input) => (input as HTMLInputElement).value === value),
          wallet
        )
    ).toBe(false);
  });
}

test('comment search submits the text entered in the Client', async ({ signedInPage: page }) => {
  await page.goto('/comments');
  const search = uniqueName('absent-comment');
  const response = observe(
    page.waitForResponse(
      (result) =>
        new URL(result.url()).pathname === '/comments/search' &&
        new URL(result.url()).searchParams.get('searchTerm') === search
    )
  );
  await page.locator('#search-input').fill(search);
  expect((await response).ok()).toBeTruthy();
  expect(await (await response).json()).toMatchObject({ isError: false, comments: [] });
});
