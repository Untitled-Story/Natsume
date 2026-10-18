import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { recordError } from '../measurement.js';

test('matches native scaling and alignment geometry', async ({ page }) => {
  const sample = fileURLToPath(new URL('../../../../data/kirakira.noap', import.meta.url));
  const fixture = new URL(
    '../../../../data/unity-baselines/fixtures/unity-compatibility.json',
    import.meta.url,
  );
  test.skip(!existsSync(sample) || !existsSync(fixture), 'Local native inputs are absent');
  const cases = JSON.parse(readFileSync(fixture, 'utf8')).cases.filter(
    (c: { label: string }) =>
      (c.label.startsWith('scaling-') && !c.label.includes('birth')) ||
      c.label.startsWith('render-') ||
      c.label.startsWith('align-zero-') ||
      c.label.startsWith('plane-zero-') ||
      c.label.startsWith('roll-'),
  );
  await page.goto('/');
  await page.locator('#file').setInputFiles(sample);
  await expect(page.locator('#status')).toHaveText('预览就绪');
  const actual = await page.evaluate(
    async ({ path, labels }) => (await import('/@fs' + path)).measureCompatibilityGeometry(labels),
    {
      path: new URL('./render-fixture.ts', import.meta.url).pathname,
      labels: cases.map((c: { label: string }) => c.label),
    },
  );
  for (const row of actual) {
    const expected = cases
      .find((c: { label: string }) => c.label === row.label)
      .samples.find((s: { frame: number }) => s.frame === row.frame);
    for (const [index, vertex] of row.vertices.entries()) {
      const error = Math.min(
        ...expected.vertices.map((v: { x: number; y: number; z: number }) =>
          Math.hypot(v.x - vertex[0], v.y - vertex[1], v.z - vertex[2]),
        ),
      );
      recordError('renderer.scaling', error, 'units', row.label + '/' + row.frame + '/' + index);
      expect(error, row.label + '/' + row.frame).toBeLessThan(0.00003);
    }
  }
});
