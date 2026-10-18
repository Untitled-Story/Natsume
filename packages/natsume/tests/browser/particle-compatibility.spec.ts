import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { recordError } from '../measurement.js';

test('shares compatibility issues with instantiation before allocating textures', async ({
  page,
}) => {
  const sample = fileURLToPath(new URL('../../../../data/kirakira.noap', import.meta.url));
  test.skip(!existsSync(sample), 'Local sample is absent');
  await page.goto('/');
  await page.locator('#file').setInputFiles(sample);
  await expect(page.locator('#status')).toHaveText('预览就绪');
  const result = await page.evaluate(
    async (path) => (await import('/@fs' + path)).checkRuntimeCompatibility(),
    new URL('./render-fixture.ts', import.meta.url).pathname,
  );
  expect(result).toMatchObject({
    valid: true,
    blocked: true,
    sameIssues: true,
    decodes: 0,
    unchanged: true,
  });
  expect(result.fields).toEqual(
    expect.arrayContaining([
      'main.gravityMultiplier',
      'main.durationSeconds',
      'particleEnvironment.viewPosition',
    ]),
  );
});

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
      c.label.startsWith('roll-') ||
      c.label.startsWith('freeform'),
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
    if (!expected.vertices.length) {
      const center = row.vertices[0];
      for (const vertex of row.vertices)
        expect(Math.hypot(...vertex.map((v: number, i: number) => v - center[i]))).toBeLessThan(
          1e-6,
        );
      continue;
    }
    if (row.label === 'freeform-boundary-parallel-True') {
      // Native projected heading is unstable at a parallel velocity. Compare
      // edge lengths and facing plane, rather than its floating-point heading.
      const position = expected.positions[0];
      const center = [position.x, position.y, position.z];
      const facing = [position.x, position.y, position.z + 10];
      const length = Math.hypot(...facing);
      for (const [index, vertex] of row.vertices.entries()) {
        const next = row.vertices[(index + 1) % 4];
        const a = expected.vertices[index],
          b = expected.vertices[(index + 1) % 4];
        const error = Math.abs(
          Math.hypot(...vertex.map((v: number, axis: number) => v - next[axis])) -
            Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z),
        );
        recordError('renderer.freeform.parallel-edge', error, 'units', row.label + '/' + row.frame);
        expect(error).toBeLessThan(0.00003);
        const depth = vertex.reduce(
          (sum: number, v: number, axis: number) =>
            sum + ((v - center[axis]) * facing[axis]) / length,
          0,
        );
        expect(Math.abs(depth)).toBeLessThan(0.00003);
      }
      continue;
    }
    for (const [index, vertex] of row.vertices.entries()) {
      const vertices = row.label.startsWith('freeform')
        ? [expected.vertices[index]]
        : expected.vertices;
      const error = Math.min(
        ...vertices.map((v: { x: number; y: number; z: number }) =>
          Math.hypot(v.x - vertex[0], v.y - vertex[1], v.z - vertex[2]),
        ),
      );
      recordError(
        row.label.startsWith('freeform') ? 'renderer.freeform' : 'renderer.scaling',
        error,
        'units',
        row.label + '/' + row.frame + '/' + index,
      );
      expect(error, row.label + '/' + row.frame).toBeLessThan(
        row.label.startsWith('freeform') ? 0.0002 : 0.00003,
      );
    }
  }
});
