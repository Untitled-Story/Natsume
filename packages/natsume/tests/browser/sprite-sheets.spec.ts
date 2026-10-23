import { existsSync, readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
const path = new URL(
  '../../../../data/unity-baselines/fixtures/unity-sprite-sheets.json',
  import.meta.url,
);
test('matches native sprite sheet frame boundaries and first-frame geometric scale', async ({
  page,
}) => {
  test.skip(!existsSync(path), 'Local native measurements are not distributed');
  const native = JSON.parse(readFileSync(path, 'utf8')) as {
    cases: {
      age: number;
      vertices: { x: number; y: number; z: number }[];
      uv: { x: number; y: number }[];
    }[];
  };
  await page.goto('/');
  const measured = await page.evaluate(
    async ({ path, ages }) => (await import('/@fs' + path)).measureSpriteSheets(ages),
    {
      path: new URL('./sprite-sheet-fixture.ts', import.meta.url).pathname,
      ages: native.cases.map((c) => c.age),
    },
  );
  expect(measured.pixels[0]).toEqual([64, 0, 128, 192]);
  expect(measured.pixels[1]).toEqual([128, 0, 64, 192]);
  native.cases.forEach((c, i) =>
    c.vertices.forEach((p, j) => {
      for (const axis of ['x', 'y', 'z'] as const)
        expect(measured.result[i]![j]![axis]).toBeCloseTo(p[axis], 5);
      expect(measured.result[i]![j]!.u).toBeCloseTo(c.uv[j]!.x, 5);
      expect(measured.result[i]![j]!.v).toBeCloseTo(c.uv[j]!.y, 5);
    }),
  );
});
