import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { recordError } from '../measurement.js';
import type { SpriteSample } from './sprite-render-fixture.js';

const path = new URL(
  '../../../../data/unity-baselines/fixtures/unity-sprite-rendering.json',
  import.meta.url,
);
test('matches native sprite geometry, slicing, tiling, pivot and renderer colors', async ({
  page,
}) => {
  test.skip(!existsSync(path), 'Local Unity measurements are not distributed');
  const native = JSON.parse(readFileSync(path, 'utf8')) as {
    texture: number[];
    cases: SpriteSample[];
  };
  await page.goto('/');
  const measured = await page.evaluate(
    async ({ path, native }) => (await import('/@fs' + path)).measureSpriteRendering(native),
    { path: new URL('./sprite-render-fixture.ts', import.meta.url).pathname, native },
  );
  writeFileSync(
    new URL('../../../../data/sprite-render-browser.json', import.meta.url),
    JSON.stringify(measured),
  );
  const stats: Record<string, { max: number; different: number; coverage: number }> = {};
  for (const c of native.cases) {
    const p: number[] = measured.result[c.label]!;
    const actual: number[] = measured.publicResult[c.label]!;
    expect(
      Math.max(...actual.map((v, i) => Math.abs(v - p[i]!))),
      c.label + ' runtime',
    ).toBeLessThanOrEqual(1);
    expect(
      actual.filter((_, i) => i % 4 === 3).map(Boolean),
      c.label + ' runtime coverage',
    ).toEqual(p.filter((_, i) => i % 4 === 3).map(Boolean));
    let max = 0,
      different = 0,
      coverage = 0;
    for (let i = 0; i < p.length; i++) {
      const diff = p[i]! - c.pixels[i]!;
      max = Math.max(max, Math.abs(diff));
      if (diff) different++;
      if (i % 4 === 3 && (p[i] === 0) !== (c.pixels[i] === 0)) coverage++;
      recordError('sprite.pixel', diff, '8-bit channel', `${c.label}/${i}`, 'unity');
    }
    stats[c.label] = { max, different, coverage };
  }
  writeFileSync(
    new URL('../../../../data/sprite-render-errors.json', import.meta.url),
    JSON.stringify(stats, null, 2),
  );
  for (const [label, s] of Object.entries(stats)) {
    expect(s.coverage, label + ' coverage').toBe(0);
    expect(s.max, label + ' pixel').toBeLessThanOrEqual(2);
  }
  expect(measured.glError).toBe(0);
});
