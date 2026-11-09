import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import ejs from 'ejs';

const root = path.resolve(process.env['MOARTUBE_NODE_SOURCE_DIR'] ?? '../MoarTube-Node');
const host = 'http://home.test';
const settings = {
  nodeName: 'backyard.tube',
  nodeHeadline: 'Your node. Your people. Your rabbit hole.',
  nodeAbout: 'Watch, like, and comment. No account needed.',
  mediaBase: '',
  nodeBulletin: [
    'Welcome to backyard.tube.',
    'A collection of DIY, music, animation, and odd finds.',
    'Pick a video and join the conversation.',
  ],
  nodeLinks: ['rivet.tube', 'gearhead.tube', '8bit.tube', 'field.tube', 'cook.tube'].map(
    (name, i) => ({
      url: 'https://' + name,
      description: [
        'Indie film, animation, and art',
        'Electronics, tools, and making',
        'Retro games and homebrew',
        'Nature, science, and the outdoors',
        'Home cooking, food experiments, recipes',
      ][i]!,
    })
  ),
};
const titles = [
  'DIY Oscilloscope from Scrap Parts — Build + Test',
  'The Last Signal (indie short animation)',
  'Late Night Street Set — Original Songs (Live, Downtown)',
  'Bizarre Deep Sea Creatures — ROV Footage (Uncut)',
  'Making a Metroidvania for a Retro Console — Devlog #3',
  'Backyard Ramen — Simple, Cheap, and Stupid Good',
];
const videos = Array.from({ length: 35 }, (_, i) => ({
  videoId: 'video' + i,
  title: titles[i % 6]!,
  lengthSeconds: 1046 - i * 3,
  creationTimestamp: Date.now() - (i + 1) * 3600000,
  views: 12846 + i * 1200,
  likes: 1248,
  dislikes: 23,
  comments: [327, 466, 512, 389, 298, 619][i % 6],
  isStreaming: false,
  isLive: false,
  tags: i % 2 ? ['music', 'animation'] : ['diy', 'music'],
}));
const comments = Array.from({ length: 23 }, (_, i) => ({
  commentId: 23 - i,
  videoId: 'video' + (i % 6),
  timestamp: Date.now() - i * 180000,
  text:
    i === 22
      ? 'One remaining comment'
      : [
          'Could you share the wiring diagram?',
          'The background art in this is incredible.',
          'What a beautiful set.',
          'That glow at 04:12 is unreal!',
          'Trying this recipe tonight.',
        ][i % 5],
  videoTitle: titles[i % 6],
  videoCommentCount: i === 22 ? 1 : [327, 466, 512, 389, 298, 619][i % 6],
}));

async function fixture(page: Page, storageFailure = false) {
  const errors: string[] = [],
    requests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  if (storageFailure) {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'indexedDB', {
        get: () => {
          throw new Error('Storage blocked');
        },
      });
    });
  }
  await page.route(host + '/**', async (route) => {
    const url = new URL(route.request().url());
    requests.push(url.pathname + url.search);
    if (url.pathname.startsWith('/external/resources/')) {
      const filename = path.join(root, 'public', url.pathname.replace('/external/resources/', ''));
      return route.fulfill({
        body: await readFile(filename),
        contentType: filename.endsWith('.css')
          ? 'text/css'
          : filename.endsWith('.js')
            ? 'application/javascript'
            : 'image/jpeg',
      });
    }
    if (url.pathname.startsWith('/external/videos/')) {
      const i = Number(url.pathname.match(/video(\d+)/)?.[1] ?? 0);
      const color = ['#b59156', '#83b8cd', '#b56f56', '#064e96', '#684a95', '#d88a32'][i % 6];
      return route.fulfill({
        contentType: 'image/svg+xml',
        body: `<svg xmlns="http://www.w3.org/2000/svg" width="700" height="450"><rect width="700" height="450" fill="${color}"/><text x="30" y="220" fill="white" font-size="36">Preview ${i + 1}</text></svg>`,
      });
    }
    const state = {
      epoch: 'fixture',
      revision: 'a'.repeat(64),
      commentsRevision: 'b'.repeat(64),
      settingsRevision: 'c'.repeat(64),
      catalogRevision: 1,
      commentsVersion: 2,
      rankingWindow: 1,
    };
    if (url.pathname === '/') {
      const model = {
        settings,
        state,
        canonicalOrigin: host,
        query: {
          searchTerm: url.searchParams.get('searchTerm') || '',
          tagTerm: url.searchParams.get('tagTerm') || '',
          tagSearch: url.searchParams.get('tagSearch') || '',
          commentSearch: url.searchParams.get('commentSearch') || '',
          sortTerm: url.searchParams.get('sortTerm') || 'hot',
          view: url.searchParams.get('view') || 'videos',
        },
      };
      return route.fulfill({
        contentType: 'text/html',
        body: ejs.render(await readFile(path.join(root, 'public/views/index.ejs'), 'utf8'), {
          model,
          bootstrap: JSON.stringify(model),
        }),
      });
    }
    let data: object = {};
    const cursor = Number(url.searchParams.get('cursor') || 0);
    if (url.pathname === '/home/state') {
      data = state;
    }
    if (url.pathname === '/home/settings') {
      data = { settings };
    }
    if (url.pathname === '/home/tags') {
      const search = url.searchParams.get('tagSearch') || '';
      data = {
        tags: ['animation', 'diy', 'music']
          .filter((label) => label.includes(search))
          .map((label) => ({ label, count: 18 })),
        allCount: 35,
        hasMore: false,
        nextCursor: null,
      };
    }
    if (url.pathname === '/home/videos') {
      const search = (url.searchParams.get('searchTerm') || '').toLowerCase(),
        tag = url.searchParams.get('tagTerm');
      const rows = videos.filter(
        (v) => v.title.toLowerCase().includes(search) && (!tag || v.tags.includes(tag))
      );
      data = {
        videos: rows.slice(cursor, cursor + 30),
        totalCount: rows.length,
        hasMore: cursor + 30 < rows.length,
        nextCursor: cursor + 30 < rows.length ? cursor + 30 : null,
        snapshot: 'v',
        revision: state.revision,
      };
    }
    if (url.pathname === '/home/comments') {
      const term = (url.searchParams.get('commentSearch') || '').toLowerCase();
      const matches = comments.filter((comment) => comment.text!.toLowerCase().includes(term));
      data = {
        comments: matches.slice(cursor, cursor + 10),
        totalCount: matches.length,
        nextCursor: cursor + 10 < matches.length ? cursor + 10 : null,
        hasMore: cursor + 10 < matches.length,
        snapshot: 'c',
        revision: state.commentsRevision,
      };
    }
    return route.fulfill({
      json: data,
      headers: { 'Cache-Control': 'public, max-age=0, s-maxage=3600, must-revalidate' },
    });
  });
  return { errors, requests };
}

test('desktop grid, ten-row comments pagination, filters, history, cache reuse and infinite videos', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1584, height: 1086 });
  const f = await fixture(page);
  await page.goto(host);
  await expect(page.locator('.video-card')).toHaveCount(30);
  await expect(page.locator('.node-banner')).toHaveAttribute(
    'src',
    '/external/resources/images/banner.png'
  );
  await expect(page.locator('.brand-mark')).toHaveCount(0);
  await expect(page.locator('#video-count, #video-search button')).toHaveCount(0);
  await expect(page.locator('#tag-picker')).toBeHidden();
  await expect(page.locator('#search-toggle')).toBeHidden();
  const layout = await page.evaluate(() => {
    const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
    const banner = rect('.node-banner');
    const sorts = rect('.sort-tabs');
    const tags = rect('.tag-bar');
    const identity = rect('.network-identity');
    const intro = rect('.desktop-intro');
    const comments = rect('.comments-panel');
    return {
      bannerAboveContent: banner.bottom <= sorts.top && banner.bottom <= identity.top,
      bannerSpansColumns: banner.left < sorts.right && banner.right >= comments.right,
      tagsBelowSorts: tags.top >= sorts.bottom,
      sidebarOrder: identity.bottom <= intro.top && intro.bottom <= comments.top,
      tagDivider: getComputedStyle(document.querySelector('.tag-bar')!).borderTopWidth,
    };
  });
  expect(layout).toEqual({
    bannerAboveContent: true,
    bannerSpansColumns: true,
    tagsBelowSorts: true,
    sidebarOrder: true,
    tagDivider: '1px',
  });

  await expect(page.locator('#video-refresh')).toHaveCount(0);
  await expect(page.locator('.comment-row')).toHaveCount(10);
  await expect(page.locator('#comments-prev')).toBeDisabled();
  const first = await page.locator('.comment-row').first().getAttribute('data-comment');
  await page.locator('#comments-next').click();
  await expect(page.locator('#comment-page')).toHaveText('Page 2');
  await expect(page.locator('.comment-row')).toHaveCount(10);
  expect(await page.locator('.comment-row').first().getAttribute('data-comment')).not.toBe(first);
  await page.locator('#comments-prev').click();
  await expect(page.locator('.comment-row').first()).toHaveAttribute('data-comment', first!);
  await page.screenshot({
    path: 'test-results/home-page/desktop.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.locator('#tag-rail').getByRole('button', { name: 'diy', exact: true }).click();
  await expect(page).toHaveURL(/tagTerm=diy/);
  await expect(
    page.locator('#tag-rail').getByRole('button', { name: 'diy', exact: true })
  ).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#search-input').fill('Oscilloscope');
  await page.locator('#video-search').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(page.locator('.video-card')).toHaveCount(6);
  await expect(page.locator('.video-card')).toHaveCount(6);
  await expect(page.locator('.comment-row')).toHaveCount(10);
  await page.goBack();
  await expect(page.locator('#search-input')).toHaveValue('');
  await page.goto(host);
  await expect(page.locator('.video-card')).toHaveCount(30);
  await page.locator('#video-sentinel').scrollIntoViewIfNeeded();
  await expect(page.locator('.video-card')).toHaveCount(35);
  expect(f.errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('mobile compact controls, About, global comment infinite scroll, totals, breakpoint and storage fallback', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const f = await fixture(page, true);
  await page.goto(host);
  await expect(page.locator('.video-card')).toHaveCount(30);
  await expect(page.locator('#video-search')).toBeHidden();
  await expect(page.locator('#tag-picker')).toBeVisible();
  await expect(page.locator('.tag-bar')).toBeHidden();
  await expect(page.locator('#sort-select')).toBeVisible();
  await page.screenshot({
    path: 'test-results/home-page/mobile-videos.png',
    fullPage: false,
    animations: 'disabled',
  });
  await page.locator('#search-toggle').click();
  await expect(page.locator('#search-input')).toBeFocused();
  await page.locator('#search-input').fill('Signal');
  await expect(page.locator('.video-card')).toHaveCount(6);
  await page.locator('#tab-about').click();
  await expect(page.locator('#about-panel')).toBeVisible();
  await expect(page.locator('.mobile-intro')).not.toContainText('MoarTube Network');
  for (const selector of ['.mobile-intro h1', '.mobile-intro h3', '.mobile-intro p']) {
    await expect(page.locator(selector)).toHaveCSS('text-align', 'center');
  }
  await page.screenshot({
    path: 'test-results/home-page/mobile-about.png',
    fullPage: false,
    animations: 'disabled',
  });
  await page.locator('#tab-community').click();
  await expect.poll(() => page.locator('.comment-row').count()).toBeGreaterThanOrEqual(10);
  await expect(page.locator('.comment-link').first()).toHaveText(/View 327 comments/);
  await expect(page.locator('#comments-next')).toBeHidden();
  await page.screenshot({
    path: 'test-results/home-page/mobile-community.png',
    fullPage: false,
    animations: 'disabled',
  });
  const beforeComments = await page.locator('.comment-row').count();
  await page.locator('#comment-sentinel').scrollIntoViewIfNeeded();
  await expect.poll(() => page.locator('.comment-row').count()).toBeGreaterThan(beforeComments);
  await page.setViewportSize({ width: 1448, height: 1086 });
  await expect(page.locator('.comment-row')).toHaveCount(10);
  await expect(page.locator('#comments-next')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#tab-videos').click();
  await expect(page.locator('#search-input')).toHaveValue('Signal');
  expect(f.errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('mobile dropdown tag search and keyboard selection preserve filters and history', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page);
  await page.goto(host + '/?view=about&tagTerm=music');
  await page.locator('#tab-videos').click();
  await expect(page.locator('#selected-tag')).toHaveText('music');
  await page.locator('#tag-picker summary').click();
  await page.locator('#tag-search').fill('diy');
  await expect(page).toHaveURL(/tagSearch=diy/);
  await expect(page.locator('#selected-tag')).toHaveText('music');
  await expect(page.locator('#tag-options button')).toHaveCount(3);
  await page.locator('#tag-search').press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/tagTerm=diy/);
  await expect(page.locator('#selected-tag')).toHaveText('diy');
  await expect(page).not.toHaveURL(/tagSearch=/);
  await page.locator('#search-toggle').click();
  await expect(page.locator('#search-input')).toBeFocused();
  const searchBox = await page.locator('#video-search').boundingBox();
  const dropdown = await page.locator('#tag-picker').boundingBox();
  expect(searchBox!.y).toBeGreaterThanOrEqual(dropdown!.y + dropdown!.height);

  await page.locator('#search-toggle').click();
  await expect(page.locator('#video-search')).toBeHidden();
});

test('late search responses cannot replace the current query and append failures preserve cards for retry', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1448, height: 1000 });
  const f = await fixture(page);
  let failed = false;
  await page.route(host + '/home/videos?**', async (route) => {
    const query = new URL(route.request().url()).searchParams;
    if (query.get('searchTerm') === 'Signal') {
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
    if (query.get('cursor') === '30' && !failed) {
      failed = true;
      return route.fulfill({
        status: 503,
        json: { message: 'Temporary fixture failure' },
        headers: { 'Cache-Control': 'no-store' },
      });
    }
    return route.fallback();
  });
  await page.goto(host);
  await expect(page.locator('.video-card')).toHaveCount(30);
  await page.locator('#video-sentinel').scrollIntoViewIfNeeded();
  await expect(page.locator('#video-status button')).toHaveText('Retry');
  await expect(page.locator('.video-card')).toHaveCount(30);
  await page.locator('#video-status button').click();
  await expect(page.locator('.video-card')).toHaveCount(35);
  await page.locator('#search-input').fill('Signal');
  await page.waitForRequest((request) => request.url().includes('searchTerm=Signal'));
  await page.locator('#search-input').fill('Oscilloscope');
  await expect(page.locator('.video-card')).toHaveCount(6);
  await expect(page.locator('.video-title').first()).toContainText('Oscilloscope');
  await page.waitForTimeout(700);
  await expect(page.locator('.video-title').first()).toContainText('Oscilloscope');
  expect(f.errors).toEqual([]);
});

test('mobile traverses all comments exactly once and desktop reaches the terminal page', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page);
  await page.goto(host + '/?view=community');
  await expect.poll(() => page.locator('.comment-row').count()).toBeGreaterThanOrEqual(10);
  while ((await page.locator('.comment-row').count()) < 23) {
    const before = await page.locator('.comment-row').count();
    await page.locator('#comment-sentinel').scrollIntoViewIfNeeded();
    await expect.poll(() => page.locator('.comment-row').count()).toBeGreaterThan(before);
  }
  const ids = await page
    .locator('.comment-row')
    .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-comment')));
  expect(new Set(ids).size).toBe(23);
  await expect(page.locator('#comment-status')).toBeEmpty();
  await page.locator('.comment-row').last().scrollIntoViewIfNeeded();
  await page.setViewportSize({ width: 1448, height: 1086 });
  await expect(page.locator('#comments-next')).toBeVisible();
  await page.locator('#comments-next').scrollIntoViewIfNeeded();
  while (await page.locator('#comments-next').isEnabled()) {
    await page.locator('#comments-next').click();
    await expect(page.locator('#comment-status')).not.toHaveText('Loading comments…');
  }
  await expect(page.locator('.comment-pagination')).toBeVisible();
  await expect(page.locator('#comments-prev')).toBeEnabled();
  await expect(page.locator('#comment-page')).toHaveText('Page 3');
  await expect(page.locator('.comment-row')).toHaveCount(3);
});

test('revisioned pages survive reload in IndexedDB and narrow layouts do not overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  const f = await fixture(page);
  await page.goto(host);
  await expect(page.locator('.video-card')).toHaveCount(30);
  const reads = () =>
    f.requests.filter(
      (request) => request.startsWith('/home/videos?') && request.includes('cursor=0')
    ).length;
  const before = reads();
  await page.reload();
  await expect(page.locator('.video-card')).toHaveCount(30);
  expect(reads()).toBe(before);
  await page.locator('#tab-about').click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#tab-community').click();
  await expect.poll(() => page.locator('.comment-row').count()).toBeGreaterThanOrEqual(10);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(f.errors).toEqual([]);
});

test('older CDN comment state requires an origin freshness check before cached pages are reused', async ({
  page,
}) => {
  await fixture(page);
  let freshReads = 0;
  await page.route(host + '/home/state**', async (route) => {
    const fresh = new URL(route.request().url()).searchParams.get('fresh') === '1';
    if (fresh) {
      freshReads++;
    }
    return route.fulfill({
      json: {
        epoch: 'fixture',
        revision: 'a'.repeat(64),
        commentsRevision: 'b'.repeat(64),
        settingsRevision: 'c'.repeat(64),
        catalogRevision: 1,
        commentsVersion: fresh ? 2 : 1,
        rankingWindow: 1,
      },
      headers: {
        Age: fresh ? '0' : '20',
        'Cache-Control': fresh ? 'no-store' : 'public, max-age=0, s-maxage=30',
      },
    });
  });
  await page.goto(host);
  await expect(page.locator('.video-card')).toHaveCount(30);
  expect(freshReads).toBe(1);
});

for (const width of [1448, 390]) {
  test(`comment search toggle, singular labels, filtered paging and accent at width ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    const f = await fixture(page);
    await page.goto(host + '/?view=community');
    await expect(page.locator('#comment-search')).toBeHidden();
    await page.locator('#comments-search-toggle').click();
    await expect(page.locator('#comment-search-input')).toBeFocused();
    await page.locator('#comment-search-input').fill('One remaining');
    await page.locator('#comment-search-input').press('Enter');
    await expect(page.locator('.comment-row')).toHaveCount(1);
    await expect(page.locator('.comment-pagination')).toBeHidden();
    await expect(page.locator('.comment-link')).toHaveText('View 1 comment \u2192');
    await expect(page.locator('.comment-arrow')).toHaveCSS('color', 'rgb(203, 12, 159)');
    await expect(page).toHaveURL(/commentSearch=One/);
    await page.goBack();
    await expect(page.locator('.comment-link').first()).toHaveText(/View 327 comments/);
    await expect(page.locator('#comment-search')).toBeHidden();
    await page.locator('#comments-search-toggle').click();
    await page.locator('#comment-search-input').fill('e');
    await page.locator('#comment-search-input').press('Enter');
    await expect.poll(() => page.locator('.comment-row').count()).toBeGreaterThanOrEqual(10);
    if (width >= 992) {
      await expect(page.locator('#comments-next')).toBeEnabled();
      await page.locator('#comments-next').click();
      await expect(page.locator('#comment-page')).toHaveText('Page 2');
    } else {
      await page.locator('#comment-sentinel').scrollIntoViewIfNeeded();
      await expect(page.locator('.comment-row')).toHaveCount(20);
    }
    const excerpts = await page.locator('.comment-text').allTextContents();
    expect(excerpts.every((text) => text.toLowerCase().includes('e'))).toBe(true);
    await page.locator('#comment-search-input').scrollIntoViewIfNeeded();
    await page.locator('#comment-search-input').press('Escape');
    await expect(page.locator('#comment-search')).toBeHidden();
    expect(f.errors).toEqual([]);
  });
}

for (const width of [1448, 390]) {
  test(`viewer corner controls, neutral search focus and theme at width ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const f = await fixture(page);
    await page.route(host + '/links/all', (route) =>
      route.fulfill({
        json: {
          isError: false,
          links: [
            {
              url: 'https://example.com/community',
              svg_graphic:
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/></svg>',
            },
          ],
        },
      })
    );
    await page.goto(host);
    await expect(page.locator('#moartube-logo')).toBeVisible();
    await expect(page.locator('#viewer-links a')).toHaveAttribute(
      'href',
      'https://example.com/community'
    );
    await expect(page.locator('.brand small')).toHaveCount(0);
    if (width < 992) {
      await page.locator('#search-toggle').click();
    }
    await page.locator('#search-input').focus();
    expect(
      await page.locator('#search-input').evaluate((el) => getComputedStyle(el).outlineStyle)
    ).toBe('none');
    await page.locator('#navbar-settings-button').click();
    await expect(page.locator('#settings-dialog')).toBeVisible();
    await expect(page.locator('#settings-dialog')).toHaveClass(/modal/);
    await expect(page.locator('#settings-dialog .modal-header')).toContainText('Settings');
    await page.locator('#darkModeSwitch').check();
    await expect(page.locator('body')).toHaveClass(/home-dark/);
    await expect(page.locator('.sort-tabs button[data-sort="new"]')).toHaveCSS('color', 'rgb(238, 238, 238)');
    await expect(page.locator('.sort-tabs button[aria-pressed="true"]')).toHaveCSS('color', 'rgb(203, 12, 159)');
    expect(await page.locator('#bulletin li').first().evaluate((el) => getComputedStyle(el, '::before').color)).toBe('rgb(203, 12, 159)');
    await expect(page.locator('.node-link a').first()).toHaveCSS('text-decoration-line', 'none');
    await page.locator('#settings-dialog .dialog-close').click();
    await page.reload();
    await expect(page.locator('body')).toHaveClass(/home-dark/);
    await page.locator('#navbar-donate-button').click();
    await expect(page.locator('#wallet-install')).toBeVisible();
    await expect(page.locator('.swal2-title')).toHaveText('Missing Crypto Wallet');
    await expect(page.locator('.swal2-cancel')).toBeVisible();
    await expect(page.locator('#donate-form')).toBeHidden();
    expect(f.errors).toEqual([]);
  });
}

test('homepage donation opens the configured chain and wallet with an exact decimal amount', async ({
  page,
}) => {
  await fixture(page);
  await page.addInitScript(() => {
    Object.assign(window, {
      walletRequests: [],
      ethereum: {
        request: async (request: { method: string; params?: unknown[] }) => {
          (window as unknown as { walletRequests: unknown[] }).walletRequests.push(request);
          return request.method === 'eth_requestAccounts' ? ['0xaccount'] : '0xtransaction';
        },
      },
    });
  });
  await page.route(host + '/monetization/all', (route) =>
    route.fulfill({
      json: {
        isError: false,
        cryptoWalletAddresses: [
          { wallet_address: '0xrecipient', chain: 'Ethereum', chain_id: '0x1', currency: 'ETH' },
        ],
      },
    })
  );
  await page.goto(host);
  await page.locator('#navbar-donate-button').click();
  await expect(page.locator('#donate-form')).toBeVisible();
  await expect(page.locator('#donate-modal img')).toBeVisible();
  await expect(page.locator('#donation-continue')).toBeDisabled();
  await expect(page.locator('#donation-amount-input')).toBeDisabled();
  await page.locator('#wallet-address-select').selectOption('0');
  await page.locator('#donation-amount-input').fill('0');
  await page.locator('#donation-continue').click();
  await expect(page.locator('#donate-status')).toHaveText('Enter an amount greater than zero.');
  expect(await page.evaluate('window.walletRequests')).toEqual([]);
  await page.locator('#donation-amount-input').fill('0.000000000000000001');
  await page.locator('#donation-continue').click();
  await expect(page.locator('#donate-status')).toHaveText('Transaction submitted to your wallet.');
  expect(
    await page.evaluate(() => (window as unknown as { walletRequests: unknown[] }).walletRequests)
  ).toEqual([
    { method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1' }] },
    { method: 'eth_requestAccounts' },
    {
      method: 'eth_sendTransaction',
      params: [{ to: '0xrecipient', from: '0xaccount', value: '0x1' }],
    },
  ]);
});

for (const width of [320, 390, 992, 1448, 1599, 1600, 2048, 2559]) {
  test(`homepage navigation matches watch page coordinates at width ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await fixture(page);
    await page.goto(host);
    await expect(page.locator('.video-card')).toHaveCount(30);
    if (width >= 992) {
      const edges = await page.evaluate(() => {
        const banner = document.querySelector('.node-banner')!.getBoundingClientRect();
        const sidebar = document.querySelector('.home-sidebar')!.getBoundingClientRect();
        const videos = document.querySelector('.videos-panel')!.getBoundingClientRect();
        return {
          bannerLeft: banner.left,
          bannerRight: banner.right,
          sidebarRight: sidebar.right,
          videosLeft: videos.left,
          viewport: innerWidth,
        };
      });
      expect(
        await page
          .locator('.video-page')
          .first()
          .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)
      ).toBe(width >= 1600 ? 5 : 3);
      expect(
        await page
          .locator('.node-banner')
          .evaluate((el: HTMLImageElement) =>
            Math.abs(el.clientHeight - (el.clientWidth * el.naturalHeight) / el.naturalWidth)
          )
      ).toBeLessThan(1);
      expect(edges.bannerLeft).toBe(0);
      expect(edges.videosLeft).toBe(14);
      expect(edges.bannerRight).toBeCloseTo(edges.viewport, 1);
      expect(edges.sidebarRight).toBeCloseTo(edges.viewport - 14, 1);
    }
    const watch = await readFile(path.join(root, 'public/views/watch.ejs'), 'utf8');
    expect(watch).toMatch(/^<!doctype html>/i);
    const style = watch.match(/<style>([\s\S]*?)<\/style>/)![1]!;
    const navigation = watch.slice(
      watch.indexOf('<nav class="navbar'),
      watch.indexOf('<div id="theater-container"')
    ).replaceAll('<%=model.externalResourcesBaseUrl%>', host);
    const positions = await page.evaluate(
      async ({ style, navigation, host }) => {
        const iframe = document.createElement('iframe');
        iframe.style.cssText =
          'position:fixed;inset:0;width:100%;height:100%;border:0;visibility:hidden';
        iframe.srcdoc =
          '<!doctype html><html><head><link rel="stylesheet" href="' +
          host +
          '/external/resources/css/bootstrap.min-5.3.0.css"><style>' +
          style +
          '</style></head><body>' +
          navigation +
          '</body></html>';
        const loaded = new Promise((resolve) => {
          iframe.onload = resolve;
        });
        document.body.append(iframe);
        await loaded;
        for (const doc of [document, iframe.contentDocument!]) {
          const actions = doc.querySelector('#viewer-links') || doc.querySelector('#navbar-settings-buttons')!;
          for (let i = 0; i < 2; i++) {
            const link = doc.createElement('a');
            link.className = 'navbar-brand navbar-settings-button';
            link.innerHTML = '<img width="16" height="16" alt="Social link" src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2216%22 height=%2216%22/%3E">';
            actions.prepend(link);
          }
        }
        const coordinates = (doc: Document) =>
          ['nav.navbar', '#moartube-logo', '#moartube-logo-light', '#navbar-donate-button', '#navbar-donate-button svg', '#navbar-settings-button', '#navbar-settings-button svg'].map((selector) => {
            const rect = doc.querySelector(selector)!.getBoundingClientRect();
            return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
          });
        const result = {
          index: coordinates(document),
          watch: coordinates(iframe.contentDocument!),
          indexMode: document.compatMode,
          watchMode: iframe.contentDocument!.compatMode,
          indexBackground: getComputedStyle(document.body).backgroundColor,
          watchBackground: iframe.contentWindow!.getComputedStyle(iframe.contentDocument!.querySelector('nav')!).backgroundColor,
        };
        iframe.remove();
        return result;
      },
      { style, navigation, host }
    );
    expect(positions.indexMode).toBe('CSS1Compat');
    expect(positions.watchMode).toBe('CSS1Compat');
    expect(positions.watchBackground).toBe(positions.indexBackground);
    for (let i = 0; i < positions.index.length; i++) {
      for (const key of ['x', 'y', 'width', 'height'] as const) {
        expect(positions.index[i]![key]).toBeCloseTo(positions.watch[i]![key], 1);
      }
    }
  });
}

for (const width of [390, 992, 1448]) {
  test(`recent discussion sort order and browser history at width ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const f = await fixture(page);
    await page.goto(host);
    const values = await page.locator(width < 992 ? '#sort-select option' : '.sort-tabs button').evaluateAll((items) =>
      items.map((item) => item.getAttribute('value') || (item as HTMLElement).dataset['sort'])
    );
    expect(values).toEqual(['hot', 'new', 'recently-discussed', 'discussed', 'viewed']);
    if (width < 992) await page.locator('#sort-select').selectOption('recently-discussed');
    else await page.getByRole('button', { name: 'Recently discussed', exact: true }).click();
    await expect(page).toHaveURL(/sortTerm=recently-discussed/);
    await expect.poll(() => f.requests.some((url) => url.includes('/home/videos?') && url.includes('sortTerm=recently-discussed'))).toBe(true);
    await page.goBack();
    await expect(page.locator('#sort-select')).toHaveValue('hot');
    await page.goForward();
    await expect(page.locator('#sort-select')).toHaveValue('recently-discussed');
    if (width >= 992) await expect(page.getByRole('button', { name: 'Recently discussed', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    expect(f.errors).toEqual([]);
  });
}
