import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import type { MaskSample } from './ui-mask-fixture.js';
test('matches native nested UI stencil, soft clipping and CanvasGroup state', async ({ page }) => {
  const path = new URL(
    '../../../../data/unity-baselines/fixtures/unity-ui-masks.json',
    import.meta.url,
  );
  test.skip(!existsSync(path), 'Local native measurements are not distributed');
  const native = JSON.parse(readFileSync(path, 'utf8'));
  const image = JSON.parse(
    readFileSync(
      new URL('../../../../data/unity-baselines/fixtures/unity-images.json', import.meta.url),
      'utf8',
    ),
  );
  await page.goto('/');
  const measured = await page.evaluate(
    async ({ path, native, image }) => (await import('/@fs' + path)).measureUIMasks(native, image),
    { path: new URL('./ui-mask-fixture.ts', import.meta.url).pathname, native, image },
  );

  const stats: Record<string, { max: number; coverage: number }> = {};
  for (const c of native.cases as MaskSample[]) {
    const pixels: number[] = measured.results[c.label];
    let max = 0,
      coverage = 0;
    pixels.forEach((p, i) => {
      max = Math.max(max, Math.abs(p - c.pixels[i]!));
      if (i % 4 === 3 && (p === 0) !== (c.pixels[i] === 0)) coverage++;
    });
    stats[c.label] = { max, coverage };
  }
  writeFileSync(
    new URL('../../../../data/ui-mask-pixel-errors.json', import.meta.url),
    JSON.stringify(stats, null, 2),
  );
  expect(measured.error).toBe(0);
  expect(measured.steady?.draws).toBe(5);
  expect(measured.steady?.uploads).toBe(0);
  for (const [label, p] of Object.entries(measured.hostResults) as [string, number[]][]) {
    const original: number[] = measured.results[label];
    let differences = 0;
    for (let y = 0; y < 96; y++)
      for (let x = 0; x < 128; x++)
        for (let ch = 0; ch < 4; ch++) {
          const i = (y * 128 + x) * 4 + ch,
            sibling = x >= 112 && x < 120 && y >= 8 && y < 16;
          const expected = sibling ? (ch === 0 || ch === 3 ? 255 : 0) : x < 64 ? original[i]! : 0;
          differences += Number(p[i] !== expected);
        }
    expect(differences, label + ' host pixels').toBe(0);
  }
  for (const [label, s] of Object.entries(stats)) {
    expect(s.coverage, label + ' coverage').toBe(0);
    expect(s.max, label + ' pixels').toBeLessThanOrEqual(2);
  }
});
