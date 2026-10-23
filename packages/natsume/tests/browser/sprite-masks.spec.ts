import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import type { SpriteMaskSample } from './sprite-mask-fixture.js';
test('matches native Sprite Mask union, alpha thresholds and sorting range endpoints', async ({
  page,
}) => {
  const path = new URL(
    '../../../../data/unity-baselines/fixtures/unity-sprite-masks.json',
    import.meta.url,
  );
  test.skip(!existsSync(path), 'Local native measurements are not distributed');
  const native = JSON.parse(readFileSync(path, 'utf8'));
  await page.goto('/');
  const measured = await page.evaluate(
    async ({ path, native }) => (await import('/@fs' + path)).measureSpriteMasks(native),
    { path: new URL('./sprite-mask-fixture.ts', import.meta.url).pathname, native },
  );
  const stats: Record<string, { max: number; coverage: number }> = {};
  for (const c of native.cases as SpriteMaskSample[]) {
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
    new URL('../../../../data/sprite-mask-pixel-errors.json', import.meta.url),
    JSON.stringify(stats, null, 2),
  );
  expect(measured.error).toBe(0);
  for (const [label, actual] of Object.entries(measured.hostResults) as [string, number[]][]) {
    const original: number[] = measured.results[label];
    expect(actual.every((v, i) => v === (Math.floor(i / 4) % 32 < 16 ? original[i] : 0))).toBe(
      true,
    );
  }
  for (const [label, actual] of Object.entries(measured.offsetResults) as [string, number[]][]) {
    const original: number[] = measured.results[label];
    expect(actual.every((v, i) => v === (Math.floor(i / 4) % 32 >= 4 ? original[i - 16] : 0))).toBe(
      true,
    );
  }
  for (const [label, s] of Object.entries(stats)) {
    expect(s.coverage, label + ' coverage').toBe(0);
    expect(s.max, label + ' pixels').toBeLessThanOrEqual(1);
  }
});
