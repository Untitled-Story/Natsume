import { expect, test } from '@playwright/test';

test('merges environment patches atomically and returns independent copies', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(
    async (path) => (await import('/@fs' + path)).verifyEnvironmentUpdates(),
    new URL('./environment-update-fixture.ts', import.meta.url).pathname,
  );
  expect(result).toEqual({
    kept: true,
    updated: true,
    removed: true,
    rejected: 2,
    independent: true,
    preserved: true,
    render: { globalMipBias: 0, sortingLayers: { 7: 2 } },
    canvas: { width: 200, height: 50 },
    camera: null,
  });
});
