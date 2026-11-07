import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect as browserExpect } from '@playwright/test';
import ejs from 'ejs';
import { expect, it } from 'vitest';

it('shows local and S3 metrics, refreshes, and isolates node failures at desktop and mobile sizes', async () => {
  const template = await readFile('public/views/settings.ejs', 'utf8');
  const html = ejs.render(template.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''), {
    model: { clientSettings: { isGpuAccelerationSupported: false } },
  });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  let s3 = false;
  let failed = false;
  let memoryFailed = false;
  let cpuFailed = false;
  let cpuPercent = 12.5;
  let cpuAppUnavailable = false;
  let gpuPercent = 40;
  let gpuFailed = false;
  let gpuAppUnavailable = false;
  let bytes = 1610612736;
  let pendingDisk: Promise<void> | undefined;
  await page.route('http://moartube.test/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/settings/metrics') {
      await pendingDisk;
      const targetMetrics = (node: boolean) => ({
        cpu: { isError: cpuFailed && node, metrics: { usedPercent: node ? 87.5 : cpuPercent, appPercent: cpuAppUnavailable ? null : (node ? 25 : 5) } },
        memory: { isError: memoryFailed && node, metrics: { appBytes: (node ? 3 : 2) * 1024 ** 3, availableBytes: 4 * 1024 ** 3, totalBytes: 16 * 1024 ** 3 } },
        disk: { isError: failed && node, metrics: s3 && node
          ? { storageMode: 's3provider', mediaBytes: null, availableBytes: null, totalBytes: null }
          : { storageMode: 'filesystem', mediaBytes: node ? 1024 : bytes, availableBytes: 1073741824, totalBytes: 10737418240 } },
      });
      await route.fulfill({ json: { isError: false, metrics: {
        client: { ...targetMetrics(false), gpu: { isError: gpuFailed, metrics: { encodePercent: gpuPercent, decodePercent: gpuPercent / 10, memoryUsedBytes: gpuPercent > 0 ? 2 * 1024 ** 3 : 0, memoryTotalBytes: gpuPercent > 0 ? 16 * 1024 ** 3 : 0, appEncodePercent: gpuAppUnavailable ? null : gpuPercent * 0.75, appDecodePercent: gpuAppUnavailable ? null : gpuPercent / 20, appMemoryBytes: gpuAppUnavailable ? null : (gpuPercent > 0 ? 512 * 1024 ** 2 : 0) } } },
        node: targetMetrics(true),
      } } });
      return;
    }
    if (pathname === '/') {
      await route.fulfill({ contentType: 'text/html', body: html });
      return;
    }
    try {
      await route.fulfill({ path: path.join(process.cwd(), 'public', pathname) });
    } catch {
      await route.fulfill({ status: 404, body: '' });
    }
  });
  const loadMetrics = async (): Promise<void> => {
    await page.addScriptTag({ path: 'public/javascript/jquery-3.6.4.min.js' });
    await page.addScriptTag({ path: 'public/javascript/settings-metrics.js' });
    await page.evaluate('new MoarTubeStorageMetrics().start()');
  };
  try {
    await page.goto('http://moartube.test/');
    await loadMetrics();
    const interval = page.getByLabel('Refresh every');
    await browserExpect(interval).toHaveValue('2');
    await browserExpect(interval.locator('option')).toHaveText(
      Array.from({ length: 10 }, (_, index) => `${index + 1} ${index === 0 ? 'second' : 'seconds'}`)
    );
    const headingBox = await page.locator('#metrics-heading').boundingBox();
    const intervalBox = await interval.boundingBox();
    expect(intervalBox!.x).toBeGreaterThan(headingBox!.x + headingBox!.width);
    await browserExpect(page.locator('#metrics-client-media')).toHaveText('1.5 GiB');
    await browserExpect(page.locator('#metrics-client-cpu-used')).toHaveText('12.5%');
    await browserExpect(page.locator('#metrics-node-cpu-used')).toHaveText('87.5%');
    for (const [field, value, percent, app] of [['encode', '40%', 40, 30], ['decode', '4%', 4, 2], ['memory', '2 GiB / 16 GiB', 12.5, 3.125]] as const) {
      await browserExpect(page.locator(`#metrics-client-gpu-${field}-used`)).toHaveText(value);
      await browserExpect(page.locator(`#metrics-client-gpu-${field}-capacity`)).toHaveAttribute('aria-valuenow', String(percent));
      const gpuTrack = await page.locator(`#metrics-client-gpu-${field}-capacity`).boundingBox();
      const gpuBar = await page.locator(`#metrics-client-gpu-${field}-usage-bar`).boundingBox();
      const otherBox = await page.locator(`#metrics-client-gpu-${field}-occupied .metrics-other-usage`).boundingBox();
      expect(gpuBar!.width / gpuTrack!.width).toBeCloseTo(app / 100, 2);
      expect(otherBox!.width / gpuTrack!.width).toBeCloseTo((percent - app) / 100, 2);
    }
    const cpuRow = await page.locator('#metrics-client-cpu').boundingBox();
    const gpuRow = await page.locator('#metrics-client-gpu').boundingBox();
    const diskRow = await page.locator('#metrics-client-local').boundingBox();
    expect(gpuRow!.y).toBeGreaterThanOrEqual(cpuRow!.y + cpuRow!.height);
    expect(diskRow!.y).toBeGreaterThanOrEqual(gpuRow!.y + gpuRow!.height);
    for (const [target, percent, app] of [['client', 12.5, 5], ['node', 87.5, 25]] as const) {
      const cpuTrack = page.locator(`#metrics-${target}-cpu-capacity`);
      await browserExpect(cpuTrack).toBeVisible();
      await browserExpect(cpuTrack).toHaveAttribute('aria-valuenow', String(percent));
      const cpuTrackBox = await cpuTrack.boundingBox();
      const cpuBarBox = await page.locator(`#metrics-${target}-cpu-usage-bar`).boundingBox();
      const otherBox = await page.locator(`#metrics-${target}-cpu-occupied .metrics-other-usage`).boundingBox();
      expect(cpuBarBox!.width / cpuTrackBox!.width).toBeCloseTo(app / 100, 2);
      expect(otherBox!.width / cpuTrackBox!.width).toBeCloseTo((percent - app) / 100, 2);
      await browserExpect(cpuTrack).toHaveAttribute('title', `System: ${percent}%; MoarTube ${target}: ${app}%`);
    }
    expect(await page.locator('#metrics-node-media').textContent()).toBe('1 KiB');
    expect(await page.locator('#metrics-client-capacity').getAttribute('aria-valuenow')).toBe('90');
    expect(await page.locator('#metrics-client-occupied').getAttribute('style')).toContain('90%');
    const track = await page.locator('#metrics-client-capacity').boundingBox();
    const other = await page.locator('#metrics-client-occupied .metrics-other-usage').boundingBox();
    const media = await page.locator('#metrics-client-usage-bar').boundingBox();
    expect((other?.width ?? 0) / (track?.width ?? 1)).toBeCloseTo(0.75, 2);
    expect((media?.width ?? 0) / (track?.width ?? 1)).toBeCloseTo(0.15, 2);
    expect(media?.x).toBeCloseTo((other?.x ?? 0) + (other?.width ?? 0), 1);
    expect(await page.locator('#metrics-node-capacity').isVisible()).toBe(true);
    expect(
      (await page.locator('#metrics-node-usage-bar').boundingBox())?.width
    ).toBeGreaterThanOrEqual(3);
    await browserExpect(page.locator('#metrics-client-memory-app')).toHaveText('2 GiB');
    await browserExpect(page.locator('#metrics-node-memory-app')).toHaveText('3 GiB');
    expect(
      await page.locator('#metrics-client-memory-capacity').getAttribute('aria-valuenow')
    ).toBe('75');
    const ramTrack = await page.locator('#metrics-client-memory-capacity').boundingBox();
    const ramOther = await page
      .locator('#metrics-client-memory-occupied .metrics-other-usage')
      .boundingBox();
    const ramApp = await page.locator('#metrics-client-memory-usage-bar').boundingBox();
    expect((ramOther?.width ?? 0) / (ramTrack?.width ?? 1)).toBeCloseTo(0.625, 2);
    expect((ramApp?.width ?? 0) / (ramTrack?.width ?? 1)).toBeCloseTo(0.125, 2);
    // Hold a refresh open so a temporary loading message cannot escape the layout check.
    await browserExpect(page.locator('#metrics-node')).toHaveAttribute('aria-busy', 'false');
    await browserExpect(page.locator('#metrics-node-memory')).toHaveAttribute('aria-busy', 'false');
    const metricsBox = await page.locator('#metrics-container').boundingBox();
    let finishDisk = () => {};
    pendingDisk = new Promise<void>((resolve) => { finishDisk = resolve; });
    bytes = 2 * 1024 ** 3;
    cpuPercent = 25;
    gpuPercent = 0;
    const refreshing = page.waitForRequest('**/settings/metrics');
    await interval.selectOption('1');
    await refreshing;
    await browserExpect(page.locator('#metrics-client')).toHaveAttribute('aria-busy', 'true');
    await browserExpect(page.locator('#metrics-client-status')).toBeHidden();
    expect(await page.locator('#metrics-container').boundingBox()).toEqual(metricsBox);
    finishDisk();
    pendingDisk = undefined;
    await browserExpect(page.locator('#metrics-client-media')).toHaveText('2 GiB');
    await browserExpect(page.locator('#metrics-client-cpu-used')).toHaveText('25%');
    for (const field of ['encode', 'decode', 'memory']) {
      await browserExpect(page.locator(`#metrics-client-gpu-${field}-used`)).toHaveText(field === 'memory' ? '0 B / 0 B' : '0%');
      await browserExpect(page.locator(`#metrics-client-gpu-${field}-capacity`)).toHaveAttribute('aria-valuenow', '0');
      expect((await page.locator(`#metrics-client-gpu-${field}-usage-bar`).boundingBox())!.width).toBe(0);
    }
    await browserExpect(page.locator('#metrics-client-cpu-capacity')).toHaveAttribute('aria-valuenow', '25');
    const refreshedCpuTrack = await page.locator('#metrics-client-cpu-capacity').boundingBox();
    const refreshedCpuBar = await page.locator('#metrics-client-cpu-usage-bar').boundingBox();
    expect(refreshedCpuBar!.width / refreshedCpuTrack!.width).toBeCloseTo(0.05, 2);
    expect(await page.locator('#metrics-container').boundingBox()).toEqual(metricsBox);
    await interval.selectOption('10');
    bytes = 0;
    s3 = true;
    await page.reload();
    await loadMetrics();
    await browserExpect(page.locator('#metrics-client-media')).toHaveText('0 B');
    expect(await page.locator('#metrics-node-local').isVisible()).toBe(true);
    for (const field of ['media', 'available', 'total']) {
      await browserExpect(page.locator('#metrics-node-' + field)).toHaveText('∞');
    }
    await browserExpect(page.locator('#metrics-node-memory-app')).toHaveText('3 GiB');
    expect(await page.locator('#metrics-client-capacity').getAttribute('aria-valuenow')).toBe('90');
    expect(await page.locator('#metrics-node-capacity').isVisible()).toBe(true);
    expect(await page.locator('#metrics-node-capacity').getAttribute('aria-valuenow')).toBeNull();
    expect(await page.locator('#metrics-node-usage-bar').getAttribute('style')).toContain('0%');
    for (const width of [1280, 600]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate<boolean>('document.documentElement.scrollWidth <= window.innerWidth')
      ).toBe(true);
    }
    s3 = false;
    failed = true;
    await page.reload();
    await loadMetrics();
    await browserExpect(page.locator('#metrics-node-status')).toContainText('Unable to load');
    expect(await page.locator('#metrics-client-media').textContent()).toBe('0 B');
    expect(await page.locator('#metrics-node-capacity').isVisible()).toBe(false);
    await browserExpect(page.locator('#metrics-node-memory-app')).toHaveText('3 GiB');
    failed = false;
    memoryFailed = true;
    cpuFailed = true;
    gpuFailed = true;
    await page.reload();
    await loadMetrics();
    await browserExpect(page.locator('#metrics-node-memory-status')).toContainText(
      'Unable to load RAM'
    );
    await browserExpect(page.locator('#metrics-node-media')).toHaveText('1 KiB');
    await browserExpect(page.locator('#metrics-client-memory-app')).toHaveText('2 GiB');
    await browserExpect(page.locator('#metrics-node-cpu-used')).toHaveText('Unavailable');
    for (const field of ['encode', 'decode', 'memory']) {
      await browserExpect(page.locator(`#metrics-client-gpu-${field}-used`)).toHaveText('Unavailable');
      await browserExpect(page.locator(`#metrics-client-gpu-${field}-capacity`)).toBeHidden();
    }
    await browserExpect(page.locator('#metrics-node-cpu-capacity')).toBeHidden();
    expect(await page.locator('#metrics-node-cpu-capacity').getAttribute('aria-valuenow')).toBeNull();
    await browserExpect(page.locator('#metrics-client-cpu-used')).toHaveText('25%');
    expect(await page.locator('#metrics-node-memory-capacity').isVisible()).toBe(false);
    cpuFailed = false;
    cpuAppUnavailable = true;
    gpuFailed = false;
    gpuPercent = 40;
    gpuAppUnavailable = true;
    await page.reload();
    await loadMetrics();
    for (const [target, percent] of [['client', 25], ['node', 87.5]] as const) {
      await browserExpect(page.locator(`#metrics-${target}-cpu-used`)).toHaveText(`${percent}%`);
      await browserExpect(page.locator(`#metrics-${target}-cpu-capacity`)).toHaveAttribute('title', `System: ${percent}%; MoarTube ${target}: unavailable`);
      expect((await page.locator(`#metrics-${target}-cpu-usage-bar`).boundingBox())!.width).toBe(0);
    }
    for (const field of ['encode', 'decode', 'memory']) {
      const track = page.locator(`#metrics-client-gpu-${field}-capacity`);
      await browserExpect(track).toBeVisible();
      await browserExpect(track).toHaveAttribute('title', /MoarTube client: unavailable/);
      expect((await page.locator(`#metrics-client-gpu-${field}-usage-bar`).boundingBox())!.width).toBe(0);
    }
  } finally {
    await browser.close();
  }
}, 20000);
