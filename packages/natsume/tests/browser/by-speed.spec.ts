import { existsSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { recordError } from '../measurement.js';

test('uploads speed-driven particle sizes to geometry', async ({ page }) => {
  const sample = new URL('../../../../data/kirakira.noap', import.meta.url).pathname;
  test.skip(!existsSync(sample), 'Local sample is absent');
  await page.goto('/');
  await page.locator('#file').setInputFiles(sample);
  await expect(page.locator('#status')).toHaveText('预览就绪');
  const rows = await page.evaluate(
    async (path) => (await import('/@fs' + path)).measureSpeedGeometry(),
    new URL('./render-fixture.ts', import.meta.url).pathname,
  );
  for (const row of rows)
    for (let axis = 0; axis < 3; axis++) {
      const expected = (axis + 2) * (0.25 * (axis + 1) + 1.5 * Math.min(1, row.speed / 4));
      const error = Math.abs(row.sizes[axis]! - expected);
      recordError('renderer.speed.size', error, 'units', row.speed + '/' + axis, 'analytic');
      expect(error).toBeLessThan(1e-5);
    }
});
