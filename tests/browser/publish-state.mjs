import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from '@playwright/test';

// Exercise the shipped view, jQuery, SweetAlert, and progress plugin without a live Node.
const view = fs.readFileSync('public/views/videos.ejs', 'utf8');
let script = view
  .match(/<script>\s*([\s\S]*?)<\/script>/)[1]
  .replace('<%- JSON.stringify(model) %>', '{}');
script = script.slice(0, script.indexOf('const moarTubeClientVideos ='));
let browser;
before(async () => {
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
});

async function check(run) {
  const page = await browser.newPage();
  try {
    await page.setContent('<!doctype html><html><body></body></html>');
    for (const file of [
      'jquery-3.6.4.min.js',
      'sweetalert-11.0.11.min.js',
      'circle-progress-1.2.2.min.js',
    ]) {
      await page.addScriptTag({ content: fs.readFileSync('public/javascript/' + file, 'utf8') });
    }
    await page.addScriptTag({
      content:
        script +
        `
      window.videos = Object.create(MoarTubeClientVideos.prototype);
      window.requests = [];
      $.ajax = (options) => {
        const deferred = $.Deferred();
        requests.push({ options, deferred });
        return deferred.promise();
      };
      window.WebSocket = class { constructor() { window.socket = this; } };
      videos.connectWebsocket();
      window.emit = (type, format = 'mp4', progress = 0, stage) => socket.onmessage({ data: JSON.stringify({
        eventName: 'video_status', payload: { type, videoId: 'video123', format, resolution: '720p', progress, stage }
      }) });
      window.snapshot = (publishingJobs = [], publishes = []) => ({ isError: false, publishes, publishingJobs });
      window.latestSnapshot = () => requests.filter(r => r.options.url.endsWith('/publishes')).at(-1);
      window.input = (format = 'mp4') => document.getElementById('video123_' + format + '_720p_publish_checkbox');
      window.circle = () => document.getElementById('video123_mp4_720p_publish_progress_circle');
    `,
    });
    await run(page);
  } finally {
    await page.close();
  }
}

for (const modal of ['Publish', 'Manage']) {
  test(`${modal} shows stages at zero percent and restores the current stage from snapshots`, async () => {
    await check(async (page) => {
      await page.clock.install();
      const result = await page.evaluate((modal) => {
        if (modal === 'Publish') videos.showPublishWizardModal('video123');
        else videos.showManageImportModal('video123');
        latestSnapshot().deferred.resolve(
          snapshot([{ format: 'mp4', resolution: '720p', progress: 0, stage: 'encoding' }])
        );
        const root = document.getElementById(
          modal === 'Publish' ? 'publish-modal-table' : 'manage-modal-published-tab-pane'
        );
        const labels = [root.querySelector('.publish-stage').textContent];
        for (const [stage, progress] of [
          ['uploading', 50],
          ['finalizing', 99],
          ['retrying', 0],
          ['queued', 0],
        ]) {
          emit('publishing', 'mp4', progress, stage);
          labels.push(root.querySelector('.publish-stage').textContent);
        }
        const count = root.querySelectorAll('.publish-stage').length;
        emit('publishing', 'mp4', 100, 'complete');
        return {
          labels,
          count,
          completed:
            modal === 'Publish' ? circle()?.textContent === '100%' : !!input() && !input().disabled,
          remainingLabel: root.querySelector('.publish-stage')?.textContent || '',
        };
      }, modal);
      assert.deepEqual(result, {
        labels: ['Encoding', 'Uploading', 'Finalizing', 'Retrying', 'Queued'],
        count: 1,
        completed: true,
        remainingLabel: modal === 'Publish' ? 'Complete' : '',
      });
      await page.clock.runFor(2000);
      assert.equal(await page.evaluate(() => !!input() && !input().disabled), true);
    });
  });
}

test('Manage restores queued switches for every format and clears stale published state', async () => {
  await check(async (page) => {
    const result = await page.evaluate(() => {
      videos.showManageImportModal('video123');
      const formats = ['m3u8', 'mp4', 'webm', 'ogv'];
      latestSnapshot().deferred.resolve(
        snapshot(formats.map((format) => ({ format, resolution: '720p', progress: 0 })))
      );
      const queued = formats.map((format) => ({
        checked: input(format).checked,
        disabled: input(format).disabled,
      }));
      emit('publishing', 'mp4', 27);
      const progress = document.getElementById('video123_mp4_720p').getAttribute('aria-valuenow');
      videos.refreshPublishingState(
        'video123',
        document.getElementById('manage-modal-published-tab-pane')
      );
      latestSnapshot().deferred.resolve(
        snapshot([], [{ format: 'mp4', resolution: '720p', isPublished: true }])
      );
      const published = { checked: input().checked, disabled: input().disabled };
      videos.refreshPublishingState(
        'video123',
        document.getElementById('manage-modal-published-tab-pane')
      );
      latestSnapshot().deferred.resolve(snapshot());
      return {
        queued,
        progress,
        published,
        cleared: { checked: input().checked, disabled: input().disabled },
      };
    });
    assert.deepEqual(result, {
      queued: Array(4).fill({ checked: true, disabled: true }),
      progress: '27',
      published: { checked: true, disabled: false },
      cleared: { checked: false, disabled: false },
    });
  });
});

test('confirmed completion followed by a retry stays queued without stale timers', async () => {
  await check(async (page) => {
    await page.clock.install();
    await page.evaluate(() => {
      videos.showPublishWizardModal('video123');
      latestSnapshot().deferred.resolve(snapshot());
      emit('publishing', 'mp4', 99);
    });
    assert.equal(await page.evaluate(() => !!circle() && !input()), true);
    await page.evaluate(() => {
      emit('publishing', 'mp4', 100);
    });
    assert.equal(
      await page.evaluate(() => !!circle() && !input() && circle().textContent === '100%'),
      true
    );
    await page.evaluate(() => {
      emit('publishing', 'mp4', 0);
    });
    await page.clock.fastForward(3000);
    assert.equal(
      await page.evaluate(() => !!circle() && !input() && circle().textContent === '0%'),
      true
    );
  });
});

test('Publish holds 100% for two seconds even when the published snapshot arrives', async () => {
  await check(async (page) => {
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 1000));
    await page.evaluate(() => {
      videos.showPublishWizardModal('video123');
      latestSnapshot().deferred.resolve(snapshot());
      emit('publishing', 'mp4', 99, 'finalizing');
      emit('publishing', 'mp4', 100, 'complete');
      emit('published');
      latestSnapshot().deferred.resolve(
        snapshot([], [{ format: 'mp4', resolution: '720p', isPublished: true }])
      );
    });
    assert.deepEqual(
      await page.evaluate(() => ({
        text: circle().textContent,
        value: $(circle()).circleProgress('value'),
      })),
      { text: '100%', value: 1 }
    );
    await page.clock.runFor(1999);
    assert.equal(await page.evaluate(() => !!circle() && !input()), true);
    await page.clock.runFor(1);
    assert.equal(
      await page.evaluate(
        () => !circle() && input().classList.contains('form-check-input-is-published')
      ),
      true
    );
  });
});

test('a completion timer from a closed modal cannot change a new publish attempt', async () => {
  await check(async (page) => {
    await page.clock.install();
    await page.evaluate(() => {
      videos.showPublishWizardModal('video123');
      latestSnapshot().deferred.resolve(snapshot());
      emit('publishing', 'mp4', 100, 'complete');
      Swal.close();
      videos.showPublishWizardModal('video123');
      latestSnapshot().deferred.resolve(
        snapshot([{ format: 'mp4', resolution: '720p', progress: 12, stage: 'encoding' }])
      );
    });
    await page.clock.runFor(3000);
    assert.equal(
      await page.evaluate(() => !!circle() && !input() && circle().textContent === '12%'),
      true
    );
  });
});

test('cancellation restores Publish and Manage controls, preserving previously published outputs', async () => {
  await check(async (page) => {
    const result = await page.evaluate(() => {
      videos.showPublishWizardModal('video123');
      latestSnapshot().deferred.resolve(snapshot());
      emit('publishing', 'mp4', 27);
      emit('publishing_stopped');
      latestSnapshot().deferred.resolve(snapshot());
      const publish = { circle: !!circle(), disabled: input().disabled, checked: input().checked };
      videos.showManageImportModal('video123');
      latestSnapshot().deferred.resolve(
        snapshot(
          [{ format: 'mp4', resolution: '720p', progress: 0 }],
          [{ format: 'mp4', resolution: '720p', isPublished: true }]
        )
      );
      emit('publishing_stopped');
      latestSnapshot().deferred.resolve(
        snapshot([], [{ format: 'mp4', resolution: '720p', isPublished: true }])
      );
      return {
        publish,
        manage: {
          checked: input().checked,
          disabled: input().disabled,
          progress: document.getElementById('video123_mp4_720p').getAttribute('aria-valuenow'),
        },
      };
    });
    assert.deepEqual(result, {
      publish: { circle: false, disabled: false, checked: false },
      manage: { checked: true, disabled: false, progress: '0' },
    });
  });
});

test('submitting another output preserves existing progress text and ring', async () => {
  await check(async (page) => {
    await page.evaluate(() => {
      videos.showPublishWizardModal('video123');
      latestSnapshot().deferred.resolve(snapshot());
      emit('publishing', 'mp4', 32);
      input('webm').checked = true;
      Swal.clickConfirm();
    });
    const result = await page.evaluate(() => ({
      text: circle().textContent,
      value: $(circle()).circleProgress('value'),
      submitted: JSON.parse(
        requests.find((r) => r.options.type === 'POST').options.data.publishings
      ),
    }));
    assert.deepEqual(result, {
      text: '32%',
      value: 0.32,
      submitted: [{ format: 'webm', resolution: '720p' }],
    });
  });
});

test('delayed snapshots cannot overwrite newer progress or cancellation', async () => {
  await check(async (page) => {
    const result = await page.evaluate(() => {
      videos.showPublishWizardModal('video123');
      const initial = latestSnapshot();
      emit('publishing', 'mp4', 32);
      initial.deferred.resolve(snapshot([{ format: 'mp4', resolution: '720p', progress: 0 }]));
      const progress = circle().textContent;
      videos.refreshPublishingState('video123', document.getElementById('publish-modal-table'));
      const stale = latestSnapshot();
      emit('publishing_stopped');
      latestSnapshot().deferred.resolve(snapshot());
      stale.deferred.resolve(snapshot([{ format: 'mp4', resolution: '720p', progress: 32 }]));
      return { progress, stopped: !!input() && !input().disabled && !circle() };
    });
    assert.deepEqual(result, { progress: '32%', stopped: true });
  });
});

test('responses from a closed modal cannot change its replacement', async () => {
  await check(async (page) => {
    const result = await page.evaluate(() => {
      videos.showPublishWizardModal('video123');
      const old = latestSnapshot();
      videos.showPublishWizardModal('video123');
      latestSnapshot().deferred.resolve(
        snapshot([{ format: 'mp4', resolution: '720p', progress: 45 }])
      );
      old.deferred.resolve(snapshot());
      return { text: circle().textContent, checkbox: !!input() };
    });
    assert.deepEqual(result, { text: '45%', checkbox: false });
  });
});

test('background refresh preserves selections that have not been submitted', async () => {
  await check(async (page) => {
    const result = await page.evaluate(() => {
      videos.showPublishWizardModal('video123');
      latestSnapshot().deferred.resolve(snapshot());
      input().checked = true;
      emit('published', 'webm');
      latestSnapshot().deferred.resolve(snapshot());
      const selected = input().checked;
      socket.onopen();
      latestSnapshot().deferred.resolve(snapshot());
      return { selected, afterReconnect: input().checked, disabled: input().disabled };
    });
    assert.deepEqual(result, { selected: true, afterReconnect: true, disabled: false });
  });
});

test('Manage switch handlers work before metadata finishes loading', async () => {
  await check(async (page) => {
    const result = await page.evaluate(() => {
      videos.showManageImportModal('video123');
      latestSnapshot().deferred.resolve(snapshot());
      input().click();
      const publish = requests.find((r) => r.options.type === 'POST');
      const pending = { checked: input().checked, disabled: input().disabled };
      videos.refreshPublishingState(
        'video123',
        document.getElementById('manage-modal-published-tab-pane')
      );
      latestSnapshot().deferred.resolve(snapshot());
      const duringSnapshot = { checked: input().checked, disabled: input().disabled };
      publish.deferred.resolve({ isError: false });
      latestSnapshot().deferred.resolve(
        snapshot([{ format: 'mp4', resolution: '720p', progress: 0 }])
      );
      return {
        url: publish.options.url,
        pending,
        duringSnapshot,
        queued: { checked: input().checked, disabled: input().disabled },
      };
    });
    assert.deepEqual(result, {
      url: '/videos/video123/publish',
      pending: { checked: true, disabled: true },
      duringSnapshot: { checked: true, disabled: true },
      queued: { checked: true, disabled: true },
    });
  });
});

test('pending and completed unpublish actions survive delayed snapshots', async () => {
  await check(async (page) => {
    const result = await page.evaluate(() => {
      videos.showManageImportModal('video123');
      const published = [{ format: 'mp4', resolution: '720p', isPublished: true }];
      latestSnapshot().deferred.resolve(snapshot([], published));
      input().click();
      const unpublish = requests.find((r) => r.options.url.endsWith('/unpublish'));
      const root = document.getElementById('manage-modal-published-tab-pane');
      videos.refreshPublishingState('video123', root);
      latestSnapshot().deferred.resolve(snapshot([], published));
      const pending = { checked: input().checked, disabled: input().disabled };
      videos.refreshPublishingState('video123', root);
      const stale = latestSnapshot();
      unpublish.deferred.resolve({ isError: false });
      latestSnapshot().deferred.resolve(snapshot());
      stale.deferred.resolve(snapshot([], published));
      return { pending, completed: { checked: input().checked, disabled: input().disabled } };
    });
    assert.deepEqual(result, {
      pending: { checked: false, disabled: true },
      completed: { checked: false, disabled: false },
    });
  });
});
