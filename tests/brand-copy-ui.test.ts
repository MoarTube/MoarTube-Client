/// <reference lib="dom" />
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ejs from 'ejs';
import { chromium, type Browser, type Page } from '@playwright/test';
import { afterAll, beforeAll, expect, it } from 'vitest';

let browser: Browser;
const startupScript = await readFile('desktop/loading.js', 'utf8');
const signinScript = await readFile('public/javascript/signin-taglines.js', 'utf8');

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => {
  await browser.close();
});

async function copyFits(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    const copy = document.querySelector<HTMLElement>('.startup-copy');
    const footer = document.querySelector<HTMLElement>('.startup-footer');
    const status = document.querySelector<HTMLElement>('.startup-status');
    if (!copy || !footer || !status) {
      throw new Error('Startup content is missing');
    }
    const content = copy.getBoundingClientRect();
    const statusBox = status.getBoundingClientRect();
    const footerBox = footer.getBoundingClientRect();
    const lines = Array.from(document.querySelectorAll<HTMLElement>('.startup-headline span'));
    return {
      linesFit: lines.every((line) => line.scrollWidth <= line.clientWidth),
      withinWhite: lines.every((line) => line.getBoundingClientRect().right <= content.right),
      footerFits: footer.scrollWidth <= footer.clientWidth,
      noOverlap: statusBox.bottom <= footerBox.top,
      withinViewport:
        content.top >= 0 &&
        content.bottom <= window.innerHeight &&
        footerBox.bottom <= window.innerHeight &&
        document.documentElement.scrollWidth <= window.innerWidth,
    };
  });
}

it('loads the Signal splash under its CSP and fits all 100 phrases in either headline position', async () => {
  let page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });
  try {
    await page.goto(pathToFileURL(path.resolve('desktop/loading.html')).href);
    await expect(page.locator('.status-title').textContent()).resolves.toBe('Starting MoarTube');
    await expect(page.locator('.status-detail').textContent()).resolves.toBe(
      'Evaluating system capabilities...'
    );
    expect(await page.locator('.startup-footer').textContent()).toBe(
      'VIDEO • LIVE • THEIRS • YOURS'
    );
    const top = await page.locator('#startup-line-top').textContent();
    expect(await page.locator('#startup-line-bottom').textContent()).not.toBe(top);
    expect(errors).toEqual([]);

    // The normal file load above verifies the production CSP. Only the test
    // page allows evaluation of the script to exhaustively sample its copy.
    await page.close();
    page = await browser.newPage({ viewport: { width: 1366, height: 768 }, bypassCSP: true });
    await page.goto(pathToFileURL(path.resolve('desktop/loading.html')).href);

    // Re-run the real script with controlled random draws to cover the whole pool.
    // Choose each phrase and its successor, including the wrap from 99 to 0.
    const phrases = await page.evaluate((script) => {
      const original = Math.random;
      const pairs: string[][] = [];
      try {
        for (let index = 0; index < 100; index++) {
          let draw = 0;
          Math.random = (): number =>
            draw++ === 0 ? (index + 0.5) / 100 : ((index === 99 ? 0 : index) + 0.5) / 99;
          window.eval(script);
          pairs.push([
            document.getElementById('startup-line-top')?.textContent ?? '',
            document.getElementById('startup-line-bottom')?.textContent ?? '',
          ]);
        }
      } finally {
        Math.random = original;
      }
      return pairs;
    }, startupScript);
    expect(new Set(phrases.map(([first]) => first)).size).toBe(100);
    expect(new Set(phrases.map(([, second]) => second)).size).toBe(100);
    expect(phrases.every(([first, second]) => first !== second)).toBe(true);

    for (const [width, height] of [
      [1920, 1080],
      [1366, 768],
      [960, 650],
      [800, 500],
      [600, 400],
      [375, 667],
    ]) {
      await page.setViewportSize({ width, height });
      // Each phrase is checked in both positions; the script fits the longer
      // of the two, which also bounds every other possible pairing.
      for (let index = 0; index < 100; index++) {
        await page.evaluate(
          ({ script, index }) => {
            let draw = 0;
            Math.random = (): number =>
              draw++ === 0 ? (index + 0.5) / 100 : ((index === 99 ? 0 : index) + 0.5) / 99;
            window.eval(script);
          },
          { script: startupScript, index }
        );
        expect(
          await copyFits(page),
          `${String(width)}x${String(height)}, phrase ${String(index)}`
        ).toEqual({
          linesFit: true,
          withinWhite: true,
          footerFits: true,
          noOverlap: true,
          withinViewport: true,
        });
      }
    }
    // Changing size must refit the existing copy without choosing new text.
    const beforeResize = await page.locator('.startup-headline').textContent();
    await page.setViewportSize({ width: 960, height: 650 });
    expect(await page.locator('.startup-headline').textContent()).toBe(beforeResize);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(
      await page
        .locator('.loading-track')
        .evaluate((element) => getComputedStyle(element, '::after').animationName)
    ).toBe('none');
  } finally {
    await page.close();
  }
}, 60000);

it('chooses from 100 sign-in taglines on load and keeps every variation inside its panel', async () => {
  const page = await browser.newPage();
  try {
    const template = await readFile('public/views/signin.ejs', 'utf8');
    let choice = 0;
    await page.addInitScript(() => {
      Math.random = (): number => 0.005;
    });
    await page.route('http://brand.test/**', async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === '/account/signin') {
        await route.fulfill({
          contentType: 'text/html',
          body: ejs.render(template, { bundledDesktop: false }),
        });
      } else if (pathname === '/javascript/signin-taglines.js') {
        await route.fulfill({
          contentType: 'application/javascript',
          body: `Math.random = () => ${String((choice + 0.5) / 100)};\n` + signinScript,
        });
      } else {
        await route.fulfill({ path: path.join(process.cwd(), 'public', pathname) });
      }
    });
    await page.goto('http://brand.test/account/signin');
    expect(await page.locator('#signin-tagline').textContent()).toBe('"Moar is Always Better"');
    expect(
      await page.locator('#signin-tagline').evaluate((heading) => {
        // Compare against the original h4 classes, without the random-copy ID.
        const original = document.createElement('h4');
        original.setAttribute('class', heading.getAttribute('class') ?? '');
        original.textContent = heading.textContent;
        heading.parentElement?.append(original);
        const properties = [
          'font-family',
          'font-size',
          'font-weight',
          'font-style',
          'line-height',
          'letter-spacing',
        ];
        const currentStyle = getComputedStyle(heading);
        const originalStyle = getComputedStyle(original);
        const unchanged = properties.every(
          (property) =>
            currentStyle.getPropertyValue(property) === originalStyle.getPropertyValue(property)
        );
        original.remove();
        return unchanged;
      })
    ).toBe(true);
    choice = 99;
    await page.reload();
    expect(await page.locator('#signin-tagline').textContent()).toBe(
      '"Welcome to Your Next Chapter"'
    );

    const taglines = await page.evaluate((script) => {
      const lines: string[] = [];
      for (let index = 0; index < 100; index++) {
        Math.random = (): number => (index + 0.5) / 100;
        window.eval(script);
        lines.push(document.getElementById('signin-tagline')?.textContent ?? '');
      }
      return lines;
    }, signinScript);
    expect(new Set(taglines).size).toBe(100);
    for (const [width, height] of [
      [1920, 1080],
      [1366, 768],
      [1024, 650],
      [992, 650],
    ]) {
      await page.setViewportSize({ width, height });
      const overflow = await page.evaluate((lines) => {
        const heading = document.getElementById('signin-tagline');
        const panel = document.querySelector('.signin-brand-panel');
        if (!heading || !panel) {
          throw new Error('Sign-in branding is missing');
        }
        return lines.filter((line) => {
          heading.textContent = line;
          const box = heading.getBoundingClientRect();
          const area = panel.getBoundingClientRect();
          return (
            heading.scrollWidth > heading.clientWidth ||
            box.left < area.left ||
            box.right > area.right ||
            box.top < area.top ||
            box.bottom > area.bottom
          );
        });
      }, taglines);
      expect(overflow, `${String(width)}x${String(height)}`).toEqual([]);
    }
    await page.setViewportSize({ width: 375, height: 667 });
    expect(await page.locator('.signin-brand-panel').isVisible()).toBe(false);
    expect(await page.locator('#sign-in-form').isVisible()).toBe(true);
    expect(await page.locator('.signin-brand-panel i').textContent()).toContain(
      'Your node. Your people. Your content. Your rules.'
    );
  } finally {
    await page.close();
  }
}, 30000);
