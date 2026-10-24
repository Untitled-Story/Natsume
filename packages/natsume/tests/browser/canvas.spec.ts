import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import type { CanvasSample } from './canvas-fixture.js';
test('matches native Camera and World Canvas pixels and replaces display environment atomically', async ({
  page,
}) => {
  const path = new URL(
    '../../../../data/unity-baselines/fixtures/unity-canvas.json',
    import.meta.url,
  );
  test.skip(!existsSync(path), 'Local native measurements are not distributed');
  const native = JSON.parse(readFileSync(path, 'utf8'));
  await page.goto('/');
  const measured = await page.evaluate(
    async ({ path, native }) => (await import('/@fs' + path)).measureCanvas(native),
    { path: new URL('./canvas-fixture.ts', import.meta.url).pathname, native },
  );
  const stats: Record<string, { max: number; coverage: number }> = {};
  for (const c of native.cases as CanvasSample[]) {
    if (c.mode === 0 || (c.mode === 2 && !c.orthographic)) continue;
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
    new URL('../../../../data/canvas-pixel-errors.json', import.meta.url),
    JSON.stringify(
      {
        stats,
        samples: native.cases
          .filter((c: CanvasSample) => measured.results[c.label])
          .map((c: CanvasSample) => ({
            label: c.label,
            native: c.pixels.slice(24760, 24764),
            actual: measured.results[c.label].slice(24760, 24764),
          })),
      },
      null,
      2,
    ),
  );
  expect(measured.error).toBe(0);
  expect(measured.atomic).toBe(true);
  expect(measured.overlay).toBe(true);
  for (const [label, s] of Object.entries(stats)) {
    expect(s.coverage, label + ' edge pixels').toBeLessThanOrEqual(2);
    expect(s.max, label + ' pixels').toBeLessThanOrEqual(1);
  }
});

test('accepts missing sorting ranks from the host and replaces them atomically per instance', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(
    async (path) => (await import('/@fs' + path)).measureSortingLayers(),
    new URL('./canvas-fixture.ts', import.meta.url).pathname,
  );
  expect(result).toEqual({
    missing: false,
    rejected: true,
    initial: [0, 0, 255, 255],
    isolated: [255, 0, 0, 255],
    changed: [255, 0, 0, 255],
    atomic: true,
    valid: true,
  });
});
