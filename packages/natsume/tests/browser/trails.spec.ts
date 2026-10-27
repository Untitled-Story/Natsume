import { test, expect } from '@playwright/test';

test('renders dynamic trail strips, retained tails and replay without stale GPU geometry', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  const result = await page.evaluate(
    async (path) => (await import('/@fs' + path)).measureTrailRendering(),
    new URL('./trail-render-fixture.ts', import.meta.url).pathname,
  );
  expect(errors).toEqual([]);
  expect(result.empty).toBe(0);
  expect(result.alive).toBeGreaterThan(25);
  expect(result.repeat).toBe(result.alive);
  expect(result.reused).toBe(true);
  expect(result.residual).toBeGreaterThan(0);
  expect(result.expired).toBe(0);
  expect(result.replay).toBeGreaterThan(0);
  expect(result.cleared).toBe(0);
  expect(result.points).toBe(0);
  expect(result.glError).toBe(0);
  expect(result.capacity).toBe(256);
  expect(result.capacityReused).toBe(true);
  expect(result.geometryReused).toBe(true);
  expect(result.frames.map((f: { draws: number }) => f.draws)).toEqual([0, 1, 1, 1, 0, 1, 0]);
  expect(result.frames[2]!.uploads).toBe(2);
  expect(result.frames[2]!.bytes).toBe(13_312);
});
