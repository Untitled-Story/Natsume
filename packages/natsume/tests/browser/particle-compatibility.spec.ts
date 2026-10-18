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

test('draws mixed mesh sizes with stable rows, pivots and sorted indices', async ({ page }) => {
  const sample = fileURLToPath(new URL('../../../../data/kirakira.noap', import.meta.url));
  test.skip(!existsSync(sample), 'Local sample is absent');
  await page.goto('/');
  await page.locator('#file').setInputFiles(sample);
  await expect(page.locator('#status')).toHaveText('预览就绪');
  const results = await page.evaluate(
    async (path) => (await import('/@fs' + path)).measureMeshChoices(),
    new URL('./render-fixture.ts', import.meta.url).pathname,
  );
  for (const result of results)
    for (const frame of result.frames) {
      const order: number[] = [],
        widths: number[] = [];
      for (let i = 0; i < frame.count; i++) {
        const offset = i * 4 * 16;
        const width = frame.vertices[offset + 16]! - frame.vertices[offset]!;
        widths.push(width);
        expect([1, 2, 3]).toContain(width);
        if (result.distribution === 1) expect(width).toBe(2);
        expect(frame.vertices[offset]!).toBeCloseTo(i * 10 - width * 0.25, 5);
      }
      for (let k = 0; k < frame.indices.length; ) {
        const particle = Math.floor(frame.indices[k]! / 4);
        order.push(particle);
        const base = particle * 4;
        const local = widths[particle] === 2 ? [0, 1, 2, 0, 2, 3] : [0, 1, 2];
        expect(frame.indices.slice(k, k + local.length)).toEqual(local.map((v) => base + v));
        k += local.length;
      }
      expect(order).toEqual(Array.from({ length: frame.count }, (_, i) => i));
      if (frame.count === 12) {
        const other = results[result.distribution === 0 ? 1 : 0]!.frames[0]!;
        for (let i = 0; i < frame.count; i++)
          expect(frame.vertices[i * 64 + 4]).toBe(other.vertices[i * 64 + 4]);
      }
    }
});

test('matches native particle material slots and transparent pass order', async ({ page }) => {
  const sample = fileURLToPath(new URL('../../../../data/kirakira.noap', import.meta.url));
  const fixture = new URL(
    '../../../../data/unity-baselines/fixtures/unity-meshes.json',
    import.meta.url,
  );
  test.skip(!existsSync(sample) || !existsSync(fixture), 'Local native inputs are absent');
  const native = JSON.parse(readFileSync(fixture, 'utf8')).materialCases as {
    label: string;
    pixels: number[];
  }[];
  await page.goto('/');
  await page.locator('#file').setInputFiles(sample);
  await expect(page.locator('#status')).toHaveText('预览就绪');
  const actual = await page.evaluate(
    async (path) => (await import('/@fs' + path)).measureMaterialPasses(),
    new URL('./render-fixture.ts', import.meta.url).pathname,
  );
  for (const row of actual) {
    const reference = native.find((c) => c.label === row.label);
    if (!reference) throw new Error(`Missing native material case: ${row.label}`);
    for (let i = 0; i < row.pixels.length; i++) {
      const error = (Math.abs(row.pixels[i] - reference.pixels[i]!) / 255) * 100;
      recordError('renderer.materials.pixel', error, 'percent', row.label + '/' + i);
      expect(error, row.label + '/' + i).toBeLessThan(10);
    }
    expect(row.passes).toBe(
      row.label.includes('0-1-2-3')
        ? 3
        : row.label.includes('0-1-2') || row.label.includes('transparent-order')
          ? 2
          : 1,
    );
  }
});
