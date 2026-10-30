import { test, expect } from '@playwright/test';

test('exposes isolated controller handles, layer queries, restart and disposed guards', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(
    async (path) => (await import('/@fs' + path)).verifyAnimatorControllers(),
    new URL('./animator-controller-fixture.ts', import.meta.url).pathname,
  );
  expect(result).toEqual({
    compatible: true,
    independent: true,
    empty: true,
    replayed: true,
    reset: true,
    disposed: true,
    arrived: true,
  });
});
