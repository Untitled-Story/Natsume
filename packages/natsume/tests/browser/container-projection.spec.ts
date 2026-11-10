import { expect, test } from '@playwright/test';

test('projects world points and node origins through the display matrix', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(
    async (path) => (await import('/@fs' + path)).verifyContainerProjection(),
    new URL('./container-projection-fixture.ts', import.meta.url).pathname,
  );
  expect(result).toEqual({
    before: { point: { x: 3, y: -4 }, child: { x: 2, y: -3 } },
    after: {
      point: { x: 16, y: 12 },
      child: { x: 14, y: 14 },
      root: { x: 10, y: 20 },
    },
    withOffset: { x: 14, y: 14 },
    rejected: 3,
  });
});
