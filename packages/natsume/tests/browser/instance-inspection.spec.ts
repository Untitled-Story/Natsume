import { expect, test } from '@playwright/test';

test('lists entry, nodes and particle systems without internal state', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(
    async (path) => (await import('/@fs' + path)).verifyInstanceInspection(),
    new URL('./instance-inspection-fixture.ts', import.meta.url).pathname,
  );
  expect(result).toEqual({
    entry: { id: 2, name: 'default', roots: [1] },
    nodes: [
      [1, 'root', 0],
      [5, 'child', 1],
    ],
    systems: [{ id: 3, nodeId: 5, timelineControlled: false }],
    destroyed: 3,
  });
});
