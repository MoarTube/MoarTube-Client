import { readFileSync } from 'node:fs';
import { chromium, type Browser, type Page } from '@playwright/test';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const storageKey = 'moartube.nodeFavorites.v1';
const values = {
  username: 'alice',
  password: 'private-password',
  moarTubeNodeIp: '127.0.0.1',
  moarTubeNodePort: '8081',
};
let browser: Browser;
let page: Page;
let requests: unknown[];

async function fillLogin(): Promise<void> {
  for (const [key, value] of Object.entries(values)) {
    await page.locator(`#sign-in-form [name="${key}"]`).fill(value);
  }
}

async function stored(): Promise<Record<string, string>[]> {
  return JSON.parse(await page.evaluate(`localStorage.getItem('${storageKey}') || '[]'`)) as Record<
    string,
    string
  >[];
}

async function save(name: string, keys: string[]): Promise<void> {
  await page.getByRole('button', { name: 'Add favorite', exact: true }).click();
  await page.getByLabel('Favorite name', { exact: true }).fill(name);
  for (const [key, value] of Object.entries(values)) {
    await page.locator(`#favorite-value-${key}`).fill(keys.includes(key) ? value : '');
  }
  await page.getByRole('button', { name: 'Save favorite', exact: true }).click();
}

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => {
  await browser.close();
});
beforeEach(async () => {
  requests = [];
  page = await browser.newPage();
  await page.route('http://favorites.test/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (route.request().method() === 'POST') {
      requests.push(route.request().postDataJSON());
      await route.fulfill({ json: { isError: true, message: 'Test login failure' } });
    } else if (pathname === '/account/signin') {
      await route.fulfill({
        contentType: 'text/html',
        body: readFileSync('public/views/signin.ejs', 'utf8'),
      });
    } else if (pathname.startsWith('/javascript/')) {
      await route.fulfill({
        contentType: 'application/javascript',
        body: readFileSync(`public${pathname}`, 'utf8'),
      });
    } else {
      await route.fulfill({ body: '' });
    }
  });
  await page.goto('http://favorites.test/account/signin');
});
afterEach(async () => {
  await page.close();
});

describe('explicit node favorites', () => {
  it('never saves on login, including after a failure', async () => {
    await fillLogin();
    await page.locator('#sign-in-button').click();
    await page.locator('.swal2-popup').waitFor();
    expect(requests).toEqual([values]);
    expect(await stored()).toEqual([]);
  });

  it('stores entered values and empty strings for every optional-field combination', async () => {
    const keys = Object.keys(values);
    for (let mask = 0; mask < 16; mask++) {
      await fillLogin();
      const selected = keys.filter((_, index) => mask & (1 << index));
      await save(`Node ${String(mask)}`, selected);
      const favorites = await stored();
      const favorite = favorites[favorites.length - 1];
      expect(favorite).toEqual({
        id: expect.any(String) as unknown,
        name: `Node ${String(mask)}`,
        ...Object.fromEntries(
          Object.entries(values).map(([key, value]) => [key, selected.includes(key) ? value : ''])
        ),
      });
    }
    expect(requests).toEqual([]);
  }, 30_000);

  it('clears stale fields, prompts for missing values, and never saves supplied values implicitly', async () => {
    await fillLogin();
    await save('Partial node', ['username', 'moarTubeNodeIp']);
    await fillLogin();
    await page.locator('#node-favorites-summary').click();
    await page.getByRole('button', { name: 'Partial node', exact: true }).click();
    expect(await page.locator('[name="password"]').inputValue()).toBe('');
    expect(await page.locator('[name="moarTubeNodePort"]').inputValue()).toBe('');
    expect(await page.evaluate('document.activeElement.getAttribute("name")')).toBe('password');
    expect(requests).toEqual([]);
    await fillLogin();
    await page.locator('#sign-in-button').click();
    await page.locator('.swal2-popup').waitFor();
    expect((await stored())[0]).toHaveProperty('password', '');
    expect((await stored())[0]).toHaveProperty('moarTubeNodePort', '');
  });

  it('persists across reloads and populates fields without signing in until requested', async () => {
    await fillLogin();
    await save('My node', Object.keys(values));
    await page.reload();
    await page.locator('#node-favorites-summary').click();
    expect(requests).toEqual([]);
    await page.getByRole('button', { name: 'My node', exact: true }).click();
    for (const [key, value] of Object.entries(values)) {
      expect(await page.locator(`#sign-in-form [name="${key}"]`).inputValue()).toBe(value);
    }
    expect(requests).toEqual([]);
    await page.locator('#sign-in-button').click();
    await page.locator('.swal2-popup').waitFor();
    expect(requests).toEqual([values]);
    expect(await page.locator('#sign-in-button').isEnabled()).toBe(true);
  });

  it('redirects after a successful favorite login without changing saved data', async () => {
    await fillLogin();
    await save('My node', Object.keys(values));
    const before = await stored();
    await page.route('http://favorites.test/account/signin', async (route) => {
      requests.push(route.request().postDataJSON());
      await route.fulfill({ json: { isAuthenticated: true, redirectUrl: '/videos' } });
    });
    await page.locator('#node-favorites-summary').click();
    await page.getByRole('button', { name: 'My node', exact: true }).click();
    await page.locator('#sign-in-button').click();
    await page.waitForURL('http://favorites.test/videos');
    expect(requests).toEqual([values]);
    expect(await stored()).toEqual(before);
  });

  it('shows favorites below Add favorite and hides the dropdown after the last removal', async () => {
    expect(await page.locator('#node-favorites-dropdown').isVisible()).toBe(false);
    await fillLogin();
    await save('My node', ['username', 'moarTubeNodeIp', 'moarTubeNodePort']);
    expect(await page.locator('#node-favorites-dropdown').isVisible()).toBe(true);
    expect(
      await page.evaluate(
        `Boolean(document.getElementById('new-node-favorite').compareDocumentPosition(document.getElementById('node-favorites-dropdown')) & Node.DOCUMENT_POSITION_FOLLOWING)`
      )
    ).toBe(true);
    expect(await stored()).toHaveLength(1);
    expect((await stored())[0]).toHaveProperty('password', '');
    await page.locator('#node-favorites-summary').click();
    expect(
      await page.getByRole('button', { name: 'Remove My node', exact: true }).textContent()
    ).toBe('X');
    await page.getByRole('button', { name: 'Remove My node', exact: true }).click();
    expect(await stored()).toEqual([]);
    expect(await page.locator('#node-favorites-dropdown').isVisible()).toBe(false);
    expect(requests).toEqual([]);
    await page.reload();
    expect(await page.locator('#node-favorites-list button').count()).toBe(0);
  });

  it('keeps sign-in available when storage is damaged or writes fail', async () => {
    await page.evaluate(`localStorage.setItem('${storageKey}', 'broken')`);
    await page.reload();
    expect(await page.locator('#sign-in-button').isEnabled()).toBe(true);
    expect(await page.locator('#node-favorites-status').textContent()).toContain(
      'could not be read'
    );
    await page.evaluate('localStorage.clear()');
    await page.reload();
    await page.evaluate(`Storage.prototype.setItem = () => { throw new Error('Quota exceeded'); }`);
    await save('Unsaved', []);
    expect(await page.locator('#node-favorites-status').textContent()).toContain('Could not save');
    expect(await stored()).toEqual([]);
  });

  it('renders favorite names as text and cancel does not persist', async () => {
    await save('<img src=x onerror=alert(1)>', []);
    expect(await page.locator('#node-favorites-list img').count()).toBe(0);
    await page.getByRole('button', { name: 'Add favorite', exact: true }).click();
    expect(await page.locator('#sign-in-form').isVisible()).toBe(false);
    expect(await page.locator('#sign-in-header').isVisible()).toBe(false);
    expect(await page.locator('#node-favorite-editor').isVisible()).toBe(true);
    expect(await page.locator('#node-favorite-fields input[type="checkbox"]').count()).toBe(0);
    expect(await page.locator('#node-favorite-fields label').allTextContents()).toEqual([
      'Username',
      'Password',
      'Node address',
      'Port',
    ]);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(await page.locator('#sign-in-form').isVisible()).toBe(true);
    expect(await page.locator('#sign-in-header').isVisible()).toBe(true);
    expect(await stored()).toHaveLength(1);
  });
});
