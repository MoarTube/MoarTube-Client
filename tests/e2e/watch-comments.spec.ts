import { test, expect, type Page, type Route } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

interface CommentRecord {
  commentId: number;
  timestamp: number;
  commentPlainTextSanitized: string;
  replyIds?: number[];
  hasMoreReplies?: boolean;
}
interface WatchFixture {
  COMMENT_READY?: Promise<void>;
  COMMENT_GAP?: HTMLElement;
  getCachedComment(id: number): Promise<{ comment: CommentRecord }>;
  commentStore(): {
    get(id: number): Promise<CommentRecord | undefined>;
    serial: Promise<unknown>;
    ready: Promise<void>;
    storageError?: string;
    db?: IDBDatabase;
  };
  setupEventListeners(): void;
  init(): void;
  loadComments(comments: CommentRecord[], highlight: boolean): void;
  loadOlderComments(): void;
  updateComments(): void;
  COMMENT_ELEMENT_CACHE: Record<string, unknown>;
  loadCommentHistory(direction: string): void;
  openCommentSection(): void;
  closeCommentSection(): void;
  getCloudflareTurnstileToken(): Promise<string>;
  QUOTE_LINK: Element | null;
  QUOTE_REQUEST?: unknown;
  COMMENT_REPLY_PENDING: Map<Element, unknown>;
  navigateToComment(id: number): Promise<void>;
}
declare global {
  interface Window {
    commentFixture: WatchFixture;
    releaseCommentCaptcha?: (token: string) => void;
  }
}
interface EdgeRecord {
  json: unknown;
  time: number;
  ttl: number;
}
const root = path.resolve(process.env['MOARTUBE_NODE_SOURCE_DIR'] ?? '../MoarTube-Node');
const browserErrors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
});
test.afterEach(({ page }) => {
  expect(browserErrors.get(page) ?? []).toEqual([]);
});
const comment = (id: number): CommentRecord => ({
  commentId: id,
  timestamp: Math.floor(id / 3),
  commentPlainTextSanitized:
    id === 150 ? '&gt;&gt;151\n&gt;&gt;1\nDynamically loaded reply' : `Comment ${String(id)}`,
});

function directReplyIds(text: string): number[] {
  return text.split('\n').flatMap((line) => {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('&gt;') && !/^&gt;&gt;[0-9]/.test(trimmed)) {
      return [];
    }
    return Array.from(line.matchAll(/(?<!&gt;)&gt;&gt;([0-9]+)/g), (match) =>
      Number(match[1])
    ).filter((id) => Number.isSafeInteger(id) && id > 0);
  });
}

async function fixture(
  page: Page,
  total = 250,
  documentScroll = false,
  makeComment = comment,
  autoPublish = true,
  initialHash = '',
  persistentBootstrap = false,
  cdn = false,
  edgeCache = new Map<string, EdgeRecord>()
) {
  const template = await readFile(path.join(root, 'public/views/watch.ejs'), 'utf8');
  const start = template.indexOf('class MoarTubeWatch {');
  const implementation = template.slice(start, template.indexOf('const moarTubeWatch =', start));
  const interactions =
    template.match(
      /\/\* Comment link interactions\. \*\/([\s\S]*?)\/\* End comment link interactions\. \*\//
    )?.[1] ?? '';
  const requests: URL[] = [];
  const allRequests: URL[] = [];
  const originRequests: URL[] = [];
  const edgeHits: URL[] = [];
  const records = new Map(
    Array.from({ length: total }, (_, i) => {
      const row = makeComment(i + 1);
      return [row.commentId, row];
    })
  );
  const descending = (a: CommentRecord, b: CommentRecord) =>
    b.timestamp - a.timestamp || b.commentId - a.commentId;
  const backlinks = (id: number, before = Number.MAX_SAFE_INTEGER) => {
    const ids = [...records.values()]
      .filter(
        (row) =>
          row.commentId < before && directReplyIds(row.commentPlainTextSanitized).includes(id)
      )
      .map((row) => row.commentId)
      .sort((a, b) => b - a);
    return { replyIds: ids.slice(0, 100), hasMore: ids.length > 100 };
  };
  let failNext = false;
  let revision = 1;
  let epoch = '11111111-1111-4111-8111-111111111111';
  const changed = new Map<number, number>();
  await page.route('http://comments.test/**', async (route) => {
    const url = new URL(route.request().url());
    allRequests.push(url);
    const publicRead =
      route.request().method() === 'GET' && url.pathname.startsWith('/videos/fixture/comments');
    if (cdn && publicRead) {
      const cached = edgeCache.get(url.href);
      if (cached && Date.now() - cached.time < cached.ttl * 1000) {
        edgeHits.push(url);
        return route.fulfill({
          json: cached.json,
          headers: { Age: String(Math.floor((Date.now() - cached.time) / 1000)) },
        });
      }
      originRequests.push(url);
    }
    const respond = async (options: Parameters<Route['fulfill']>[0]) => {
      if (cdn && publicRead && options?.json && (options.status ?? 200) === 200) {
        const ttl = url.pathname.endsWith('/state')
          ? url.searchParams.has('fresh')
            ? 0
            : 30
          : url.searchParams.get('epoch') === epoch &&
              Number(url.searchParams.get('revision')) === revision
            ? 3600
            : 0;
        if (ttl) {
          edgeCache.set(url.href, { json: options.json, time: Date.now(), ttl });
        }
      }
      return route.fulfill(options);
    };
    if (url.pathname === '/jquery.js') {
      return respond({ path: path.join(root, 'public/javascript/jquery-3.6.4.min.js') });
    }
    if (url.pathname === '/watch') {
      return respond({
        contentType: 'text/html',
        body: `<style>${documentScroll ? 'html,body{scroll-behavior:smooth}' : ''}body{margin:0}.hidden-elem,.mobile{display:none}#comment-section{${documentScroll ? '' : 'height:360px;overflow-y:auto'}}.postContainer{min-height:90px}.highlight{background:yellow}#quote-preview{position:absolute}</style><section id="comment-section"><span id="comment-section-counter">0</span><span id="expand-comment-section-counter">0</span><span id="comment-section-counter-descriptor"></span><span id="expand-comment-section-counter-descriptor"></span><button id="update-comments-button">Refresh</button><span id="update-comments-button-spinner" class="hidden-elem"></span><span id="comment-section-update-descriptor"></span><form id="comment-input-form-static" class="comment-input-form" data-commentformtype="static"><textarea name="commentPlainText"></textarea><button type="submit">Submit</button></form><div id="comments-container"></div></section><footer style="height:80px">Footer after comments</footer><script src="/jquery.js"></script><script>const INCOMING_PARAMETERS={commentsData:{cdnEnabled:${cdn},totalCount:${records.size},hasMore:${records.size > 100},cacheVersion:${cdn ? 1 : revision},cacheEpoch:${JSON.stringify(cdn ? '11111111-1111-4111-8111-111111111111' : epoch)}}};${implementation}window.commentFixture=new MoarTubeWatch();const w=window.commentFixture;w.VIDEO_ID='fixture';w.getCloudflareTurnstileToken=()=>Promise.resolve('token');w.showAlert=(_error,message)=>document.getElementById('comment-section-update-descriptor').textContent=message;${
          persistentBootstrap
            ? 'w.COMMENT_READY=w.loadInitialComments();'
            : 'w.loadComments(' +
              JSON.stringify(
                [...records.values()]
                  .sort(descending)
                  .slice(0, 100)
                  .map((row) => ({
                    ...row,
                    replyIds: backlinks(row.commentId).replyIds,
                    hasMoreReplies: backlinks(row.commentId).hasMore,
                  }))
              ) +
              ',false);'
        }w.setupEventListeners();</script>`,
      });
    }
    if (url.pathname === '/videos/fixture/comments/state') {
      return respond({
        json: { isError: false, epoch, version: revision, totalCount: records.size },
      });
    }
    if (url.pathname === '/videos/fixture/comments/cache') {
      const since = Number(url.searchParams.get('since'));
      const reset = !!url.searchParams.get('epoch') && url.searchParams.get('epoch') !== epoch;
      const entries = [...(reset ? new Map([...records].map(([id]) => [id, id])) : changed)]
        .filter(([, version]) => version > (reset ? 0 : since))
        .sort((a, b) => a[1] - b[1]);
      const ids = entries.slice(0, 100).map(([id]) => id);
      return respond({
        json: {
          isError: false,
          version: entries.length > 100 ? entries[99]![1] : revision,
          hasMore: entries.length > 100,
          reset,
          epoch,
          totalCount: records.size,
          comments: ids
            .filter((id) => records.has(id))
            .map((id) => ({
              ...records.get(id),
              replyIds: backlinks(id).replyIds,
              hasMoreReplies: backlinks(id).hasMore,
            })),
          deletedIds: ids.filter((id) => !records.has(id)),
        },
      });
    }
    if (url.pathname === '/videos/fixture/comments/comment') {
      const own = makeComment(Math.max(total, ...records.keys()) + 1);
      records.set(own.commentId, own);
      changed.set(own.commentId, ++revision);
      edgeCache.delete('http://comments.test/videos/fixture/comments/state');
      return respond({
        json: {
          isError: false,
          commentId: own.commentId,
          comment: own,
          totalCount: records.size,
          comments: [own],
        },
      });
    }
    if (url.pathname === '/videos/fixture/comments') {
      if (Number(url.searchParams.get('timestamp')) > 32503680000000) {
        return respond({ status: 400, json: { message: 'Timestamp exceeds API bound' } });
      }
      requests.push(url);
      if (failNext) {
        failNext = false;
        return respond({ status: 503, json: { isError: true, message: 'Temporary error' } });
      }
      const cursor = Number(url.searchParams.get('timestamp'));
      const id = Number(url.searchParams.get('beforeId') ?? url.searchParams.get('afterId'));
      if (
        autoPublish &&
        url.searchParams.get('type') === 'after' &&
        id === total &&
        !records.has(total + 1)
      ) {
        records.set(total + 1, makeComment(total + 1));
      }
      const candidates = [...records.values()].filter((c) =>
        url.searchParams.get('type') === 'before'
          ? c.timestamp < cursor || (c.timestamp === cursor && c.commentId < id)
          : c.timestamp > cursor || (c.timestamp === cursor && c.commentId > id)
      );
      candidates.sort((a, b) =>
        url.searchParams.get('type') === 'before' ? descending(a, b) : descending(b, a)
      );
      return respond({
        json: {
          isError: false,
          comments: candidates
            .slice(0, 100)
            .filter(
              (row) =>
                !new Set((url.searchParams.get('knownIds') ?? '').split(',').map(Number)).has(
                  row.commentId
                )
            )
            .map((row) => ({
              ...row,
              replyIds: backlinks(row.commentId).replyIds,
              hasMoreReplies: backlinks(row.commentId).hasMore,
            })),
          commentIds: url.searchParams.has('knownIds')
            ? candidates.slice(0, 100).map((row) => row.commentId)
            : undefined,
          pageEnd: url.searchParams.has('knownIds') ? candidates.slice(0, 100).at(-1) : undefined,
          hasMore: candidates.length > 100,
          totalCount: records.size,
        },
      });
    }
    if (url.pathname.endsWith('/replies')) {
      const id = Number(url.pathname.split('/').at(-2));
      return respond({
        json: {
          isError: false,
          ...backlinks(
            id,
            Number(url.searchParams.get('beforeReplyId') || Number.MAX_SAFE_INTEGER)
          ),
        },
      });
    }
    const id = Number(url.pathname.split('/').at(-1));
    if (
      url.searchParams.has('timestamp') &&
      Number(url.searchParams.get('timestamp')) !== records.get(id)?.timestamp
    ) {
      return respond({ status: 404, json: { isError: true, message: 'Comment not found' } });
    }
    return records.has(id)
      ? respond({
          json: {
            isError: false,
            comment: {
              ...records.get(id),
              replyIds: backlinks(id).replyIds,
              hasMoreReplies: backlinks(id).hasMore,
            },
          },
        })
      : respond({ status: 404, json: { isError: true, message: 'Comment not found' } });
  });
  await page.goto('http://comments.test/watch' + initialHash);
  if (persistentBootstrap) {
    await page.evaluate(() => window.commentFixture.COMMENT_READY);
  }
  await page.addStyleTag({
    content: '.reply:target:not(.comment-unselected) { background: yellow; }',
  });
  if (interactions) {
    await page.addStyleTag({ content: interactions });
  }
  return {
    requests,
    allRequests,
    originRequests,
    edgeHits,
    edgeCache,
    expireState: () => {
      const cached = edgeCache.get('http://comments.test/videos/fixture/comments/state');
      if (cached) {
        cached.time = Date.now() - 31000;
      }
    },
    replaceDatabase: (rows: CommentRecord[]) => {
      records.clear();
      for (const row of rows) {
        records.set(row.commentId, row);
      }
      changed.clear();
      revision = 1;
      epoch = '22222222-2222-4222-8222-222222222222';
    },
    failNext: () => {
      failNext = true;
    },
    publish: (rows: CommentRecord[]) => {
      for (const row of rows) {
        const old = records.get(row.commentId);
        records.set(row.commentId, row);
        changed.set(row.commentId, ++revision);
        for (const match of (
          (old?.commentPlainTextSanitized ?? '') + row.commentPlainTextSanitized
        ).matchAll(/&gt;&gt;(\d+)/g)) {
          changed.set(Number(match[1]), ++revision);
        }
      }
    },
    remove: (id: number) => {
      const row = records.get(id);
      records.delete(id);
      changed.set(id, ++revision);
      for (const match of (row?.commentPlainTextSanitized ?? '').matchAll(/&gt;&gt;(\d+)/g)) {
        changed.set(Number(match[1]), ++revision);
      }
    },
  };
}

async function bottom(page: Page) {
  await page.locator('#comment-section').evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
}

async function expectCentered(page: Page, id: number, documentScroll = false) {
  await expect
    .poll(() =>
      page.locator('#pc' + String(id)).evaluate((el, doc) => {
        const rect = el.getBoundingClientRect();
        const root = document.getElementById('comment-section')!.getBoundingClientRect();
        return Math.abs(
          (rect.top + rect.bottom) / 2 - (doc ? innerHeight / 2 : (root.top + root.bottom) / 2)
        );
      }, documentScroll)
    )
    .toBeLessThan(3);
}

async function expectNaturalPosition(page: Page, id: number, documentScroll = false) {
  await expect(page.locator('#pc' + String(id))).toBeInViewport();
  await expect
    .poll(() =>
      page.locator('#pc' + String(id)).evaluate((el, doc) => {
        const panel = document.getElementById('comment-section')!;
        const root = doc ? document.scrollingElement! : panel;
        const rect = el.getBoundingClientRect();
        const bounds = panel.getBoundingClientRect();
        const height = doc ? innerHeight : panel.clientHeight;
        const center = doc ? height / 2 : bounds.top + height / 2;
        const ideal = root.scrollTop + (rect.top + rect.bottom) / 2 - center;
        const clamped = Math.max(0, Math.min(root.scrollHeight - height, ideal));
        return Math.abs(root.scrollTop - clamped);
      }, documentScroll)
    )
    .toBeLessThan(3);
}

async function responsiveCommentControls(page: Page, width: number) {
  await page.setViewportSize({ width, height: 800 });
  await fixture(page);
  const template = await readFile(path.join(root, 'public/views/watch.ejs'), 'utf8');
  const responsive = template.match(
    /@media \(min-width: 0px\) \{[\s\S]*?(?=@media \(max-width: 1366px\))/
  )![0];
  const back = template.match(/<div id="comment-section-back-button-container"[\s\S]*?<\/div>/)![0];
  await page.locator('#comment-section').evaluate((el, html) => {
    el.insertAdjacentHTML('afterbegin', html);
    el.insertAdjacentHTML(
      'beforebegin',
      '<button id="expand-comment-section">Open comments</button><div id="recommended-videos-list-container">Recommendations</div>'
    );
    window.commentFixture.setupEventListeners();
  }, back);
  await page.addStyleTag({ content: responsive });
}

test('mobile comment controls open and close the section and hide on desktop resize', async ({
  page,
}) => {
  await responsiveCommentControls(page, 400);
  await expect(page.locator('#comment-section')).toBeHidden();
  await expect(page.locator('#comment-section-back-button-container')).toBeHidden();
  await page.locator('#expand-comment-section').click();
  await expect(page.locator('#comment-section')).toBeVisible();
  await expect(page.locator('#comment-section-back-button-container')).toBeVisible();
  await page.setViewportSize({ width: 992, height: 800 });
  await expect(page.locator('#comment-section-back-button-container')).toBeHidden();
  await page.setViewportSize({ width: 991, height: 800 });
  await expect(page.locator('#comment-section-back-button-container')).toBeVisible();
  await page.locator('#comment-section-back-button').click();
  await expect(page.locator('#comment-section')).toBeHidden();
  await expect(page.locator('#expand-comment-section')).toBeVisible();
  await page.locator('#expand-comment-section').click();
  await expect(page.locator('#comment-section-back-button-container')).toBeVisible();
});

test('desktop comment navigation never displays the mobile back control', async ({ page }) => {
  await responsiveCommentControls(page, 1440);
  await expect(page.locator('#comment-section')).toBeVisible();
  await expect(page.locator('#comment-section-back-button-container')).toBeHidden();
  await page.evaluate(() => window.commentFixture.navigateToComment(200));
  await expect(page.locator('#p200')).toHaveClass(/\bhighlight\b/);
  await expect(page.locator('#comment-section-back-button-container')).toBeHidden();
  await page.setViewportSize({ width: 992, height: 800 });
  await expect(page.locator('#comment-section-back-button-container')).toBeHidden();
});

for (const documentScroll of [false, true]) {
  test(`repeated clicks on the same post number stay centered (${documentScroll ? 'document' : 'panel'})`, async ({
    page,
  }) => {
    await fixture(page, 750, documentScroll, comment, false);
    const navigations: string[] = [];
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) {
        navigations.push(frame.url());
      }
    });
    const permalink = page.locator(
      '#pc700 .postInfo.desktop .postNum a[title="Link to this post"]'
    );
    for (let click = 0; click < 4; click++) {
      await permalink.click();
      await expectCentered(page, 700, documentScroll);
      const drift = await page.locator('#pc700').evaluate(async (el, doc) => {
        let max = 0;
        for (let frame = 0; frame < 24; frame++) {
          await new Promise(requestAnimationFrame);
          const r = el.getBoundingClientRect(),
            panel = document.getElementById('comment-section')!.getBoundingClientRect();
          max = Math.max(
            max,
            Math.abs(
              (r.top + r.bottom) / 2 - (doc ? innerHeight / 2 : (panel.top + panel.bottom) / 2)
            )
          );
        }
        return max;
      }, documentScroll);
      expect(drift).toBeLessThan(3);
      await expect(page.locator('#p700')).toHaveClass(/\bhighlight\b/);
      expect(navigations).toHaveLength(1);
    }
    await permalink.dblclick({ delay: 20 });
    await expectCentered(page, 700, documentScroll);
    expect(navigations).toHaveLength(1);
  });

  test(`post-number permalinks use natural centered navigation (${documentScroll ? 'document' : 'panel'})`, async ({
    page,
  }) => {
    await fixture(page, 750, documentScroll);
    await page.locator('textarea').fill('Unchanged draft');
    await page.locator('#pc700 .postInfo.desktop .postNum a[title="Link to this post"]').click();
    await expectCentered(page, 700, documentScroll);
    await expect(page).toHaveURL(/#p700$/);
    await expect(page.locator('textarea')).toHaveValue('Unchanged draft');
    await page.evaluate(() => window.commentFixture.loadOlderComments());
    await expect(page.locator('#pc650')).toHaveCount(1);
    await page.locator('#pc650 .postInfo.desktop .postNum a[title="Link to this post"]').click();
    await expectCentered(page, 650, documentScroll);
    await page.locator('#pc750 .postInfo.desktop .postNum a[title="Link to this post"]').click();
    await expectNaturalPosition(page, 750, documentScroll);
  });
}

test('incoming comment startup uses navigation without replaying a post-number click', async ({
  page,
}) => {
  await fixture(page, 750, false, comment, false);
  await page.evaluate(() => {
    history.replaceState(null, '', '/watch?v=fixture#p700');
    const watch = window.commentFixture as unknown as Record<string, unknown>;
    watch['INCOMING_PARAMETERS'] = {
      informationData: { information: {} },
      linksData: { links: [] },
      cryptoWalletAddressesData: { cryptoWalletAddresses: [] },
      videoData: { video: {} },
      recommendedVideosData: { recommendedVideos: [] },
      commentsData: { comments: [] },
    };
    for (const method of [
      'loadInformation',
      'loadLinks',
      'loadCryptoWalletAddresses',
      'loadVideo',
      'loadTags',
      'loadRecommendedVideos',
    ]) {
      watch[method] = () => {};
    }
    document.addEventListener('click', (event) => {
      if (event.target instanceof Element && event.target.closest('.postNum a')) {
        document.body.dataset['replayedPostNumber'] = 'yes';
      }
    });
    window.commentFixture.init();
  });
  await expectCentered(page, 700);
  await expect(page.locator('body')).not.toHaveAttribute('data-replayed-post-number', 'yes');
  await expect(page.locator('#p700')).toHaveClass(/\bhighlight\b/);
});

test('restoring newer history keeps the visible comment header in place', async ({ page }) => {
  await fixture(page, 1000, false, comment, false);
  await page.evaluate(() => window.commentFixture.navigateToComment(500));
  await expectCentered(page, 500);
  await page.locator('#comment-section').dispatchEvent('wheel', { deltaY: -100 });
  await page.locator('#comment-section').evaluate((el) => {
    el.scrollTop = 0;
  });
  await expect(page.locator('#pc700')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeInViewport();
});

test('post-number and reply links show pointer and red hover states', async ({ page }) => {
  await fixture(page);
  for (const selector of ['.postNum a[title="Link to this post"]', '.comment-quote-button']) {
    const link = page.locator('#pc250 .postInfo.desktop ' + selector);
    await expect(link).toHaveCSS('cursor', 'pointer');
    await link.hover();
    await expect(link).toHaveCSS('color', 'rgb(255, 0, 0)');
    await page.mouse.move(1000, 800);
    await expect(link).not.toHaveCSS('color', 'rgb(255, 0, 0)');
  }
});

for (const viaQuote of [true, false]) {
  test(`navigation replaces an incoming comment-link highlight (${viaQuote ? 'quote' : 'post number'})`, async ({
    page,
  }) => {
    await fixture(
      page,
      750,
      false,
      (id) => ({
        ...comment(id),
        commentPlainTextSanitized: id === 750 ? '&gt;&gt;740' : `Comment ${String(id)}`,
      }),
      false,
      '#p750'
    );
    await expect(page.locator('#p750')).toHaveCSS('background-color', 'rgb(255, 255, 0)');
    await expect(page.locator('#p750:target')).toHaveCount(1);
    const selector = viaQuote
      ? '#pc750 blockquote .quotelink'
      : '#pc740 .postInfo.desktop .postNum a[title="Link to this post"]';
    await page.locator(selector).click();
    await expectCentered(page, 740);
    await page.mouse.move(1000, 800);
    await expect(page.locator('#p750:target')).toHaveCount(0);
    await expect(page.locator('#p750')).not.toHaveClass(/\bhighlight\b/);
    await expect(page.locator('#p750')).not.toHaveCSS('background-color', 'rgb(255, 255, 0)');
    await expect(page.locator('#p740')).toHaveClass(/\bhighlight\b/);
    await expect(page).toHaveURL(/#p740$/);
  });
}

for (const viaQuote of [true, false]) {
  test(`posting and ${viaQuote ? 'quote' : 'post-number'} navigation replace all earlier highlights`, async ({
    page,
  }) => {
    await fixture(
      page,
      250,
      false,
      (id) => ({
        ...comment(id),
        commentPlainTextSanitized: id === 251 ? '&gt;&gt;240' : `Comment ${String(id)}`,
      }),
      false,
      '#p240'
    );
    await expect(page.locator('#p240')).toHaveCSS('background-color', 'rgb(255, 255, 0)');
    const submit = async () => {
      await page.locator('textarea').fill('New comment');
      await page.getByRole('button', { name: /^submit$/i }).click();
    };
    await submit();
    await expect(page.locator('#p251')).toHaveClass(/\bnew-comment-highlight\b/);
    await expect(page.locator('#p240')).not.toHaveCSS('background-color', 'rgb(255, 255, 0)');
    const link = page.locator(
      viaQuote
        ? '#pc251 blockquote .quotelink'
        : '#pc240 .postInfo.desktop .postNum a[title="Link to this post"]'
    );
    await link.click();
    await page.mouse.move(1000, 800);
    await expect(page.locator('#p240')).toHaveClass(/\bhighlight\b/);
    await expect(page.locator('.new-comment-highlight')).toHaveCount(0);
    await submit();
    await expect(page.locator('#p252')).toHaveClass(/\bnew-comment-highlight\b/);
    await expect(page.locator('#p240')).not.toHaveClass(/\bhighlight\b/);
    await expect(page.locator('#p240')).not.toHaveCSS('background-color', 'rgb(255, 255, 0)');
    await expect(page.locator('#p251')).not.toHaveClass(/\bnew-comment-highlight\b/);
    await page.locator('#pc241 .postInfo.desktop .postNum a[title="Link to this post"]').click();
    await page.mouse.move(1000, 800);
    await expect(page.locator('#p241')).toHaveClass(/\bhighlight\b/);
    await expect(page.locator('.new-comment-highlight')).toHaveCount(0);
    await expect(page.locator('#p240')).not.toHaveClass(/\bhighlight\b/);
  });
}

test('a failed post preserves the selected comment highlight', async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => window.commentFixture.navigateToComment(200));
  await page.route('**/comments/comment', (route) =>
    route.fulfill({ status: 503, json: { isError: true } })
  );
  await page.locator('textarea').fill('Draft');
  await page.getByRole('button', { name: /^submit$/i }).click();
  await expect(page.locator('#comment-section-update-descriptor')).toContainText(
    'unable to submit'
  );
  await expect(page.locator('#p200')).toHaveClass(/\bhighlight\b/);
  await expect(page.locator('textarea')).toHaveValue('Draft');
});

async function applyCommentHighlightTheme(page: Page, dark = false) {
  const template = await readFile(path.join(root, 'public/views/watch.ejs'), 'utf8');
  const start = template.indexOf('      .reply:target:not(.comment-unselected),');
  const end = template.indexOf('      .mobile,', start);
  let css = template.slice(start, end);
  css += template.match(/\.new-comment-highlight\s*\{[^}]*\}/)![0];
  if (dark) {
    const darkStart = template.indexOf('        .reply:target:not(.comment-unselected),');
    css += template.slice(darkStart, template.indexOf('        #moartube-logo-light', darkStart));
    css += [...template.matchAll(/\.reply\.highlight-anti[^{}]*\{[^}]*\}/g)][1]![0];
  }
  await page.addStyleTag({ content: css });
}

for (const dark of [false, true]) {
  for (const viaQuote of [false, true]) {
    test(`selected comments use darker quote-hover styling (${dark ? 'dark' : 'light'}, ${viaQuote ? 'quote' : 'post number'})`, async ({
      page,
    }) => {
      await fixture(
        page,
        250,
        false,
        (id) => ({
          ...comment(id),
          commentPlainTextSanitized:
            id === 250 || id === 241
              ? '&gt;&gt;240'
              : id === 240
                ? '&gt;&gt;239'
                : `Comment ${String(id)}`,
        }),
        false
      );
      await applyCommentHighlightTheme(page, dark);
      await page
        .locator(
          viaQuote
            ? '#pc250 blockquote .quotelink'
            : '#pc240 .postInfo.desktop .postNum a[title="Link to this post"]'
        )
        .click();
      await expectCentered(page, 240);
      await page.mouse.move(1000, 800);
      const target = page.locator('#p240');
      await expect(target).toHaveCSS(
        'background-color',
        dark ? 'rgb(47, 47, 47)' : 'rgb(237, 227, 235)'
      );
      await page.locator('#pc241 blockquote .quotelink').hover();
      await expect(target).toHaveClass(/\bhighlight-anti\b/);
      await expect(target).toHaveCSS(
        'background-color',
        dark ? 'rgb(39, 39, 39)' : 'rgb(191, 166, 186)'
      );
      await expect(page.locator('#quote-preview')).toHaveCount(0);
      await page.mouse.move(1000, 800);
      await expect(target).not.toHaveClass(/\bhighlight-anti\b/);
      await expect(target).toHaveClass(/\bhighlight\b/);
      await expect(target).toHaveCSS(
        'background-color',
        dark ? 'rgb(47, 47, 47)' : 'rgb(237, 227, 235)'
      );
    });
  }
}

for (const fromPost of [false, true]) {
  test(`existing ${fromPost ? 'new-comment' : 'incoming-fragment'} highlights use the darker hover state`, async ({
    page,
  }) => {
    await fixture(
      page,
      250,
      false,
      (id) => ({
        ...comment(id),
        commentPlainTextSanitized:
          id === (fromPost ? 250 : 241)
            ? '&gt;&gt;' + String(fromPost ? 251 : 240)
            : `Comment ${String(id)}`,
      }),
      false,
      fromPost ? '' : '#p240'
    );
    await applyCommentHighlightTheme(page);
    const id = fromPost ? 251 : 240;
    if (fromPost) {
      await page.locator('textarea').fill('A new comment');
      await page.getByRole('button', { name: /^submit$/i }).click();
      await expect(page.locator('#p251')).toHaveClass(/\bnew-comment-highlight\b/);
    }
    const target = page.locator('#p' + String(id));
    const base = await target.evaluate((el) => getComputedStyle(el).backgroundColor);
    await page.locator('#pc' + String(fromPost ? 250 : 241) + ' blockquote .quotelink').hover();
    await expect(target).toHaveClass(/\bhighlight-anti\b/);
    await expect(target).toHaveCSS('background-color', 'rgb(191, 166, 186)');
    await page.mouse.move(1000, 800);
    await expect(target).not.toHaveClass(/\bhighlight-anti\b/);
    await expect(target).toHaveCSS('background-color', base);
  });
}

test('clicked quote destinations stay highlighted after hover cleanup and scrolling', async ({
  page,
}) => {
  await fixture(
    page,
    750,
    false,
    (id) => ({
      ...comment(id),
      commentPlainTextSanitized:
        id === 750 ? '&gt;&gt;740' : id === 740 ? '&gt;&gt;741' : `Comment ${String(id)}`,
    }),
    false
  );
  await page.locator('#pc750 blockquote .quotelink').click();
  await expectCentered(page, 740);
  await page.mouse.move(1000, 800);
  await expect(page.locator('#p740')).toHaveClass(/\bhighlight\b/);
  const other = page.locator('#pc740 blockquote .quotelink');
  await other.hover();
  await page.mouse.move(1000, 800);
  await expect(page.locator('#p740')).toHaveClass(/\bhighlight\b/);
  await expect(page.locator('#p741')).not.toHaveClass(/\bhighlight\b/);
  await page.locator('#comment-section').dispatchEvent('wheel', { deltaY: 100 });
  await page.locator('#comment-section').evaluate((el) => {
    el.scrollTop += 100;
  });
  await expect(page.locator('#p740')).toHaveClass(/\bhighlight\b/);
  await other.click();
  await page.mouse.move(1000, 800);
  await expect(page.locator('#p741')).toHaveClass(/\bhighlight\b/);
  await expect(page.locator('#p740')).not.toHaveClass(/\bhighlight\b/);
});

test('unloaded quote and backlink destinations retain their navigation highlight', async ({
  page,
}) => {
  await fixture(
    page,
    750,
    false,
    (id) => ({
      ...comment(id),
      commentPlainTextSanitized: id === 750 ? '&gt;&gt;5' : `Comment ${String(id)}`,
    }),
    false
  );
  await page.locator('#pc750 blockquote .quotelink').click();
  await expectNaturalPosition(page, 5);
  await page.mouse.move(1000, 800);
  await page.locator('#pc5 #bl_5 .quotelink[data-comment-id="750"]').hover();
  await page.mouse.move(1000, 800);
  await expect(page.locator('#p5')).toHaveClass(/\bhighlight\b/);
  await page.locator('#pc5 #bl_5 .quotelink[data-comment-id="750"]').click();
  await expectNaturalPosition(page, 750);
  await page.mouse.move(1000, 800);
  await expect(page.locator('#p750')).toHaveClass(/\bhighlight\b/);
});

for (const documentScroll of [false, true]) {
  test(`round-trip edge navigation adds no whitespace (${documentScroll ? 'document' : 'panel'})`, async ({
    page,
  }) => {
    await fixture(
      page,
      1000,
      documentScroll,
      (id) => ({
        ...comment(id),
        commentPlainTextSanitized: id === 1000 ? '&gt;&gt;1\nReply' : `Comment ${String(id)}`,
      }),
      false
    );
    const measureGaps = () =>
      page.evaluate(() => {
        const panel = document.getElementById('comment-section')!;
        const rows = document.querySelectorAll('#comments-container > .postContainer');
        return {
          above:
            rows[0]!.getBoundingClientRect().top -
            document.querySelector('form')!.getBoundingClientRect().bottom,
          below:
            panel.scrollHeight -
            (rows[rows.length - 1]!.getBoundingClientRect().bottom -
              panel.getBoundingClientRect().top +
              panel.scrollTop),
          trailingMargin: parseFloat(
            getComputedStyle(rows[rows.length - 1]!.querySelector('blockquote')!).marginBottom
          ),
        };
      });
    const naturalGaps = await measureGaps();
    for (let i = 0; i < 3; i++) {
      for (const id of [1, 1000]) {
        await page
          .locator(
            id === 1
              ? '#pc1000 blockquote .quotelink'
              : '#pc1 #bl_1 .quotelink[data-comment-id="1000"]'
          )
          .click();
        await expectNaturalPosition(page, id, documentScroll);
        const gaps = await measureGaps();
        expect(gaps.above).toBeLessThanOrEqual(naturalGaps.above + 1);
        // A final paragraph margin can collapse outside its row once backlinks change its height.
        expect(gaps.below).toBeLessThanOrEqual(naturalGaps.below + gaps.trailingMargin + 1);
      }
    }
  });
}

for (const documentScroll of [false, true]) {
  test(`quote navigation centers retained and unloaded targets (${documentScroll ? 'document' : 'panel'})`, async ({
    page,
  }) => {
    await fixture(
      page,
      1000,
      documentScroll,
      (id) => ({
        ...comment(id),
        commentPlainTextSanitized: id === 1000 ? '&gt;&gt;950\n&gt;&gt;5' : `Comment ${String(id)}`,
      }),
      false
    );
    await page.locator('textarea').fill('Keep my draft');
    await page.locator('#pc1000 blockquote a[data-comment-id="950"]').click();
    await expectCentered(page, 950, documentScroll);
    await expect(page.locator('textarea')).toHaveValue('Keep my draft');
    await page.locator('#pc1000 blockquote a[data-comment-id="5"]').click();
    await expectNaturalPosition(page, 5, documentScroll);
    await expect(page.locator('#p5')).toHaveClass(/highlight/);
    await expect(page).toHaveURL(/#p5$/);
    await expect(page.locator('#comment-section-counter')).toHaveText('1000');
    const ids = await page
      .locator('#comments-container > .postContainer')
      .evaluateAll((rows) => rows.map((row) => Number(row.id.slice(2))));
    expect(ids).toEqual([...new Set(ids)].sort((a, b) => b - a));
    expect(ids.length).toBeLessThanOrEqual(500);
    await page.locator('#pc5 #bl_5 a[data-comment-id="1000"]').click();
    await expectNaturalPosition(page, 1000, documentScroll);
    await expect(page.locator('textarea')).toHaveValue('Keep my draft');
  });
}

test('failed quote navigation keeps history and can retry', async ({ page }) => {
  await fixture(page, 750);
  await page.route('**/comments/5', (route) =>
    route.fulfill({ status: 404, json: { isError: true } })
  );
  await page.evaluate(() => window.commentFixture.navigateToComment(5));
  await expect(page.locator('#pc750')).toHaveCount(1);
  await expect(page.locator('#comment-section-update-descriptor')).toContainText('unavailable');
  await page.unroute('**/comments/5');
  await page.evaluate(() => window.commentFixture.navigateToComment(5));
  await expectNaturalPosition(page, 5);
});

test('a newer navigation supersedes a delayed distant lookup', async ({ page }) => {
  await fixture(page, 1000);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/comments/5', async (route) => {
    await held;
    await route.fulfill({ json: { isError: false, comment: comment(5) } });
  });
  const requested = page.waitForRequest('**/comments/5');
  await page.evaluate(() => {
    void window.commentFixture.navigateToComment(5);
  });
  await requested;
  await page.evaluate(() => window.commentFixture.navigateToComment(950));
  release();
  await expectCentered(page, 950);
  await expect(page).toHaveURL(/#p950$/);
  await expect(page.locator('#pc5')).toHaveCount(0);
});

test('failed surrounding-history requests preserve the previous window', async ({ page }) => {
  await fixture(page, 750);
  await page.route('**/videos/fixture/comments?**', (route) =>
    route.fulfill({ status: 503, json: { isError: true } })
  );
  await page.evaluate(() => window.commentFixture.navigateToComment(5));
  await expect(page.locator('#pc750')).toHaveCount(1);
  await expect(page.locator('#pc5')).toHaveCount(0);
  await expect(page.locator('#comment-section-update-descriptor')).toContainText('try again');
});

test('centering releases on user scrolling and retains comment-number quoting', async ({
  page,
}) => {
  await fixture(page, 1000);
  await page.evaluate(() => window.commentFixture.navigateToComment(950));
  await expectCentered(page, 950);
  await page.locator('#comment-section').dispatchEvent('wheel', { deltaY: 100 });
  await page.locator('#comment-section').evaluate((el) => {
    el.scrollTop += 100;
  });
  const before = await page.locator('#comment-section').evaluate((el) => el.scrollTop);
  await page.evaluate(() =>
    window.commentFixture.loadComments(
      [
        {
          commentId: 949,
          timestamp: Math.floor(949 / 3),
          commentPlainTextSanitized: 'Existing comment',
        },
      ],
      false
    )
  );
  expect(await page.locator('#comment-section').evaluate((el) => el.scrollTop)).toBe(before);
  await page.locator('#pc950 .postInfo.desktop .comment-quote-button').click();
  await expect(page.locator('#comment-input-form-dynamic-950 textarea')).toHaveValue(
    />>950\n> Comment 950/
  );
  await expect(page.locator('#comment-input-form-static textarea')).toHaveValue('');
});

test('reply numbers open independent contextual drafts without scrolling to the general form', async ({
  page,
}) => {
  await fixture(page, 750, false, comment, false);
  await page.locator('#comment-input-form-static textarea').fill('General draft');
  await page.evaluate(() => window.commentFixture.navigateToComment(500));
  await expectCentered(page, 500);
  const row = page.locator('#pc500');
  const before = await row.evaluate((el) => el.getBoundingClientRect().top);
  await row.locator('.postInfo.desktop .comment-quote-button').click();
  const contextual = page.locator('#comment-input-form-dynamic-500');
  await expect(contextual).toBeVisible();
  expect(
    Math.abs((await row.evaluate((el) => el.getBoundingClientRect().top)) - before)
  ).toBeLessThan(3);
  await expect(contextual.locator('textarea')).toHaveValue('>>500\n> Comment 500\n');
  await expect(page.locator('#comment-input-form-static textarea')).toHaveValue('General draft');
  expect(await contextual.evaluate((el) => el.parentElement?.id)).toBe('pc500');
  await contextual.locator('textarea').fill('>>500\nMy contextual draft');
  await row.locator('.postInfo.desktop .comment-quote-button').click();
  await expect(contextual).toHaveCount(1);
  await expect(contextual.locator('textarea')).toHaveValue('>>500\nMy contextual draft');
  await page.locator('#pc499 .postInfo.desktop .comment-quote-button').click();
  await expect(page.locator('#comment-input-form-dynamic-499 textarea')).toHaveValue(
    '>>499\n> Comment 499\n'
  );
  await expect(contextual.locator('textarea')).toHaveValue('>>500\nMy contextual draft');
});

test('successful contextual submissions remove only their own form and preserve general drafts', async ({
  page,
}) => {
  await fixture(page, 250, false, comment, false);
  await page.locator('#comment-input-form-static textarea').fill('General draft');
  for (const id of [240, 241]) {
    await page.locator('#pc' + String(id) + ' .postInfo.desktop .comment-quote-button').click();
  }
  const form = page.locator('#comment-input-form-dynamic-240');
  await form.locator('textarea').fill('>>240\nContextual reply');
  const posted = page.waitForRequest(
    (req) => req.method() === 'POST' && req.url().endsWith('/comments/comment')
  );
  await form.locator('[type="submit"]').click();
  expect((await posted).postDataJSON()).toMatchObject({
    commentPlainText: '>>240\nContextual reply',
  });
  await expect(form).toHaveCount(0);
  await expect(page.locator('#p251')).toHaveClass(/\bnew-comment-highlight\b/);
  await expect(page.locator('#comment-input-form-static textarea')).toHaveValue('General draft');
  await expect(page.locator('#comment-input-form-dynamic-241')).toHaveCount(1);
});

test('failed contextual submissions retain their draft and can retry or cancel', async ({
  page,
}) => {
  await fixture(page, 250, false, comment, false);
  await page.locator('#comment-input-form-static textarea').fill('General draft');
  await page.locator('#pc240 .postInfo.desktop .comment-quote-button').click();
  const form = page.locator('#comment-input-form-dynamic-240');
  await form.locator('textarea').fill('>>240\nKeep this reply');
  await page.route('**/comments/comment', (route) =>
    route.fulfill({ status: 503, json: { isError: true } })
  );
  await form.locator('[type="submit"]').click();
  await expect(form.locator('[type="submit"]')).toBeEnabled();
  await expect(form.locator('textarea')).toHaveValue('>>240\nKeep this reply');
  await expect(page.locator('#comment-input-form-static textarea')).toHaveValue('General draft');
  await form.locator('.comment-input-form-dynamic-cancel-button').click();
  await expect(form).toHaveCount(0);
  await page.locator('#pc240 .postInfo.desktop .comment-quote-button').click();
  await page.unroute('**/comments/comment');
  await page.locator('#comment-input-form-dynamic-240 [type="submit"]').click();
  await expect(page.locator('#comment-input-form-dynamic-240')).toHaveCount(0);
});

test('contextual forms leave history cursors intact and disappear with trimmed parent comments', async ({
  page,
}) => {
  const state = await fixture(page, 750, false, comment, false);
  for (const id of [750, 651]) {
    await page.locator('#pc' + String(id) + ' .postInfo.desktop .comment-quote-button').click();
  }
  await expect(page.locator('.comment-input-form-contextual')).toHaveCount(2);
  await page.evaluate(() => window.commentFixture.loadOlderComments());
  await expect(page.locator('#pc551')).toHaveCount(1);
  expect(state.requests.some((url) => url.searchParams.get('beforeId') === '651')).toBe(true);
  for (const id of [451, 351, 251, 151]) {
    await page.evaluate(() => window.commentFixture.loadOlderComments());
    await expect(page.locator('#pc' + String(id))).toHaveCount(1);
  }
  await expect(page.locator('#pc750')).toHaveCount(0);
  await expect(page.locator('#pc651')).toHaveCount(0);
  await expect(page.locator('.comment-input-form-contextual')).toHaveCount(0);
  await expect(page.locator('#comments-container > .postContainer')).toHaveCount(500);
});

test('contextual quotes preserve line breaks, use unique IDs, and respect the input limit', async ({
  page,
}) => {
  await fixture(
    page,
    250,
    false,
    (id) => ({
      ...comment(id),
      commentPlainTextSanitized:
        id === 250
          ? '&gt;&gt;240'
          : id === 240
            ? 'First line\nSecond line'
            : id === 241
              ? 'A'.repeat(500)
              : `Comment ${String(id)}`,
    }),
    false
  );
  for (const id of [240, 241]) {
    await page.locator('#pc' + String(id) + ' .postInfo.desktop .comment-quote-button').click();
  }
  await expect(page.locator('#comment-input-form-dynamic-240 textarea')).toHaveValue(
    '>>240\n> First line\n> Second line\n'
  );
  expect(await page.locator('#comment-input-form-dynamic-241 textarea').inputValue()).toHaveLength(
    500
  );
  await page.locator('#pc250 blockquote .quotelink').hover();
  await expect(page.locator('#quote-preview')).toBeVisible();
  await expect(page.locator('#quote-preview .comment-input-form-contextual')).toHaveCount(0);
  await page.mouse.move(1000, 800);
  const ids = await page
    .locator('.comment-input-form-contextual [id], .comment-input-form-contextual')
    .evaluateAll((elements) => elements.map((el) => el.id));
  expect(new Set(ids).size).toBe(ids.length);
  await page
    .locator('#comment-input-form-dynamic-241 .comment-input-form-dynamic-cancel-button')
    .click();
  await expect(page.locator('#comment-input-form-dynamic-240')).toHaveCount(1);
  await expect(page.locator('#comment-input-form-dynamic-241')).toHaveCount(0);
});

test('an open contextual form does not make its visible comment require a popup', async ({
  page,
}) => {
  await fixture(
    page,
    250,
    false,
    (id) => ({
      ...comment(id),
      commentPlainTextSanitized: id === 241 ? '&gt;&gt;240' : `Comment ${String(id)}`,
    }),
    false
  );
  await page.locator('#pc240 .postInfo.desktop .comment-quote-button').click();
  await page.locator('#comment-input-form-dynamic-240 textarea').fill('A draft line\n'.repeat(20));
  await page.locator('#pc240').evaluate((el) => {
    const panel = document.getElementById('comment-section')!;
    panel.scrollTop += el.getBoundingClientRect().top - panel.getBoundingClientRect().top - 150;
  });
  await page.locator('#pc241 blockquote .quotelink').hover();
  await expect(page.locator('#p240')).toHaveClass(/\bhighlight\b/);
  await expect(page.locator('#quote-preview')).toHaveCount(0);
});

test('contextual submissions cannot be duplicated or cancelled while saving', async ({ page }) => {
  await fixture(page, 250, false, comment, false);
  await page.locator('#pc240 .postInfo.desktop .comment-quote-button').click();
  const form = page.locator('#comment-input-form-dynamic-240');
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  await page.route('**/comments/comment', async (route) => {
    requests++;
    await held;
    await route.fallback();
  });
  const waiting = page.waitForRequest('**/comments/comment');
  await form.locator('[type="submit"]').click();
  await waiting;
  await expect(form.locator('.comment-input-form-dynamic-cancel-button')).toBeDisabled();
  await form.dispatchEvent('submit');
  release();
  await expect(form).toHaveCount(0);
  expect(requests).toBe(1);
});

test('navigation preserves scrolling in both directions and refresh from distant history', async ({
  page,
}) => {
  const state = await fixture(page, 1000, false, comment, false);
  await page.evaluate(() => window.commentFixture.navigateToComment(500));
  await expectCentered(page, 500);
  await page.locator('#comment-section').dispatchEvent('wheel', { deltaY: 100 });
  await bottom(page);
  await expect(page.locator('#pc300')).toHaveCount(1);
  await page.locator('#comment-section').evaluate((el) => {
    el.scrollTop = 0;
  });
  await expect(page.locator('#pc700')).toHaveCount(1);
  state.publish([comment(1001)]);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.locator('#pc1001')).toHaveCount(1);
  await expect(page.locator('#comment-section-counter')).toHaveText('1001');
});

test('scrolling loads older comments in descending order and keeps hover, refresh and posting behavior', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const state = await fixture(page);
  await expect(page.locator('#comments-container > .postContainer').first()).toHaveAttribute(
    'id',
    'pc250'
  );
  await expect(page.getByRole('button', { name: 'Older comments', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Newer comments', exact: true })).toHaveCount(0);
  await bottom(page);
  await expect(page.locator('#pc150')).toHaveCount(1);
  expect(state.requests[0]?.searchParams.get('beforeId')).toBe('151');
  expect(state.requests[0]?.searchParams.has('page')).toBe(false);
  await page.locator('#pc150').scrollIntoViewIfNeeded();
  await page.locator('#pc151').evaluate((el) => {
    const scroll = document.getElementById('comment-section');
    if (scroll) {
      scroll.scrollTop += el.getBoundingClientRect().top - 30;
    }
  });
  const link = page.locator('#pc150 blockquote .quotelink[data-comment-id="151"]');
  await link.hover();
  await expect(page.locator('#pc151 #p151')).toHaveClass(/highlight/);
  await page.mouse.move(800, 500);
  await expect(page.locator('#pc151 #p151')).not.toHaveClass(/highlight/);
  await page.locator('#pc151 #bl_151 .quotelink').hover();
  await expect(page.locator('#pc150 #p150')).toHaveClass(/highlight/);
  await page.mouse.move(800, 500);
  await expect(page.locator('#pc150 #p150')).not.toHaveClass(/highlight/);
  await page.locator('#pc150 blockquote .quotelink[data-comment-id="1"]').hover();
  await expect(page.locator('#quote-preview #p1')).toHaveCount(1);
  await page.mouse.move(800, 500);
  await expect(page.locator('#quote-preview')).toHaveCount(0);
  await page.evaluate(() => window.commentFixture.updateComments());
  await expect(page.locator('#comments-container > .postContainer').first()).toHaveAttribute(
    'id',
    'pc251'
  );
  await expect(page.locator('#p251')).toHaveClass(/new-comment-highlight/);
  await page.locator('textarea').fill('A new comment');
  await page.getByRole('button', { name: /^submit$/i }).click();
  await expect(page.locator('#comments-container > .postContainer').first()).toHaveAttribute(
    'id',
    'pc252'
  );
  await expect(page.locator('#pc150')).toHaveCount(1);
  await bottom(page);
  await expect(page.locator('#pc1')).toHaveCount(1);
  const ids = await page
    .locator('#comments-container > .postContainer')
    .evaluateAll((elements) => elements.map((el) => Number(el.id.slice(2))));
  expect(ids).toEqual([...new Set(ids)].sort((a, b) => b - a));
  await expect(page.locator('#comment-section-counter')).toHaveText('252');
  expect(errors).toEqual([]);
});

test('document scrolling loads one older batch without following the moving footer', async ({
  page,
}) => {
  const { requests } = await fixture(page, 1000, true);
  await page.locator('#comments-older-sentinel').scrollIntoViewIfNeeded();
  await expect(page.locator('#pc801')).toHaveCount(1);
  await page.waitForTimeout(350);
  await expect(page.locator('#comments-container > .postContainer')).toHaveCount(200);
  expect(requests).toHaveLength(1);
});

test('unloaded quote popups remain inside a narrow viewport and disappear on mouse leave', async ({
  page,
}) => {
  await page.setViewportSize({ width: 400, height: 700 });
  await fixture(page);
  await bottom(page);
  await expect(page.locator('#pc150')).toHaveCount(1);
  await page.locator('#pc150 blockquote .quotelink[data-comment-id="1"]').hover();
  const popup = page.locator('#quote-preview');
  await expect(popup).toBeVisible();
  await page.waitForTimeout(150);
  const bounds = await popup.boundingBox();
  expect(bounds).not.toBeNull();
  if (bounds) {
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(400);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(700);
  }
  await page.mouse.move(399, 699);
  await expect(popup).toHaveCount(0);
});

test('leaving an unloaded quote cancels its popup while the result enters the cache', async ({
  page,
}) => {
  await fixture(page);
  await bottom(page);
  await expect(page.locator('#pc150')).toHaveCount(1);
  let release: () => void = () => {};
  const responseGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let arrived: () => void = () => {};
  const requestArrived = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  await page.route('**/videos/fixture/comments/1', async (route) => {
    arrived();
    await responseGate;
    await route.fulfill({ json: { isError: false, comment: comment(1) } }).catch(() => {});
  });
  await page.locator('#pc150 blockquote .quotelink[data-comment-id="1"]').hover();
  await requestArrived;
  await page.mouse.move(800, 500);
  release();
  await expect(page.locator('#quote-preview')).toHaveCount(0);
});

test('refreshing from deep history preserves access to the comments between old and new batches', async ({
  page,
}) => {
  const state = await fixture(page, 750);
  for (const id of [551, 451, 351, 251, 151]) {
    await bottom(page);
    await expect(page.locator('#pc' + String(id))).toHaveCount(1);
  }
  await page.evaluate(() => window.commentFixture.updateComments());
  await expect(page.locator('#pc751')).toHaveCount(1);
  await page.locator('#comment-section').evaluate((el) => {
    el.scrollTop = 0;
  });
  await expect(page.locator('#pc750')).toHaveCount(1);
  expect(state.requests.some((url) => url.searchParams.get('beforeId') === '751')).toBe(false);
  await expect(page.locator('#comments-container > .postContainer')).toHaveCount(500);
});

test('failed infinite-scroll requests can be retried without duplicate comments', async ({
  page,
}) => {
  const state = await fixture(page);
  state.failNext();
  await bottom(page);
  await expect(page.getByRole('button', { name: 'Retry loading comments' })).toBeVisible();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
  expect(state.requests).toHaveLength(1);
  await page.getByRole('button', { name: 'Retry loading comments' }).click();
  await expect(page.locator('#pc51')).toHaveCount(1);
  const ids = await page
    .locator('#comments-container > .postContainer')
    .evaluateAll((rows) => rows.map((row) => row.id));
  expect(ids.length).toBeGreaterThanOrEqual(200);
  expect(ids.length).toBeLessThanOrEqual(250);
  expect(new Set(ids).size).toBe(ids.length);
});

test('long histories stay bounded and trimmed newer comments load again when scrolling back', async ({
  page,
}) => {
  await fixture(page, 750);
  for (const id of [551, 451, 351, 251, 151]) {
    await bottom(page);
    await expect(page.locator('#pc' + String(id))).toHaveCount(1);
  }
  await expect(page.locator('#comments-container > .postContainer')).toHaveCount(500);
  expect(
    await page.evaluate(() => Object.keys(window.commentFixture.COMMENT_ELEMENT_CACHE).length)
  ).toBe(500);
  await expect(page.locator('#comment-section-counter')).toHaveText('750');
  await page.locator('#comment-section').evaluate((el) => {
    el.scrollTop = 0;
  });
  await expect(page.locator('#pc750')).toHaveCount(1);
  await expect(page.locator('#comments-container > .postContainer')).toHaveCount(500);
});

test('document scrolling preserves the reading position when the 500-comment window trims', async ({
  page,
}) => {
  const { requests } = await fixture(page, 1000, true);
  for (let batch = 1; batch <= 6; batch++) {
    await page.locator('#comments-older-sentinel').scrollIntoViewIfNeeded();
    await expect.poll(() => requests.length).toBe(batch);
    await page.waitForTimeout(250);
    expect(requests).toHaveLength(batch);
    await expect(page.locator('#comments-container > .postContainer')).toHaveCount(
      Math.min(500, (batch + 1) * 100)
    );
  }
});

test.describe('adversarial comment interactions', () => {
  // Allow bounded persistence backpressure on slower browser storage.
  const check = expect.configure({ timeout: 15000 });

  for (const total of [0, 1, 99, 100, 101, 200, 201]) {
    test(`history boundary with ${String(total)} comments`, async ({ page }) => {
      const { requests } = await fixture(page, total, false, comment, false);
      await check(page.locator('#comments-container > .postContainer')).toHaveCount(
        Math.min(total, 100)
      );
      if (total > 100) {
        await bottom(page);
        await check(page.locator('#pc' + String(Math.max(1, total - 199)))).toHaveCount(1);
        if (total > 200) {
          await bottom(page);
        }
        await check(page.locator('#pc1')).toHaveCount(1);
      }
      await check(page.locator('#comment-section-counter')).toHaveText(String(total));
      if (total <= 100) {
        await bottom(page);
        await page.waitForTimeout(100);
        expect(requests).toHaveLength(0);
      }
    });
  }

  for (const status of [200, 503]) {
    test(`refresh recovers after ${String(status)} error response`, async ({ page }) => {
      await fixture(page);
      await page.route('**/videos/fixture/comments?**', (route) =>
        route.fulfill({ status, json: { isError: true, message: 'Temporary failure' } })
      );
      await page.getByRole('button', { name: 'Refresh', exact: true }).click();
      await check(page.locator('#update-comments-button')).toBeVisible();
      await check(page.locator('#update-comments-button-spinner')).toBeHidden();
    });
  }

  test('late posting responses merge below newer comments', async ({ page }) => {
    await fixture(page);
    await page.evaluate(() => {
      window.commentFixture.loadComments(
        [{ commentId: 252, timestamp: 84, commentPlainTextSanitized: 'A newer refresh' }],
        true
      );
      window.commentFixture.loadComments(
        [{ commentId: 251, timestamp: 83, commentPlainTextSanitized: 'Delayed own post' }],
        true
      );
    });
    const ids = await page
      .locator('#comments-container > .postContainer')
      .evaluateAll((rows) => rows.slice(0, 3).map((row) => row.id));
    expect(ids).toEqual(['pc252', 'pc251', 'pc250']);
  });

  test('duplicate records in one response render once and count once', async ({ page }) => {
    await fixture(page);
    await page.evaluate(() => {
      const row = { commentId: 251, timestamp: 84, commentPlainTextSanitized: 'Once only' };
      window.commentFixture.loadComments([row, row], true);
    });
    await check(page.locator('#pc251')).toHaveCount(1);
    await check(page.locator('#comment-section-counter')).toHaveText('251');
  });

  test('rapid refresh requests share one in-flight operation', async ({ page }) => {
    await fixture(page);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let requests = 0;
    await page.route('**/videos/fixture/comments?**', async (route) => {
      requests++;
      await gate;
      await route
        .fulfill({ json: { isError: false, comments: [], hasMore: false } })
        .catch(() => {});
    });
    try {
      await page.evaluate(() => {
        for (let i = 0; i < 5; i++) {
          window.commentFixture.updateComments();
        }
      });
      await page.waitForTimeout(100);
      expect(requests).toBe(1);
    } finally {
      release();
    }
  });

  test('refresh preempts an older-history response already in flight', async ({ page }) => {
    await fixture(page, 750);
    for (const id of [551, 451, 351, 251, 151]) {
      await bottom(page);
      await check(page.locator('#pc' + String(id))).toHaveCount(1);
    }
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let arrived: () => void = () => {};
    const waiting = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    await page.route('**/videos/fixture/comments?**', async (route) => {
      const url = new URL(route.request().url());

      if (url.searchParams.get('type') === 'before' && url.searchParams.get('beforeId') === '151') {
        arrived();
        await gate;
        await route
          .fulfill({
            json: {
              isError: false,
              comments: Array.from({ length: 100 }, (_, i) => comment(150 - i)),
              hasMore: true,
            },
          })
          .catch(() => {});
      } else {
        await route.fallback();
      }
    });
    await bottom(page);
    await waiting;
    await page.evaluate(() => window.commentFixture.updateComments());
    await check(page.locator('#pc751')).toHaveCount(1);
    release();
    await page.waitForTimeout(100);
    await check(page.locator('#pc751')).toHaveCount(1);
  });

  test('a no-op refresh from deep history does not reset or recount the window', async ({
    page,
  }) => {
    await fixture(page, 750, false, comment, false);
    for (const id of [551, 451, 351, 251, 151]) {
      await bottom(page);
      await check(page.locator('#pc' + String(id))).toHaveCount(1);
    }
    const before = await page
      .locator('#comments-container > .postContainer')
      .evaluateAll((rows) => rows.map((row) => row.id));
    await page.evaluate(() => window.commentFixture.updateComments());
    await check(page.locator('#update-comments-button-spinner')).toBeHidden();
    expect(
      await page
        .locator('#comments-container > .postContainer')
        .evaluateAll((rows) => rows.map((row) => row.id))
    ).toEqual(before);
    await check(page.locator('#comment-section-counter')).toHaveText('750');
  });

  test('returning from the browser page cache resumes infinite scrolling', async ({ page }) => {
    await fixture(page);
    await page.evaluate(() => {
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    await bottom(page);
    await check(page.locator('#pc51')).toHaveCount(1);
  });

  test('equal-timestamp histories remain complete while traversing every batch', async ({
    page,
  }) => {
    await fixture(page, 1000, false, (id) => ({ ...comment(id), timestamp: 0 }), false);
    const seen = new Set<number>();
    for (let batch = 0; batch < 10; batch++) {
      if (batch) {
        await bottom(page);
        await check(page.locator('#pc' + String(1000 - (batch + 1) * 100 + 1))).toHaveCount(1);
      }
      const ids = await page
        .locator('#comments-container > .postContainer')
        .evaluateAll((rows) => rows.map((row) => Number(row.id.slice(2))));
      expect(ids).toEqual([...new Set(ids)].sort((a, b) => b - a));
      ids.forEach((id) => seen.add(id));
      expect(ids.length).toBeLessThanOrEqual(500);
    }
    expect(seen.size).toBe(1000);
  });

  test('timestamp ordering takes precedence over ID ordering', async ({ page }) => {
    await fixture(page, 350, false, (id) => ({ ...comment(id), timestamp: id % 13 }), false);
    const seen = new Set<number>();
    for (let batch = 0; batch < 4; batch++) {
      if (batch) {
        await bottom(page);
        await page.waitForTimeout(100);
      }
      const rows = await page
        .locator('#comments-container > .postContainer')
        .evaluateAll((elements) =>
          elements.map((el) => ({
            id: Number(el.id.slice(2)),
            timestamp: Number((el as HTMLElement).dataset['timestamp']),
          }))
        );
      expect(rows).toEqual([...rows].sort((a, b) => b.timestamp - a.timestamp || b.id - a.id));
      rows.forEach((row) => seen.add(row.id));
    }
    expect(seen.size).toBe(350);
  });

  test('posting after a large unseen burst still displays the own comment and fills the gap', async ({
    page,
  }) => {
    const state = await fixture(page, 250, false, comment, false);
    state.publish(Array.from({ length: 200 }, (_, i) => comment(251 + i)));
    await page.route('**/videos/fixture/comments/comment', async (route) => {
      const own = comment(451);
      state.publish([own]);
      await route.fulfill({
        json: {
          isError: false,
          commentId: 451,
          comment: own,
          comments: Array.from({ length: 100 }, (_, i) => comment(251 + i)),
          totalCount: 451,
        },
      });
    });
    await page.locator('textarea').fill('Own comment after a burst');
    await page.getByRole('button', { name: /^submit$/i }).click();
    await check(page.locator('#pc451')).toHaveCount(1);
    await check(page.locator('#comment-section-counter')).toHaveText('451');
    await page.locator('#pc451').scrollIntoViewIfNeeded();
    await check(page.locator('#pc450')).toHaveCount(1);
    const ids = await page
      .locator('#comments-container > .postContainer')
      .evaluateAll((rows) => rows.map((row) => Number(row.id.slice(2))));
    expect(ids).toEqual([...new Set(ids)].sort((a, b) => b - a));
  });

  test('duplicate form submissions create one posting request', async ({ page }) => {
    await fixture(page);
    let posts = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/videos/fixture/comments/comment', async (route) => {
      posts++;
      await gate;
      await route
        .fulfill({
          json: {
            isError: false,
            commentId: 251,
            comment: comment(251),
            comments: [comment(251)],
            totalCount: 251,
          },
        })
        .catch(() => {});
    });
    await page.locator('textarea').fill('Submit once');
    try {
      await page.locator('form').evaluate((form) => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
      await page.waitForTimeout(100);
      expect(posts).toBe(1);
    } finally {
      release();
    }
    await check(page.locator('#pc251')).toHaveCount(1);
  });

  test('overlapping post and refresh totals do not double-count an already known comment', async ({
    page,
  }) => {
    await fixture(page);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let arrived: () => void = () => {};
    const waiting = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    await page.route('**/videos/fixture/comments/comment', async (route) => {
      arrived();
      await gate;
      await route
        .fulfill({
          json: {
            isError: false,
            commentId: 351,
            comment: comment(351),
            comments: [comment(351)],
            totalCount: 351,
          },
        })
        .catch(() => {});
    });
    await page.locator('textarea').fill('Delayed own comment');
    await page.getByRole('button', { name: /^submit$/i }).click();
    await waiting;
    await page.route('**/videos/fixture/comments?**', (route) =>
      route.fulfill({
        json: {
          isError: false,
          comments: Array.from({ length: 100 }, (_, i) => comment(251 + i)),
          hasMore: true,
          totalCount: 351,
        },
      })
    );
    await page.evaluate(() => window.commentFixture.updateComments());
    await check(page.locator('#pc350')).toHaveCount(1);
    release();
    await check(page.locator('#pc351')).toHaveCount(1);
    await check(page.locator('#comment-section-counter')).toHaveText('351');
  });

  test('a fresh refresh can reconcile a lower server total after deletions', async ({ page }) => {
    const state = await fixture(page, 250, false, comment, false);
    state.remove(1);
    await page.evaluate(() => window.commentFixture.updateComments());
    await check(page.locator('#comment-section-counter')).toHaveText('249');
  });

  test('a saved post can recover intermediate history after follow-up refresh failure', async ({
    page,
  }) => {
    const state = await fixture(page, 250, false, comment, false);
    state.publish(Array.from({ length: 200 }, (_, i) => comment(251 + i)));
    await page.route('**/videos/fixture/comments/comment', (route) => {
      const own = comment(451);
      state.publish([own]);
      return route.fulfill({
        json: {
          isError: false,
          commentId: 451,
          comment: own,
          comments: [own],
          refreshIncomplete: true,
        },
      });
    });
    await page.locator('textarea').fill('Saved despite refresh failure');
    await page.getByRole('button', { name: /^submit$/i }).click();
    await check(page.locator('#pc451')).toHaveCount(1);
    await page.locator('#pc451').scrollIntoViewIfNeeded();
    await check(page.locator('#pc450')).toHaveCount(1);
    await page.evaluate(() => window.commentFixture.updateComments());
    await check(page.locator('#comment-section-counter')).toHaveText('451');
  });

  test('rapid older-history triggers keep one request in flight', async ({ page }) => {
    await fixture(page);
    let requests = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/videos/fixture/comments?**', async (route) => {
      requests++;
      await gate;
      await route.fallback().catch(() => {});
    });
    try {
      await page.evaluate(() => {
        for (let i = 0; i < 50; i++) {
          window.commentFixture.loadOlderComments();
        }
      });
      await page.waitForTimeout(100);
      expect(requests).toBe(1);
    } finally {
      release();
    }
    await check(page.locator('#pc51')).toHaveCount(1);
  });

  test('empty responses with an incorrect hasMore flag stop fetching', async ({ page }) => {
    await fixture(page);
    let requests = 0;
    await page.route('**/videos/fixture/comments?**', (route) => {
      requests++;
      return route.fulfill({ json: { isError: false, comments: [], hasMore: true } });
    });
    await bottom(page);
    await page.waitForTimeout(150);
    expect(requests).toBe(1);
    await check(page.locator('#comments-container > .postContainer')).toHaveCount(100);
  });

  test('posting failure preserves the draft and can be retried', async ({ page }) => {
    await fixture(page);
    let fail = true;
    await page.route('**/videos/fixture/comments/comment', (route) => {
      if (fail) {
        fail = false;
        return route.fulfill({ status: 503, json: { isError: true } });
      }
      return route.fallback();
    });
    await page.locator('textarea').fill('Keep my draft');
    await page.getByRole('button', { name: /^submit$/i }).click();
    await check(page.getByRole('button', { name: /^submit$/i })).toBeEnabled();
    await check(page.locator('textarea')).toHaveValue('Keep my draft');
    await page.getByRole('button', { name: /^submit$/i }).click();
    await check(page.locator('#pc251')).toHaveCount(1);
    await check(page.locator('textarea')).toHaveValue('');
  });

  test('a pending captcha cannot post after leaving and returning to the page', async ({
    page,
  }) => {
    await fixture(page);
    let posts = 0;
    await page.route('**/videos/fixture/comments/comment', (route) => {
      posts++;
      return route.fallback();
    });
    await page.evaluate(() => {
      window.commentFixture.getCloudflareTurnstileToken = () =>
        new Promise((resolve) => {
          window.releaseCommentCaptcha = resolve;
        });
    });
    await page.locator('textarea').fill('Still waiting for captcha');
    await page.getByRole('button', { name: /^submit$/i }).click();
    await page.evaluate(() => {
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      window.releaseCommentCaptcha?.('old-token');
    });
    await check(page.getByRole('button', { name: /^submit$/i })).toBeEnabled();
    await page.waitForTimeout(100);
    expect(posts).toBe(0);
  });

  test('a failed uncached gap request can retry without losing intermediate history', async ({
    page,
  }) => {
    const state = await fixture(page, 750);
    await page.evaluate(() => window.commentFixture.navigateToComment(300));
    await expectCentered(page, 300);
    await page.evaluate(() => window.commentFixture.updateComments());
    await check(page.locator('#pc751')).toHaveCount(1);
    state.failNext();
    await page.evaluate(() => window.commentFixture.COMMENT_GAP?.scrollIntoView());
    await check(page.locator('#pc651')).toHaveCount(1);
    await page.evaluate(() => window.commentFixture.COMMENT_GAP?.scrollIntoView());
    await check(page.getByRole('button', { name: 'Retry loading comments' })).toBeVisible();
    await page.getByRole('button', { name: 'Retry loading comments' }).click();
    await check(page.locator('#pc650')).toHaveCount(1);
  });

  test('failed uncached scroll-back restoration can retry', async ({ page }) => {
    const state = await fixture(page, 750, false, comment, false);
    await page.evaluate(() => window.commentFixture.navigateToComment(400));
    await expectCentered(page, 400);
    state.failNext();
    await page.locator('#comment-section').evaluate((el) => {
      el.scrollTop = 0;
    });
    await check(page.getByRole('button', { name: 'Retry loading comments' })).toBeVisible();
    await page.getByRole('button', { name: 'Retry loading comments' }).click();
    await check(page.locator('#pc600')).toHaveCount(1);
  });

  test('hiding and reopening comments during a response does not cause a request storm', async ({
    page,
  }) => {
    const { requests } = await fixture(page);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let arrived: () => void = () => {};
    const waiting = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    await page.route('**/videos/fixture/comments?**', async (route) => {
      arrived();
      await gate;
      await route.fallback().catch(() => {});
    });
    await bottom(page);
    await waiting;
    await page.evaluate(() => window.commentFixture.closeCommentSection());
    release();
    await page.waitForTimeout(100);
    expect(requests).toHaveLength(1);
    await page.evaluate(() => window.commentFixture.openCommentSection());
    await check(page.locator('#pc51')).toHaveCount(1);
  });

  test('deleted quote targets are marked unavailable', async ({ page }) => {
    const state = await fixture(page);
    state.remove(1);
    await bottom(page);
    await check(page.locator('#pc150')).toHaveCount(1);
    const link = page.locator('#pc150 blockquote .quotelink[data-comment-id="1"]');
    await link.hover();
    await check(link).toHaveClass(/deadlink/);
    await check(page.locator('#quote-preview')).toHaveCount(0);
  });

  test('transient quote errors can retry without marking the comment deleted', async ({ page }) => {
    await fixture(page);
    let fail = true;
    await page.route('**/videos/fixture/comments/1', (route) => {
      if (fail) {
        fail = false;
        return route.fulfill({
          status: 200,
          json: { isError: true, message: 'Temporary failure' },
        });
      }
      return route.fallback();
    });
    await bottom(page);
    await check(page.locator('#pc150')).toHaveCount(1);
    const link = page.locator('#pc150 blockquote .quotelink[data-comment-id="1"]');
    const firstResponse = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/videos/fixture/comments/1'
    );
    await link.hover();
    await firstResponse;
    await page.waitForFunction(() => !window.commentFixture.QUOTE_REQUEST);
    await check(link).not.toHaveClass(/deadlink/);
    await page.mouse.move(800, 500);
    await link.hover();
    await check(page.locator('#quote-preview #p1')).toHaveCount(1);
  });

  test('trimming a hovered comment releases its preview references', async ({ page }) => {
    await fixture(page);
    await bottom(page);
    await check(page.locator('#pc150')).toHaveCount(1);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let arrived: () => void = () => {};
    const waiting = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    await page.route('**/videos/fixture/comments/1', async (route) => {
      arrived();
      await gate;
      await route.fulfill({ json: { isError: false, comment: comment(1) } }).catch(() => {});
    });
    await page.locator('#pc150 blockquote .quotelink[data-comment-id="1"]').hover();
    await waiting;
    await page.evaluate(() =>
      window.commentFixture.loadComments(
        Array.from({ length: 500 }, (_, i) => ({
          commentId: 1000 + i,
          timestamp: 1000 + i,
          commentPlainTextSanitized: 'Newer row',
        })),
        true
      )
    );
    release();
    await check(page.locator('#quote-preview')).toHaveCount(0);
    expect(await page.evaluate(() => window.commentFixture.QUOTE_LINK)).toBeNull();
  });

  test('resizing with a quote open dismisses the obsolete popup', async ({ page }) => {
    await fixture(page);
    await bottom(page);
    await check(page.locator('#pc150')).toHaveCount(1);
    await page.locator('#pc150 blockquote .quotelink[data-comment-id="1"]').hover();
    await check(page.locator('#quote-preview')).toBeVisible();
    await page.setViewportSize({ width: 320, height: 568 });
    await check(page.locator('#quote-preview')).toHaveCount(0);
  });

  test('a long quote remains bounded by a small viewport', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await fixture(page, 250, false, (id) => ({
      ...comment(id),
      commentPlainTextSanitized:
        id === 1 ? 'A line\n'.repeat(60) : comment(id).commentPlainTextSanitized,
    }));
    await bottom(page);
    await check(page.locator('#pc150')).toHaveCount(1);
    await page.locator('#pc150 blockquote .quotelink[data-comment-id="1"]').hover();
    await check(page.locator('#quote-preview')).toBeVisible();
    const box = await page.locator('#quote-preview').boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.x + box.width).toBeLessThanOrEqual(320);
      expect(box.y + box.height).toBeLessThanOrEqual(568);
    }
  });

  test('rapid direction and viewport changes keep ordering and retention consistent', async ({
    page,
  }) => {
    await fixture(page, 2000, false, comment, false);
    for (let step = 0; step < 18; step++) {
      const newer = step % 5 === 4;
      await page.locator('#comment-section').evaluate((el, up) => {
        el.scrollTop = up ? 0 : el.scrollHeight;
      }, newer);
      await page.waitForTimeout(60);
      if (step === 7) {
        await page.setViewportSize({ width: 768, height: 1024 });
      }
      if (step === 12) {
        await page.setViewportSize({ width: 1920, height: 1080 });
      }
      const state = await page.evaluate(() => {
        const ids = Array.from(
          document.querySelectorAll('#comments-container > .postContainer')
        ).map((el) => Number(el.id.slice(2)));
        return { ids, cache: Object.keys(window.commentFixture.COMMENT_ELEMENT_CACHE).length };
      });
      expect(state.ids).toEqual([...new Set(state.ids)].sort((a, b) => b - a));
      expect(state.ids.length).toBeLessThanOrEqual(500);
      expect(state.cache).toBe(state.ids.length);
    }
  });
});

test('unloaded parent popups include replies from the full history', async ({ page }) => {
  await fixture(
    page,
    750,
    false,
    (id) => ({
      ...comment(id),
      commentPlainTextSanitized:
        id === 750 ? '&gt;&gt;5\nA distant reply' : comment(id).commentPlainTextSanitized,
    }),
    false
  );
  await page.locator('#pc750 blockquote .quotelink[data-comment-id="5"]').hover();
  await expect(page.locator('#quote-preview #bl_5 .quotelink[data-comment-id="750"]')).toHaveCount(
    1
  );
});

test('offscreen retained parent popups reuse authoritative batch metadata', async ({ page }) => {
  const state = await fixture(
    page,
    250,
    false,
    (id) => ({
      ...comment(id),
      commentPlainTextSanitized:
        id === 250 || id === 1 ? '&gt;&gt;160\nReply' : `Comment ${String(id)}`,
    }),
    false
  );
  const link = page.locator('#pc250 blockquote .quotelink');
  for (let i = 0; i < 2; i++) {
    await link.hover();
    await expect(
      page.locator('#quote-preview #bl_160 .quotelink[data-comment-id="1"]')
    ).toHaveCount(1);
    await page.mouse.move(1, 1);
    await expect(page.locator('#quote-preview')).toHaveCount(0);
  }
  expect(state.allRequests.filter((url) => url.pathname.endsWith('/replies'))).toHaveLength(0);
});

test('parents retain distant backlinks after the replying comment is trimmed', async ({ page }) => {
  await fixture(
    page,
    750,
    false,
    (id) => ({
      ...comment(id),
      commentPlainTextSanitized:
        id === 750 || id === 8
          ? '&gt;&gt;5\nA reply to comment five'
          : comment(id).commentPlainTextSanitized,
    }),
    false
  );
  for (let batch = 1; batch <= 7; batch++) {
    await bottom(page);
    await expect(
      page.locator('#pc' + String(Math.max(1, 750 - (batch + 1) * 100 + 1)))
    ).toHaveCount(1);
  }
  await page.locator('#pc5').scrollIntoViewIfNeeded();
  await expect(page.locator('#pc750')).toHaveCount(0);
  await expect(page.locator('#pc5 #bl_5 .quotelink[data-comment-id="750"]')).toHaveCount(1);
  await expect(page.locator('#pc5 #bl_5 .quotelink[data-comment-id="8"]')).toHaveCount(1);
  await page.locator('#pc5 #bl_5 .quotelink[data-comment-id="750"]').hover();
  await expect(page.locator('#quote-preview #p750')).toHaveCount(1);
});

test('global backlink pages are bounded and can show older replies', async ({ page }) => {
  await fixture(
    page,
    250,
    false,
    (id) => ({
      ...comment(id),
      commentPlainTextSanitized: id > 1 ? '&gt;&gt;1\nA reply' : 'Parent comment',
    }),
    false
  );
  for (let batch = 0; batch < 2; batch++) {
    await bottom(page);
    await expect(page.locator('#pc' + String(batch === 0 ? 51 : 1))).toHaveCount(1);
  }
  await page.locator('#pc1').scrollIntoViewIfNeeded();
  const links = page.locator('#pc1 #bl_1');
  await expect(links.locator('.quotelink')).toHaveCount(100);
  await expect(links.locator('.quotelink').first()).toHaveAttribute('data-comment-id', '250');
  await links.getByRole('button', { name: 'Older replies', exact: true }).click();
  await expect(links.locator('.quotelink').first()).toHaveAttribute('data-comment-id', '150');
  await expect(links.locator('.quotelink')).toHaveCount(100);
  await links.getByRole('button', { name: 'Newest replies', exact: true }).click();
  await expect(links.locator('.quotelink').first()).toHaveAttribute('data-comment-id', '250');
});

test('failed global backlink requests can retry', async ({ page }) => {
  await fixture(
    page,
    750,
    false,
    (id) => ({
      ...comment(id),
      commentPlainTextSanitized:
        id > 5 ? '&gt;&gt;5\nDistant reply' : comment(id).commentPlainTextSanitized,
    }),
    false
  );
  let fail = true;
  await page.route('**/videos/fixture/comments/5/replies*', (route) => {
    if (fail) {
      fail = false;
      return route.fulfill({ status: 503, json: { isError: true } });
    }
    return route.fallback();
  });
  for (let batch = 1; batch <= 7; batch++) {
    await bottom(page);
    await expect(
      page.locator('#pc' + String(Math.max(1, 750 - (batch + 1) * 100 + 1)))
    ).toHaveCount(1);
  }
  await page.locator('#pc5').scrollIntoViewIfNeeded();
  await page
    .locator('#pc5 #bl_5')
    .getByRole('button', { name: 'Older replies', exact: true })
    .click();
  await page.locator('#pc5 #bl_5').getByRole('button', { name: 'Retry replies' }).click();
  await expect(page.locator('#pc5 #bl_5 .quotelink[data-comment-id="650"]')).toHaveCount(1);
});

test('multiple and zero-padded references have canonical targets and backlinks', async ({
  page,
}) => {
  await fixture(
    page,
    750,
    false,
    (id) => ({
      ...comment(id),
      commentPlainTextSanitized:
        id === 750 ? '&gt;&gt;0005 and &gt;&gt;50' : comment(id).commentPlainTextSanitized,
    }),
    false
  );
  const links = page.locator('#pc750 blockquote .quotelink');
  await expect(links).toHaveCount(2);
  await expect(links.first()).toHaveAttribute('data-comment-id', '5');
  await expect(links.last()).toHaveAttribute('data-comment-id', '50');
  await links.first().hover();
  await expect(page.locator('#quote-preview #bl_5 .quotelink[data-comment-id="750"]')).toHaveCount(
    1
  );
});

test('cache retains trimmed comments and history without per-row reply requests', async ({
  page,
}) => {
  const state = await fixture(page, 1100, false, comment, false);
  for (let i = 0; i < 10; i++) {
    await bottom(page);
    await expect(page.locator('#pc' + String(Math.max(1, 901 - i * 100)))).toBeAttached();
  }
  expect(
    await page.evaluate(async () => {
      const s = window.commentFixture.commentStore();
      await s.ready;
      return s.storageError ?? Boolean(s.db);
    })
  ).toBe(true);
  const historyCount = state.requests.length;
  await page.evaluate(() => window.commentFixture.navigateToComment(1000));
  await expect(page.locator('#p1000')).toHaveClass(/highlight/);
  expect(state.requests.length).toBe(historyCount);
  expect(state.allRequests.filter((url) => url.pathname.endsWith('/replies'))).toHaveLength(0);
  expect(state.allRequests.filter((url) => /comments\/1000$/.test(url.pathname))).toHaveLength(0);
});

test('hover downloads once and retains the result after the pointer leaves', async ({ page }) => {
  const state = await fixture(page, 250, false, comment, false);
  await bottom(page);
  await expect(page.locator('#pc150')).toBeAttached();
  await page.locator('#pc150 .quotelink[data-comment-id="1"]').hover();
  await expect(page.locator('#quote-preview')).toContainText('Comment 1');
  await page.mouse.move(1200, 700);
  await page.locator('#pc150 .quotelink[data-comment-id="1"]').hover();
  await expect(page.locator('#quote-preview')).toContainText('Comment 1');
  expect(
    state.allRequests.filter((url) => url.pathname === '/videos/fixture/comments/1')
  ).toHaveLength(1);
});

test('persistent cache survives reloads and reconciles replies and deleted comments', async ({
  page,
}) => {
  const state = await fixture(page, 250, false, comment, false, '', true);
  expect(state.requests).toHaveLength(1);
  await bottom(page);
  await expect(page.locator('#pc150')).toBeAttached();
  await bottom(page);
  await expect(page.locator('#pc1')).toBeAttached();
  const count = state.requests.length;
  await page.evaluate(() => window.commentFixture.commentStore().serial);
  await page.reload();
  await page.evaluate(() => window.commentFixture.COMMENT_READY);
  expect(state.requests).toHaveLength(count);
  state.publish([
    { commentId: 251, timestamp: 1000, commentPlainTextSanitized: '&gt;&gt;1\nNew reply' },
  ]);
  state.remove(2);
  await page.reload();
  await page.evaluate(() => window.commentFixture.COMMENT_READY);
  await expect(page.locator('#pc251')).toBeAttached();
  await page.evaluate(() => window.commentFixture.navigateToComment(1));
  await expect(page.locator('#bl_1 .quotelink[data-comment-id="251"]')).toHaveCount(1);
  await expect(page.locator('#pc2')).toHaveCount(0);
  expect(state.requests).toHaveLength(count);
  expect(state.allRequests.filter((url) => url.pathname.endsWith('/cache'))).toHaveLength(1);
});

for (const failure of ['unavailable', 'write failure', 'partial write failure']) {
  test(`comment cache falls back when storage has ${failure}`, async ({ page }) => {
    await page.addInitScript((mode) => {
      if (mode === 'unavailable') {
        Object.defineProperty(window, 'indexedDB', {
          get() {
            throw new Error('Storage blocked');
          },
        });
      } else {
        const original = IDBObjectStore.prototype.put;
        let writes = 0;
        IDBObjectStore.prototype.put = function (...args) {
          if (this.name === 'comments' && (mode === 'write failure' || ++writes === 5)) {
            throw new DOMException('Quota full', 'QuotaExceededError');
          }
          return original.apply(this, args);
        };
      }
    }, failure);
    await fixture(page, 250, false, comment, false, '', true);
    await expect(page.locator('#pc250')).toBeAttached();
    await bottom(page);
    await expect(page.locator('#pc150')).toBeAttached();
    await page.locator('#pc150 blockquote .quotelink[data-comment-id="1"]').hover();
    await expect(page.locator('#quote-preview')).toContainText('Comment 1');
    await page.evaluate(() => window.commentFixture.commentStore().serial);
    if (failure !== 'unavailable') {
      expect(
        await page.evaluate(
          () =>
            new Promise<number>((resolve, reject) => {
              const open = indexedDB.open('moartube-comments-v1', 2);
              open.onerror = () => reject(open.error);
              open.onsuccess = () => {
                const db = open.result,
                  request = db.transaction('comments').objectStore('comments').count();
                request.onsuccess = () => {
                  resolve(request.result);
                  db.close();
                };
                request.onerror = () => reject(request.error);
              };
            })
        )
      ).toBe(0);
    }
  });
}

test('concurrent uncached comment consumers share one download', async ({ page }) => {
  const state = await fixture(page, 250, false, comment, false);
  const rows = await page.evaluate(() =>
    Promise.all([1, 1, 1].map((id) => window.commentFixture.getCachedComment(id)))
  );
  expect(rows.map((row) => row.comment.commentId)).toEqual([1, 1, 1]);
  expect(
    state.allRequests.filter((url) => url.pathname === '/videos/fixture/comments/1')
  ).toHaveLength(1);
});

test('a delayed quote response cannot resurrect a comment deleted during refresh', async ({
  page,
}) => {
  const state = await fixture(page, 250, false, comment, false, '', true);
  await bottom(page);
  await expect(page.locator('#pc150')).toBeAttached();
  let release!: () => void, arrived!: () => void;
  const gate = new Promise<void>((resolve) => {
      release = resolve;
    }),
    waiting = new Promise<void>((resolve) => {
      arrived = resolve;
    });
  let first = true;
  await page.route('**/videos/fixture/comments/1', async (route) => {
    if (!first) {
      return route.fallback();
    }
    first = false;
    arrived();
    await gate;
    await route.fulfill({ json: { isError: false, comment: comment(1) } });
  });
  const link = page.locator('#pc150 blockquote .quotelink[data-comment-id="1"]');
  await link.hover();
  await waiting;
  state.remove(1);
  await page.evaluate(() => window.commentFixture.updateComments());
  await expect
    .poll(() => state.allRequests.filter((url) => url.pathname.endsWith('/cache')).length)
    .toBe(1);
  await expect(page.locator('#comment-section-counter')).toHaveText('249');
  release();
  await expect(link).toHaveClass(/deadlink/);
  expect(await page.evaluate(() => window.commentFixture.commentStore().get(1))).toBeUndefined();
});

test('repeated refreshes reveal a large cached burst without fetching its history again', async ({
  page,
}) => {
  const state = await fixture(page, 250, false, comment, false, '', true);
  state.publish(
    Array.from({ length: 205 }, (_, i) => ({ ...comment(251 + i), timestamp: 1000 + i }))
  );
  for (const id of [350, 450, 455]) {
    await page.evaluate(() => window.commentFixture.updateComments());
    await expect(page.locator('#pc' + String(id))).toBeAttached();
    await expect(page.locator('#update-comments-button-spinner')).toBeHidden();
  }
  expect(state.requests).toHaveLength(1);
  await expect(page.locator('#comment-section-counter')).toHaveText('455');
});

test('a previewed comment body is not downloaded again when history reaches it', async ({
  page,
}) => {
  await fixture(page, 250, false, comment, false);
  const bodies: number[] = [];
  page.on('response', async (response) => {
    if (!new URL(response.url()).pathname.startsWith('/videos/fixture/comments')) {
      return;
    }
    const data = await response.json();
    if (data.comment) {
      bodies.push(data.comment.commentId);
    }
    for (const row of data.comments ?? []) {
      bodies.push(row.commentId);
    }
  });
  await bottom(page);
  await expect(page.locator('#pc150')).toBeAttached();
  await page.locator('#pc150 blockquote .quotelink[data-comment-id="1"]').hover();
  await expect(page.locator('#quote-preview #p1')).toBeAttached();
  await page.mouse.move(1200, 700);
  await bottom(page);
  await expect(page.locator('#pc1')).toBeAttached();
  expect(bodies.filter((id) => id === 1)).toHaveLength(1);
});

test('a replacement database with reused revisions and IDs invalidates persisted comments', async ({
  page,
}) => {
  const state = await fixture(page, 250, false, comment, false, '', true);
  await page.evaluate(() => window.commentFixture.commentStore().serial);
  state.replaceDatabase(
    Array.from({ length: 250 }, (_, i) => ({
      ...comment(i + 1),
      commentPlainTextSanitized: `Replacement ${String(i + 1)}`,
    }))
  );
  await page.reload();
  await page.evaluate(() => window.commentFixture.COMMENT_READY);
  await expect(page.locator('#pc250')).toContainText('Replacement 250');
  expect(state.requests).toHaveLength(2);
  expect(state.allRequests.filter((url) => url.pathname.endsWith('/cache'))).toHaveLength(0);
});

test('explicit refresh clears old database records even when the revision number is reused', async ({
  page,
}) => {
  const state = await fixture(page, 250, false, comment, false, '', true);
  state.replaceDatabase([{ ...comment(1), commentPlainTextSanitized: 'New database comment' }]);
  await page.evaluate(() => window.commentFixture.updateComments());
  await expect(page.locator('#pc1')).toContainText('New database comment');
  await expect(page.locator('#pc250')).toHaveCount(0);
  await expect(page.locator('#comment-section-counter')).toHaveText('1');
});

test.describe('Cloudflare-compatible comment distribution', () => {
  test('shares cold history and quote previews between independent browser caches', async ({
    page,
    browser,
  }) => {
    const first = await fixture(page, 250, false, comment, false, '', true, true);
    await bottom(page);
    await expect(page.locator('#pc150')).toBeAttached();
    await page.locator('#pc150 blockquote .quotelink[data-comment-id="1"]').hover();
    await expect(page.locator('#quote-preview')).toContainText('Comment 1');
    const context = await browser.newContext();
    try {
      const other = await context.newPage();
      const second = await fixture(
        other,
        250,
        false,
        comment,
        false,
        '',
        true,
        true,
        first.edgeCache
      );
      await bottom(other);
      await expect(other.locator('#pc150')).toBeAttached();
      await other.locator('#pc150 blockquote .quotelink[data-comment-id="1"]').hover();
      await expect(other.locator('#quote-preview')).toContainText('Comment 1');
      expect(second.originRequests).toHaveLength(0);
      expect(second.edgeHits.length).toBeGreaterThanOrEqual(4);
      for (const url of first.originRequests.filter((url) => !url.pathname.endsWith('/state'))) {
        expect(url.searchParams.get('epoch')).toBe('11111111-1111-4111-8111-111111111111');
        expect(url.searchParams.get('revision')).toBe('1');
      }
    } finally {
      await context.close();
    }
  });

  test('keeps cached bodies across reloads without another origin request', async ({ page }) => {
    const state = await fixture(page, 250, false, comment, false, '', true, true);
    const count = state.originRequests.length;
    await page.evaluate(() => window.commentFixture.commentStore().serial);
    await page.reload();
    await page.evaluate(() => window.commentFixture.COMMENT_READY);
    await expect(page.locator('#pc250')).toBeAttached();
    expect(state.originRequests).toHaveLength(count);
    expect(state.edgeHits.some((url) => url.pathname.endsWith('/state'))).toBe(true);
  });

  test('explicit refresh bypasses stale metadata and changes the cache key after additions and deletions', async ({
    page,
  }) => {
    const state = await fixture(page, 250, false, comment, false, '', true, true);
    await page.evaluate(() => window.commentFixture.getCachedComment(1));
    state.publish([{ ...comment(251), commentPlainTextSanitized: '&gt;&gt;1 new reply' }]);
    state.remove(250);
    await page.evaluate(() => window.commentFixture.updateComments());
    await expect(page.locator('#pc251')).toBeAttached();
    await expect(page.locator('#pc250')).toHaveCount(0);
    expect(await page.evaluate(() => window.commentFixture.commentStore().get(1))).toMatchObject({
      replyIds: [251, 150],
    });
    expect(
      state.originRequests.some(
        (url) => url.pathname.endsWith('/state') && url.searchParams.get('fresh') === '1'
      )
    ).toBe(true);
    expect(
      state.originRequests.some(
        (url) => url.pathname.endsWith('/cache') && Number(url.searchParams.get('revision')) > 1
      )
    ).toBe(true);
    await page.evaluate(() => window.commentFixture.commentStore().serial);
    // The old unpurged edge marker and old HTML must not roll this tab backwards.
    await page.reload();
    await page.evaluate(() => window.commentFixture.COMMENT_READY);
    await expect(page.locator('#pc251')).toBeAttached();
    await expect(page.locator('#pc250')).toHaveCount(0);
    await expect(page.locator('#comment-section-counter')).toHaveText('250');
  });

  test('expired metadata synchronizes deletions before serving an IndexedDB hover hit', async ({
    page,
  }) => {
    const state = await fixture(page, 250, false, comment, false, '', true, true);
    await page.evaluate(() => window.commentFixture.getCachedComment(1));
    state.remove(1);
    state.expireState();
    await page.evaluate(() => {
      (
        window.commentFixture as unknown as { COMMENT_STATE_CHECKED_AT: number }
      ).COMMENT_STATE_CHECKED_AT = 0;
    });
    const removed = await page.evaluate(async () => {
      try {
        await window.commentFixture.getCachedComment(1);
        return false;
      } catch {
        return true;
      }
    });
    expect(removed).toBe(true);
    expect(await page.evaluate(() => window.commentFixture.commentStore().get(1))).toBeUndefined();
    expect(state.originRequests.filter((url) => url.pathname.endsWith('/state'))).toHaveLength(2);
    await expect(page.locator('#comment-section-counter')).toHaveText('249');
  });

  test('a database replacement is discovered even through stale HTML and reused revisions', async ({
    page,
  }) => {
    const state = await fixture(page, 250, false, comment, false, '', true, true);
    state.replaceDatabase([{ ...comment(1), commentPlainTextSanitized: 'Replacement baseline' }]);
    await page.evaluate(() => window.commentFixture.updateComments());
    await expect(page.locator('#pc1')).toContainText('Replacement baseline');
    await expect(page.locator('#pc250')).toHaveCount(0);
    await page.evaluate(() => window.commentFixture.commentStore().serial);
    await page.reload();
    await page.evaluate(() => window.commentFixture.COMMENT_READY);
    await expect(page.locator('#pc1')).toContainText('Replacement baseline');
    await expect(page.locator('#comment-section-counter')).toHaveText('1');
  });

  test('CDN history, posting, contextual forms and distant quote navigation retain behavior', async ({
    page,
  }) => {
    await fixture(page, 250, false, comment, false, '', true, true);
    await bottom(page);
    await expect(page.locator('#pc150')).toBeAttached();
    await page.locator('#pc150 blockquote .quotelink[data-comment-id="1"]').click();
    await expect(page.locator('#p1')).toHaveClass(/highlight/);
    await page.mouse.move(1200, 700);
    await page
      .locator('#comments-container > #pc1 .postInfo.desktop .comment-quote-button')
      .click();
    const form = page.locator('#comment-input-form-dynamic-1');
    await expect(form).toBeVisible();
    await form.locator('button[type="submit"], input[type="submit"]').click();
    await expect(form).toHaveCount(0);
    await expect(page.locator('#pc251')).toBeAttached();
    await expect(page.locator('#p251')).toHaveClass(/new-comment-highlight/);
  });
});

test.describe('Cloudflare freshness edge cases', () => {
  test('the Age header prevents extending an almost expired edge marker by another 30 seconds', async ({
    page,
  }) => {
    const state = await fixture(page, 250, false, comment, false, '', true, true);
    await page.evaluate(() => window.commentFixture.commentStore().serial);
    state.edgeCache.get('http://comments.test/videos/fixture/comments/state')!.time =
      Date.now() - 29000;
    await page.reload();
    await page.evaluate(() => window.commentFixture.COMMENT_READY);
    expect(
      await page.evaluate(
        () =>
          Date.now() -
          (window.commentFixture as unknown as { COMMENT_STATE_CHECKED_AT: number })
            .COMMENT_STATE_CHECKED_AT
      )
    ).toBeGreaterThanOrEqual(29000);
    const count = state.originRequests.length;
    state.expireState();
    await page.evaluate(() => {
      (
        window.commentFixture as unknown as { COMMENT_STATE_CHECKED_AT: number }
      ).COMMENT_STATE_CHECKED_AT -= 2000;
    });
    await page.evaluate(() => window.commentFixture.getCachedComment(250));
    expect(state.originRequests).toHaveLength(count + 1);
    expect(state.originRequests.at(-1)!.pathname).toMatch(/\/state$/);
  });

  test('explicit refresh checks the origin even when a cached state check is already running', async ({
    page,
  }) => {
    const state = await fixture(page, 250, false, comment, false, '', true, true);
    let release!: () => void, arrived!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    let blocked = false;
    await page.route('**/videos/fixture/comments/state*', async (route) => {
      if (blocked || new URL(route.request().url()).searchParams.has('fresh')) {
        return route.fallback();
      }
      blocked = true;
      arrived();
      await gate;
      return route.fulfill({
        json: {
          isError: false,
          epoch: '11111111-1111-4111-8111-111111111111',
          version: 1,
          totalCount: 250,
        },
      });
    });
    const pending = page.evaluate(() =>
      (
        window.commentFixture as unknown as { syncCommentCache(fresh: boolean): Promise<unknown> }
      ).syncCommentCache(false)
    );
    await entered;
    state.publish([comment(251)]);
    await page.evaluate(() => window.commentFixture.updateComments());
    release();
    await pending;
    await expect(page.locator('#pc251')).toBeAttached();
    expect(
      state.originRequests.some(
        (url) => url.pathname.endsWith('/state') && url.searchParams.get('fresh') === '1'
      )
    ).toBe(true);
  });

  test('global reply pagination is shared by the CDN and retained in IndexedDB', async ({
    page,
    browser,
  }) => {
    const make = (id: number) => ({
      ...comment(id),
      commentPlainTextSanitized: id >= 201 ? '&gt;&gt;1 reply' : `Comment ${id}`,
    });
    const first = await fixture(page, 400, false, make, false, '', true, true);
    const readReplies = async (target: Page) =>
      target.evaluate(async () => {
        await window.commentFixture.getCachedComment(1);
        return (
          window.commentFixture as unknown as {
            getCachedReplyPage(id: number, before: number): Promise<{ replyIds: number[] }>;
          }
        ).getCachedReplyPage(1, 301);
      });
    expect((await readReplies(page)).replyIds).toEqual(
      Array.from({ length: 100 }, (_, i) => 300 - i)
    );
    const before = first.allRequests.length;
    await readReplies(page);
    expect(first.allRequests).toHaveLength(before);
    const context = await browser.newContext();
    try {
      const other = await context.newPage();
      const second = await fixture(other, 400, false, make, false, '', true, true, first.edgeCache);
      expect((await readReplies(other)).replyIds).toHaveLength(100);
      expect(second.originRequests).toHaveLength(0);
      expect(second.edgeHits.some((url) => url.pathname.endsWith('/replies'))).toBe(true);
    } finally {
      await context.close();
    }
  });

  test('CDN freshness and navigation still work when IndexedDB is unavailable', async ({
    page,
  }) => {
    await page.addInitScript(() =>
      Object.defineProperty(window, 'indexedDB', { value: undefined })
    );
    const state = await fixture(page, 250, false, comment, false, '', true, true);
    await bottom(page);
    await expect(page.locator('#pc150')).toBeAttached();
    await page.locator('#pc150 blockquote .quotelink[data-comment-id="1"]').hover();
    await expect(page.locator('#quote-preview')).toContainText('Comment 1');
    state.remove(1);
    await page.evaluate(() => window.commentFixture.updateComments());
    expect(await page.evaluate(() => window.commentFixture.commentStore().get(1))).toBeUndefined();
    await expect(page.locator('#comment-section-counter')).toHaveText('249');
  });
});

test('Cloudflare freshness also checks quote targets already present in the DOM', async ({
  page,
}) => {
  const make = (id: number) => ({
    ...comment(id),
    commentPlainTextSanitized: id === 20 ? '&gt;&gt;1 quote' : `Comment ${id}`,
  });
  const state = await fixture(page, 20, false, make, false, '', true, true);
  await expect(page.locator('#pc1')).toBeAttached();
  state.remove(1);
  state.expireState();
  await page.evaluate(() => {
    (
      window.commentFixture as unknown as { COMMENT_STATE_CHECKED_AT: number }
    ).COMMENT_STATE_CHECKED_AT = 0;
  });
  const link = page.locator('#pc20 blockquote .quotelink');
  await link.hover();
  await expect(link).toHaveClass(/deadlink/);
  await expect(page.locator('#comments-container > #pc1')).toHaveCount(0);
  await expect(page.locator('#quote-preview')).toHaveCount(0);
  await expect(page.locator('#comment-section-counter')).toHaveText('19');
});

test('Cloudflare freshness reconciles retained DOM comments before direct navigation', async ({
  page,
}) => {
  const state = await fixture(page, 20, false, comment, false, '', true, true);
  state.publish([
    { ...comment(1), commentPlainTextSanitized: 'Updated while retained in the DOM' },
  ]);
  state.expireState();
  await page.evaluate(() => {
    (
      window.commentFixture as unknown as { COMMENT_STATE_CHECKED_AT: number }
    ).COMMENT_STATE_CHECKED_AT = 0;
  });
  await page.evaluate(() => window.commentFixture.navigateToComment(1));
  await expect(page.locator('#p1')).toContainText('Updated while retained in the DOM');
  await expect(page.locator('#p1')).toHaveClass(/highlight/);
});

test.describe('nested quote reply semantics', () => {
  test('quoting a reply preserves nested navigation without adding an inherited backlink', async ({
    page,
  }) => {
    const make = (id: number) => ({
      ...comment(id),
      commentPlainTextSanitized:
        id === 12
          ? 'Original text'
          : id === 13
            ? '&gt;&gt;12\n&gt;Original text\nReply text'
            : id === 14
              ? '&gt;&gt;13\n&gt;&gt;&gt;12\n&gt;&gt;Original text\n&gt;Reply text\nNew reply'
              : `Comment ${id}`,
    });
    await fixture(page, 14, false, make, false, '', true);
    await expect(page.locator('#pc12 .backlink .quotelink[data-comment-id="13"]')).toBeAttached();
    await expect(page.locator('#pc12 .backlink .quotelink[data-comment-id="14"]')).toHaveCount(0);
    await expect(page.locator('#pc13 .backlink .quotelink[data-comment-id="14"]')).toBeAttached();
    const nested = page.locator('#pc14 blockquote .quotelink[data-comment-id="12"]');
    await expect(nested).toBeAttached();
    await expect(nested.locator('xpath=..')).toHaveClass('quote');
    await nested.hover();
    await expect(page.locator('#quote-preview')).toContainText('Original text');
    await nested.click();
    await expect(page.locator('#p12')).toHaveClass(/highlight/);
    await page.locator('#pc14 .postInfo.desktop .comment-quote-button').click();
    await expect(page.locator('#comment-input-form-dynamic-14 textarea')).toHaveValue(
      />>14\n> >>13\n> >>>12/
    );
    const ids = await page.evaluate(() => {
      const app = window.commentFixture as unknown as {
        extractReplyToCommentIds(text: string): number[];
      };
      return app.extractReplyToCommentIds('&gt;&gt;14\n&gt;&gt;&gt;13\n&gt;&gt;&gt;&gt;12');
    });
    expect(ids).toEqual([14]);
  });

  test('browser parsing distinguishes direct references from nested and quoted text consistently', async ({
    page,
  }) => {
    await fixture(page, 20, false, comment, false);
    const results = await page.evaluate(() => {
      const app = window.commentFixture as unknown as {
        extractReplyToCommentIds(text: string): number[];
        convertCommentToHTML(text: string): string;
      };
      const inputs = [
        '&gt;&gt;2\n&gt;&gt;&gt;1',
        '&gt;&gt;2\n&gt;quoted &gt;&gt;1',
        '&gt;&gt;2\n&gt;&gt;quoted &gt;&gt;1',
        'Text &gt;&gt;&gt;&gt;&gt;&gt;1 then &gt;&gt;2',
        '\u00a0&gt;&gt;&gt;1\r\n\u2003&gt;&gt;2',
        '&gt;&gt;1&gt;&gt;2 &gt;&gt;0002',
        '&gt;&gt;0 &gt;&gt;9007199254740992 &gt;&gt;2',
      ];
      return inputs.map((text) => ({
        ids: app.extractReplyToCommentIds(text),
        html: app.convertCommentToHTML(text),
      }));
    });
    expect(results.map((result) => result.ids)).toEqual([[2], [2], [2], [2], [2], [1, 2, 2], [2]]);
    for (const result of results.slice(0, 5)) {
      expect(result.html).toContain('data-comment-id="1"');
      expect(result.html).toContain('data-comment-id="2"');
    }
    expect(results[6]!.html).not.toContain('data-comment-id="0"');
    expect(results[6]!.html).not.toContain('data-comment-id="9007199254740992"');
  });
});

test('copying quotes repeatedly never turns quoted numbers into comment references', async ({
  page,
}) => {
  const make = (id: number) => ({
    ...comment(id),
    commentPlainTextSanitized:
      id === 14 ? '&gt;&gt;13\n&gt;&gt;&gt;12\n&gt;&gt;test1\n&gt;123\n1234' : `Comment ${id}`,
  });
  const state = await fixture(page, 14, false, make, false, '', true);
  let next = 15;
  await page.route('**/videos/fixture/comments/comment', async (route) => {
    const body = route.request().postDataJSON() as { commentPlainText: string };
    const row = {
      ...comment(next++),
      commentPlainTextSanitized: body.commentPlainText
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;'),
      replyIds: [],
      hasMoreReplies: false,
    };
    state.publish([row]);
    await route.fulfill({
      json: {
        isError: false,
        commentId: row.commentId,
        comment: row,
        comments: [row],
        totalCount: row.commentId,
      },
    });
  });
  for (const id of [14, 15, 16]) {
    await page
      .locator(`#comments-container > #pc${id} .postInfo.desktop .comment-quote-button`)
      .click();
    const form = page.locator(`#comment-input-form-dynamic-${id}`);
    const value = await form.locator('textarea').inputValue();
    expect(value.startsWith(`>>${id}\n> `)).toBe(true);
    expect(value).not.toMatch(/^>>123(?:\r?$)/m);
    if (id === 14) {
      expect(value).toBe('>>14\n> >>13\n> >>>12\n> >>test1\n> >123\n> 1234\n');
    }
    await form.locator('button[type="submit"]').click();
    await expect(form).toHaveCount(0);
    const posted = page.locator(`#comments-container > #pc${id + 1}`);
    await expect(posted).toBeAttached();
    await expect(posted.locator('blockquote .quotelink[data-comment-id="123"]')).toHaveCount(0);
    await expect(posted.locator('blockquote .quotelink[data-comment-id="13"]')).toHaveCount(1);
    await expect(posted.locator('blockquote .quotelink[data-comment-id="12"]')).toHaveCount(1);
    await expect(
      page.locator(
        `#comments-container > #pc${id} .backlink .quotelink[data-comment-id="${id + 1}"]`
      )
    ).toHaveCount(1);
    if (id > 14) {
      await expect(
        page.locator(
          `#comments-container > #pc14 .backlink .quotelink[data-comment-id="${id + 1}"]`
        )
      ).toHaveCount(0);
    }
  }
  expect(state.allRequests.some((url) => url.pathname === '/videos/fixture/comments/123')).toBe(
    false
  );
});
