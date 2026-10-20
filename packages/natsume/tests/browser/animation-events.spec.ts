import { existsSync } from 'node:fs';
import { test, expect } from '@playwright/test';

test('dispatches animation messages with cancellation, error isolation and receiver diagnostics', async ({
  page,
}) => {
  const sample = new URL('../../../../data/kirakira.noap', import.meta.url).pathname;
  test.skip(!existsSync(sample), 'Local sample is absent');
  await page.goto('/');
  await page.locator('#file').setInputFiles(sample);
  await expect(page.locator('#status')).toHaveText('预览就绪');
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
