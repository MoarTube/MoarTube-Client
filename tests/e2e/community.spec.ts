import { observe } from './fixtures.js';
import { test } from './node-fixtures.js';
import { expect, uniqueName, clientResponse, expectSuccess } from './fixtures.js';
import { randomBytes } from 'node:crypto';

test('add and delete a promotional link through the Client', async ({
  signedInPage: page,
  viewerPage: viewer,
}) => {
  const url = `https://example.test/${uniqueName('link').replaceAll(' ', '-')}`;
  await page.goto('/links');
  await page.locator('#add-link-button').click();
  await page.locator('#url-input').fill(url);
  await page
    .locator('#svg-graphic-textarea')
    .fill('<svg xmlns="http://www.w3.org/2000/svg"><circle r="5"/></svg>');
  const added = clientResponse(page, '/links/add');
  await page.locator('.swal2-confirm').click();
  await expectSuccess(added);
  await page.reload();
  const row = page.locator('#links-table tr').filter({ hasText: url });
  await expect(row).toHaveCount(1);
  await viewer.goto('/');
  await expect(viewer.locator(`#navbar-settings-buttons a[href="${url}"]`)).toBeVisible();
  await row.locator('.delete-link-button').click();
  await page.locator('.swal2-cancel').click();
  await expect(row).toHaveCount(1);
  await row.locator('.delete-link-button').click();
  const deleted = clientResponse(page, '/links/delete');
  await page.locator('.swal2-confirm').click();
  await expectSuccess(deleted);
  await expect(row).toHaveCount(0);
  await page.reload();
  await expect(page.locator('#links-table')).not.toContainText(url);
  await viewer.reload();
  await expect(viewer.locator(`#navbar-settings-buttons a[href="${url}"]`)).toHaveCount(0);
});

test('link dialog rejects empty fields', async ({ signedInPage: page }) => {
  await page.goto('/links');
  await page.locator('#add-link-button').click();
  await page.locator('.swal2-confirm').click();
  await expect(page.locator('#url-input')).toBeVisible();
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
    await page.goto('/monetization');
    await page.locator('#add-wallet-button').click();
    await expect(page.locator('#currency-select')).toBeDisabled();
    await page.locator('#wallet-address-input').fill(wallet);
    await page.locator('#chain-select').selectOption(chain);
    await page.locator('#currency-select').selectOption(chain);
    const added = clientResponse(page, '/monetization/add');
    await page.locator('.swal2-confirm').click();
    await expectSuccess(added);
    await page.reload();
    const row = page.locator('#crypto-wallet-addresses-table tr').filter({ hasText: wallet });
    await expect(row).toHaveCount(1);
    const walletId = Number(
      await row.locator('.delete-wallet-button').getAttribute('data-cryptowalletaddressid')
    );
    expect(Number.isInteger(walletId)).toBe(true);
    expect(walletId).toBeGreaterThan(0);
    await row.locator('.delete-wallet-button').click();
    const deleted = clientResponse(page, '/monetization/delete');
    await page.locator('.swal2-confirm').click();
    expect((await deleted).request().postDataJSON()).toEqual({ cryptoWalletAddressId: walletId });
    await expectSuccess(deleted);
    await expect(row).toHaveCount(0);
    await page.reload();
    await expect(page.locator('#crypto-wallet-addresses-table')).not.toContainText(wallet);
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
