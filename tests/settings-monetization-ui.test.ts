import { readFile } from 'node:fs/promises';
import path from 'node:path';
import ejs from 'ejs';
import { chromium, expect as browserExpect } from '@playwright/test';
import { expect, it } from 'vitest';

it('loads donation rows, validates drafts, saves additions and removals, and retains failed changes', async () => {
  const template = await readFile('public/views/settings.ejs', 'utf8');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  let wallets = [
    {
      wallet_address_id: 1,
      wallet_address: '<img src=x onerror=alert(1)>',
      chain: 'ETH',
      currency: 'ETH',
    },
  ];
  let nextId = 2;
  let fail = true;
  let failLoad = true;
  let additions = 0;
  let deletions = 0;
  let failDelete = true;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('http://moartube.test/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const base = '/settings/node/personalize/monetization';
    if (pathname.startsWith(base)) {
      if (pathname === base) {
        await route.fulfill({
          json: failLoad ? { isError: true } : { isError: false, cryptoWalletAddresses: wallets },
        });
      } else if (pathname.endsWith('/add')) {
        if (fail) {
          await route.fulfill({ status: 502, json: { isError: true, message: 'Unavailable' } });
          return;
        }
        const data = route.request().postDataJSON() as {
          walletAddress: string;
          chain: string;
          currency: string;
        };
        const wallet = {
          wallet_address_id: nextId++,
          wallet_address: data.walletAddress,
          chain: data.chain,
          currency: data.currency,
        };
        wallets.push(wallet);
        additions++;
        await route.fulfill({ json: { isError: false, cryptoWalletAddress: wallet } });
      } else {
        if (failDelete) {
          await route.fulfill({ status: 502, json: { isError: true } });
          return;
        }
        deletions++;
        const { cryptoWalletAddressId } = route.request().postDataJSON() as {
          cryptoWalletAddressId: number;
        };
        wallets = wallets.filter((wallet) => wallet.wallet_address_id !== cryptoWalletAddressId);
        await route.fulfill({ json: { isError: false } });
      }
      return;
    }
    if (pathname === '/') {
      const html = ejs
        .render(template, { model: { clientSettings: {} } })
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(
          '</body>',
          `
        <script src="/javascript/jquery-3.6.4.min.js"></script>
        <script src="/javascript/settings-monetization.js"></script>
        <script>window.alerts=[]; window.editor=new MoarTubeNodeMonetization((...args)=>window.alerts.push(args)); void window.editor.start();</script></body>`
        );
      await route.fulfill({ contentType: 'text/html', body: html });
      return;
    }
    try {
      await route.fulfill({ path: path.join(process.cwd(), 'public', pathname) });
    } catch {
      await route.fulfill({ status: 404, body: '' });
    }
  });
  try {
    await page.goto('http://moartube.test/');
    const form = page.getByRole('form', { name: 'Monetization', exact: true });
    const rows = form.locator('.node-monetization-row');
    await browserExpect(form.locator('fieldset')).toHaveJSProperty('disabled', true);
    failLoad = false;
    await form.getByRole('button', { name: 'Retry loading' }).click();
    await browserExpect(rows).toHaveCount(1);
    await browserExpect(rows.first().locator('input')).toHaveValue('<img src=x onerror=alert(1)>');
    await browserExpect(form.locator('img')).toHaveCount(0);
    expect(
      await form.evaluate(
        (element: { parentElement: { lastElementChild: unknown } | null }) =>
          element.parentElement?.lastElementChild === element
      )
    ).toBe(true);
    await form.getByRole('button', { name: 'Add item', exact: true }).click();
    const draft = rows.last();
    await draft.locator('input').fill(' 0xnew ');
    await form.getByRole('button', { name: 'Save', exact: true }).click();
    expect(additions).toBe(0);
    await browserExpect(draft.locator('[name=chain]')).toBeFocused();
    await draft.locator('[name=chain]').selectOption('BNB');
    await draft.locator('[name=currency]').selectOption('BNB');
    await rows
      .first()
      .getByRole('button', { name: 'Remove donation address 1', exact: true })
      .click();
    await form.getByRole('button', { name: 'Save', exact: true }).click();
    await browserExpect(form.getByRole('status')).toContainText('not confirmed saved');
    await browserExpect(draft.locator('input')).toHaveValue(' 0xnew ');
    expect(deletions).toBe(0);
    fail = false;
    await form.getByRole('button', { name: 'Save', exact: true }).click();
    await browserExpect(form.getByRole('status')).toContainText('not confirmed saved');
    expect(additions).toBe(0);
    failDelete = false;
    await form.getByRole('button', { name: 'Save', exact: true }).click();
    await browserExpect(form.getByRole('status')).toBeEmpty();
    expect(wallets).toEqual([
      { wallet_address_id: 2, wallet_address: '0xnew', chain: 'BNB', currency: 'BNB' },
    ]);
    await form.getByRole('button', { name: 'Save', exact: true }).click();
    await browserExpect(form.getByRole('status')).toBeEmpty();
    expect(additions).toBe(1);
    await page.reload();
    await browserExpect(rows).toHaveCount(1);
    await browserExpect(rows.first().locator('input')).toHaveValue('0xnew');
    await form.screenshot({ path: 'temp/monetization-desktop.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    await form.screenshot({ path: 'temp/monetization-mobile.png' });
    expect(
      await form.evaluate(
        (element: { scrollWidth: number; clientWidth: number }) =>
          element.scrollWidth <= element.clientWidth
      )
    ).toBe(true);
    await rows
      .first()
      .getByRole('button', { name: 'Remove donation address 1', exact: true })
      .click();
    await form.getByRole('button', { name: 'Save', exact: true }).click();
    await browserExpect(form.getByRole('status')).toBeEmpty();
    await page.reload();
    await browserExpect(form.locator('#node-monetization-empty')).toBeVisible();
    expect(wallets).toEqual([]);
    const add = form.getByRole('button', { name: 'Add item', exact: true });
    for (let index = 0; index < 10; index++) {await add.click();}
    await browserExpect(rows).toHaveCount(10);
    await browserExpect(add).toBeDisabled();
    await rows
      .first()
      .getByRole('button', { name: 'Remove donation address 1', exact: true })
      .click();
    await browserExpect(add).toBeEnabled();
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
  }
}, 30000);
