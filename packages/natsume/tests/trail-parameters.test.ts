import { recordError } from './measurement.js';
import { existsSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { trailLifetime, trailUV, trailAppearance } from '../src/runtime/trail-parameters.js';
import { TrailsModuleT } from '../src/format/generated/noa/ir/trails-module.js';
import { Vec2T } from '../src/format/generated/noa/ir/vec2.js';
import { ColorParameterT } from '../src/format/generated/noa/ir/color-parameter.js';
import { ColorT } from '../src/format/generated/noa/ir/color.js';
import { constant, linear } from './particle-fixtures.js';

it('scales normalized trail lifetime by start lifetime and optional particle size', () => {
  const t = new TrailsModuleT();
  t.lifetime = constant(0.4);
  expect(trailLifetime(t, 0.5, [2, 2, 2], 0, 0)).toBeCloseTo(0.2);
  t.sizeAffectsLifetime = true;
  expect(trailLifetime(t, 0.5, [2, 3, 1], 0, 0)).toBeCloseTo(0.6);
});

interface Row {
  mode: number;
  texture: number;
  flags: number;
  samples: {
    frame: number;
    vertices: { x: number; y: number; z: number }[];
    uv: { x: number; y: number }[];
    colors: { r: number; g: number; b: number; a: number }[];
  }[];
}
const native = new URL('../../../data/unity-baselines/fixtures/unity-trails.json', import.meta.url);
it.skipIf(!existsSync(native))(
  'matches native trail UV relations across both modes and all texture settings',
  () => {
    const { cases } = JSON.parse(readFileSync(native, 'utf8')) as { cases: Row[] };
    let checked = 0,
      max = 0;
    for (const c of cases.filter((c) => c.flags === 0))
      for (const sample of c.samples) {
        if (sample.vertices.length < 4 || (c.mode === 0 && c.texture === 4)) continue;
        const centers = sample.vertices
          .filter((_, i) => i % 2 === 0)
          .map((p, i) => {
            const q = sample.vertices[i * 2 + 1]!;
            return [(p.x + q.x) / 2, (p.y + q.y) / 2, (p.z + q.z) / 2];
          });
        // Native Ribbon partitions consecutive particle IDs by ribbonCount.
        const groups = c.mode === 1 ? [centers.slice(0, 3), centers.slice(3)] : [centers];
        let base = 0;
        for (const points of groups) {
          let length = 0;
          const distances = [0];
          for (let i = 1; i < points.length; i++) {
            length += Math.hypot(...points[i]!.map((p, j) => p - points[i - 1]![j]!));
            distances.push(length);
          }
          const t = new TrailsModuleT();
          t.mode = c.mode;
          t.textureMode = c.texture;
          t.textureScale = new Vec2T(1.5, 0.75);
          for (let i = 0; i < points.length; i++)
            for (const side of [0, 1] as const) {
              const actual = trailUV(t, distances[i]!, length, i, points.length - 1, side),
                expected = sample.uv[(base + i) * 2 + side]!;
              max = Math.max(
                max,
                Math.abs(actual[0] - expected.x),
                Math.abs(actual[1] - expected.y),
              );
              checked++;
            }
          base += points.length;
        }
      }
    expect(checked).toBeGreaterThan(100);
    expect(max).toBeLessThan(2e-6);
    recordError('trail.uv', max, 'UV units', `${checked} sampled components`);
  },
);

it.skipIf(!existsSync(native))('matches native trail width and quantized color inheritance', () => {
  const { cases } = JSON.parse(readFileSync(native, 'utf8')) as { cases: Row[] };
  let widthError = 0,
    colorError = 0,
    checked = 0;
  const cp = (r: number, g: number, b: number, a: number) =>
    new ColorParameterT(0, null, new ColorT(r, g, b, a));
  for (const c of cases.filter((c) => c.texture === 0 && [0, 1, 2, 4, 8].includes(c.flags)))
    for (const s of c.samples) {
      const centers = s.vertices
        .filter((_, i) => i % 2 === 0)
        .map((p, i) => {
          const q = s.vertices[i * 2 + 1]!;
          return [(p.x + q.x) / 2, (p.y + q.y) / 2, (p.z + q.z) / 2];
        });
      const groups = c.mode === 1 ? [centers.slice(0, 3), centers.slice(3)] : [centers];
      let base = 0;
      for (const points of groups) {
        let length = 0;
        const distances = [0];
        for (let i = 1; i < points.length; i++) {
          length += Math.hypot(...points[i]!.map((p, j) => p - points[i - 1]![j]!));
          distances.push(length);
        }
        const t = new TrailsModuleT();
        t.mode = c.mode;
        t.sizeAffectsWidth = (c.flags & 2) !== 0;
        t.inheritParticleColor = (c.flags & 4) !== 0;
        t.widthOverTrail = linear(0.5, 1.5);
        t.colorOverLifetime = cp(0.5, 0.6, 0.7, 0.5);
        t.colorOverTrail = cp(0.8, 0.6, 0.4, 0.9);
        for (let i = 0; i < points.length; i++) {
          const output = new Float32Array(4),
            phase = length > 0 ? distances[i]! / length : 0;
          const width = trailAppearance(
            t,
            Math.min((s.frame * 0.05) / 0.5, 1),
            phase,
            [2, 2, 2],
            [51 / 255, 102 / 255, 153 / 255, 204 / 255],
            0,
            0,
            0,
            output,
          );
          const a = s.vertices[(base + i) * 2]!,
            b = s.vertices[(base + i) * 2 + 1]!;
          widthError = Math.max(
            widthError,
            Math.abs(width - Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)),
          );
          const expected = s.colors[(base + i) * 2]!;
          for (const [axis, key] of (['r', 'g', 'b', 'a'] as const).entries())
            colorError = Math.max(colorError, Math.abs(output[axis]! * 255 - expected[key]));
          checked++;
        }
        base += points.length;
      }
    }
  expect(checked).toBeGreaterThan(100);
  expect(widthError).toBeLessThan(2e-6);
  expect(colorError).toBeLessThanOrEqual(1.00001);
  recordError('trail.width', widthError, 'scene units', `${checked} vertices`);
  recordError('trail.color', colorError, 'byte channel units', `${checked} vertices`);
});
