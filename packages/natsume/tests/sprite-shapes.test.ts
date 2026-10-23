import { readFileSync, existsSync } from 'node:fs';
import { expect, it } from 'vitest';
import { ShapeModuleT } from '../src/format/generated/noa/ir/shape-module.js';
import { DonutShapeT } from '../src/format/generated/noa/ir/donut-shape.js';
import { ScalarParameterT } from '../src/format/generated/noa/ir/scalar-parameter.js';
import { ShapeGeometry } from '../src/format/generated/noa/ir/shape-geometry.js';
import { sampleShape } from '../src/runtime/shapes.js';
import { recordError } from './measurement.js';

interface Point {
  x: number;
  y: number;
  z: number;
}
interface NativeShape {
  label: string;
  donut: boolean;
  radius: number;
  tube: number;
  thickness: number;
  arc: number;
  mode: number;
  time: number;
  positions: Point[];
  velocities: Point[];
}
const path = new URL(
  '../../../data/unity-baselines/fixtures/unity-sprite-shapes.json',
  import.meta.url,
);
const native: NativeShape[] = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')).cases : [];
it.skipIf(!native.length)('matches native torus distributions, sweep and tube normals', () => {
  const out = new Float64Array(6);
  for (const c of native.filter((c) => c.donut)) {
    const shape = new ShapeModuleT();
    shape.geometryType = ShapeGeometry.DonutShape;
    const speed = new ScalarParameterT();
    speed.constantMax = speed.multiplier = 1;
    shape.geometry = new DonutShapeT(
      c.radius,
      c.tube,
      c.thickness,
      (c.arc * Math.PI) / 180,
      c.mode,
      speed,
    );
    const sum = new Float64Array(6),
      reference = new Float64Array(6);
    for (let i = 0; i < c.positions.length; i++) {
      sampleShape(shape, 12345, i, c.time, i, c.positions.length, out, c.time, 1);
      const rho = Math.hypot(out[0]!, out[1]!);
      const distance = Math.hypot(rho - c.radius, out[2]!);
      expect(distance).toBeLessThanOrEqual(c.tube + 1e-6);
      expect(distance).toBeGreaterThanOrEqual(c.tube * (1 - c.thickness) - 1e-6);
      expect(Math.hypot(out[3]!, out[4]!, out[5]!)).toBeCloseTo(1, 6);
      for (const [axis, k] of (['x', 'y', 'z'] as const).entries()) {
        const p = out[axis]!,
          q = c.positions[i]![k];
        sum[axis]! += p / c.positions.length;
        sum[axis + 3]! += (p * p) / c.positions.length;
        reference[axis]! += q / c.positions.length;
        reference[axis + 3]! += (q * q) / c.positions.length;
      }
    }
    for (let axis = 0; axis < 6; axis++) {
      const difference = sum[axis]! - reference[axis]!;
      recordError(
        'shape.torus',
        difference,
        axis < 3 ? 'position mean' : 'position second moment',
        `${c.label}/${axis}`,
        'unity',
      );
      expect(Math.abs(difference), `${c.label}/${axis}`).toBeLessThan(
        0.03 * Math.max(axis < 3 ? c.radius : 1, Math.abs(reference[axis]!)),
      );
    }
  }
});

it.skipIf(!native.length)('matches native sprite placement and nonrandom spawn modes', async () => {
  const { EffectPack } = await import('../src/pack.js');
  const { SpriteShapeSampler } = await import('../src/runtime/sprite-shape.js');
  const { SpriteShapeT } = await import('../src/format/generated/noa/ir/sprite-shape.js');
  const { AssetT } = await import('../src/format/generated/noa/ir/asset.js');
  const { SpriteAssetT } = await import('../src/format/generated/noa/ir/sprite-asset.js');
  const { MeshT } = await import('../src/format/generated/noa/mesh/mesh.js');
  const { Vec3T } = await import('../src/format/generated/noa/mesh/vec3.js');
  const { minimalDocument } = await import('./helpers.js');
  const source = JSON.parse(readFileSync(path, 'utf8'));
  const mesh = new MeshT();
  mesh.positions = source.vertices.map((p: Point) => new Vec3T(p.x, p.y, 0));
  mesh.indices = source.triangles;
  const doc = minimalDocument();
  doc.assets = [new AssetT(42, 4, new SpriteAssetT(43, 44))];
  const pack = new EffectPack(
    doc,
    { format: 'noa-package', version: 1, noir_version: [2, 0], document: 'scene.noir', files: [] },
    new Map(),
    new Map([[43, mesh]]),
  );
  const out = new Float64Array(10);
  for (const c of source.cases.filter((c: NativeShape) => !c.donut)) {
    const speed = new ScalarParameterT();
    speed.constantMax = c.speed ?? 1;
    const d = new SpriteShapeT(
      c.label === 'sprite-empty' ? 0 : 42,
      c.placement,
      c.normalOffset,
      false,
      c.mode,
      speed,
      c.spread ?? 0,
    );
    const shape = new ShapeModuleT(ShapeGeometry.SpriteShape, d);
    const sampler = new SpriteShapeSampler(pack, d),
      sum = new Float64Array(6),
      reference = new Float64Array(6);
    for (let i = 0; i < c.positions.length; i++) {
      sampleShape(shape, 12345, i, c.time, i, c.positions.length, out, c.time, 1, sampler);
      if ((c.mode !== 0 && c.placement !== 2) || c.label === 'sprite-empty')
        for (const [axis, k] of (['x', 'y', 'z'] as const).entries())
          expect(out[axis], `${c.label}/${i}/${axis}`).toBeCloseTo(c.positions[i][k], 4);
      expect(out[5]).toBe(1);
      expect(out[2]).toBeCloseTo(c.normalOffset, 6);
      for (const [axis, k] of (['x', 'y', 'z'] as const).entries()) {
        const p = out[axis]!,
          q = c.positions[i][k];
        sum[axis]! += p / c.positions.length;
        sum[axis + 3]! += (p * p) / c.positions.length;
        reference[axis]! += q / c.positions.length;
        reference[axis + 3]! += (q * q) / c.positions.length;
      }
    }
    if (c.positions.length < 8192) continue;
    for (let axis = 0; axis < 6; axis++) {
      const difference = sum[axis]! - reference[axis]!;
      recordError(
        'shape.sprite',
        difference,
        axis < 3 ? 'position mean' : 'position second moment',
        `${c.label}/${axis}`,
        'unity',
      );
      expect(Math.abs(difference), `${c.label}/${axis}`).toBeLessThan(
        0.04 * Math.max(1, Math.abs(reference[axis]!)),
      );
    }
  }
  pack.dispose();
});
