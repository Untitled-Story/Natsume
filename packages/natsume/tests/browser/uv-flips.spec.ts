import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import type { FlipNative } from './uv-flip-fixture.js';
import { recordError } from '../measurement.js';
test('matches native UV flip endpoints, atlas bounds, channel masks and distributions', async ({
  page,
}) => {
  test.skip(
    !existsSync(
      new URL('../../../../data/unity-baselines/fixtures/unity-uv-flips.json', import.meta.url),
    ),
    'Local Unity measurements are absent',
  );
  const native = JSON.parse(
    readFileSync(
      new URL('../../../../data/unity-baselines/fixtures/unity-uv-flips.json', import.meta.url),
      'utf8',
    ),
  ) as FlipNative;
  await page.goto('/');
  const actual = await page.evaluate(
    async ({ path, native }) => (await import('/@fs' + path)).measureUVFlips(native),
    { path: new URL('./uv-flip-fixture.ts', import.meta.url).pathname, native },
  );
  for (const [index, c] of native.cases.entries()) {
    const a = actual[index]!;
    expect(a.stable).toBe(true);
    expect(a.stride).toBe(16);
    if (c.count === 4) {
      const order = (a: { x: number; y: number }, b: { x: number; y: number }) =>
        a.y - b.y || a.x - b.x;
      const expected = c.vertices
        .map((v, i) => ({ ...v, u: c.uv[i]!.x, v: c.uv[i]!.y }))
        .sort(order);
      const measured = a.vertices.sort(order);
      for (let i = 0; i < 4; i++)
        for (const field of ['x', 'y', 'z', 'u', 'v'] as const)
          expect(measured[i]![field], JSON.stringify({ ...c, field })).toBeCloseTo(
            expected[i]![field],
            6,
          );
    } else
      for (const key of ['flippedU', 'flippedV', 'flippedBoth'] as const) {
        recordError(
          'texture-sheet.flip-frequency',
          Math.abs(a[key] - c[key]) / c.count,
          'fraction',
          `${index}/${key}`,
        );
        expect(Math.abs(a[key] - c[key]) / c.count, JSON.stringify(c) + '/' + key).toBeLessThan(
          0.025,
        );
      }
  }
});
