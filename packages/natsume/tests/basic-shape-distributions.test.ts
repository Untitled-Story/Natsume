import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { sampleShape, validateShape } from '../src/runtime/shapes.js';
import { constant } from './particle-fixtures.js';
import { ShapeModuleT } from '../src/format/generated/noa/ir/shape-module.js';
import { ShapeGeometry as G } from '../src/format/generated/noa/ir/shape-geometry.js';
import { SphereShapeT } from '../src/format/generated/noa/ir/sphere-shape.js';
import { BoxShapeT } from '../src/format/generated/noa/ir/box-shape.js';
import { ConeShapeT } from '../src/format/generated/noa/ir/cone-shape.js';
import { EdgeShapeT } from '../src/format/generated/noa/ir/edge-shape.js';
import { Vec3T } from '../src/format/generated/noa/ir/vec3.js';

type Point = { x: number; y: number; z: number };
type Stats = { mean: Point; second: Point; radiusMean: number; radiusSecond: number };
interface NativeCase {
  label: string;
  type: number;
  count: number;
  thickness: number;
  angle: number;
  length: number;
  arc: number;
  randomDirection: number;
  sphericalDirection: number;
  align: boolean;
  position: Stats;
  velocity: Stats;
}
const native: { cases: NativeCase[] } = JSON.parse(
  readFileSync(new URL('./fixtures/unity-basic-shapes.json', import.meta.url), 'utf8'),
);
for (const c of native.cases.filter((c) => !c.align))
  it('matches native basic shape distribution ' + c.label, () => {
    const s = new ShapeModuleT();
    s.randomDirection = c.randomDirection;
    s.sphericalDirection = c.sphericalDirection;
    if (c.type === 0 || c.type === 2) {
      s.geometryType = G.SphereShape;
      s.geometry = new SphereShapeT(constant(1), c.thickness, c.type === 2);
    } else if ([5, 15, 16].includes(c.type)) {
      s.geometryType = G.BoxShape;
      s.geometry = new BoxShapeT(
        new Vec3T(c.thickness, c.thickness, c.thickness),
        c.type === 5 ? 0 : c.type === 15 ? 1 : 2,
      );
    } else if (c.type === 12) {
      s.geometryType = G.EdgeShape;
      s.geometry = new EdgeShapeT(constant(1));
    } else {
      s.geometryType = G.ConeShape;
      const cone = new ConeShapeT(constant(1), (c.angle * Math.PI) / 180, c.length);
      cone.region = c.type === 8 ? 1 : 0;
      cone.arcRadians = (c.arc * Math.PI) / 180;
      cone.radiusThickness = c.thickness;
      s.geometry = cone;
    }
    validateShape(s);
    const sums = new Float64Array(6),
      squares = new Float64Array(6),
      radii = new Float64Array(4),
      out = new Float64Array(6);
    for (let i = 0; i < c.count; i++) {
      sampleShape(s, 12345, i, 0, i, c.count, out);
      for (let a = 0; a < 6; a++) {
        expect(Number.isFinite(out[a])).toBe(true);
        sums[a] = sums[a]! + out[a]! / c.count;
        squares[a] = squares[a]! + out[a]! ** 2 / c.count;
      }
      const rp = Math.hypot(out[0]!, out[1]!, out[2]!),
        rv = Math.hypot(out[3]!, out[4]!, out[5]!);
      radii[0] = radii[0]! + rp / c.count;
      radii[1] = radii[1]! + (rp * rp) / c.count;
      radii[2] = radii[2]! + rv / c.count;
      radii[3] = radii[3]! + (rv * rv) / c.count;
    }
    for (const [block, stats] of [c.position, c.velocity].entries()) {
      for (const [a, key] of (['x', 'y', 'z'] as const).entries()) {
        expect(Math.abs(sums[block * 3 + a]! - stats.mean[key])).toBeLessThan(0.025);
        expect(Math.abs(squares[block * 3 + a]! - stats.second[key])).toBeLessThan(0.035);
      }
      expect(Math.abs(radii[block * 2]! - stats.radiusMean)).toBeLessThan(0.025);
      expect(Math.abs(radii[block * 2 + 1]! - stats.radiusSecond)).toBeLessThan(0.045);
    }
  });

it('keeps degenerate cones and aligned sweeps finite', () => {
  const s = new ShapeModuleT(G.ConeShape, new ConeShapeT(constant(0), Math.PI / 2, 0));
  const out = new Float64Array(6);
  sampleShape(s, 1, 0, 0, 0, 1, out);
  expect([...out].every(Number.isFinite)).toBe(true);
  (s.geometry as ConeShapeT).arcMode = 1;
  expect(() => validateShape(s)).not.toThrow();
  (s.geometry as ConeShapeT).arcMode = 0;
  s.alignToDirection = true;
  expect(() => validateShape(s)).not.toThrow();
});
