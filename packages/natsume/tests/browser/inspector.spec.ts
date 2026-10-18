import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';

const sample = fileURLToPath(new URL('../../../../data/kirakira.noap', import.meta.url));

test('opens local files in a single preview and console, replaces scenes and clears logs', async ({
  page,
}) => {
  test.skip(!existsSync(sample), 'Local Noa sample is not distributed');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#play')).toBeDisabled();
  await expect(page.locator('#console-panel')).toBeHidden();
  const previewBox = await page.locator('#viewport').boundingBox();
  const controlsBox = await page.locator('.controls').boundingBox();
  expect(previewBox!.y).toBe(0);
  expect(previewBox!.height).toBe(page.viewportSize()!.height);
  expect(controlsBox!.y + controlsBox!.height).toBe(page.viewportSize()!.height);
  await expect(page.locator('#status')).toBeEmpty();
  await page.locator('#file').setInputFiles(sample);
  await expect(page.locator('#status')).toHaveText('预览就绪');
  await expect(page.locator('#pack-name')).toHaveText('kirakira.noap');
  await expect(page.locator('#console')).toContainText('17 个节点 · 4 个资产');
  await expect(page.locator('#console')).toContainText('NOISE');
  await page.locator('#pause').click();
  await expect(page.locator('#console')).toContainText('暂停');
  await page.locator('#toggle-console').click();
  await expect(page.locator('#console-panel')).toBeVisible();
  const openControls = await page.locator('.controls').boundingBox();
  expect(openControls).toEqual(controlsBox);
  await page.locator('#clear-console').click();
  await expect(page.locator('#console')).toBeEmpty();
  await page.locator('#file').setInputFiles(sample);
  await expect(page.locator('#status')).toHaveText('预览就绪');
  const state = await page.evaluate(async () => {
    const path = '/src/preview.ts';
    const { getPreview } = await import(path);
    const { app, effect } = getPreview();
    return { children: app.stage.children.length, state: effect.state };
  });
  expect(state).toEqual({ children: 1, state: 'playing' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#file')).toBeVisible();
  expect(
    await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    })),
  ).toEqual({ width: 390, height: 844 });
  const buttonRows = await page
    .locator('.controls button, .file-button')
    .evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().top));
  expect(new Set(buttonRows).size).toBe(1);
  const mobilePreview = await page.locator('#viewport').boundingBox();
  expect(mobilePreview).toEqual({ x: 0, y: 0, width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/preview-mobile.png', fullPage: true });
  await page.locator('#file').setInputFiles({
    name: 'broken.noap',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('not a package'),
  });
  await expect(page.locator('#console')).toContainText('Truncated ZIP');
  await expect(page.locator('#console-panel')).toBeVisible();
  await expect(page.locator('#play')).toBeDisabled();
  expect(errors).toEqual([]);
});

test('reports malformed local input in the console', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file').setInputFiles({
    name: 'broken.noap',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('not a package'),
  });
  await expect(page.locator('#console .error')).toContainText('Truncated ZIP');
  await expect(page.locator('#status')).toHaveText('无法预览，请查看控制台');
  await expect(page.locator('#play')).toBeDisabled();
});

test('provides editable world gravity in the preview host', async ({ page }) => {
  test.skip(!existsSync(sample), 'Local Noa sample is not distributed');
  await page.goto('/');
  await expect(page.locator('#gravity-y')).toBeDisabled();
  await page.locator('#file').setInputFiles(sample);
  await expect(page.locator('#status')).toHaveText('预览就绪');
  await page.locator('#pause').click();
  await page.locator('#gravity-y').fill('3');
  await page.locator('#gravity-y').press('Tab');
  await expect(page.locator('#console')).toContainText('世界重力 (0, 3, 0)');
  const currentGravity = () =>
    page.evaluate(async () => {
      const path = '/src/preview.ts';
      const { effect } = (await import(path)).getPreview();
      return [...effect.simulation.emitters.values()].map((e: { gravity: number[] }) =>
        Array.from(e.gravity),
      );
    });
  expect(
    (await currentGravity()).every((g: number[]) => g[0] === 0 && g[1] === 3 && g[2] === 0),
  ).toBe(true);
  await page.locator('#gravity-y').fill('');
  await page.locator('#gravity-y').press('Tab');
  await expect(page.locator('#gravity-y')).toHaveValue('3');
  await expect(page.locator('#console')).toContainText('重力 Y 必须是有限数字');
  expect((await currentGravity()).every((g: number[]) => g[1] === 3)).toBe(true);
  await page.locator('#file').setInputFiles(sample);
  await expect(page.locator('#status')).toHaveText('预览就绪');
  expect((await currentGravity()).every((g: number[]) => g[1] === 3)).toBe(true);
});

test('previews a package that requires host gravity', async ({ page }) => {
  const local = new URL('../../../../data/minori.noap', import.meta.url);
  test.skip(!existsSync(local), 'Local Noa sample is not distributed');
  await page.goto('/');
  await page.locator('#file').setInputFiles(fileURLToPath(local));
  await expect(page.locator('#status')).toHaveText('预览就绪');
  const result = await page.evaluate(async () => {
    const path = '/src/preview.ts';
    const { app, effect } = (await import(path)).getPreview();
    app.ticker.stop();
    effect.restart();
    for (let i = 0; i < 60; i++) effect.update(1 / 60);
    app.render();
    return { particles: effect.particleCount, glError: app.renderer.gl.getError() };
  });
  expect(result.particles).toBeGreaterThan(0);
  expect(result.glError).toBe(0);
});
