import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { recordError } from '../measurement.js';

const local = (path: string) => new URL('../../../../data/' + path, import.meta.url);
const read = (path: string) => JSON.parse(readFileSync(local(path), 'utf8'));

test('matches native source equations, built-in pixels, HDR sampling and resource lifecycle', async ({
  page,
}) => {
  test.skip(
    ![
      'unity-baselines/fixtures/unity-source-materials.json',
      'source-shader-audit/material-uses-readable.json',
      'source-shader-audit/00caeea0345e4a8eed279ee8893d77fa53d37a1626d91fa644012a7a2224e700.shader.json',
      'source-shader-audit/afc864a0b8f613244f08d7d3ed52bc0fabe38bf5d39ce298d23f6f0038a97b29.shader.json',
      'scene-mesh.noap',
      'recovered-source-textures/exr/0e3859ea49c5f7e40bf845aca044672e.exr',
    ].every((path) => existsSync(local(path))),
    'Local native source material resources are not distributed',
  );
  const native = read('unity-baselines/fixtures/unity-source-materials.json');
  const hdr = native.hdr.find((sample: { label: string }) => sample.label === 'original-astc');
  expect(
    hdr,
    'Regenerate source-material fixtures with NATSUME_SOURCE_HDR pointing to the recovered EXR and its original ASTC files.',
  ).toBeDefined();
  const uses = read('source-shader-audit/material-uses-readable.json');
  const shader = read(
    'source-shader-audit/00caeea0345e4a8eed279ee8893d77fa53d37a1626d91fa644012a7a2224e700.shader.json',
  );
  const depthShader = read(
    'source-shader-audit/afc864a0b8f613244f08d7d3ed52bc0fabe38bf5d39ce298d23f6f0038a97b29.shader.json',
  );
  await page.goto('/');
  const measured = await page.evaluate(
    async ({ path, input }) => (await import('/@fs' + path)).measureSourceMaterials(input),
    {
      path: new URL('./source-material-fixture.ts', import.meta.url).pathname,
      input: {
        bytes: Array.from(readFileSync(local('scene-mesh.noap'))),
        shader,
        depthShader,
        source: uses.find((use: { program: string }) => use.program === shader.program_sha256)
          .source,
        cases: native.cases,
        exr: Array.from(
          readFileSync(local('recovered-source-textures/exr/0e3859ea49c5f7e40bf845aca044672e.exr')),
        ),
        hdrPoints: hdr.pixels,
      },
    },
  );
  writeFileSync(local('source-material-browser.json'), JSON.stringify(measured));
  for (const sample of native.cases) {
    expect(measured.results[sample.label]).toHaveLength(sample.pixels.length);
    let max = 0;
    for (let i = 0; i < sample.pixels.length; i++)
      max = Math.max(max, Math.abs(measured.results[sample.label][i] - sample.pixels[i]));
    recordError('material.source', max, '8-bit channel', sample.label, 'unity');
    expect(max, sample.label).toBeLessThanOrEqual(2);
  }
  let builtinMax = 0;
  for (let i = 0; i < native.builtins[0].pixels.length; i++)
    builtinMax = Math.max(
      builtinMax,
      Math.abs(measured.builtinPixels[i] - native.builtins[0].pixels[i]),
    );
  recordError('texture.builtin-particle', builtinMax, '8-bit channel', '64x64', 'unity');
  expect(builtinMax).toBe(0);
  expect([measured.hdrWidth, measured.hdrHeight]).toEqual([hdr.width, hdr.height]);
  for (const pixel of measured.hdrSamples) {
    const reference = hdr.pixels.find(
      (value: { x: number; y: number }) => value.x === pixel.x && value.y === pixel.y,
    );
    expect(reference, `HDR reference ${pixel.x}/${pixel.y}`).toBeDefined();
    for (let c = 0; c < 4; c++) {
      const error = Math.abs(pixel.value[c] - reference.value[c]);
      recordError('texture.hdr', error, 'channel', `${pixel.x}/${pixel.y}/${c}`, 'unity');
      expect(error).toBeLessThanOrEqual(0.000001);
    }
  }
  expect(measured.lifecycle).toEqual({
    sharedRefs: 4,
    retained: 2,
    released: true,
    depthDraws: 0,
    unknownRejected: true,
    hdrFormat: 'rgba16float',
    hdrResources: 1,
    hdrReleased: true,
    resizeStable: true,
    hostStateRestored: true,
    glError: 0,
  });
});

test('measures native builtin filtering and runtime mip bias', async ({ page }) => {
  test.skip(
    ![
      'unity-baselines/fixtures/unity-source-materials.json',
      'source-shader-audit/material-uses-readable.json',
      'source-shader-audit/00caeea0345e4a8eed279ee8893d77fa53d37a1626d91fa644012a7a2224e700.shader.json',
      'scene-mesh.noap',
    ].every((path) => existsSync(local(path))),
    'Local native builtin filtering measurements are not distributed',
  );
  const native = read('unity-baselines/fixtures/unity-source-materials.json');
  expect(
    native.builtinFilters,
    'Regenerate source-material fixtures with the builtin filter probe.',
  ).toHaveLength(18);
  expect(native.builtins[0].mips).toHaveLength(7);
  const uses = read('source-shader-audit/material-uses-readable.json');
  const shader = read(
    'source-shader-audit/00caeea0345e4a8eed279ee8893d77fa53d37a1626d91fa644012a7a2224e700.shader.json',
  );
  await page.goto('/');
  const measured = await page.evaluate(
    async ({ path, input }) => (await import('/@fs' + path)).measureBuiltinFiltering(input),
    {
      path: new URL('./source-material-fixture.ts', import.meta.url).pathname,
      input: {
        bytes: Array.from(readFileSync(local('scene-mesh.noap'))),
        shader,
        source: uses.find((use: { program: string }) => use.program === shader.program_sha256)
          .source,
        cases: native.builtinFilters,
      },
    },
  );
  const rows = native.builtinFilters.map((sample: { label: string; pixels: number[] }) => {
    const errors = sample.pixels
      .map((value, index) => Math.abs(value - measured.results[sample.label][index]))
      .sort((a, b) => a - b);
    return {
      label: sample.label,
      max: errors.at(-1),
      p95: errors[Math.floor(errors.length * 0.95)],
    };
  });
  writeFileSync(local('builtin-filter-browser.json'), JSON.stringify({ rows, measured }, null, 2));
  expect(measured.glError).toBe(0);
  for (const row of rows) {
    recordError('texture.builtin-filter', row.max, '8-bit channel', row.label, 'unity');
    expect(row.max, row.label).toBeLessThanOrEqual(25);
  }
});
