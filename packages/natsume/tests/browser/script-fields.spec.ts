import { test, expect } from '@playwright/test';

test('declares Bridge animation fields with isolation, restart and guarded callbacks', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(
    async (path) => (await import('/@fs' + path)).verifyScriptFields(),
    new URL('./script-fields-fixture.ts', import.meta.url).pathname,
  );
  expect(result).toEqual({
    compatible: true,
    sideEffects: 0,
    independent: true,
    coalesced: true,
    restarted: true,
    recursion: true,
    isolated: true,
    destroyed: true,
  });
});

test('imports explicit preview declarations without running source game logic', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(
    async (path) => (await import('/@fs' + path)).verifyPreviewBridgeDeclaration(),
    new URL('./script-fields-fixture.ts', import.meta.url).pathname,
  );
  expect(result).toEqual({
    malformed: true,
    compatible: true,
    mode: 1,
    declared: true,
    guarded: true,
  });
});
