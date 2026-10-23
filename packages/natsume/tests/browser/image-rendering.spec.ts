import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import type { ImageSample } from './image-render-fixture.js';
const path = new URL(
  '../../../../data/unity-baselines/fixtures/unity-images.json',
  import.meta.url,
);
test('matches native Image geometry, fill origins, border sizing and premultiplied pixels', async ({
  page,
}) => {
  test.skip(!existsSync(path), 'Local native measurements are not distributed');
  const native = JSON.parse(readFileSync(path, 'utf8'));
  await page.goto('/');
  const measured = await page.evaluate(
    async ({ path, native }) => (await import('/@fs' + path)).measureImages(native),
    { path: new URL('./image-render-fixture.ts', import.meta.url).pathname, native },
  );
  const stats: Record<string, { coverage: number; max: number }> = {};
  for (const c of native.cases as ImageSample[]) {
    const pixels: number[] = measured.results[c.label];
    let max = 0,
      coverage = 0;
    pixels.forEach((p, i) => {
      const alpha = i - (i % 4) + 3;
      if (pixels[alpha]! > 0 && c.pixels[alpha]! > 0)
        max = Math.max(max, Math.abs(p - c.pixels[i]!));
      if (i % 4 === 3 && (p === 0) !== (c.pixels[i] === 0)) coverage++;
    });
    stats[c.label] = { max, coverage };
  }
  writeFileSync(
    new URL('../../../../data/image-pixel-errors.json', import.meta.url),
    JSON.stringify(stats, null, 2),
  );
  expect(measured.error).toBe(0);
  for (const [label, s] of Object.entries(stats)) {
    expect(s.coverage, label + ' edge pixels').toBeLessThanOrEqual(2);
    expect(s.max, label + ' pixels').toBeLessThanOrEqual(2);
  }
});
