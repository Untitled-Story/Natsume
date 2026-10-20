import { recordError } from '../measurement.js';
import { existsSync, readFileSync } from 'node:fs';
import type { NativeLegacyCase } from './legacy-render-fixture.js';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';

test('previews the Noa hologram package with legacy materials and prewarm', async ({ page }) => {
  const sample = new URL('../../../../data/hologram.noap', import.meta.url);
  test.skip(!existsSync(sample), 'Local Noa package is not distributed');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.locator('#file').setInputFiles(fileURLToPath(sample));
  await expect(page.locator('#status')).toHaveText('预览就绪');
  // The prefab's authored layers are hundreds of units apart; inspect one emitter.
  await page.locator('#focus').selectOption('14');
  const result = await page.evaluate(async () => {
    const path = '/src/preview.ts';
    const { app, effect } = (await import(path)).getPreview();
    app.ticker.stop();
    effect.restart();
    const initial = effect.particleCount;
    for (let i = 0; i < 180; i++) effect.update(1 / 60);
    effect.pause();
    const time = effect.time;
    effect.setParticleEnvironment({ fog: { mode: 'none' }, depth: 3 });
    let invalidEnvironmentRejected = false;
    try {
      effect.setParticleEnvironment({ fog: { mode: 'none' }, depth: NaN });
    } catch {
      invalidEnvironmentRejected = true;
    }
    app.render();
    const gl = app.renderer.gl;
    const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
    gl.readPixels(
      0,
      0,
      gl.drawingBufferWidth,
      gl.drawingBufferHeight,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixels,
    );
    return {
      initial,
      invalidEnvironmentRejected,
      pausedTimeUnchanged: effect.time === time,
      count: effect.particleCount,
      meshes: effect.container.children.length,
      nonzero: pixels.some((v: number, i: number) => i % 4 !== 3 && v > 32),
      glError: app.renderer.gl.getError(),
    };
  });
  expect(result.invalidEnvironmentRejected).toBe(true);
  expect(result.pausedTimeUnchanged).toBe(true);
  expect(result.initial).toBeGreaterThan(0);
  expect(result.count).toBeGreaterThan(0);
  expect(result.meshes).toBe(13);
  expect(result.nonzero).toBe(true);
  expect(result.glError).toBe(0);
  expect(errors).toEqual([]);
});

test('renders legacy blending, three fog modes, zIndex fallback and soft particle boundaries', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(
    async (path) => (await import('/@fs' + path)).measureLegacyMaterials(),
    new URL('./legacy-render-fixture.ts', import.meta.url).pathname,
  );
  const expected: Record<string, number[]> = {
    alpha: [128, 0, 128, 255],
    additive: [128, 0, 255, 255],
    'soft-quarter': [32, 0, 223, 255],
    'soft-occluded': [0, 0, 255, 255],
    'soft-full': [128, 0, 128, 255],
    'fog-fallback': [64, 64, 128, 255],
    'fog-additive': [64, 0, 255, 255],
    'fog-exp': [64, 64, 128, 255],
    'fog-exp2': [64, 64, 128, 255],
    'soft-affine-depth': [32, 0, 223, 255],
  };
  for (const [key, pixel] of Object.entries(expected)) {
    pixel.forEach((v, i) =>
      recordError(
        'material.' + (key.startsWith('fog') ? 'fog' : key.startsWith('soft') ? 'soft' : 'blend'),
        result.results[key][i] - v,
        '8-bit channel',
        key + '/' + i,
        'analytic',
      ),
    );
    pixel.forEach((v, i) =>
      expect(Math.abs(result.results[key][i] - v), key + ' channel ' + i).toBeLessThanOrEqual(2),
    );
    [0, 128, 128, 255].forEach((v, i) =>
      expect(
        Math.abs(result.results[key + '-sibling'][i] - v),
        key + ' sibling',
      ).toBeLessThanOrEqual(2),
    );
  }
  for (const [label, expected] of Object.entries({
    'animated-initial': [128, 0, 128, 255],
    'animated-end': [0, 0, 128, 255],
    'animated-disabled': [0, 0, 255, 255],
  }))
    expected.forEach((value, i) => {
      recordError(
        'animation.material.pixel',
        result.results[label][i] - value,
        '8-bit channel',
        `${label}/${i}`,
        'analytic',
      );
      expect(Math.abs(result.results[label][i] - value), `${label}/${i}`).toBeLessThanOrEqual(2);
    });
  expect(result.borrowedAlive).toBe(true);
  expect(result.glError).toBe(0);
});

test('matches native legacy fog and depth-writing scene pixels', async ({ page }) => {
  const fixture = new URL(
    '../../../../data/unity-baselines/fixtures/unity-meshes.json',
    import.meta.url,
  );
  test.skip(!existsSync(fixture), 'Local native measurements are absent');
  const cases = (JSON.parse(readFileSync(fixture, 'utf8')) as { legacyCases?: NativeLegacyCase[] })
    .legacyCases;
  test.skip(!cases, 'Native legacy pixels have not been measured');
  await page.goto('/');
  const result = await page.evaluate(
    async ({ path, cases }) => (await import('/@fs' + path)).measureLegacyMaterials(cases),
    {
      path: new URL('./legacy-render-fixture.ts', import.meta.url).pathname,
      cases,
    },
  );
  for (const sample of cases!)
    for (let channel = 0; channel < 3; channel++) {
      const error = result.results[sample.label][channel] - sample.pixels[channel]!;
      recordError(
        'material.native.' + (sample.fog === 'none' ? 'soft' : 'fog'),
        error,
        '8-bit channel',
        sample.label + '/' + channel,
      );
      expect(Math.abs(error), sample.label + '/' + channel).toBeLessThanOrEqual(2);
    }
  expect(result.glError).toBe(0);
});
