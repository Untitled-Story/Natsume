import { recordError } from './measurement.js';
import { beforeAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Emitter } from '../src/runtime/emitter.js';
import { Scene } from '../src/runtime/scene.js';
import { loadPack } from '../src/loader/load.js';
import { archive } from './helpers.js';
import { constant, linear } from './particle-fixtures.js';
import { randomSource } from './random-fixtures.js';
import { ParticleModuleData as M } from '../src/format/generated/noa/ir/particle-module-data.js';
import { CircleShapeT } from '../src/format/generated/noa/ir/circle-shape.js';
import { ShapeModuleT } from '../src/format/generated/noa/ir/shape-module.js';
import { ScalarMode } from '../src/format/generated/noa/ir/scalar-mode.js';
import { random, scalar } from '../src/runtime/parameters.js';

let scene: Scene;
beforeAll(async () => {
  scene = new Scene(await loadPack(await archive()), [1]);
});
function create(seed: number, thickness: number, arc: number) {
  const source = randomSource(seed, thickness, arc);
  const emitter = new Emitter(3, scene.nodes.get(1)!, source, true, seed, []);
  emitter.sync();
  return emitter;
}
function uniform(values: number[]) {
  const bins = new Array<number>(16).fill(0);
  let sum = 0,
    square = 0;
  for (const value of values) {
    expect(value).toBeGreaterThanOrEqual(-1e-6);
    expect(value).toBeLessThanOrEqual(1 + 1e-6);
    bins[Math.max(0, Math.min(15, Math.floor(value * 16)))]!++;
    sum += value;
    square += value * value;
  }
  const mean = sum / values.length;
  expect(Math.abs(mean - 0.5)).toBeLessThan(0.015);
  expect(Math.abs(square / values.length - mean * mean - 1 / 12)).toBeLessThan(0.006);
  // Fixed seeds and broad thresholds: catch center bias without chasing sample noise.
  for (const bin of bins)
    expect(Math.abs(bin - values.length / 16)).toBeLessThan(values.length * 0.012);
}
function correlation(a: number[], b: number[]) {
  const ma = a.reduce((s, v) => s + v, 0) / a.length,
    mb = b.reduce((s, v) => s + v, 0) / b.length;
  let va = 0,
    vb = 0,
    cov = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]! - ma,
      y = b[i]! - mb;
    va += x * x;
    vb += y * y;
    cov += x * y;
  }
  return cov / Math.sqrt(va * vb);
}

for (const seed of [0, 12345, 0xffffffff]) {
  it('keeps equal-area Circle density and arc coverage for seed ' + seed, () => {
    for (const thickness of [0, 0.25, 0.5, 1])
      for (const arc of [Math.PI / 2, Math.PI * 1.5, Math.PI * 2]) {
        const e = create(seed, thickness, arc),
          radii: number[] = [],
          angles: number[] = [];
        const innerSquared = (1 - thickness) ** 2;
        for (let i = 0; i < e.count; i++) {
          const x = e.positions[i * 3]!,
            y = e.positions[i * 3 + 1]!,
            r2 = (x * x + y * y) / 4;
          expect(e.positions[i * 3 + 2]).toBe(0);
          expect(r2).toBeGreaterThanOrEqual(innerSquared - 1e-6);
          expect(r2).toBeLessThanOrEqual(1 + 1e-6);
          if (thickness) radii.push((r2 - innerSquared) / (1 - innerSquared));
          angles.push(((Math.atan2(y, x) + Math.PI * 2) % (Math.PI * 2)) / arc);
        }
        if (thickness) uniform(radii);
        uniform(angles);
        if (thickness) expect(Math.abs(correlation(radii, angles))).toBeLessThan(0.04);
      }
  });
}

it('keeps birth attributes uniformly distributed and avoids unrelated channel correlations', () => {
  const e = create(98765, 1, Math.PI * 2),
    columns: number[][] = Array.from({ length: 9 }, () => []);
  for (let i = 0; i < e.count; i++) {
    const o = i * 3;
    const values = [
      (e.lifetimes[i]! - 2) / 2,
      (Math.hypot(...e.velocities.subarray(o, o + 3)) - 1) / 2,
      (e.startSizes[o]! - 1) / 2,
      (e.startSizes[o + 1]! - 2) / 4,
      (e.startSizes[o + 2]! - 3) / 6,
      e.rotations[o]!,
      e.rotations[o + 1]!,
      e.rotations[o + 2]!,
      e.startColors[i * 4]!,
    ];
    values.forEach((value, c) => columns[c]!.push(value));
    // TwoColors interpolates RGBA together, not as independent color channels.
    expect(Array.from(e.startColors.subarray(i * 4, i * 4 + 4))).toEqual(
      new Array(4).fill(values[8]),
    );
  }
  columns.forEach(uniform);
  // Native birth size and rotation use independent factors per axis.
  for (let a = 0; a < columns.length; a++)
    for (let b = a + 1; b < columns.length; b++)
      expect(Math.abs(correlation(columns[a]!, columns[b]!))).toBeLessThan(0.04);
});

it('keeps two-curve random interpolation stable over time and serial IDs', () => {
  const p = linear(2, 4);
  p.mode = ScalarMode.TwoCurves;
  p.curveMin = linear(0, 1).curveMax;
  for (const serial of [0, 1, 0xfffffffe, 0xffffffff]) {
    const u = random(12345, serial, 50);
    for (const t of [0, 0.25, 0.5, 1]) expect(scalar(p, t, u)).toBeCloseTo(t + (2 + t) * u, 10);
  }
});

interface Stats {
  name: string;
  mean: number;
  variance: number;
  bins: number[];
}
const native: {
  cases: { seed: number; thickness: number; arc: number; count: number; distributions: Stats[] }[];
} = JSON.parse(readFileSync(new URL('./fixtures/unity-random.json', import.meta.url), 'utf8'));
for (const fixture of native.cases) {
  it(
    'matches native distribution summaries ' +
      [fixture.seed, fixture.thickness, fixture.arc].join('/'),
    () => {
      const arc = (fixture.arc * Math.PI) / 180;
      const e = create(fixture.seed, fixture.thickness, arc);
      const columns = new Map<string, number[]>();
      const add = (key: string, value: number) => {
        if (!columns.has(key)) columns.set(key, []);
        columns.get(key)!.push(value);
      };
      for (let i = 0; i < e.count; i++) {
        const o = i * 3,
          x = e.positions[o]!,
          y = e.positions[o + 1]!;
        add('radiusSquared', (x * x + y * y) / 4);
        add('angle', ((Math.atan2(y, x) + Math.PI * 2) % (Math.PI * 2)) / arc);
        add('lifetime', (e.lifetimes[i]! - 2) / 2);
        add('speed', (Math.hypot(...e.velocities.subarray(o, o + 3)) - 1) / 2);
        for (let axis = 0; axis < 3; axis++) {
          add('size' + 'XYZ'[axis], (e.startSizes[o + axis]! - axis - 1) / (2 * (axis + 1)));
          add('rotation' + 'XYZ'[axis], e.rotations[o + axis]!);
        }
        add('color', e.startColors[i * 4]!);
      }
      const before = e.positions.slice(),
        velocity = e.velocities.slice();
      e.step(1 / 60);
      for (let i = 0; i < e.count; i++)
        for (let axis = 0; axis < 3; axis++) {
          const o = i * 3 + axis,
            low = axis + 1;
          add(
            'velocity' + 'XYZ'[axis],
            ((e.positions[o]! - before[o]!) * 60 - velocity[o]! - low) / low,
          );
        }
      for (const [key, values] of columns) {
        const expected = fixture.distributions.find((d) => d.name === key)!;
        const mean = values.reduce((s, v) => s + v, 0) / values.length;
        const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
        const label = [fixture.seed, fixture.thickness, fixture.arc, key].join('/');
        recordError('random.mean', mean - expected.mean, 'normalized', label);
        recordError('random.variance', variance - expected.variance, 'normalized²', label);
        expect(Math.abs(mean - expected.mean), key).toBeLessThan(0.018);
        expect(Math.abs(variance - expected.variance), key).toBeLessThan(0.007);
        const bins = new Array<number>(16).fill(0);
        for (const v of values) bins[Math.max(0, Math.min(15, Math.floor(v * 16)))]!++;
        for (let bin = 0; bin < 16; bin++) {
          recordError(
            'random.histogram',
            bins[bin]! / values.length - expected.bins[bin]! / fixture.count,
            'fraction',
            label + '/' + bin,
          );
          expect(
            Math.abs(bins[bin]! / values.length - expected.bins[bin]! / fixture.count),
            key,
          ).toBeLessThan(0.018);
        }
      }
    },
  );
}

it('handles zero-radius and zero-arc boundaries with finite births', () => {
  const e = create(24680, 1, 0);
  expect(Array.from(e.positions.subarray(0, e.count * 3)).every(Number.isFinite)).toBe(true);
  for (let i = 0; i < e.count; i++) {
    expect(e.positions[i * 3]).toBeGreaterThanOrEqual(0);
    expect(e.positions[i * 3 + 1]).toBe(0);
  }
  const source = structuredClone(e.source);
  (source.modules.find((m) => m.dataType === M.ShapeModule)!.data as ShapeModuleT).geometry =
    new CircleShapeT(constant(0), Math.PI * 2, 1);
  const zero = new Emitter(3, scene.nodes.get(1)!, source, true, 24680, []);
  zero.sync();
  expect(zero.positions.every((v) => v === 0)).toBe(true);
  expect(zero.velocities.every(Number.isFinite)).toBe(true);
});
