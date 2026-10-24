import { pixelAdjustedRect } from '../src/rendering/pixel-adjustment.js';
import { readFileSync, existsSync } from 'node:fs';
import { it, expect } from 'vitest';
import { mat4 } from 'gl-matrix';
import { CanvasT } from '../src/format/generated/noa/ir/canvas.js';
import { canvasLayout } from '../src/rendering/canvas-layout.js';
import { copyCanvasEnvironment } from '../src/rendering/canvas-environment.js';
const path = new URL('../../../data/unity-baselines/fixtures/unity-canvas.json', import.meta.url);
const matrix = (m: Record<string, number>) =>
  mat4.fromValues(
    ...(Array.from({ length: 16 }, (_, i) => m['e' + (i % 4) + Math.floor(i / 4)]!) as Parameters<
      typeof mat4.fromValues
    >),
  );
it.skipIf(!existsSync(path))(
  'matches native screen Canvas dimensions, position, orientation and plane distance',
  () => {
    const native = JSON.parse(readFileSync(path, 'utf8'));
    for (const c of native.cases) {
      if (c.mode === 2) continue;
      const canvas = new CanvasT();
      canvas.mode = c.mode;
      canvas.planeDistance = c.plane;
      const d = c.mode === 0 ? c.display : { x: 128, y: 96 };
      const env = copyCanvasEnvironment({
        displays: { 0: { width: d.x, height: d.y } },
        mainCamera: {
          viewMatrix: matrix(c.view),
          projectionMatrix: matrix(c.projection),
          viewport: c.viewport,
        },
      })!;
      const actual = canvasLayout(canvas, env),
        expected = matrix(c.world);
      expect(actual.width, c.label).toBeCloseTo(c.size.x, 5);
      expect(actual.height, c.label).toBeCloseTo(c.size.y, 5);
      for (let i = 0; i < 16; i++)
        expect(actual.world[i], c.label + '/' + i).toBeCloseTo(expected[i]!, 4);
    }
  },
);
it('copies display and matrix inputs and rejects invalid viewports', () => {
  const view = mat4.create(),
    source = {
      displays: { 0: { width: 128, height: 96 } },
      mainCamera: { viewMatrix: view, projectionMatrix: view },
    };
  const copy = copyCanvasEnvironment(source)!;
  view[12] = 100;
  source.displays[0].width = 9;
  expect(copy.displays[0]!.width).toBe(128);
  expect(copy.mainCamera!.viewMatrix[12]).toBe(0);
  expect(() =>
    copyCanvasEnvironment({
      ...source,
      mainCamera: { ...source.mainCamera, viewport: { x: 0.9, y: 0, width: 0.5, height: 1 } },
    }),
  ).toThrow();
});

it.skipIf(!existsSync(path))(
  'matches native pixel snapping under fractional positions and scales',
  () => {
    const native = JSON.parse(readFileSync(path, 'utf8'));
    for (const c of native.pixelRects) {
      const actual = pixelAdjustedRect(c.size.x, c.size.y, c.pivot, matrix(c.world));
      for (const key of ['x', 'y', 'width', 'height'] as const)
        expect(
          Math.abs(actual[key] - c.adjusted[key]),
          `${c.scale.x}/${c.angle}/${key}`,
        ).toBeLessThan(0.0001);
    }
  },
);

it('copies sorting layer ranks and rejects malformed mappings', async () => {
  const { copyRenderEnvironment } = await import('../src/rendering/render-environment.js');
  const layers = { [-123]: -2, 456: 3 };
  const copied = copyRenderEnvironment({ sortingLayers: layers })!;
  layers[-123] = 99;
  expect(copied.sortingLayers![-123]).toBe(-2);
  expect(Object.isFrozen(copied.sortingLayers)).toBe(true);
  for (const value of [
    null,
    [],
    new Map(),
    { '1.5': 2 },
    { '2147483648': 2 },
    { '01': 2 },
    { 1: NaN },
  ])
    expect(() => copyRenderEnvironment({ sortingLayers: value as never })).toThrow();
});

it('uses package sorting ranks before host fallbacks and preserves the default layer', async () => {
  const { canvasSortingRank } = await import('../src/rendering/canvas-sorting.js');
  const { ComponentData: C } = await import('../src/format/generated/noa/ir/component-data.js');
  const pack = {
    components: [
      { dataType: C.ParticleRenderer, data: { sourceSortingLayerId: 123, sortingLayerRank: 4 } },
    ],
  };
  const environment = { sortingLayers: { 0: 99, 123: 99, [-456]: -3 } };
  const rank = (id: number) => canvasSortingRank(pack as never, id, environment);
  expect(rank(0)).toBe(0);
  expect(rank(123)).toBe(4);
  expect(rank(-456)).toBe(-3);
  expect(rank(789)).toBeUndefined();
});
