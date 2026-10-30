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

test('pairs Bridge control callbacks when the first receiver stops playback', async ({ page }) => {
  await page.goto('/');
  const calls = await page.evaluate(
    async (path) => (await import('/@fs' + path)).verifyControlCancellation(),
    new URL('./timeline-fixture.ts', import.meta.url).pathname,
  );
  expect(calls).toEqual(['first:start', 'first:stop']);
});

test('drives disabled ITimeControl receivers without ordinary lifecycle updates', async ({
  page,
}) => {
  await page.goto('/');
  const calls = await page.evaluate(
    async (path) => (await import('/@fs' + path)).verifyDisabledControlReceiver(),
    new URL('./timeline-fixture.ts', import.meta.url).pathname,
  );
  expect(calls).toEqual(['start', 'sample', 'stop']);
});
