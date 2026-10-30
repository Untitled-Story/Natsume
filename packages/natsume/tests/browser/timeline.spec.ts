import { test, expect } from '@playwright/test';

test('isolates Director graphs and retains guarded handles across restart', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(
    async (path) => (await import('/@fs' + path)).verifyDirectors(),
    new URL('./timeline-fixture.ts', import.meta.url).pathname,
  );
  expect(result).toEqual({
    live: true,
    isolated: true,
    rebound: true,
    retained: true,
    disposed: true,
  });
});
