import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';

test('applies grid animation only when UV0 is selected', async ({ page }) => {
  const sample = fileURLToPath(new URL('../../../../data/kirakira.noap', import.meta.url));
  test.skip(!existsSync(sample), 'Local Noa sample is not distributed');
  await page.goto('/');
  await page.locator('#file').setInputFiles(sample);
  await expect(page.locator('#status')).toHaveText('预览就绪');
  const rows = await page.evaluate(
    async (path) => {
      return (await import('/@fs' + path)).measureSheetUV();
    },
    new URL('./render-fixture.ts', import.meta.url).pathname,
  );
  for (const row of rows) {
    const base =
      row.mask & 1
        ? [
            [0.25, 1 / 3],
            [0.5, 1 / 3],
            [0.5, 2 / 3],
            [0.25, 2 / 3],
          ]
        : [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
          ];
    for (let i = 0; i < 4; i++)
      for (let axis = 0; axis < 2; axis++) expect(row.uv[i][axis]).toBeCloseTo(base[i]![axis]!, 5);
  }
});
