import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { recordError } from '../measurement.js';

const sample = new URL('../../../../data/scene-mesh.noap', import.meta.url);
const baseline = new URL(
  '../../../../data/unity-baselines/fixtures/unity-scene-materials.json',
  import.meta.url,
);
test('matches native ordinary mesh slots, source pass states and instance lifecycle', async ({
  page,
}) => {
  test.skip(
    !existsSync(sample) || !existsSync(baseline),
    'Local Unity measurements are not distributed',
  );
  const native = JSON.parse(readFileSync(baseline, 'utf8'));
  // Unity Color.yellow differs from RGB yellow; compare the actual source texels.
  const source = native.generatedMips[0];
  expect([source.width, source.height]).toEqual([8, 8]);
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++)
      expect(source.pixels.slice((y * 8 + x) * 4, (y * 8 + x + 1) * 4)).toEqual(
        y < 4
          ? x < 4
            ? [255, 0, 0, 255]
            : [0, 255, 0, 255]
          : x < 4
            ? [0, 0, 255, 255]
            : [255, 255, 0, 255],
      );
  await page.goto('/');
  const measured = await page.evaluate(
    async ({ path, bytes, cases, states, layers }) =>
      (await import('/@fs' + path)).measureSceneMaterials(bytes, cases, states, layers),
    {
      path: new URL('./scene-render-fixture.ts', import.meta.url).pathname,
      bytes: Array.from(readFileSync(sample)),
      cases: native.cases,
      states: native.states,
      layers: native.layers,
    },
  );
  writeFileSync(
    new URL('../../../../data/scene-material-browser.json', import.meta.url),
    JSON.stringify(measured, null, 2),
  );
  for (const c of [...native.cases, ...native.states, ...native.layers])
    for (let i = 0; i < c.pixels.length; i++) {
      const difference = measured.results[c.label][i] - c.pixels[i];
      recordError('material.scene', difference, '8-bit channel', c.label + '/' + i, 'unity');
      expect(Math.abs(difference), c.label + '/' + i).toBeLessThanOrEqual(2);
    }
  expect(measured.lifecycle).toEqual({ compatible: true, meshes: 2, nodes: 1, glError: 0 });
});

test('previews ordinary meshes and isolates animated material/enabled state', async ({ page }) => {
  test.skip(!existsSync(sample), 'Local exported geometry is not distributed');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.locator('#file').setInputFiles(sample.pathname);
  await expect(page.locator('#status')).toHaveText('预览就绪');
  const result = await page.evaluate(
    async ({ path, bytes }) => (await import('/@fs' + path)).exerciseSceneAnimation(bytes),
    {
      path: new URL('./scene-render-fixture.ts', import.meta.url).pathname,
      bytes: Array.from(readFileSync(sample)),
    },
  );
  expect(result).toEqual({
    isolated: true,
    hidden: true,
    restored: true,
    sourceUnchanged: true,
    invalidEnvironmentRejected: true,
    released: true,
  });
  expect(errors).toEqual([]);
});
