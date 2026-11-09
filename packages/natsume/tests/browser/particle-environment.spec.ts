import { expect, test } from '@playwright/test';

test('shares all environment checks across preflight, creation and atomic replacement', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(
    async (path) => (await import('/@fs' + path)).verifyEnvironmentValidation(),
    new URL('./particle-environment-fixture.ts', import.meta.url).pathname,
  );
  expect(result).toEqual({ rejected: Array(9).fill(true), replaced: true });
});
