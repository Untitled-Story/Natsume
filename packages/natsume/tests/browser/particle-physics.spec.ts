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

test('preserves Trigger query slots and cancels queued events when a callback pauses', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(
    async (path) => (await import('/@fs' + path)).checkTriggerEvents(),
    new URL('./particle-physics-fixture.ts', import.meta.url).pathname,
  );
  expect(result).toMatchObject({
    recursive: true,
    paused: true,
    unsubscribed: true,
    disposed: true,
  });
  expect(result.events.map((event: { kind: string }) => event.kind)).toEqual(['inside', 'inside']);
  expect(result.events[0].colliders).toEqual([
    { slot: 1, colliderId: 'sphere' },
    { slot: 3, colliderId: 'sphere' },
  ]);
  expect(result.pausedAt).toBeCloseTo(1 / 60);
  expect(result.resumedAt).toBeCloseTo(2 / 60);
  expect(result.diagnostics).toContain('PARTICLE_TRIGGER_EVENT_ERROR');
});

test('owns particle-light handles across replacement, stop, restart and disposal', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(
    async (path) => (await import('/@fs' + path)).checkParticleLightLifecycle(),
    new URL('./particle-physics-fixture.ts', import.meta.url).pathname,
  );
  expect(result).toMatchObject({
    blocked: true,
    first: { created: 1, destroyed: 0 },
    replaced: { created: 2, destroyed: 1 },
    cleared: { created: 2, destroyed: 2 },
    final: { created: 3, destroyed: 3 },
  });
  expect(result.updates).toBeGreaterThan(2);
});
