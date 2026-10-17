import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import { Emitter } from '../src/runtime/emitter.js';
import { Scene } from '../src/runtime/scene.js';
import { loadPack } from '../src/loader/load.js';
import { archive } from './helpers.js';
import { randomSource } from './random-fixtures.js';
import { constant, vector } from './particle-fixtures.js';
import { ParticleModuleData as M } from '../src/format/generated/noa/ir/particle-module-data.js';
import type { ShapeModuleT } from '../src/format/generated/noa/ir/shape-module.js';
import type { CircleShapeT } from '../src/format/generated/noa/ir/circle-shape.js';
import type { EmissionModuleT } from '../src/format/generated/noa/ir/emission-module.js';
import { Vec3T } from '../src/format/generated/noa/ir/vec3.js';
import { QuaternionT } from '../src/format/generated/noa/ir/quaternion.js';

type Point = { x: number; y: number; z: number };
interface NativeCase {
  label: string;
  radius: number;
  jitter: number;
  scale: Point;
  rotated: boolean;
  positions: Point[];
  velocities: Point[];
  mean: number[];
  secondMoment: number[];
  radiusSquaredMean: number;
  radiusSquaredVariance: number;
}
const native: { cases: NativeCase[] } = JSON.parse(
  readFileSync(new URL('./fixtures/unity-shape.json', import.meta.url), 'utf8'),
);
let scene: Scene;
beforeAll(async () => {
  scene = new Scene(await loadPack(await archive()), [1]);
});
for (const fixture of native.cases) {
  it('matches native shape ' + fixture.label, () => {
    const spread = fixture.label.startsWith('spread-');
    const count = spread ? fixture.positions.length : 16384;
    const arc =
      spread && fixture.label.endsWith('-360') ? Math.PI * 2 : spread ? Math.PI / 2 : Math.PI * 2;
    const source = randomSource(12345, 0, arc);
    source.main!.maxParticles = count;
    source.main!.speed = constant(1);
    source.modules = source.modules.filter(
      (m) => m.dataType === M.ShapeModule || m.dataType === M.EmissionModule,
    );
    const shape = source.modules.find((m) => m.dataType === M.ShapeModule)!.data as ShapeModuleT;
    const circle = shape.geometry as CircleShapeT;
    circle.radius = constant(spread ? 2 : fixture.radius);
    circle.arcMode = spread ? 3 : 0;
    shape.randomPosition = spread ? 0 : fixture.jitter;
    shape.transform!.position = new Vec3T(4, 5, 6);
    const scale = spread ? { x: 1, y: 1, z: 1 } : fixture.scale;
    shape.transform!.scale = new Vec3T(scale.x, scale.y, scale.z);
    if (fixture.rotated)
      shape.transform!.rotation = new QuaternionT(0, 0, Math.SQRT1_2, Math.SQRT1_2);
    (
      source.modules.find((m) => m.dataType === M.EmissionModule)!.data as EmissionModuleT
    ).bursts[0]!.count = constant(count);
    const e = new Emitter(3, scene.nodes.get(1)!, source, true, 12345, false, []);
    e.sync();
    expect(e.count).toBe(count);
    if (spread) {
      for (let i = 0; i < count; i++)
        for (const [axis, key] of (['x', 'y', 'z'] as const).entries())
          expect(e.positions[i * 3 + axis]).toBeCloseTo(fixture.positions[i]![key], 5);
      return;
    }
    const columns = [0, 1, 2].map(() => [] as number[]),
      radii: number[] = [];
    for (let i = 0; i < count; i++) {
      const offset = [0, 1, 2].map(
        (axis) =>
          e.positions[i * 3 + axis]! -
          [4, 5, 6][axis]! -
          fixture.radius * e.velocities[i * 3 + axis]!,
      );
      offset.forEach((v, axis) => columns[axis]!.push(v));
      radii.push(offset.reduce((s, v) => s + v * v, 0));
    }
    for (let axis = 0; axis < 3; axis++) {
      const mean = columns[axis]!.reduce((s, v) => s + v, 0) / count;
      const moment = columns[axis]!.reduce((s, v) => s + v * v, 0) / count;
      expect(Math.abs(mean - fixture.mean[axis]!)).toBeLessThan(0.06);
      expect(Math.abs(moment - fixture.secondMoment[axis]!)).toBeLessThan(0.06);
    }
    const mean = radii.reduce((s, v) => s + v, 0) / count;
    const variance = radii.reduce((s, v) => s + (v - mean) ** 2, 0) / count;
    expect(Math.abs(mean - fixture.radiusSquaredMean)).toBeLessThan(0.08);
    expect(Math.abs(variance - fixture.radiusSquaredVariance)).toBeLessThan(
      fixture.rotated ? 0.2 : 1e-6,
    );
    // Position jitter must not turn the radial initial velocity toward its offset.
    const unjittered = structuredClone(source);
    (
      unjittered.modules.find((m) => m.dataType === M.ShapeModule)!.data as ShapeModuleT
    ).randomPosition = 0;
    const control = new Emitter(3, scene.nodes.get(1)!, unjittered, true, 12345, false, []);
    control.sync();
    expect(e.velocities).toEqual(control.velocities);
  });
}

it('keeps one-particle and zero-arc Burst Spread finite', () => {
  const source = randomSource(12345, 1, 0);
  const shape = source.modules.find((m) => m.dataType === M.ShapeModule)!.data as ShapeModuleT;
  (shape.geometry as CircleShapeT).arcMode = 3;
  source.main!.size = vector(1, 1, 1);
  source.main!.maxParticles = 1;
  (
    source.modules.find((m) => m.dataType === M.EmissionModule)!.data as EmissionModuleT
  ).bursts[0]!.count = constant(1);
  const e = new Emitter(3, scene.nodes.get(1)!, source, true, 12345, false, []);
  e.sync();
  expect(Array.from(e.positions).every(Number.isFinite)).toBe(true);
});
