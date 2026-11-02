import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { recordError } from '../measurement.js';
test('matches native Canvas camera assignment and layer filtering', async ({ page }) => {
  test.skip(
    !existsSync(
      new URL('../../../../data/unity-baselines/fixtures/unity-cameras.json', import.meta.url),
    ),
    'Local Unity measurements are absent',
  );
  const native = JSON.parse(
    readFileSync(
      new URL('../../../../data/unity-baselines/fixtures/unity-cameras.json', import.meta.url),
      'utf8',
    ),
  ) as {
    canvasPixels: {
      mode: number;
      observer: number;
      masked: boolean;
      enabled: boolean;
      pixel: number[];
    }[];
  };
  await page.goto('/');
  const result = await page.evaluate(
    async ({ path, cases }) => (await import('/@fs' + path)).measureNativeCameraCanvases(cases),
    {
      path: new URL('./authored-camera-fixture.ts', import.meta.url).pathname,
      cases: native.canvasPixels,
    },
  );
  for (const [i, c] of native.canvasPixels.entries())
    expect(result[i], JSON.stringify(c)).toEqual(c.pixel);
});
test('integrates source camera animation, camera Canvas, restart and display resizing', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(
    async (path) => (await import('/@fs' + path)).measureCameraCanvas(),
    new URL('./authored-camera-fixture.ts', import.meta.url).pathname,
  );
  expect(result.initial).toEqual([255, 255, 0, 255]);
  expect(result.inactive).toEqual([0, 0, 0, 0]);
  expect(result.endpoint).toEqual([0, 0, 0, 0]);
  expect(result.active).toEqual([255, 255, 0, 255]);
  expect(result.layout).toEqual({ width: 64, height: 48 });
  expect(result.resized).toEqual({ width: 128, height: 48 });
  expect(result.animatedSize).toBeCloseTo(2.5);
  expect(result.restarted).toBe(2);
  expect(result.original).toBe(2);
});
test('executes authored camera clear, depth, order, viewport, display and lifecycle', async ({
  page,
}) => {
  test.skip(
    !existsSync(
      new URL('../../../../data/unity-baselines/fixtures/unity-cameras.json', import.meta.url),
    ),
    'Local Unity measurements are absent',
  );
  await page.goto('/');
  const cases = await page.evaluate(
    async (path) => (await import('/@fs' + path)).measureAuthoredCameras(),
    new URL('./authored-camera-fixture.ts', import.meta.url).pathname,
  );
  const native = JSON.parse(
    readFileSync(
      new URL('../../../../data/unity-baselines/fixtures/unity-cameras.json', import.meta.url),
      'utf8',
    ),
  ) as { pixels: { clear: number; reverse: boolean; linear: boolean; pixels: number[] }[] };
  for (const c of cases) {
    const center = c.reverse || c.clear === 3 ? [255, 0, 0, 255] : [0, 0, 255, 255];
    expect(c.pixels.center, JSON.stringify(c)).toEqual(center);
    expect(c.otherDisplay.center).toEqual([0, 0, 0, 0]);
    expect(c.restored).toEqual(c.pixels);
    expect(c.restarted).toEqual(c.pixels);
    if (c.sourceColorSpace === 'gamma')
      expect(c.pixels.corner).toEqual(
        !c.reverse && !c.partial && c.clear < 2 ? [0, 128, 0, 255] : [0, 255, 0, 255],
      );
    if (!c.partial) {
      const expected = native.pixels.find(
        (p) =>
          p.clear === c.clear &&
          p.reverse === c.reverse &&
          p.linear === (c.sourceColorSpace === 'linear'),
      )!.pixels;
      const error = Math.max(
        ...c.pixels.raw.map((value: number, i: number) => Math.abs(value - expected[i]!)),
      );
      recordError('camera.pixels', error, 'byte', `${c.clear}/${c.reverse}`);
      expect(error, JSON.stringify({ clear: c.clear, reverse: c.reverse })).toBeLessThanOrEqual(1);
    }
  }
});
