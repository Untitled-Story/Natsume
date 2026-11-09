import { expect, test } from '@playwright/test';

const fixture = new URL('./effect-behaviors-fixture.ts', import.meta.url).pathname;

test('runs frame hooks even below the simulation step and skips idle and stopped instances', async ({
  page,
}) => {
  await page.goto('/');
  const r = await page.evaluate(
    async (path) => (await import('/@fs' + path)).verifyBehaviorFrameClocks(),
    fixture,
  );
  expect(r).toEqual({
    idle: [],
    substep: ['before', 'late'],
    step: ['before', 'update', 'late'],
    drain: ['before', 'update', 'late'],
    stopped: [],
  });
});

test('runs host and Bridge phases around simulation and retains host lifecycle on restart', async ({
  page,
}) => {
  await page.goto('/');
  const r = await page.evaluate(
    async (path) => (await import('/@fs' + path)).verifyBehaviorPhases(),
    fixture,
  );
  expect(r.frame).toEqual([
    'script:before',
    'before',
    'animation',
    'script:update',
    'update',
    'script:late',
    'late',
  ]);
  expect(r.times[0]).toBe(0);
  expect(r.times[1]).toBeGreaterThan(0);
  expect(r.times[2]).toBe(r.times[1]);
  expect(r.deltas[0]).toBe(0.15);
  expect(r.deltas[1]).toBeCloseTo(r.times[1]);
  expect(r.deltas[2]).toBe(0.15);
  expect(r.offset).toEqual({ x: 12, y: 34 });
  expect(r.paused).toEqual([]);
  expect(r.retained).toBe(true);
  expect(r.disabledHostUpdates).toEqual([]);
  expect(r.cleanup).toEqual(['disable', 'enable', 'disable', 'destroy']);
  expect(r.removed).toBe(true);
  expect(r.enabled).toBe(false);
});

test('defers additions until the next frame and skips removed receivers immediately', async ({
  page,
}) => {
  await page.goto('/');
  const r = await page.evaluate(
    async (path) => (await import('/@fs' + path)).verifyBehaviorMutation(),
    fixture,
  );
  expect(r.first).toEqual(['first:before', 'removed:destroy', 'first:late']);
  expect(r.next).toEqual(['first:before', 'new:before', 'new:update', 'first:late', 'new:late']);
});

for (const action of ['pause', 'restart', 'destroy'] as const) {
  test(`cancels the current frame when beforeUpdate calls ${action}`, async ({ page }) => {
    await page.goto('/');
    const r = await page.evaluate(
      async ({ path, action }) => (await import('/@fs' + path)).verifyBehaviorCancellation(action),
      { path: fixture, action },
    );
    expect(r).toEqual({ calls: ['before'], time: 0 });
  });
}

for (const policy of ['isolate', 'throw'] as const) {
  test(`honors ${policy} errors and finishes all destruction callbacks`, async ({ page }) => {
    await page.goto('/');
    const r = await page.evaluate(
      async ({ path, policy }) => (await import('/@fs' + path)).verifyBehaviorErrors(policy),
      { path: fixture, policy },
    );
    expect(r.calls.filter((c: string) => c === 'failure')).toHaveLength(
      policy === 'isolate' ? 1 : 2,
    );
    expect(r.calls.includes('bad:late')).toBe(policy === 'throw');
    expect(r.calls.slice(-3)).toEqual(['bad:destroy', 'good:disable', 'good:destroy']);
    expect(r.removed).toBe(true);
    expect(r.errors).toEqual(policy === 'throw' ? ['before failure', 'destroy failure'] : []);
    expect(r.diagnostics).toBe(policy === 'isolate' ? 3 : 0);
  });
}

test('rejects invalid delta, recursive update and operations after removal or destruction', async ({
  page,
}) => {
  await page.goto('/');
  const r = await page.evaluate(
    async (path) => (await import('/@fs' + path)).verifyBehaviorGuards(),
    fixture,
  );
  expect(r.frames).toBe(1);
  expect(r.errors).toHaveLength(5);
  expect(r.errors[0]).toContain('Delta time');
  expect(r.errors[1]).toContain('Delta time');
  expect(r.errors[2]).toContain('Recursive effect update');
  expect(r.errors[3]).toContain('Behavior has been removed');
  expect(r.errors[4]).toContain('Effect instance has been destroyed');
});
