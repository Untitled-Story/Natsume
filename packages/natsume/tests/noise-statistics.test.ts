import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Emitter } from '../src/runtime/emitter.js';
import { Scene } from '../src/runtime/scene.js';
import type { EffectPack } from '../src/pack.js';
import { minimalDocument } from './helpers.js';
import { constant, particleSource, vector } from './particle-fixtures.js';
import { NoiseModuleT } from '../src/format/generated/noa/ir/noise-module.js';
import { ParticleModuleT } from '../src/format/generated/noa/ir/particle-module.js';
import { ParticleModuleData as M } from '../src/format/generated/noa/ir/particle-module-data.js';
import { recordError } from './measurement.js';

interface Sample {
  frame: number;
  displacementRms: number;
  rotationRms: number;
  sizeDeltaRms: number;
}
const native = JSON.parse(
  readFileSync(new URL('./fixtures/unity-noise-statistics.json', import.meta.url), 'utf8'),
) as {
  count: number;
  pointSeed: number;
  cases: { label: string; seed: number; samples: Sample[] }[];
};
for (const sample of native.cases)
  it('measures Noise population statistics ' + sample.label + '/' + sample.seed, () => {
    const doc = minimalDocument();
    const pack = {
      nodes: doc.nodes,
      components: [],
      getNode: (id: number) => doc.nodes.find((n) => n.id === id),
    } as unknown as EffectPack;
    const source = particleSource();
    source.main!.maxParticles = native.count;
    source.main!.seed = sample.seed;
    source.main!.rotation3d = true;
    const noise = new NoiseModuleT();
    noise.algorithm = 'unity-particle-noise';
    noise.quality = sample.label === 'low' ? 0 : sample.label === 'medium' ? 1 : 2;
    noise.frequency = sample.label === 'frequency-zero' ? 0 : Math.fround(0.28);
    noise.damping = true;
    const strength = sample.label === 'calibrated-high' ? Math.fround(0.03) : 1;
    noise.strength = vector(strength, strength, strength);
    noise.positionAmount = constant(sample.label === 'rotation' || sample.label === 'size' ? 0 : 1);
    noise.rotationAmount = constant(sample.label === 'rotation' ? 1 : 0);
    noise.sizeAmount = constant(sample.label === 'size' ? 1 : 0);
    noise.scrollSpeed = constant(sample.label === 'scroll' ? 1 : 0);
    noise.octaves = sample.label === 'octaves' ? 3 : 1;
    noise.octaveMultiplier = 0.5;
    noise.octaveScale = 2;
    source.modules.push(new ParticleModuleT(M.NoiseModule, noise));
    const e = new Emitter(3, new Scene(pack, [1]).nodes.get(1)!, source, true, sample.seed, []);
    e.sync();
    e.emitting = false;
    e.count = native.count;
    let state = native.pointSeed;
    for (let i = 0; i < e.positions.length; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      e.positions[i] = (state >>> 8) * (32 / 16777216) - 16;
    }
    const origins = e.positions.slice();
    e.startSizes.fill(1);
    e.lifetimes.fill(10);
    for (let frame = 1; frame <= 60; frame++) {
      e.step(1 / 60);
      const expected = sample.samples.find((s) => s.frame === frame);
      if (!expected) continue;
      let displacement = 0,
        rotation = 0,
        size = 0;
      for (let i = 0; i < native.count; i++) {
        for (let axis = 0; axis < 3; axis++) {
          const k = i * 3 + axis;
          displacement += (e.positions[k]! - origins[k]!) ** 2;
          rotation += e.rotations[k]! ** 2;
          if (axis < 2 && e.noiseSizes) size += (Math.abs(e.noiseSizes[k]!) - 1) ** 2;
        }
      }
      const mode =
        sample.label === 'rotation'
          ? 'rotation'
          : sample.label === 'size'
            ? 'size'
            : 'displacement';
      const actual = Math.sqrt(
        (mode === 'rotation' ? rotation : mode === 'size' ? size : displacement) / native.count,
      );
      const target =
        mode === 'rotation'
          ? (expected.rotationRms * Math.PI) / 180
          : mode === 'size'
            ? expected.sizeDeltaRms
            : expected.displacementRms;
      expect(Number.isFinite(actual)).toBe(true);
      recordError(
        `noise.population.${sample.label}.frame${frame}.absolute`,
        actual - target,
        mode === 'rotation' ? 'rad' : mode === 'size' ? 'factor' : 'units',
        String(sample.seed),
      );
      if (target > 1e-8)
        recordError(
          `noise.population.${sample.label}.frame${frame}.relative`,
          (actual - target) / target,
          'fraction',
          String(sample.seed),
        );
    }
  });
