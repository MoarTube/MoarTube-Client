import { test } from './node-fixtures.js';
import { expect, uniqueName, clientResponse, expectSuccess } from './fixtures.js';

for (const [kind, form, input] of [
  ['name', '#personalize_settings_node_name_form', '#node-name-input'],
  ['about', '#personalize_settings_node_about_form', '#node-about-textarea'],
] as const) {
  test(`edits node ${kind} through the Client and restores the previous value`, async ({
    signedInPage: page,
    viewerPage: viewer,
  }) => {
    await page.goto('/settings');
    const previous = await page.locator(input).inputValue();
    const value = uniqueName(kind);
    try {
      await page.locator(input).fill(value);
      const response = clientResponse(page, `/settings/node/personalize/${kind}`);
      await page.locator(form).getByRole('button', { name: /save/i }).click();
      await expectSuccess(response);
      await page.reload();
      await expect(page.locator(input)).toHaveValue(value);
      await viewer.goto('/');
      await expect(viewer.locator(kind === 'name' ? '#node-name' : '#node-about')).toHaveText(
        value
      );
    } finally {
      await page.goto('/settings');
      await page.locator(input).fill(previous);
      const response = clientResponse(page, `/settings/node/personalize/${kind}`);
      await page.locator(form).getByRole('button', { name: /save/i }).click();
      await expectSuccess(response);
    }
  });
}

for (const [feature, selector] of [
  ['comments', '#comments-checkbox'],
  ['likes', '#likes-checkbox'],
  ['dislikes', '#dislikes-checkbox'],
  ['reports', '#reports-checkbox'],
  ['liveChat', '#live-chat-checkbox'],
] as const) {
  test(`toggles ${feature} through the Client and restores the original setting`, async ({
    signedInPage: page,
  }) => {
    await page.goto('/settings');
    const original = await page.locator(selector).isChecked();
    try {
      const response = clientResponse(page, `/settings/node/${feature}/toggle`);
      await page.locator(selector).setChecked(!original);
      await expectSuccess(response);
      await page.reload();
      await expect(page.locator(selector)).toBeChecked({ checked: !original });
    } finally {
      await page.goto('/settings');
      if ((await page.locator(selector).isChecked()) !== original) {
        const response = clientResponse(page, `/settings/node/${feature}/toggle`);
        await page.locator(selector).setChecked(original);
        await expectSuccess(response);
      }
    }
  });
}

for (const [kind, format] of [
  ['video', 'hls'],
  ['video', 'mp4'],
  ['video', 'webm'],
  ['video', 'ogv'],
  ['live', 'hls'],
] as const) {
  test(`opens ${kind} ${format} encoding settings with the real configuration`, async ({
    signedInPage: page,
  }) => {
    await page.goto('/settings');
    await page.locator(`#show-${kind}-encoding-btn`).click();
    await page.locator(`.encoding-settings[data-format="${format}"]`).click();
    await expect(page.locator(`input[id="240p-bitrate-range-${format}"]`)).toBeVisible();
    await expect(page.locator(`input[id="framerate-range-${format}"]`)).toBeEnabled();
    expect(
      Number(await page.locator(`input[id="framerate-range-${format}"]`).inputValue())
    ).toBeGreaterThan(0);
  });
}

test('GPU selector displays the Client actual device selection', async ({ signedInPage: page }) => {
  await page.goto('/settings');
  const select = page.getByRole('combobox', { name: 'GPU acceleration' });
  await expect(select).toBeVisible();
  await expect(select.locator('option')).not.toHaveCount(0);
});
