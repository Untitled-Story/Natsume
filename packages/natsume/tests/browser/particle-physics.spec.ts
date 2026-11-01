import { test, expect } from '@playwright/test';

test('isolates collision callbacks, rejects recursion and cancels stale contacts', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(
    async (path) => (await import('/@fs' + path)).checkCollisionEvents(),
    new URL('./particle-physics-fixture.ts', import.meta.url).pathname,
  );
  expect(result).toMatchObject({
    recursive: true,
    unsubscribed: true,
    late: 0,
    stopped: true,
    disposed: true,
  });
  expect(result.events).toHaveLength(1);
  expect(result.events[0]).toMatchObject({
    systemId: 5,
    particleId: 0,
    planeNodeId: 1,
    normal: [0, 1, 0],
  });
  expect(result.diagnostics).toContain('PARTICLE_COLLISION_EVENT_ERROR');
});
