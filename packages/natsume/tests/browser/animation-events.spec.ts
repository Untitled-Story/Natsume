import { test, expect } from '@playwright/test';

test('keeps message errors isolated under throw policy and completes all destruction callbacks', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(
    async (path) => (await import('/@fs' + path)).verifyThrowingScriptLifecycle(),
    new URL('./animation-events-fixture.ts', import.meta.url).pathname,
  );
  expect(result).toEqual({
    eventIsolated: true,
    updateThrown: true,
    destroyThrown: true,
    destroyed: [1, 2],
    disposed: true,
  });
});

test('dispatches animation messages with cancellation, error isolation and receiver diagnostics', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(
    async (path) => (await import('/@fs' + path)).verifyAnimationEvents(),
    new URL('./animation-events-fixture.ts', import.meta.url).pathname,
  );
  expect(result).toEqual({
    bridgeCount: 2,
    bridgeHandled: true,
    messages: ['event-0', 'event-1'],
    missing: true,
    isolated: true,
    recursion: true,
    batch: ['event-0', 'event-1', 'event-2'],
    destroyed: true,
    later: 0,
  });
});
