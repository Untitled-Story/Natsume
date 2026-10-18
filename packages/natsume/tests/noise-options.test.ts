import { recordError } from './measurement.js';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Emitter } from '../src/runtime/emitter.js';
import { Scene } from '../src/runtime/scene.js';
import type { EffectPack } from '../src/pack.js';
import { minimalDocument } from './helpers.js';
import { particleSource, constant, vector, manualParticle } from './particle-fixtures.js';
import { NoiseModuleT } from '../src/format/generated/noa/ir/noise-module.js';
import { ParticleModuleT } from '../src/format/generated/noa/ir/particle-module.js';
import { ParticleModuleData as M } from '../src/format/generated/noa/ir/particle-module-data.js';
const native = JSON.parse(
  readFileSync(new URL('./fixtures/unity-noise-options.json', import.meta.url), 'utf8'),
) as {
  cases: {
    label: string;
    samples: {
      frame: number;
      position: { x: number; y: number; z: number };
      rotation: { x: number; y: number; z: number };
      bakedSize: { x: number; y: number; z: number };
    }[];
  }[];
};
function create(label: string) {
  const doc = minimalDocument();
  const pack = {
    nodes: doc.nodes,
    components: [],
    getNode: (id: number) => doc.nodes.find((n) => n.id === id),
  } as unknown as EffectPack;
  const source = particleSource();
  const noise = new NoiseModuleT();
  noise.algorithm = 'unity-particle-noise';
  noise.quality = 2;
  noise.frequency = 0.28;
  noise.damping = true;
  noise.strength = vector(1, 1, 1);
  noise.positionAmount = constant(1);
  if (label === 'rotation' || label === 'size') noise.positionAmount = constant(0);
  if (label === 'rotation') noise.rotationAmount = constant(1);
  if (label === 'size') noise.sizeAmount = constant(1);
  if (label === 'strength-zero') noise.strength = vector();
  if (label === 'frequency-zero') noise.frequency = 0;
  if (label.startsWith('remap')) {
    noise.remapEnabled = true;
    noise.remap = vector(
      ...(Array(3).fill(label.endsWith('negative') ? -0.25 : 0.25) as [number, number, number]),
    );
  }
  if (label === 'scroll') noise.scrollSpeed = constant(1);
  if (label === 'octaves') {
    noise.octaves = 3;
    noise.octaveMultiplier = 0.5;
    noise.octaveScale = 2;
  }
  if (label === 'low') noise.quality = 0;
  if (label === 'medium') noise.quality = 1;
  source.modules.push(new ParticleModuleT(M.NoiseModule, noise));
  const e = new Emitter(3, new Scene(pack, [1]).nodes.get(1)!, source, true, 12345, []);
  manualParticle(e);
  e.positions.set([1, 2, 3]);
  e.velocities.fill(0);
  e.rotations.fill(0);
  e.lifetimes[0] = 2;
  return e;
}
for (const label of ['remap-positive', 'remap-negative', 'strength-zero'])
  it('matches native Noise ' + label, () => {
    const e = create(label);
    const samples = native.cases.find((c) => c.label === label)!.samples;
    for (const s of samples) {
      if (s.frame) e.step(1 / 60);
      for (const [i, k] of (['x', 'y', 'z'] as const).entries()) {
        recordError(
          'noise.constantRemap',
          e.positions[i]! - s.position[k],
          'units',
          label + '/' + s.frame + '/' + k,
        );
        expect(Math.abs(e.positions[i]! - s.position[k])).toBeLessThan(1e-5);
      }
    }
  });
it('keeps native rotation and size parameter relationships without accumulating size', () => {
  const position = create('position'),
    rotation = create('rotation'),
    size = create('size');
  position.step(1 / 60);
  rotation.step(1 / 60);
  size.step(1 / 60);
  const delta = Array.from(position.positions.subarray(0, 3), (v, i) => v - [1, 2, 3][i]!);
  expect(rotation.rotations[2]).toBeCloseTo((delta[2]! * Math.PI) / 360, 6);
  for (let axis = 0; axis < 3; axis++)
    expect(size.noiseSizes![axis]).toBeCloseTo(1 + delta[axis]! * 30, 5);
  const factors = Array.from(size.noiseSizes!.subarray(0, 3));
  size.step(1 / 60);
  expect(Array.from(size.noiseSizes!.subarray(0, 3))).toEqual(factors);
  expect(Array.from(size.startSizes.subarray(0, 3))).toEqual([2, 3, 4]);
  // Native BakeMesh applies the same noncumulative per-axis scale, although GetCurrentSize omits it.
  const initial = native.cases.find((c) => c.label === 'position')!.samples[1]!.position;
  const baked = native.cases.find((c) => c.label === 'size')!.samples[1]!.bakedSize;
  for (const [i, k] of (['x', 'y'] as const).entries())
    expect(Math.abs(baked[k] - [2, 3][i]! * (1 + (initial[k] - [1, 2][i]!) * 30))).toBeLessThan(
      1e-5,
    );
});
for (const label of ['scroll', 'octaves', 'low', 'medium', 'frequency-zero'])
  it('keeps ' + label + ' finite and reproducible', () => {
    const a = create(label),
      b = create(label);
    for (let i = 0; i < 60; i++) {
      a.step(1 / 60);
      b.step(1 / 60);
    }
    expect([...a.positions].every(Number.isFinite)).toBe(true);
    expect(a.positions).toEqual(b.positions);
    if (label === 'scroll') {
      const fixed = create('position');
      for (let i = 0; i < 60; i++) fixed.step(1 / 60);
      expect(a.positions).not.toEqual(fixed.positions);
    }
  });
