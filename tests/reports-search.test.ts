import { chromium, expect as browserExpect } from '@playwright/test';
import { expect, it } from 'vitest';

it.each(['videos', 'comments'])(
  'updates %s reports without navigation or lost focus, and rejects stale results',
  async (kind) => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    let documents = 0;
    const rendered: string[] = [];
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'log') {rendered.push(message.text());}
    });
    let slowStarted: () => void = () => {};
    const slow = new Promise<void>((resolve) => {
      slowStarted = resolve;
    });
    await page.route('http://reports.test/**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/all')) {
        const search = url.searchParams.get('search') ?? '';
        if (search === 'slow') {
          slowStarted();
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        if (search === 'error') {
          await route.fulfill({ status: 500, json: { isError: true } });
          return;
        }
        const offset = Number(url.searchParams.get('offset'));
        await route.fulfill({ json: { reports: [`${search}:${String(offset)}`], hasMore: offset === 0 } });
        return;
      }
      documents++;
      await route.fulfill({
        contentType: 'text/html',
        body: `
      <style>.hidden-elem { display: none; }</style>
      <form role="search"><span id="search_input_icon">Search</span><output id="search_input_spinner" class="hidden-elem">Loading</output><input id="search-input" name="search"></form>
      <nav aria-label="Report pages"></nav><nav aria-label="Archive pages"></nav>
      <div id="reports"></div><div id="archives"></div><div id="error"></div>`,
      });
    });
    try {
      await page.goto('http://reports.test/reports/' + kind + '?page=3&archivePage=2');
      await page.addScriptTag({ path: 'public/javascript/reports-search.js' });
      await page.evaluate(`new MoarTubeReportsSearch({
      loadReports: reports => { document.getElementById('reports').textContent = reports.join(); console.log(reports.join()); },
      loadArchives: reports => { document.getElementById('archives').textContent = reports.join(); },
      onError: message => { document.getElementById('error').textContent = message; }
    })`);
      const input = page.locator('#search-input');
      await input.fill('matching');
      await page.evaluate("document.getElementById('search-input').setSelectionRange(3, 3)");
      await browserExpect(page.locator('#search_input_spinner')).toBeVisible();
      await browserExpect(page.locator('#reports')).toHaveText('matching:0');
      await browserExpect(page.locator('#archives')).toHaveText('matching:0');
      await browserExpect(input).toBeFocused();
      expect(await page.evaluate<number>("document.getElementById('search-input').selectionStart")).toBe(3);
      expect(new URL(page.url()).searchParams.has('page')).toBe(false);
      expect(new URL(page.url()).searchParams.has('archivePage')).toBe(false);
      await page.getByText('Next reports', { exact: true }).click();
      await browserExpect(page.locator('#reports')).toHaveText('matching:100');
      await page.goBack();
      await browserExpect(page.locator('#reports')).toHaveText('matching:0');
      await input.fill('slow');
      await slow;
      await input.fill('latest');
      await browserExpect(page.locator('#reports')).toHaveText('latest:0');
      expect(rendered).not.toContain('slow:0');
      await browserExpect(input).toBeFocused();
      await input.fill('enter');
      await input.press('Enter');
      await browserExpect(page.locator('#reports')).toHaveText('enter:0');
      await input.fill('error');
      await browserExpect(page.locator('#error')).toContainText('Unable to load reports');
      await browserExpect(page.locator('#search_input_spinner')).toBeHidden();
      await browserExpect(page.locator('#reports')).toHaveText('enter:0');
      expect(documents).toBe(1);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
  20000
);
